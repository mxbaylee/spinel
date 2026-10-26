import type { FormulaResult, FormulaState } from '@spinel/doc-formulas';
import { FormulaReadout, formulaRequest } from './DocFormulas.tsx';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Modal } from '../src/ui/redesign/Controls.tsx';
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
  checkpointLabel = 'Selected saved version',
  controlsTarget,
  canRestore = true,
}: {
  id: string;
  spaceId?: string;
  checkpoint: string;
  onBusyChange: (busy: boolean) => void;
  checkpointLabel?: string;
  controlsTarget?: HTMLElement | null;
  canRestore?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [formulaStates, setFormulaStates] = useState<FormulaState[]>([]);
  const [data, setData] = useState<Preview | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const restoreRequest = useRef<AbortController | null>(null);
  const requestId = useRef(crypto.randomUUID());
  useEffect(() => {
    let disposed = false;
    const loading = new AbortController();
    let cleanup: (() => void) | undefined;
    setData(null);
    setReady(false);
    setError('');
    setFormulaStates([]);
    void (async () => {
      const loaded = await historyRequest<Preview>(
        id,
        `/${encodeURIComponent(checkpoint)}`,
        'GET',
        undefined,
        spaceId,
        loading.signal,
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
  }, [id, spaceId, checkpoint, refresh]);
  useEffect(() => {
    requestId.current = crypto.randomUUID();
    setConfirming(false);
    setBusy(false);
    return () => {
      restoreRequest.current?.abort();
      restoreRequest.current = null;
      onBusyChange(false);
    };
  }, [id, spaceId, checkpoint, onBusyChange]);
  const liveHref = spaceId
    ? spaceHref(spaceId, { kind: 'page', id })
    : `/?item=${encodeURIComponent(id)}`;
  const restore = async () => {
    if (!data || !ready || !canRestore || data.item.access === 'viewer' || restoreRequest.current)
      return;
    const request = new AbortController();
    restoreRequest.current = request;
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
        request.signal,
      );
      if (request.signal.aborted) return;
      location.assign(liveHref);
    } catch (cause) {
      if (request.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : 'Could not restore this version.');
      setBusy(false);
    } finally {
      if (restoreRequest.current === request) restoreRequest.current = null;
    }
  };
  const restoreButton = data && canRestore && data.item.access !== 'viewer' && (
    <Button
      primary
      disabled={!ready || busy}
      onClick={() => {
        setConfirming(true);
        onBusyChange(true);
      }}
    >
      {busy ? 'Restoring…' : 'Restore this version'}
    </Button>
  );
  return (
    <section aria-label="Version preview" className="history-preview">
      <h2>Preview — {data?.item.name ?? 'Saved version'}</h2>
      <p>Read only. The live document is unchanged.</p>
      {controlsTarget ? createPortal(restoreButton, controlsTarget) : restoreButton}
      {error && !confirming && <p role="alert">{error}</p>}
      {!ready && error && (
        <Button onClick={() => setRefresh((value) => value + 1)}>Try again</Button>
      )}
      {!ready && !error && <p role="status">Loading preview…</p>}
      {ready && <FormulaReadout states={formulaStates} />}
      <div
        className="univer-container"
        ref={container}
        style={{ visibility: ready ? 'visible' : 'hidden' }}
      />
      {confirming && (
        <Modal
          icon="history"
          title={`Restore ${checkpointLabel} for everyone?`}
          description="Accepted edits will finish first. The current document will be kept as a Before restore checkpoint. Other open editors must refresh."
          open
          dismissDisabled={busy}
          onOpenChange={(open) => {
            if (!open && !busy) {
              setConfirming(false);
              onBusyChange(false);
            }
          }}
        >
          {error && <p role="alert">{error}</p>}
          {error === 'Restore was interrupted. Start a new restore.' && (
            <Button onClick={() => location.reload()}>Reload preview for a new attempt</Button>
          )}
          <div className="sp-actions">
            <Button
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                onBusyChange(false);
              }}
            >
              Cancel
            </Button>
            <Button
              primary
              disabled={
                busy ||
                !canRestore ||
                !ready ||
                error === 'Restore was interrupted. Start a new restore.'
              }
              onClick={() => void restore()}
            >
              {busy ? 'Restoring…' : 'Restore version'}
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
