import { formulaPaperColors } from './DocFormulas.tsx';
import {
  installDocFormulas,
  type DocFormulaController,
  type FormulaDefinition,
  type FormulaResult,
  type FormulaState,
} from '@spinel/doc-formulas';
import { sheetImages } from './sheetImages.ts';
import { sheetPreset } from './sheetPreset.ts';
import { readOnlySheetDrawings } from './readOnlySheetDrawings.ts';
import sheetDrawingEnglish from '@univerjs/preset-sheets-drawing/locales/en-US';
import { InterceptorEffectEnum, IPermissionService, IURLImageService } from '@univerjs/core';
import type { IDocumentData, IWorkbookData, IURLImageService as URLImages } from '@univerjs/core';
import { UnitAction } from '@univerjs/protocol';
import { setDocumentPermissionValue } from '@univerjs/docs';
import { UniverDrawingPlugin } from '@univerjs/drawing';
import {
  SheetInterceptorService,
  SheetSkeletonService,
  INTERCEPTOR_POINT,
  getAllWorkbookPermissionPoint,
} from '@univerjs/sheets';
import { IRenderManagerService } from '@univerjs/engine-render';
import { CalculationMode } from '@univerjs/preset-sheets-core';
import { editorTheme, bindEditorTheme, installCanvasColors } from '../src/ui/editorTheme.ts';
import { getTheme } from '../src/ui/theme.ts';
import { displayPresetCell } from '../src/ui/presetStyles.ts';
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import type { IPreset } from '@univerjs/presets';
import { UniverDocsCorePreset, UniverDocsUIPlugin } from '@univerjs/preset-docs-core';
import { UniverDocsDrawingPreset } from '@univerjs/preset-docs-drawing';
import { UniverDocsHyperLinkPreset } from '@univerjs/preset-docs-hyper-link';
import sheetsEnglish from '@univerjs/preset-sheets-core/locales/en-US';
import docsEnglish from '@univerjs/preset-docs-core/locales/en-US';
import drawingEnglish from '@univerjs/preset-docs-drawing/locales/en-US';
import linkEnglish from '@univerjs/preset-docs-hyper-link/locales/en-US';
import '@univerjs/preset-sheets-core/lib/index.css';
import '@univerjs/preset-docs-core/lib/index.css';
import '@univerjs/preset-docs-drawing/lib/index.css';
import '@univerjs/preset-docs-hyper-link/lib/index.css';
import { editorReady } from './editorReady.ts';
import { documentReady } from './documentReady.ts';

/** Gives the drawing plugin a replacement image service, keeping its other options. */
function withImages(preset: IPreset, images: URLImages): IPreset {
  return {
    ...preset,
    plugins: preset.plugins.map((entry) => {
      const [plugin, config] = Array.isArray(entry) ? entry : [entry, undefined];
      if (plugin !== UniverDrawingPlugin) return entry;
      const current = (config as { override?: unknown[] } | undefined)?.override ?? [];
      return [
        plugin,
        { ...config, override: [...current, [IURLImageService, { useValue: images }]] },
      ];
    }),
  };
}

const aborted = () => new DOMException('The viewer was closed.', 'AbortError');

/**
 * An isolated, read-only native viewer for a stored snapshot: no collaboration
 * client, autosave or live mutation transport. Used by version previews and
 * offline copies. Resolves with a dispose function once the viewer is ready;
 * if `signal` aborts first it disposes itself and rejects.
 */
export async function openSnapshotViewer({
  container,
  kind,
  snapshot,
  signal,
  images,
  mobile = false,
  evaluateFormula,
  onFormulaChange,
}: {
  container: HTMLElement;
  kind: 'sheet' | 'doc';
  snapshot: IDocumentData | IWorkbookData;
  signal: AbortSignal;
  images?: URLImages;
  mobile?: boolean;
  evaluateFormula?: (definition: FormulaDefinition, signal: AbortSignal) => Promise<FormulaResult>;
  onFormulaChange?: (states: FormulaState[]) => void;
}) {
  const sheet = kind === 'sheet';
  const drawings = (preset: IPreset) => (images ? withImages(preset, images) : preset);
  const { univer, univerAPI } = createUniver({
    theme: editorTheme(),
    darkMode: getTheme() === 'dark',
    locale: LocaleType.EN_US,
    locales: {
      [LocaleType.EN_US]: mergeLocales(
        sheetsEnglish,
        docsEnglish,
        drawingEnglish,
        linkEnglish,
        sheetDrawingEnglish,
      ),
    },
    presets: sheet
      ? [
          // Offline (local images), show stored values only: computing IMAGE()
          // would load its URL with new Image(), outside the local image service.
          sheetPreset(
            container,
            mobile,
            images ? { initialFormulaComputing: CalculationMode.NO_CALCULATION } : undefined,
          ),
          drawings(sheetImages(mobile, false)),
        ]
      : [
          UniverDocsCorePreset({ container }),
          { plugins: [[UniverDocsUIPlugin, { placeholder: false }]] },
          drawings(UniverDocsDrawingPreset()),
          UniverDocsHyperLinkPreset(),
        ],
  });
  let formulas: DocFormulaController | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let stopVisibility: (() => void) | undefined;
  const closeFormulas = () => {
    clearInterval(interval);
    stopVisibility?.();
    formulas?.dispose();
  };
  let cleanup = () => {
    closeFormulas();
    univer.dispose();
  };
  try {
    installCanvasColors(univer);
    if (sheet) univerAPI.createWorkbook(snapshot as IWorkbookData).setEditable(false);
    else univerAPI.createDocument(snapshot as IDocumentData);
    await editorReady(univerAPI);
    if (signal.aborted) throw aborted();
    const unitId = snapshot.id;
    const permissions = univer.__getInjector().get(IPermissionService);
    if (!sheet) {
      await documentReady(univer, unitId, signal);
      if (signal.aborted) throw aborted();
      formulas = await installDocFormulas({
        univer,
        unitId,
        colors: formulaPaperColors,
        evaluate: evaluateFormula ?? (async () => ({ ok: false, reason: 'unavailable' })),
        onChange: onFormulaChange,
      });
      const refresh = () => {
        if (globalThis.document.visibilityState === 'hidden') formulas?.clear();
        else void formulas?.refresh();
      };
      globalThis.document.addEventListener('visibilitychange', refresh);
      stopVisibility = () => globalThis.document.removeEventListener('visibilitychange', refresh);
      if (evaluateFormula)
        interval = setInterval(() => {
          if (globalThis.document.visibilityState === 'visible') void formulas?.refresh();
        }, 5000);
      if (signal.aborted) throw aborted();
      // A viewer needs a local UI fence, not an owner-only document policy.
      // The policy command can still permit its owner and changes the snapshot.
      // Use the same public local permission boundary as the live viewer.
      setDocumentPermissionValue(permissions, unitId, unitId, UnitAction.Edit, false);
      if (univerAPI.getActiveDocument()!.getPermission().canEdit())
        throw new Error('The document could not be made read-only. Reload to try again.');
    } else {
      // setEditable controls cell entry; the full permission set also fences
      // formatting, worksheet structure and other toolbar commands.
      for (const Point of getAllWorkbookPermissionPoint()) {
        const point = new Point(unitId);
        if (!permissions.getPermissionPoint(point.id)) permissions.addPermissionPoint(point);
        permissions.updatePermissionPoint(
          point.id,
          [UnitAction.View, UnitAction.Copy, UnitAction.Print].includes(point.subType),
        );
      }
      readOnlySheetDrawings(univer, unitId);
    }
    const interceptor = sheet
      ? univer
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
          })
      : undefined;
    const render = univer.__getInjector().get(IRenderManagerService).getRenderUnitById(unitId);
    if (sheet && render) {
      const canvas = render.engine.getCanvasElement();
      canvas.style.backgroundColor = '#ffffff';
      canvas.setAttribute('aria-label', 'Spreadsheet grid');
    }
    const stopTheme = bindEditorTheme(
      univer,
      sheet
        ? () => {
            for (const skeleton of univer
              .__getInjector()
              .get(SheetSkeletonService)
              .getSkeletonsByUnitId(unitId))
              skeleton.makeDirty(true);
            univerAPI.getActiveWorkbook()?.getActiveSheet()?.refreshCanvas();
          }
        : undefined,
    );
    cleanup = () => {
      closeFormulas();
      stopTheme();
      interceptor?.dispose();
      univer.dispose();
    };
    if (signal.aborted) throw aborted();
    return cleanup;
  } catch (error) {
    // Univer owns a separate React root; unmount it after the caller's commit.
    queueMicrotask(cleanup);
    throw error;
  }
}
