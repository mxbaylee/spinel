import { useEffect, useRef, useState } from 'react';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import { UniverDocsCorePreset } from '@univerjs/preset-docs-core';
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

type Preview = { snapshot: IDocumentData | IWorkbookData; item: WorkspaceItem; unitId: string };

/** Isolated native viewer: no collaboration client, autosave or live mutation transport. */
export function VersionPreview() {
  const query = new URLSearchParams(location.search);
  const id = query.get('item') ?? '',
    checkpoint = query.get('version') ?? '';
  const container = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<Preview | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void (async () => {
      const loaded = await itemsRequest<Preview>(`/${id}/history/${checkpoint}`);
      if (disposed) return;
      setData(loaded);
      const sheet = loaded.item.kind === 'sheet';
      const { univer, univerAPI } = createUniver({
        locale: LocaleType.EN_US,
        locales: {
          [LocaleType.EN_US]: mergeLocales(sheetsEnglish, docsEnglish, drawingEnglish, linkEnglish),
        },
        presets: sheet
          ? [UniverSheetsCorePreset({ container: container.current! })]
          : [
              UniverDocsCorePreset({ container: container.current! }),
              UniverDocsDrawingPreset(),
              UniverDocsHyperLinkPreset(),
            ],
      });
      cleanup = () => univer.dispose();
      if (sheet) univerAPI.createWorkbook(loaded.snapshot as IWorkbookData).setEditable(false);
      else
        await univerAPI
          .createDocument(loaded.snapshot as IDocumentData)
          .getPermission()
          .setReadOnly();
      await editorReady(univerAPI);
      if (!disposed) setReady(true);
    })().catch((cause) => {
      if (!disposed)
        setError(cause instanceof Error ? cause.message : 'Could not open this version.');
    });
    return () => {
      disposed = true;
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
    }
  };
  return (
    <section aria-label="Version preview">
      <h1>Preview — {data?.item.name ?? 'Saved version'}</h1>
      <p>Read only. The live document is unchanged.</p>
      <a href={`/?item=${encodeURIComponent(id)}`}>Back to live document</a>
      {data && data.item.access !== 'viewer' && (
        <button disabled={!ready || busy} onClick={() => void restore()}>
          {busy ? 'Restoring…' : 'Restore this version'}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {!ready && !error && <p role="status">Loading preview…</p>}
      <div className="univer-container" ref={container} />
    </section>
  );
}
