import { observeOfflineRecovery } from './offlineProbe.ts';
import { sheetImages, sheetImageOverride } from './sheetImages.ts';
import sheetDrawingEnglish from '@univerjs/preset-sheets-drawing/locales/en-US';
import { guestItemId } from './documentAccess.ts';
import { VersionNames } from './VersionNames.tsx';
import { FileExports } from './FileExports.tsx';
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
  SetRangeValuesCommand,
} from '@univerjs/sheets';
import { editorTheme, bindEditorTheme, installCanvasColors } from '../src/ui/editorTheme.ts';
import { getTheme } from '../src/ui/theme.ts';
import { presetStyle, displayPresetCell, presetCellForEditing } from '../src/ui/presetStyles.ts';
import { FillPresets } from '../src/ui/FillPresets.tsx';
import { UnitAction } from '@univerjs/protocol';
import { Collaborators, watchPresence } from './Collaborators.tsx';
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
  ClientEnglish,
  UIEnglish,
} from './collaboration.ts';
import type { SaveState } from '../src/shared/autosave.ts';
import { editorReady } from './editorReady.ts';

export function SheetEditor({
  id,
  name,
  onDirty,
}: {
  id: string;
  name: string;
  onDirty: (dirty: boolean) => void;
}) {
  const mobile = useRef(useMobileSheetControls()).current;
  const print = useRef<(() => Promise<void>) | null>(null);
  const applyFill = useRef<((id: string) => Promise<void>) | null>(null);
  const [editable, setEditable] = useState(false);
  const [people, setPeople] = useState<Collaborator[]>([]);
  const [presenceUnavailable, setPresenceUnavailable] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const controller = useRef<ReturnType<typeof watchCollaboration> | null>(null);
  const [status, setStatus] = useState<SaveState>({
    dirty: false,
    message: 'Loading spreadsheet…',
    failed: false,
  });
  useEffect(() => {
    let disposed = false;
    let stopPresence: (() => void) | undefined;
    let stopProbe: (() => void) | undefined;
    setPeople([]);
    setPresenceUnavailable(false);
    let editing = false;
    let disposeEditor: (() => void) | undefined;
    let save: ReturnType<typeof watchCollaboration> | undefined;
    let lastState = status;
    const publish = (state: SaveState) => {
      lastState = state;
      if (disposed) return;
      const dirty = editing || state.dirty;
      onDirty(dirty);
      setStatus({
        ...state,
        dirty,
        message: editing && !state.failed ? 'Editing cell — changes not saved yet.' : state.message,
      });
    };
    void (async () => {
      const data = await prepareCollaboration(id);
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
        collaboration: true,
        plugins: [
          ...collaborationPlugins(data.unitId, [[...sheetImageOverride]]),
          mobile ? UniverSheetsPrintMobileUIPlugin : UniverSheetsPrintPlugin,
        ],
        presets: [sheetPreset(container.current!, mobile), sheetImages(mobile)],
      });
      print.current = async () => {
        await univerAPI.executeCommand(SheetPrintOpenOperation.id);
      };
      // Sheet services are registered lazily when the first sheet is created.
      // Own disposal before awaiting load, then attach display hooks after readiness.
      disposeEditor = () => univer.dispose();
      installCanvasColors(univer);
      identifyCollaborator(univer, data.user);
      stopProbe = await observeOfflineRecovery(univer, data.unitId, data.user.id);
      if (disposed) {
        stopProbe();
        return;
      }
      const workbook = await univerAPI.getCollaboration().loadSheetAsync(data.unitId);
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
            return displayPresetCell(cell, style, getTheme());
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
      // Literal document colours render against light paper even with dark chrome.
      const render = univer
        .__getInjector()
        .get(IRenderManagerService)
        .getRenderUnitById(data.unitId);
      if (render) {
        const canvas = render.engine.getCanvasElement();
        canvas.style.backgroundColor = '#ffffff';
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
        stopTheme();
        interceptor.dispose();
        stopEditingTheme();
        univer.dispose();
      };
      const readOnly = async () => {
        setEditable(false);
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
      };
      if (data.access === 'viewer') await readOnly();
      save = watchCollaboration(univer, univerAPI, data.unitId, id, data.access, publish, readOnly);
      controller.current = save;
      setEditable(data.access !== 'viewer');
      applyFill.current = async (preset) => {
        const book = univerAPI.getActiveWorkbook();
        if (!book) throw new Error('Open a spreadsheet first.');
        const sheet = book.getActiveSheet(),
          range = sheet?.getActiveRange();
        if (!sheet || !range) throw new Error('Select cells to fill.');
        // Keep the cells chosen at the click, even if selection changes while
        // the SDK finishes an in-progress edit asynchronously.
        const target = { ...range.getRange() };
        await book.endEditingAsync(true);
        const result = await univerAPI.executeCommand(SetRangeValuesCommand.id, {
          unitId: data.unitId,
          subUnitId: sheet.getSheetId(),
          range: target,
          value: { s: presetStyle(preset, 'light') },
        });
        if (!result) throw new Error('Could not apply this fill. Check your access and try again.');
      };
      univerAPI.addEvent(univerAPI.Event.SheetEditChanging, () => {
        editing = true;
        publish(lastState);
      });
      univerAPI.addEvent(univerAPI.Event.SheetEditEnded, () => {
        editing = false;
        publish(lastState);
      });
      stopPresence = watchPresence(univer, univerAPI, data.unitId, setPeople, () =>
        setPresenceUnavailable(true),
      );
    })().catch((error) => {
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
      stopProbe?.();
      stopPresence?.();
      save?.dispose();
      // Univer owns a separate React root; unmount it after our cleanup commit.
      if (disposeEditor) queueMicrotask(disposeEditor);
      controller.current = null;
      applyFill.current = null;
      onDirty(false);
    };
    // Name is folder metadata; a rename must not recreate an editor with pending edits.
  }, [id]);
  return (
    <section className="sheet-editor" data-mobile={mobile} aria-label="Sheet document">
      <Collaborators people={people} />
      {presenceUnavailable && <p role="status">Could not load who is here.</p>}
      <FillPresets
        disabled={!editable || status.failed}
        apply={async (preset) => {
          if (!applyFill.current) throw new Error('Wait for the spreadsheet to load.');
          await applyFill.current(preset);
        }}
      />
      <div className="save-status" role="status" aria-label="Save status" aria-live="polite">
        {status.message}
        {status.failed && status.dirty && (
          <button onClick={() => controller.current?.retry()}>Retry saving</button>
        )}
      </div>
      {!guestItemId() && (
        <>
          <VersionNames
            id={id}
            saved={!status.dirty && !status.failed && Boolean(controller.current)}
          />
          <FileExports
            id={id}
            name={name}
            saved={!status.dirty && !status.failed && Boolean(controller.current)}
            print={async () => {
              if (!print.current) throw new Error('Wait for the spreadsheet to load.');
              await print.current();
            }}
          />
        </>
      )}
      <div className="univer-container" ref={container} />
    </section>
  );
}
