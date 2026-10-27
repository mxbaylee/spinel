import { locks } from 'node:worker_threads';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ClientCheckpoint } from '@spinel/sync-client';
import type { OfflineBundle } from '../shared/offlineBundle.ts';
import { OfflineSession } from '../../web/offline/OfflineSession.ts';
import * as offlineStorage from '../../web/offline/offlineStore.ts';
import {
  offlineChanged,
  setPreparedAccount,
  watchOfflineChanges,
  withOfflineItemWriter,
} from '../../web/offline/offlineStore.ts';
import type { OfflineStore } from '../../web/offline/offlineStore.ts';

const accountId = 'writer-handoff-account';
const itemId = 'second-prepared-document';
const lockName = `spinel-offline:${accountId}:${itemId}`;
const changeKey = 'spinel.offline.changed';
let values: Map<string, string>;

beforeEach(() => {
  values = new Map();
  vi.stubGlobal('navigator', { locks });
  vi.stubGlobal('location', { origin: 'https://spinel.test' });
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    }),
  );
  setPreparedAccount(accountId);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const bundle: OfflineBundle = {
  version: 1,
  accountId,
  itemId,
  spaceId: 'prepared-space',
  unitId: 'document-generation',
  revisionOffset: 2,
  revision: 3,
  name: 'Travel notes',
  kind: 'doc',
  access: 'owner',
  readOnly: false,
  sdkVersion: '1.1.0',
  snapshot: { id: itemId, body: { dataStream: '\r\n' }, documentStyle: {} },
  images: [],
};
const checkpoint: ClientCheckpoint = {
  version: 1,
  unitId: bundle.unitId,
  revision: 1,
  snapshot: { ...bundle.snapshot, id: bundle.unitId },
  sent: null,
  inflight: [],
  buffer: [],
};

test('a prepared-account download hands its released writer to the mounted native storage adapter', async () => {
  // Use the runtime's real Web Locks. Only the IndexedDB boundary is replaced;
  // the change event, writer helper, session admission and persistence are real.
  let committed = false;
  const saveCheckpoint = vi.fn(
    async (_scope: unknown, _checkpoint: ClientCheckpoint, verify: () => void) => verify(),
  );
  const store = {
    bundle: vi.fn(async () =>
      committed ? { bundle: structuredClone(bundle), bytes: new Map() } : undefined,
    ),
    saveCheckpoint,
    close: vi.fn(),
  };
  vi.spyOn(offlineStorage, 'openExistingOfflineStore').mockResolvedValue(
    store as unknown as OfflineStore,
  );
  const active = new OfflineSession(accountId, itemId, bundle.spaceId, () => true);
  let adoption: Promise<void> | undefined;
  const changed = vi.fn((change: offlineStorage.OfflineChange) => {
    if (change.itemId === itemId && change.pending === undefined) {
      adoption = active.persist(checkpoint);
      void adoption.catch(() => {});
    }
  });
  const stop = watchOfflineChanges(accountId, changed);
  const entered = deferred();
  const release = deferred();
  const preparing = withOfflineItemWriter(accountId, itemId, async () => {
    committed = true;
    offlineChanged(accountId, itemId);
    entered.resolve();
    await release.promise;
    return 'saved';
  });
  try {
    await entered.promise;
    expect(changed).not.toHaveBeenCalled();
    expect(values.has(changeKey)).toBe(false);
    release.resolve();
    await expect(preparing).resolves.toBe('saved');
    expect(adoption).toBeDefined();
    await adoption;
    expect(active.enabled).toBe(true);
    expect(active.readOnly).toBe(false);
    expect(active.problem).toBe('');
    expect(saveCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({ account: accountId, item: itemId, spaceId: bundle.spaceId }),
      checkpoint,
      expect.any(Function),
      expect.any(Object),
    );
    const competing = vi.fn(async () => {});
    await expect(withOfflineItemWriter(accountId, itemId, competing)).rejects.toThrow(
      'Close this document in every tab',
    );
    expect(competing).not.toHaveBeenCalled();
    // Its native writer stays held for the editor lifetime, but pending notices
    // must still update this tab and other tabs immediately.
    offlineChanged(accountId, itemId, true);
    expect(changed).toHaveBeenLastCalledWith({ accountId, itemId, pending: true });
    expect(JSON.parse(values.get(changeKey)!)).toMatchObject({ accountId, itemId, pending: true });
  } finally {
    release.resolve();
    await preparing.catch(() => {});
    await adoption?.catch(() => {});
    stop();
    active.dispose();
    await locks.request(lockName, () => {});
  }
});

test.each([false, true])(
  'a failed temporary operation publishes only its committed changes after release (committed=%s)',
  async (committed) => {
    const failure = new Error('The later operation failed.');
    const reacquired: Promise<boolean>[] = [];
    const changed = vi.fn(() => {
      reacquired.push(locks.request(lockName, { ifAvailable: true }, (lock) => Boolean(lock)));
    });
    const stop = watchOfflineChanges(accountId, changed);
    try {
      await expect(
        withOfflineItemWriter(accountId, itemId, async () => {
          if (committed) offlineChanged(accountId, itemId);
          expect(changed).not.toHaveBeenCalled();
          expect(values.has(changeKey)).toBe(false);
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(changed).toHaveBeenCalledTimes(committed ? 1 : 0);
      expect(await Promise.all(reacquired)).toEqual(committed ? [true] : []);
      expect(values.has(changeKey)).toBe(committed);
      if (committed)
        expect(JSON.parse(values.get(changeKey)!)).toMatchObject({ accountId, itemId });
    } finally {
      stop();
    }
  },
);

test('a rejected competing writer leaves the original handoff queued and unrelated scopes immediate', async () => {
  const own = vi.fn();
  const other = vi.fn();
  const stopOwn = watchOfflineChanges(accountId, own);
  const stopOther = watchOfflineChanges('another-account', other);
  const entered = deferred();
  const release = deferred();
  const preparing = withOfflineItemWriter(accountId, itemId, async () => {
    offlineChanged(accountId, itemId);
    entered.resolve();
    await release.promise;
  });
  try {
    await entered.promise;
    const competing = vi.fn(async () => {});
    await expect(withOfflineItemWriter(accountId, itemId, competing)).rejects.toThrow(
      'Close this document in every tab',
    );
    expect(competing).not.toHaveBeenCalled();
    expect(own).not.toHaveBeenCalled();
    offlineChanged(accountId, 'another-document', true);
    offlineChanged('another-account', itemId, false);
    expect(own).toHaveBeenCalledExactlyOnceWith({
      accountId,
      itemId: 'another-document',
      pending: true,
    });
    expect(other).toHaveBeenCalledExactlyOnceWith({
      accountId: 'another-account',
      itemId,
      pending: false,
    });
    release.resolve();
    await preparing;
    expect(own).toHaveBeenLastCalledWith({ accountId, itemId });
    expect(own).toHaveBeenCalledTimes(2);
    expect(other).toHaveBeenCalledOnce();
  } finally {
    release.resolve();
    await preparing.catch(() => {});
    stopOwn();
    stopOther();
  }
});
