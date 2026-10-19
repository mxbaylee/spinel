import { useEffect, useRef, useState } from 'react';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import type { WorkspaceItem } from '../src/shared/workspace.ts';
import { itemsRequest } from './itemsApi.ts';
import { openSnapshotViewer } from './snapshotViewer.ts';

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
      const dispose = await openSnapshotViewer({
        container: container.current!,
        kind: loaded.item.kind === 'sheet' ? 'sheet' : 'doc',
        snapshot: loaded.snapshot,
        signal: loading.signal,
      });
      if (disposed) return queueMicrotask(dispose);
      cleanup = dispose;
      setReady(true);
    })().catch((cause) => {
      if (!disposed && !loading.signal.aborted)
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
