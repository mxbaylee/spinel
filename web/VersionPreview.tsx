import { sheetImages } from './sheetImages.ts';
import sheetDrawingEnglish from '@univerjs/preset-sheets-drawing/locales/en-US';
import { useEffect, useRef, useState } from 'react';
import { InterceptorEffectEnum, IPermissionService } from '@univerjs/core';
import { UnitAction } from '@univerjs/protocol';
import { setDocumentPermissionValue } from '@univerjs/docs';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import {
  SheetInterceptorService,
  SheetSkeletonService,
  INTERCEPTOR_POINT,
  getAllWorkbookPermissionPoint,
} from '@univerjs/sheets';
import { IRenderManagerService } from '@univerjs/engine-render';
import { editorTheme, bindEditorTheme, installCanvasColors } from '../src/ui/editorTheme.ts';
import { getTheme } from '../src/ui/theme.ts';
import { displayPresetCell } from '../src/ui/presetStyles.ts';
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
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
import type { WorkspaceItem } from '../src/shared/workspace.ts';
import { itemsRequest } from './itemsApi.ts';
import { editorReady } from './editorReady.ts';
import { documentReady } from './documentReady.ts';

type Preview = { snapshot: IDocumentData | IWorkbookData; item: WorkspaceItem; unitId: string };

/** Isolated native viewer: no collaboration client, autosave or live mutation transport. */
export function VersionPreview({
  id,
  checkpoint,
  onBusyChange,
}: {
  id: string;
  checkpoint: string;
  onBusyChange: (busy: boolean) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<Preview | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  useEffect(() => {
    let disposed = false;
    const loading = new AbortController();
    let cleanup: (() => void) | undefined;
    void (async () => {
      const loaded = await itemsRequest<Preview>(`/${id}/history/${checkpoint}`);
      if (disposed) return;
      setData(loaded);
      const sheet = loaded.item.kind === 'sheet';
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
          ? [UniverSheetsCorePreset({ container: container.current! }), sheetImages(false, false)]
          : [
              UniverDocsCorePreset({ container: container.current! }),
              { plugins: [[UniverDocsUIPlugin, { placeholder: false }]] },
              UniverDocsDrawingPreset(),
              UniverDocsHyperLinkPreset(),
            ],
      });
      cleanup = () => univer.dispose();
      installCanvasColors(univer);
      if (sheet) univerAPI.createWorkbook(loaded.snapshot as IWorkbookData).setEditable(false);
      else univerAPI.createDocument(loaded.snapshot as IDocumentData);
      await editorReady(univerAPI);
      if (disposed) return;
      if (!sheet) {
        await documentReady(univer, loaded.snapshot.id, loading.signal);
        if (disposed) return;
        // A preview needs a local UI fence, not an owner-only document policy.
        // The policy command can still permit its owner and changes the snapshot.
        // Use the same public local permission boundary as the live viewer.
        const permissions = univer.__getInjector().get(IPermissionService);
        setDocumentPermissionValue(
          permissions,
          loaded.snapshot.id,
          loaded.snapshot.id,
          UnitAction.Edit,
          false,
        );
        if (univerAPI.getActiveDocument()!.getPermission().canEdit())
          throw new Error('The preview could not be made read-only. Reload to try again.');
      }
      if (disposed) return;
      if (sheet) {
        // setEditable controls cell entry; the full permission set also fences
        // formatting, worksheet structure and other toolbar commands.
        const permissions = univer.__getInjector().get(IPermissionService);
        for (const Point of getAllWorkbookPermissionPoint()) {
          const point = new Point(loaded.snapshot.id);
          if (!permissions.getPermissionPoint(point.id)) permissions.addPermissionPoint(point);
          permissions.updatePermissionPoint(
            point.id,
            [UnitAction.View, UnitAction.Copy, UnitAction.Print].includes(point.subType),
          );
        }
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
      const unitId = loaded.snapshot.id;
      const render = univer.__getInjector().get(IRenderManagerService).getRenderUnitById(unitId);
      if (sheet && render) render.engine.getCanvasElement().style.backgroundColor = '#ffffff';
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
        stopTheme();
        interceptor?.dispose();
        univer.dispose();
      };
      if (!disposed) setReady(true);
    })().catch((cause) => {
      if (!disposed)
        setError(cause instanceof Error ? cause.message : 'Could not open this version.');
    });
    return () => {
      disposed = true;
      loading.abort();
      if (cleanup) queueMicrotask(cleanup);
    };
  }, [id, checkpoint]);
  const restore = async () => {
    if (
      !data ||
      !ready ||
      !window.confirm(
        'Restore this version for everyone? Accepted edits will finish first. The current document will be kept as “Before restore”. Other editors must refresh.',
      )
    )
      return;
    setBusy(true);
    onBusyChange(true);
    setError('');
    try {
      await itemsRequest(`/${id}/history/${checkpoint}/restore`, 'POST', {
        unitId: data.unitId,
        requestId: requestId.current,
      });
      location.assign(`/?item=${encodeURIComponent(id)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not restore this version.');
      setBusy(false);
      onBusyChange(false);
    }
  };
  return (
    <section aria-label="Version preview">
      <h2>Preview — {data?.item.name ?? 'Saved version'}</h2>
      <p>Read only. The live document is unchanged.</p>
      <a href={`/?item=${encodeURIComponent(id)}`}>Back to live document</a>
      {data && data.item.access !== 'viewer' && (
        <button disabled={!ready || busy} onClick={() => void restore()}>
          {busy ? 'Restoring…' : 'Restore this version'}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {error === 'Restore was interrupted. Start a new restore.' && (
        <button onClick={() => location.reload()}>Reload preview for a new attempt</button>
      )}
      {!ready && !error && <p role="status">Loading preview…</p>}
      <div
        className="univer-container"
        ref={container}
        style={{ visibility: ready ? 'visible' : 'hidden' }}
      />
    </section>
  );
}
