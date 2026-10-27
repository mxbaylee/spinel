import { useLayoutEffect, useRef, useState } from 'react';
import { DeviceStoragePanel } from './DeviceStoragePanel.tsx';
import type { DeviceStorageDialog, DeviceStorageOperation } from './DeviceStoragePanel.tsx';
import {
  readDeviceInventory,
  removeDeviceCopy,
  requestPersistence,
} from './offline/deviceStorage.ts';
import type { DeviceInventory } from './offline/deviceStorage.ts';
import {
  offlinePreparation,
  watchOfflineAccount,
  watchOfflineChanges,
} from './offline/offlineStore.ts';

const ended = () => new DOMException('This device view is no longer current.', 'AbortError');

/** Only the selected account's mounted This device section may read private summaries. */
export function DeviceStorage({ accountId }: { accountId: string }) {
  const [inventory, setInventory] = useState<DeviceInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false);
  const [operation, setOperation] = useState<DeviceStorageOperation>(null);
  const [dialog, setDialog] = useState<DeviceStorageDialog>(null);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const [retry, setRetry] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const lifetime = useRef<{ verify: () => void; refresh: () => Promise<void> } | null>(null);
  const busy = useRef(false);

  useLayoutEffect(() => {
    let active = true;
    let reading = false;
    let again = false;
    let generation = 0;
    const pendingDuringRead = new Map<string, boolean>();
    setInventory(null);
    setDialog(null);
    setMessage(null);
    setError('');
    setLocked(false);
    setOperation(null);
    setLoading(true);
    busy.current = false;
    const stopWatching = watchOfflineAccount();
    let current: () => boolean;
    try {
      current = offlinePreparation(accountId, () => active).isCurrent;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Device storage is unavailable.');
      setLoading(false);
      return () => {
        active = false;
        stopWatching();
      };
    }
    const verify = () => {
      if (!active) throw ended();
      if (!current()) {
        invalidate();
        throw ended();
      }
    };
    const invalidate = () => {
      active = false;
      generation++;
      lifetime.current = null;
      busy.current = false;
      setInventory(null);
      setDialog(null);
      setMessage(null);
      setOperation(null);
      setLoading(false);
      setLocked(true);
      setError('You signed out or changed accounts on this device.');
    };
    const refresh = async () => {
      if (!active) return;
      if (!current()) {
        invalidate();
        return;
      }
      if (reading || busy.current) {
        again = true;
        return;
      }
      reading = true;
      pendingDuringRead.clear();
      const attempt = ++generation;
      setLoading(true);
      try {
        const result = await readDeviceInventory(accountId, verify);
        verify();
        if (attempt !== generation) return;
        if (busy.current) {
          again = true;
          return;
        }
        setInventory({
          ...result,
          // A checkpoint can commit while an older snapshot's images hash.
          // Apply its newer flag only to rows the completed read actually found.
          items: result.items.map((item) =>
            pendingDuringRead.has(item.itemId)
              ? { ...item, pending: pendingDuringRead.get(item.itemId) }
              : item,
          ),
        });
        setError('');
      } catch (cause) {
        if (!active) return;
        if (!current()) {
          invalidate();
          return;
        }
        if (attempt === generation)
          setError(
            cause instanceof Error ? cause.message : 'Could not check this device. Try again.',
          );
      } finally {
        reading = false;
        if (active && attempt === generation) setLoading(false);
        if (active && again && !busy.current) {
          again = false;
          void refresh();
        }
      }
    };
    lifetime.current = { verify, refresh };
    const accountChanged = () => {
      if (active && !current()) invalidate();
    };
    const stopChanges = watchOfflineChanges(accountId, (change) => {
      if (!active) return;
      if (!current()) {
        invalidate();
        return;
      }
      if (typeof change.pending === 'boolean') {
        // A checkpoint status transition does not justify rehashing every image.
        // Estimates and complete availability are checked on the next refresh.
        if (reading) pendingDuringRead.set(change.itemId, change.pending);
        setInventory(
          (previous) =>
            previous && {
              ...previous,
              items: previous.items.map((item) =>
                item.itemId === change.itemId ? { ...item, pending: change.pending } : item,
              ),
            },
        );
        return;
      }
      void refresh();
    });
    const foreground = () => {
      if (document.visibilityState !== 'hidden') void refresh();
    };
    window.addEventListener('spinel-offline-account-changed', accountChanged);
    window.addEventListener('storage', accountChanged);
    window.addEventListener('focus', foreground);
    window.addEventListener('pageshow', foreground);
    document.addEventListener('visibilitychange', foreground);
    void refresh();
    return () => {
      active = false;
      generation++;
      lifetime.current = null;
      window.removeEventListener('spinel-offline-account-changed', accountChanged);
      window.removeEventListener('storage', accountChanged);
      window.removeEventListener('focus', foreground);
      window.removeEventListener('pageshow', foreground);
      document.removeEventListener('visibilitychange', foreground);
      stopWatching();
      stopChanges();
    };
  }, [accountId, retry]);

  function openDialog(next: DeviceStorageDialog, from?: HTMLElement) {
    if (busy.current) return;
    if (from) trigger.current = from;
    setDialog(next);
    setMessage(null);
  }

  async function protect() {
    const scope = lifetime.current;
    if (!scope || busy.current) return;
    try {
      scope.verify();
    } catch {
      return;
    }
    busy.current = true;
    setOperation('persistence');
    setMessage(null);
    try {
      const persistence = await requestPersistence();
      scope.verify();
      setInventory((previous) => previous && { ...previous, persistence });
      setMessage({
        text:
          persistence === 'granted'
            ? 'Storage protection was granted. It is not a backup or a guarantee.'
            : persistence === 'denied'
              ? 'Storage protection was not granted. Your existing device copies are kept.'
              : persistence === 'unsupported'
                ? 'This browser does not offer storage protection. Your existing device copies are kept.'
                : 'Storage protection could not be requested. Your existing device copies are kept.',
        failed: persistence === 'error',
      });
    } catch (cause) {
      if (lifetime.current === scope)
        setMessage({
          text: cause instanceof Error ? cause.message : 'Could not request storage protection.',
          failed: true,
        });
    } finally {
      if (lifetime.current === scope) {
        busy.current = false;
        setOperation(null);
        void scope.refresh();
      }
    }
  }

  async function remove() {
    const scope = lifetime.current;
    if (!scope || busy.current || dialog?.kind !== 'remove') return;
    const selected = dialog;
    try {
      scope.verify();
    } catch {
      return;
    }
    busy.current = true;
    setOperation({ itemId: selected.item.itemId });
    setMessage(null);
    try {
      const result = await removeDeviceCopy(accountId, selected.item.itemId, scope.verify, {
        discardPending: selected.discard === true,
      });
      scope.verify();
      if (result.status === 'needs-recovery') {
        setDialog({ kind: 'remove', item: { ...selected.item, pending: true } });
        setMessage({
          text: 'This copy now has saved or unverified offline changes. Nothing was removed.',
          failed: false,
        });
      } else {
        setInventory(
          (previous) =>
            previous && {
              ...previous,
              items: previous.items.filter((item) => item.itemId !== selected.item.itemId),
            },
        );
        setDialog(null);
        setMessage({
          text: `${selected.item.name} was removed from this device. The original is unchanged.`,
          failed: false,
        });
      }
    } catch (cause) {
      if (lifetime.current === scope)
        setMessage({
          text:
            cause instanceof Error
              ? cause.message
              : 'Could not remove this device copy. It has been kept.',
          failed: true,
        });
    } finally {
      if (lifetime.current === scope) {
        busy.current = false;
        setOperation(null);
        void scope.refresh();
      }
    }
  }

  return (
    <DeviceStoragePanel
      inventory={inventory}
      loading={loading}
      error={error}
      locked={locked}
      operation={operation}
      message={message}
      dialog={dialog}
      headingRef={heading}
      onRefresh={() => {
        if (lifetime.current) void lifetime.current.refresh();
        else setRetry((previous) => previous + 1);
      }}
      onRequestPersistence={() => {
        void protect();
      }}
      onOpenDialog={openDialog}
      onConfirmRemove={() => {
        void remove();
      }}
      allowNavigation={() => {
        try {
          lifetime.current?.verify();
          return lifetime.current !== null;
        } catch {
          return false;
        }
      }}
      finalFocus={() => (trigger.current?.isConnected ? trigger.current : heading.current)}
    />
  );
}
