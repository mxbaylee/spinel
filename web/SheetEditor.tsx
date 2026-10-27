import { SaveStatus } from './SaveStatus.tsx';
import { recordNativeMutationInventory } from './nativeMutationInventory.ts';
import { readOnlySheetDrawings } from './readOnlySheetDrawings.ts';
import { sheetImages } from './sheetImages.ts';
import sheetDrawingEnglish from '@univerjs/preset-sheets-drawing/locales/en-US';
import { EditorTools } from './EditorTools.tsx';
import { useEditorChrome } from './EditorFrame.tsx';
import { sheetPreset, useMobileSheetControls } from './sheetPreset.ts';
import { IRenderManagerService } from '@univerjs/engine-render';
import {
  CustomCommandExecutionError,
  ICommandService,
  IPermissionService,
  InterceptorEffectEnum,
} from '@univerjs/core';
import { SetImageFormulaDataMutation } from '@univerjs/engine-formula';
import { CalculationMode } from '@univerjs/preset-sheets-core';
import type { OfflineSession } from './offline/OfflineSession.ts';
import {
  getAllWorkbookPermissionPoint,
  SheetInterceptorService,
  SheetSkeletonService,
  INTERCEPTOR_POINT,
  BEFORE_CELL_EDIT,
} from '@univerjs/sheets';
import { editorTheme, bindEditorTheme, installCanvasColors } from '../src/ui/editorTheme.ts';
import { getTheme } from '../src/ui/theme.ts';
import { displayPresetCell, presetCellForEditing } from '../src/ui/presetStyles.ts';
import { UnitAction } from '@univerjs/protocol';
import { watchPresence } from './Collaborators.tsx';
import type { Collaborator } from './Collaborators.tsx';
import { useEffect, useRef, useState } from 'react';
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import enUS from '@univerjs/preset-sheets-core/locales/en-US';
import '@univerjs/preset-sheets-core/lib/index.css';
import {
  prepareEditor,
  identifyCollaborator,
  watchCollaboration,
  loadSpinelDocument,
  disposeSpinelSync,
} from './collaboration.ts';
import type { SaveState } from '../src/shared/autosave.ts';
import { editorReady } from './editorReady.ts';
import type { ConnectionState } from './connectionState.ts';
import { guestPendingBuffer } from './guestPendingBuffer.ts';
import type { RegisterGuestEditor } from './guestRevocation.ts';
import { nativeSyncPermissions } from './nativeSyncPermissions.ts';

export function SheetEditor({
  id,
  name,
  spaceId,
  onDirty,
  onConnectionState,
  saveStatusTarget,
  registerGuestEditor,
  localAccountId,
}: {
  id: string;
  name: string;
  spaceId?: string;
  saveStatusTarget: HTMLElement | null;
  onDirty: (dirty: boolean, retained?: boolean) => void;
  onConnectionState?: (state: ConnectionState | null) => void;
  registerGuestEditor?: RegisterGuestEditor;
  localAccountId?: string;
}) {
  const chrome = useEditorChrome();
  const mobile = useRef(useMobileSheetControls()).current;
  const [people, setPeople] = useState<Collaborator[]>([]);
  const container = useRef<HTMLDivElement>(null);
  const controller = useRef<ReturnType<typeof watchCollaboration> | null>(null);
  const [reloadGeneration, reload] = useState(0);
  const syncNotice = useRef<string | undefined>(undefined);
  const lastRoom = useRef('');
  const [status, setStatus] = useState<SaveState>({
    dirty: false,
    message: 'Loading spreadsheet…',
    failed: false,
  });
  useEffect(() => {
    let disposed = false;
    let offlineSession: OfflineSession | undefined;
    let initialized = false;
    let captureReady = false;
    const loading = new AbortController();
    const room = `${spaceId ?? ''}/${id}`;
    if (lastRoom.current !== room) syncNotice.current = undefined;
    lastRoom.current = room;
    onConnectionState?.('reconnecting');
    const publishConnection = (state: ConnectionState) => {
      if (!disposed) onConnectionState?.(state);
    };
    let stopPresence: (() => void) | undefined;
    setPeople([]);
    let editing = false;
    let freezeAfterEditing = false;
    let disposeEditor: (() => void) | undefined;
    let save: ReturnType<typeof watchCollaboration> | undefined;
    let lastState: SaveState = { dirty: false, failed: false, message: 'Loading spreadsheet…' };
    const publish = (state: SaveState) => {
      lastState = state;
      if (disposed) return;
      const dirty = editing || state.dirty;
      if (dirty && initialized) syncNotice.current = undefined;
      onDirty(dirty, Boolean(state.retained));
      setStatus({
        ...state,
        ...(editing ? { local: undefined } : {}),
        dirty,
        failed: state.failed || (initialized && Boolean(syncNotice.current)),
        message: editing
          ? freezeAfterEditing
            ? 'Your sign-in ended. Copy the unfinished cell text before signing in again.'
            : `Editing cell — changes not saved yet.${state.failed ? ` ${state.message}` : ''}`
          : state.failed
            ? state.message
            : ((initialized ? syncNotice.current : undefined) ?? state.message),
      });
    };
    publish(lastState);
    void (async () => {
      const data = await prepareEditor(id, spaceId, () => !disposed, localAccountId);
      offlineSession = data.offline;
      if (disposed) {
        offlineSession?.dispose();
        return;
      }
      const nativePermissions = nativeSyncPermissions(data.unitId, data.access);
      recordNativeMutationInventory();
      const { univer, univerAPI } = createUniver({
        theme: editorTheme(),
        darkMode: getTheme() === 'dark',
        locale: LocaleType.EN_US,
        locales: {
          [LocaleType.EN_US]: mergeLocales(enUS, sheetDrawingEnglish),
        },
        override: nativePermissions.override,
        presets: [
          sheetPreset(
            container.current!,
            mobile,
            data.offline?.enabled
              ? { initialFormulaComputing: CalculationMode.NO_CALCULATION }
              : undefined,
          ),
          sheetImages(mobile, data.offline),
        ],
      });
      // IMAGE formula results use a direct browser Image loader in the OSS
      // plugin. Stop only that derived result while local; ordinary formula
      // calculation and lazy native command registration remain untouched.
      const offlineImages = data.offline
        ? univer
            .__getInjector()
            .get(ICommandService)
            .beforeCommandExecuted((command) => {
              if (
                command.id === SetImageFormulaDataMutation.id &&
                data.offline!.enabled &&
                !data.offline!.online
              )
                throw new CustomCommandExecutionError('Formula images are unavailable offline.');
            })
        : undefined;
      // Sheet services are registered lazily when the first sheet is created.
      // Own disposal before awaiting load, then attach display hooks after readiness.
      disposeEditor = () => {
        offlineImages?.dispose();
        disposeSpinelSync(univer);
        univer.dispose();
      };
      // Register before unit loading can yield to input. An unfinished native
      // cell edit has no collaboration mutation yet, but still blocks leaving.
      const editingCell = () => {
        if (disposed) return;
        editing = true;
        if (chrome) chrome.editing.current = true;
        publish(lastState);
      };
      univerAPI.addEvent(univerAPI.Event.SheetEditStarted, editingCell);
      univerAPI.addEvent(univerAPI.Event.SheetEditChanging, editingCell);
      univerAPI.addEvent(univerAPI.Event.BeforeSheetEditStart, (event) => {
        if (freezeAfterEditing) event.cancel = true;
      });
      univerAPI.addEvent(univerAPI.Event.BeforeSheetEditEnd, (event) => {
        // Hiding the native editor is not a commit barrier: cross-sheet formula
        // submission awaits sheet activation. After expiry retain that draft
        // for copying instead of freezing permissions ahead of its submission.
        // Escape remains an explicit discard of the unfinished input.
        if (freezeAfterEditing && event.isConfirm) event.cancel = true;
      });
      univerAPI.addEvent(univerAPI.Event.SheetEditEnded, () => {
        if (disposed) return;
        editing = false;
        if (chrome) chrome.editing.current = false;
        publish(lastState);
        if (freezeAfterEditing)
          queueMicrotask(() => {
            if (!disposed && freezeAfterEditing) void readOnly();
          });
      });
      registerGuestEditor?.((retain) => {
        try {
          return retain ? guestPendingBuffer(univer) : null;
        } finally {
          disposed = true;
          stopPresence?.();
          save?.dispose();
          disposeEditor?.();
          disposeEditor = undefined;
        }
      });
      installCanvasColors(univer);
      identifyCollaborator(univer, data.user);
      const readOnly = async (preserveInput = false) => {
        if (preserveInput && editing) {
          // A current native cell editor has not emitted its mutation yet.
          // Keep it available for copying; the expired binding sends no frames.
          freezeAfterEditing = true;
          publish(lastState);
          return;
        }
        freezeAfterEditing = false;
        nativePermissions.readonly();
        // This tab's presentation follows its grant; never change shared permissions.
        const permissions = univer.__getInjector().get(IPermissionService);
        for (const Point of getAllWorkbookPermissionPoint()) {
          const point = new Point(data.unitId);
          if (!permissions.getPermissionPoint(point.id)) permissions.addPermissionPoint(point);
          permissions.updatePermissionPoint(
            point.id,
            [UnitAction.View, UnitAction.Copy, UnitAction.Print].includes(point.subType),
          );
        }
        readOnlySheetDrawings(univer, data.unitId);
      };
      await loadSpinelDocument({
        univer,
        unitId: data.unitId,
        itemId: id,
        spaceId,
        access: data.access,
        kind: 'sheet',
        signal: loading.signal,
        isCurrent: () => !disposed,
        offline: data.offline,
        canRefresh: () => !editing,
        lock: () => {
          disposeEditor?.();
          disposeEditor = undefined;
          publish({
            dirty: false,
            failed: true,
            local: 'attention',
            message: 'Offline access changed on this device. Reopen the document to continue.',
          });
        },
        initializeAccess: () => (data.access === 'viewer' ? readOnly() : undefined),
        onInitialPending: () =>
          publish({
            dirty: true,
            failed: false,
            message: 'Changes not saved yet — keep this tab open.',
          }),
        reload: (_reason, clean) => {
          if (disposed) return;
          initialized = false;
          syncNotice.current = clean
            ? undefined
            : 'The document was reloaded after a synchronization problem. Edits the server did not accept were discarded.';
          publish({
            dirty: false,
            failed: !clean,
            message: clean
              ? 'Loading the current saved document…'
              : 'Reloading after a synchronization problem…',
          });
          reload((generation) => generation + 1);
        },
      });
      const workbook = univerAPI.getActiveWorkbook();
      if (!workbook) throw new Error('Could not load this spreadsheet.');
      captureReady = true;
      await editorReady(univerAPI);
      if (disposed) return;
      const interceptor = univer
        .__getInjector()
        .get(SheetInterceptorService)
        .intercept(INTERCEPTOR_POINT.CELL_CONTENT, {
          effect: InterceptorEffectEnum.Style,
          handler(value, context, next) {
            const cell = next(value);
            if (!cell) return cell;
            const style = context.worksheet.getComposedCellStyleByCellData(
              context.row,
              context.col,
              cell,
            );
            return displayPresetCell(cell, style);
          },
        });
      const stopEditingTheme = univer
        .__getInjector()
        .get(SheetInterceptorService)
        .writeCellInterceptor.intercept(BEFORE_CELL_EDIT, {
          handler(value, context, next) {
            const cell = next(value);
            if (!cell) return cell;
            const style = context.worksheet.getComposedCellStyleByCellData(
              context.row,
              context.col,
              context.origin,
            );
            return presetCellForEditing(cell, context.origin, style);
          },
        });
      const render = univer
        .__getInjector()
        .get(IRenderManagerService)
        .getRenderUnitById(data.unitId);
      if (render) {
        const canvas = render.engine.getCanvasElement();
        canvas.setAttribute('aria-label', 'Spreadsheet grid');
      }
      const stopTheme = bindEditorTheme(univer, () => {
        // Invalidate cached display styles on inactive tabs as well.
        for (const skeleton of univer
          .__getInjector()
          .get(SheetSkeletonService)
          .getSkeletonsByUnitId(data.unitId))
          skeleton.makeDirty(true);
        univerAPI.getActiveWorkbook()?.getActiveSheet()?.refreshCanvas();
      });
      disposeEditor = () => {
        disposeSpinelSync(univer);
        stopTheme();
        interceptor.dispose();
        stopEditingTheme();
        univer.dispose();
      };
      if (data.access === 'viewer') await readOnly();
      stopPresence = await watchPresence(univer, univerAPI, data.unitId, setPeople);
      if (disposed) {
        stopPresence();
        return;
      }
      initialized = true;
      save = watchCollaboration(univer, publish, readOnly, publishConnection);
      controller.current = save;
    })().catch((error) => {
      // Failed checkpoint/SDK initialization must not leave a writable canvas
      // without native capture. A bound client may already own pending input.
      if (!captureReady) {
        disposeEditor?.();
        disposeEditor = undefined;
        offlineSession?.dispose();
      }
      publishConnection('offline');
      if (!disposed)
        publish({
          dirty: lastState.dirty,
          message:
            error instanceof Error
              ? error.message
              : 'Could not load this spreadsheet. Reload to try again.',
          failed: true,
        });
    });
    return () => {
      disposed = true;
      loading.abort();
      registerGuestEditor?.(null);
      stopPresence?.();
      save?.dispose();
      // Univer owns a separate React root; unmount it after our cleanup commit.
      if (disposeEditor) queueMicrotask(disposeEditor);
      offlineSession?.dispose();
      controller.current = null;
      if (chrome) chrome.editing.current = false;
      onDirty(false);
      onConnectionState?.(null);
    };
    // Name is folder metadata; a rename must not recreate an editor with pending edits.
  }, [id, spaceId, reloadGeneration]);
  return (
    <section className="sheet-editor" data-mobile={mobile} aria-label="Sheet document">
      <SaveStatus
        state={status}
        target={chrome?.saveTarget ?? saveStatusTarget}
        onRetry={() => controller.current?.retry()}
      />
      {!localAccountId && (
        <EditorTools
          id={id}
          spaceId={spaceId}
          name={name}
          people={people}
          saved={
            !status.dirty &&
            !status.failed &&
            (!status.local || status.local === 'synced') &&
            Boolean(controller.current)
          }
        />
      )}
      <div className="univer-container" ref={container} />
    </section>
  );
}
