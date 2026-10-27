import { lazy, Suspense, useEffect, useState } from 'react';
import { EditorFrame } from './EditorFrame.tsx';
import type { ConnectionState } from './connectionState.ts';
import type { NavigationGuard } from './navigation.ts';
import type { OfflineDownload } from './offline/offlineStore.ts';
import {
  hasOfflineEdits,
  offlineAccountEvent,
  offlineAccountRead,
  openOfflineStore,
} from './offline/offlineStore.ts';
import './offlineRecovery.css';

const OfflineViewer = lazy(() =>
  import('./OfflineViewer.tsx').then((m) => ({ default: m.OfflineViewer })),
);

/** Recovery must remain reachable when the original item or Space no longer opens. */
export function OfflineRecoveryEntry({
  accountId,
  itemId,
  navigation,
  connection,
  onConnectionState,
}: {
  accountId: string;
  itemId: string;
  navigation: NavigationGuard;
  connection: ConnectionState;
  onConnectionState?: (state: ConnectionState | null) => void;
}) {
  const [item, setItem] = useState<{ name: string; spaceId?: string } | null>(null);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    let mounted = true;
    const current = offlineAccountRead(accountId);
    const changed = (event: StorageEvent) => {
      if (offlineAccountEvent(event, accountId) && !current()) {
        setItem(null);
        setProblem('You signed out or changed accounts on this device.');
      }
    };
    window.addEventListener('storage', changed);
    void (async () => {
      if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(itemId))
        throw new Error('This recovery link is not valid.');
      if (!current()) throw new Error('This account has no prepared device copy here.');
      const store = await openOfflineStore(accountId);
      const download = await store.bundle(itemId).finally(() => store.close());
      if (!mounted) return;
      if (!current()) throw new Error('This offline session is no longer current.');
      if (
        !download ||
        download.bundle.accountId !== accountId ||
        download.bundle.itemId !== itemId ||
        !hasOfflineEdits(download.outbox)
      )
        throw new Error('There are no saved offline changes for this document on this device.');
      setItem({ name: download.bundle.name, spaceId: download.bundle.spaceId });
    })().catch((error) => {
      if (mounted)
        setProblem(error instanceof Error ? error.message : 'Could not open this device copy.');
    });
    return () => {
      mounted = false;
      window.removeEventListener('storage', changed);
    };
  }, [accountId, itemId]);
  const back = () => {
    if (navigation.allow()) location.assign('/');
  };
  if (problem)
    return (
      <section className="offline-recovery-entry">
        <h1>Offline changes</h1>
        <p role="alert">{problem}</p>
        <button onClick={back}>My files</button>
      </section>
    );
  if (!item) return <p role="status">Opening offline changes…</p>;
  return (
    <EditorFrame
      name={item.name}
      contextLabel="Offline changes on this device"
      connection={connection}
      documentKey={itemId}
      onBack={back}
      backLabel="My files"
    >
      <Suspense fallback={<p role="status">Opening offline changes…</p>}>
        <OfflineViewer
          accountId={accountId}
          itemId={itemId}
          spaceId={item.spaceId}
          onDirty={navigation.dirty}
          onConnectionState={onConnectionState}
        />
      </Suspense>
    </EditorFrame>
  );
}

export function OfflineRecoveryList({
  downloads,
  navigation,
}: {
  downloads: Iterable<OfflineDownload>;
  navigation: NavigationGuard;
}) {
  const pending = [...downloads]
    .filter((item) => item.pending)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!pending.length) return null;
  return (
    <section className="offline-recovery-list" aria-labelledby="offline-recovery-heading">
      <h2 id="offline-recovery-heading">Offline changes on this device</h2>
      <p>Open these device copies to recover, export, or discard saved changes.</p>
      <ul>
        {pending.map((item) => (
          <li key={item.itemId}>
            <a
              href={`/?offlineRecovery=${encodeURIComponent(item.itemId)}`}
              onClick={(event) => {
                if (!navigation.allow()) event.preventDefault();
              }}
            >
              Recover {item.name}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
