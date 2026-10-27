import { useEffect, useState } from 'react';
import { SheetEditor } from './SheetEditor.tsx';
import { DocEditor } from './DocEditor.tsx';
import {
  offlineAccountEvent,
  offlineAccountRead,
  openExistingOfflineStore,
} from './offline/offlineStore.ts';
import { checkBundle } from './offline/download.ts';
import { isRuntimeCompatible } from './offline/runtime.ts';
import type { ConnectionState } from './connectionState.ts';

/**
 * The same native editors restore their own durable queue on an offline launch.
 * A mounted editor owns its recovery result even after cleanup removes the bundle;
 * only a new mount rechecks availability. File-list badges can update independently.
 */
export function OfflineViewer({
  accountId,
  itemId,
  spaceId,
  name,
  onDirty = () => {},
  onConnectionState,
}: {
  accountId: string;
  itemId: string;
  spaceId?: string;
  name?: string;
  onDirty?: (dirty: boolean) => void;
  onConnectionState?: (state: ConnectionState | null) => void;
}) {
  const [item, setItem] = useState<{ kind: 'sheet' | 'doc'; name: string } | 'missing' | null>(
    null,
  );
  const [problem, setProblem] = useState('');
  useEffect(() => {
    let mounted = true;
    const current = offlineAccountRead(accountId);
    const changed = (event: StorageEvent) => {
      if (!offlineAccountEvent(event, accountId)) return;
      if (!current()) {
        setItem(null);
        setProblem('You signed out or changed accounts on this device.');
      }
    };
    window.addEventListener('storage', changed);
    void (async () => {
      const store = await openExistingOfflineStore(accountId);
      if (!store) {
        if (mounted && current()) setItem('missing');
        return;
      }
      const download = await store.bundle(itemId).finally(() => store.close());
      if (!mounted) return;
      if (!current()) throw new Error('This offline session is no longer current.');
      if (!download) {
        setItem('missing');
        return;
      }
      if (
        download.bundle.accountId !== accountId ||
        download.bundle.itemId !== itemId ||
        download.bundle.spaceId !== spaceId
      )
        throw new Error('This document is not prepared in this account or Space on this device.');
      if (
        !isRuntimeCompatible({
          format: download.bundle.version,
          sdkVersion: download.bundle.sdkVersion,
        })
      )
        throw new Error(
          'This saved copy needs a compatible version of Spinel. Its data is retained.',
        );
      checkBundle(download.bundle, accountId, itemId, spaceId);
      setItem({ kind: download.bundle.kind, name: download.bundle.name });
    })().catch((error) => {
      if (mounted)
        setProblem(error instanceof Error ? error.message : 'Could not open this device copy.');
    });
    return () => {
      mounted = false;
      window.removeEventListener('storage', changed);
    };
  }, [accountId, itemId, spaceId]);
  if (problem) return <p role="alert">{problem}</p>;
  if (item === 'missing')
    return (
      <p role="status">
        {name ?? 'This document'} needs a connection. It isn’t downloaded on this device.
      </p>
    );
  if (!item) return <p role="status">Opening offline copy…</p>;
  const Editor = item.kind === 'sheet' ? SheetEditor : DocEditor;
  return (
    <section aria-label="Offline copy">
      <Editor
        id={itemId}
        spaceId={spaceId}
        name={item.name}
        localAccountId={accountId}
        saveStatusTarget={null}
        onDirty={onDirty}
        onConnectionState={onConnectionState}
      />
    </section>
  );
}
