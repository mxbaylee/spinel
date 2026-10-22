import type { FormulaState } from '@spinel/doc-formulas';
import { FormulaReadout } from './DocFormulas.tsx';
import { useEffect, useRef, useState } from 'react';
import { OfflineAccess, offlineScope } from './offline/OfflineAccess.ts';
import { PreparedImages } from './offline/PreparedImages.ts';
import { openOfflineStore, preparedAccount } from './offline/offlineStore.ts';
import { useMobileSheetControls } from './sheetPreset.ts';
import { openSnapshotViewer } from './snapshotViewer.ts';

/**
 * Opens this device's copy of a document, read-only, with images from the
 * verified local copies only. It never reaches the server: there is no
 * collaboration client, autosave or remote image fallback.
 */
export function OfflineViewer({
  accountId,
  itemId,
  spaceId,
}: {
  accountId: string;
  itemId: string;
  spaceId?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mobile = useMobileSheetControls();
  const [formulaStates, setFormulaStates] = useState<FormulaState[]>([]);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    const loading = new AbortController();
    let access: OfflineAccess | undefined;
    let images: PreparedImages | undefined;
    let dispose: (() => void) | undefined;
    const close = () => {
      dispose?.();
      images?.dispose();
      access?.dispose();
    };
    // Another tab signing out or switching account ends this view at once.
    const watch = () => {
      if (preparedAccount() !== accountId) access?.lock('You signed out on this device.');
    };
    window.addEventListener('storage', watch);
    void (async () => {
      const store = await openOfflineStore(accountId);
      const stored = await store.bundle(itemId).finally(() => store.close());
      if (loading.signal.aborted) return;
      if (!stored) throw new Error('This document is no longer on this device.');
      const { bundle, bytes } = stored;
      if (bundle.accountId !== accountId || preparedAccount() !== accountId)
        throw new Error('This copy belongs to another account.');
      if (bundle.itemId !== itemId || bundle.spaceId !== spaceId)
        throw new Error('This copy belongs to another document or Space.');
      access = new OfflineAccess(offlineScope(bundle));
      access.subscribe((state) => {
        if (state.phase === 'disposed') return;
        setProblem(state.reason ?? 'This copy can’t be shown right now.');
        // Univer would keep showing what it already drew; take it down.
        const shown = dispose;
        dispose = undefined;
        if (shown) queueMicrotask(shown);
      });
      images = await PreparedImages.prepare(access, bundle.images, bytes, preparedAccount);
      if (loading.signal.aborted) return;
      const shown = await openSnapshotViewer({
        container: container.current!,
        kind: bundle.kind,
        snapshot: images.localize(bundle.snapshot),
        signal: loading.signal,
        images,
        mobile: bundle.kind === 'sheet' && mobile,
        onFormulaChange: (states) => {
          if (!loading.signal.aborted) setFormulaStates([...states]);
        },
      });
      // Closed or locked while it opened: nothing else will take it down.
      if (loading.signal.aborted || !access.mayReadLocal) return shown();
      dispose = shown;
      setReady(true);
    })().catch((cause) => {
      if (loading.signal.aborted) return;
      setProblem(cause instanceof Error ? cause.message : 'Could not open the offline copy.');
    });
    return () => {
      loading.abort();
      window.removeEventListener('storage', watch);
      // Univer owns a separate React root; unmount it after this commit.
      queueMicrotask(close);
    };
  }, [accountId, itemId, spaceId, mobile]);
  return (
    <section aria-label="Offline copy">
      {problem ? (
        <p role="alert">{problem}</p>
      ) : ready ? (
        <p role="status">Read only on this device. Reconnect to edit.</p>
      ) : (
        <p role="status">Opening offline copy…</p>
      )}
      {ready && !problem && <FormulaReadout states={formulaStates} />}
      <div
        className="univer-container"
        ref={container}
        style={{ visibility: ready && !problem ? 'visible' : 'hidden' }}
      />
    </section>
  );
}
