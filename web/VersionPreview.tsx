import type { FormulaResult, FormulaState } from '@spinel/doc-formulas';
import { FormulaReadout, formulaRequest } from './DocFormulas.tsx';
import { useEffect, useRef, useState } from 'react';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import type { WorkspaceItem } from '../src/shared/workspace.ts';
import { historyRequest } from './historyApi.ts';
import { spaceHref } from './spaceNavigation.ts';
import { openSnapshotViewer } from './snapshotViewer.ts';

type Preview = { snapshot: IDocumentData | IWorkbookData; item: WorkspaceItem; unitId: string };

/** Isolated native viewer: no collaboration client, autosave or live mutation transport. */
export function VersionPreview({
  id,
  spaceId,
  checkpoint,
  onBusyChange,
}: {
  id: string;
  spaceId?: string;
  checkpoint: string;
  onBusyChange: (busy: boolean) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [formulaStates, setFormulaStates] = useState<FormulaState[]>([]);
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
      const loaded = await historyRequest<Preview>(
        id,
        `/${encodeURIComponent(checkpoint)}`,
        'GET',
        undefined,
        spaceId,
      );
      if (disposed) return;
      setData(loaded);
      const dispose = await openSnapshotViewer({
        container: container.current!,
        kind: loaded.item.kind === 'sheet' ? 'sheet' : 'doc',
        snapshot: loaded.snapshot,
        signal: loading.signal,
        evaluateFormula: (definition, signal) =>
          formulaRequest<FormulaResult>(id, 'evaluate', { definition }, signal, spaceId),
        onFormulaChange: (states) => {
          if (!disposed) setFormulaStates([...states]);
        },
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
  }, [id, spaceId, checkpoint]);
  const liveHref = spaceId
    ? spaceHref(spaceId, { kind: 'page', id })
    : `/?item=${encodeURIComponent(id)}`;
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
      await historyRequest(
        id,
        `/${encodeURIComponent(checkpoint)}/restore`,
        'POST',
        {
          unitId: data.unitId,
          requestId: requestId.current,
        },
        spaceId,
      );
      location.assign(liveHref);
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
      <a href={liveHref}>Back to live document</a>
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
      {ready && <FormulaReadout states={formulaStates} />}
      <div
        className="univer-container"
        ref={container}
        style={{ visibility: ready ? 'visible' : 'hidden' }}
      />
    </section>
  );
}
