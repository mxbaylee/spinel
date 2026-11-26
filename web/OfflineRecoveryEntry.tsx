import { lazy, Suspense, useEffect, useState } from 'react';
import { EditorFrame } from './EditorFrame.tsx';
import type { ConnectionState } from './connectionState.ts';
import type { NavigationGuard } from './navigation.ts';
import {
  hasOfflineEdits,
  offlineAccountEvent,
  offlineAccountRead,
  openExistingOfflineStore,
} from './offline/offlineStore.ts';
import './offlineRecovery.css';
import { LoadingReview } from '../src/ui/redesign/LoadingReview.tsx';

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
  const [item, setItem] = useState<{
    name: string;
    spaceId?: string;
    creation: boolean;
  } | null>(null);
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
      const store = await openExistingOfflineStore(accountId);
      if (!store)
        throw new Error('There are no saved offline changes for this document on this device.');
      const download = await store.bundle(itemId).finally(() => store.close());
      if (!mounted) return;
      if (!current()) throw new Error('This offline session is no longer current.');
      if (
        !download ||
        download.bundle.accountId !== accountId ||
        download.bundle.itemId !== itemId ||
        (!download.creation && !hasOfflineEdits(download.outbox))
      )
        throw new Error('There are no saved offline changes for this document on this device.');
      setItem({
        name: download.bundle.name,
        spaceId: download.bundle.spaceId,
        creation: Boolean(download.creation),
      });
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
  if (!item) return <LoadingReview size="compact" label="Opening offline changes…" />;
  return (
    <EditorFrame
      name={item.name}
      contextLabel="Needs attention: changes saved on this device"
      connection={connection}
      documentKey={itemId}
      onBack={back}
      backLabel={item.creation ? 'Back to files' : 'My files'}
    >
      <Suspense fallback={<LoadingReview size="compact" label="Opening offline changes…" />}>
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
