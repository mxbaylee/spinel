import { SaveStatus } from './SaveStatus.tsx';
import { readOnlySheetDrawings } from './readOnlySheetDrawings.ts';
import { sheetImages, sheetImageOverride } from './sheetImages.ts';
import sheetDrawingEnglish from '@univerjs/preset-sheets-drawing/locales/en-US';
import { EditorTools } from './EditorTools.tsx';
import { useEditorChrome } from './EditorFrame.tsx';
import { sheetPreset, useMobileSheetControls } from './sheetPreset.ts';
import {
  SheetPrintOpenOperation,
  UniverSheetsPrintPlugin,
  UniverSheetsPrintMobileUIPlugin,
} from '@univerjs-pro/sheets-print';
import printEnglish from '@univerjs-pro/sheets-print/locale/en-US';
import '@univerjs-pro/sheets-print/lib/index.css';
import { IRenderManagerService } from '@univerjs/engine-render';
import { IPermissionService, InterceptorEffectEnum } from '@univerjs/core';
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
  collaborationPlugins,
  prepareCollaboration,
  identifyCollaborator,
  watchCollaboration,
  loadSpinelDocument,
  disposeSpinelSync,
  ClientEnglish,
  UIEnglish,
} from './collaboration.ts';
import type { SaveState } from '../src/shared/autosave.ts';
import { editorReady } from './editorReady.ts';
import type { ConnectionState } from './connectionState.ts';
import { guestPendingBuffer } from './guestPendingBuffer.ts';
import type { RegisterGuestEditor } from './guestRevocation.ts';

export function SheetEditor({
  id,
  name,
  spaceId,
  onDirty,
  onConnectionState,
  saveStatusTarget,
  registerGuestEditor,
}: {
  id: string;
  name: string;
  spaceId?: string;
  saveStatusTarget: HTMLElement | null;
  onDirty: (dirty: boolean) => void;
  onConnectionState?: (state: ConnectionState | null) => void;
  registerGuestEditor?: RegisterGuestEditor;
}) {
  const chrome = useEditorChrome();
  const mobile = useRef(useMobileSheetControls()).current;
  const print = useRef<(() => Promise<void>) | null>(null);
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
    let disposeEditor: (() => void) | undefined;
    let save: ReturnType<typeof watchCollaboration> | undefined;
    let lastState = status;
    const publish = (state: SaveState) => {
      lastState = state;
      if (disposed) return;
      const dirty = editing || state.dirty;
      if (dirty) syncNotice.current = undefined;
      onDirty(dirty);
      setStatus({
        ...state,
        dirty,
        failed: state.failed || Boolean(syncNotice.current),
        message: editing
          ? `Editing cell — changes not saved yet.${state.failed ? ` ${state.message}` : ''}`
          : state.failed
            ? state.message
            : (syncNotice.current ?? state.message),
      });
    };
    void (async () => {
      const data = await prepareCollaboration(id, spaceId, () => !disposed);
      if (disposed) return;
      const { univer, univerAPI } = createUniver({
        theme: editorTheme(),
        darkMode: getTheme() === 'dark',
        locale: LocaleType.EN_US,
        locales: {
          [LocaleType.EN_US]: mergeLocales(
            enUS,
            ClientEnglish,
            UIEnglish,
            printEnglish,
            sheetDrawingEnglish,
          ),
        },
        ...(data.syncVersion !== 1 ? { collaboration: true as const } : {}),
        plugins: [
          ...collaborationPlugins(
            data.unitId,
            [[...sheetImageOverride]],
            false,
            spaceId ? { spaceId, itemId: id } : undefined,
            data.syncVersion === 1,
          ),
          mobile ? UniverSheetsPrintMobileUIPlugin : UniverSheetsPrintPlugin,
        ],
        presets: [
          sheetPreset(container.current!, mobile),
          sheetImages(mobile, data.syncVersion !== 1),
        ],
      });
      print.current = async () => {
        await univerAPI.executeCommand(SheetPrintOpenOperation.id);
      };
      // Sheet services are registered lazily when the first sheet is created.
      // Own disposal before awaiting load, then attach display hooks after readiness.
      disposeEditor = () => {
        disposeSpinelSync(univer);
        univer.dispose();
      };
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
      const readOnly = async () => {
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
      if (data.syncVersion === 1)
        await loadSpinelDocument({
          univer,
          unitId: data.unitId,
          itemId: id,
          spaceId,
          access: data.access,
          kind: 'sheet',
          signal: loading.signal,
          isCurrent: () => !disposed,
          initializeAccess: () => (data.access === 'viewer' ? readOnly() : undefined),
          reload: () => {
            if (disposed) return;
            syncNotice.current =
              'The document was reloaded after a synchronization problem. Edits the server did not accept were discarded.';
            publish({
              dirty: false,
              failed: true,
              message: 'Reloading after a synchronization problem…',
            });
            reload((generation) => generation + 1);
          },
        });
      const workbook =
        data.syncVersion === 1
          ? univerAPI.getActiveWorkbook()
          : await univerAPI.getCollaboration().loadSheetAsync(data.unitId);
      if (!workbook) throw new Error('Could not load this spreadsheet.');
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
      save = watchCollaboration(
        univer,
        univerAPI,
        data.unitId,
        id,
        data.access,
        publish,
        readOnly,
        publishConnection,
        spaceId,
      );
      controller.current = save;
      stopPresence = await watchPresence(univer, univerAPI, data.unitId, setPeople);
      if (disposed) {
        stopPresence();
        return;
      }
      univerAPI.addEvent(univerAPI.Event.SheetEditChanging, () => {
        editing = true;
        if (chrome) chrome.editing.current = true;
        publish(lastState);
      });
      univerAPI.addEvent(univerAPI.Event.SheetEditEnded, () => {
        editing = false;
        if (chrome) chrome.editing.current = false;
        publish(lastState);
      });
    })().catch((error) => {
      publishConnection('offline');
      if (!disposed)
        publish({
          dirty: false,
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
      <EditorTools
        id={id}
        spaceId={spaceId}
        name={name}
        people={people}
        saved={!status.dirty && !status.failed && Boolean(controller.current)}
        print={async () => {
          if (!print.current) throw new Error('Wait for the spreadsheet to load.');
          await print.current();
        }}
      />
      <div className="univer-container" ref={container} />
    </section>
  );
}
