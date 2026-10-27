import { afterEach, expect, test, vi } from 'vitest';
import type { ClientCheckpoint } from '@spinel/sync-client';
import type { OfflineBundle } from '../shared/offlineBundle.ts';
import { OfflineSession } from '../../web/offline/OfflineSession.ts';
import { OfflineStore } from '../../web/offline/offlineStore.ts';
import { downloadForOffline } from '../../web/offline/download.ts';
import { OFFLINE_SDK_VERSION } from '../../web/offline/OfflineAccess.ts';

vi.mock('../../web/offline/download.ts', () => ({ downloadForOffline: vi.fn(async () => {}) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const scope = {
  account: 'owner',
  item: 'item',
  spaceId: 'space',
  unitId: 'generation',
  revisionOffset: 2,
};
const bundle: OfflineBundle = {
  version: 1,
  accountId: scope.account,
  itemId: scope.item,
  spaceId: scope.spaceId,
  unitId: scope.unitId,
  revisionOffset: scope.revisionOffset,
  revision: 3,
  name: 'Notes',
  kind: 'doc',
  access: 'editor',
  readOnly: false,
  sdkVersion: OFFLINE_SDK_VERSION,
  snapshot: { id: 'item', body: { dataStream: '\r\n' }, documentStyle: {} },
  images: [],
};
const checkpoint: ClientCheckpoint = {
  version: 1,
  unitId: scope.unitId,
  revision: 1,
  snapshot: { id: scope.unitId, body: { dataStream: '\r\n' }, documentStyle: {} },
  sent: null,
  inflight: [],
  buffer: [],
};

function session(writer = true) {
  const values = new Map<string, string>();
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    }),
  );
  const store = {
    removeClean: vi.fn(async (_scope: unknown, verify: () => void) => verify()),
  };
  const value = new OfflineSession(scope.account, scope.item, scope.spaceId, () => true);
  Object.assign(value, {
    store,
    download: { bundle: { ...bundle, readOnly: !writer } },
    releaseWriter: writer ? vi.fn() : undefined,
  });
  return { value, store };
}

test('clean access removal reuses the mounted writer and checks exact native scope', async () => {
  const request = vi.fn();
  vi.stubGlobal('navigator', { locks: { request } });
  const f = session();
  const verify = vi.fn();
  await f.value.removeClean(verify);
  expect(request).not.toHaveBeenCalled();
  expect(f.store.removeClean).toHaveBeenCalledWith(scope, expect.any(Function));
  expect(verify.mock.calls.length).toBeGreaterThanOrEqual(2);
});

test.each(['remove', 'refresh'] as const)(
  'a viewer holds an exclusive item writer during clean %s and releases it afterward',
  async (action) => {
    let held = false;
    const request = vi.fn(
      async (_name: string, _options: unknown, work: (lock: object) => Promise<void>) => {
        held = true;
        await work({});
        held = false;
      },
    );
    vi.stubGlobal('navigator', { locks: { request } });
    const f = session(false);
    const verify = () => expect(held).toBe(true);
    if (action === 'remove') await f.value.removeClean(verify);
    else await f.value.refreshClean(verify);
    await Promise.resolve();
    expect(request).toHaveBeenCalledWith(
      'spinel-offline:owner:item',
      { ifAvailable: true },
      expect.any(Function),
    );
    expect(held).toBe(false);
    if (action === 'refresh') expect(downloadForOffline).toHaveBeenCalledOnce();
  },
);

test('a viewer cannot remove a copy while another tab holds its writer', async () => {
  vi.stubGlobal('navigator', {
    locks: {
      request: async (_name: string, _options: unknown, work: (lock: null) => Promise<void>) =>
        work(null),
    },
  });
  const f = session(false);
  await expect(f.value.removeClean(() => {})).rejects.toThrow('every other tab');
  expect(f.store.removeClean).not.toHaveBeenCalled();
});

/** Exercise guards across the asynchronous IDB read; writes are recorded for assertion. */
function storage(existing: unknown) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('location', { origin: 'https://spinel.test' });
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('IDBKeyRange', { bound: (...range: unknown[]) => range });
  let aborted = false;
  const removed: string[] = [];
  const written: unknown[] = [];
  const transaction = {
    oncomplete: undefined as (() => void) | undefined,
    onabort: undefined as (() => void) | undefined,
    error: null,
    objectStore(name: string) {
      return {
        get() {
          const request = { result: existing, onsuccess: undefined as (() => void) | undefined };
          setTimeout(() => {
            request.onsuccess?.();
            setTimeout(() => {
              if (!aborted) transaction.oncomplete?.();
            }, 0);
          }, 0);
          return request;
        },
        delete() {
          removed.push(name);
        },
        put(value: unknown) {
          written.push(value);
        },
      };
    },
    abort() {
      aborted = true;
      transaction.onabort?.();
    },
  };
  const database = { transaction: vi.fn(() => transaction) };
  const store = new OfflineStore(scope.account, database as unknown as IDBDatabase);
  return { store, database, removed, written, aborted: () => aborted };
}

test.each(['account', 'itemId', 'spaceId', 'unitId', 'revisionOffset'] as const)(
  'clean removal cannot erase a stored copy after its %s changes',
  async (field) => {
    const changed = {
      ...bundle,
      [field === 'account' ? 'accountId' : field]: field === 'revisionOffset' ? 4 : 'other',
    };
    const f = storage({ bundle: changed });
    await expect(f.store.removeClean(scope, () => {})).rejects.toThrow('download changed');
    expect(f.removed).toEqual([]);
    expect(f.aborted()).toBe(true);
  },
);

test.each([
  { failure: 'stale' as const },
  { recoverySnapshot: checkpoint.snapshot },
  { recoveryMissing: true },
])('clean removal retains any persisted failure or recovery evidence: %j', async (retained) => {
  const f = storage({
    bundle,
    outbox: { version: 1, ...scope, checkpoint: { ...checkpoint, ...retained } },
  });
  await expect(f.store.removeClean(scope, () => {})).rejects.toThrow('Changes are saved');
  expect(f.removed).toEqual([]);
});

test.each(['remove', 'refresh'] as const)(
  'account or host changes during the IDB read abort clean %s before deleting any data',
  async (action) => {
    const f = storage({ bundle });
    let current = true;
    const verify = () => {
      if (!current) throw new Error('Changed');
    };
    const work =
      action === 'remove'
        ? f.store.removeClean(scope, verify)
        : f.store.saveDownload(bundle, new Map(), verify);
    current = false;
    await expect(work).rejects.toThrow('Changed');
    expect(f.removed).toEqual([]);
    expect(f.written).toEqual([]);
    expect(f.aborted()).toBe(true);
  },
);

test('a clean scoped removal deletes the native item and its images in the same transaction', async () => {
  const f = storage({ bundle, outbox: { version: 1, ...scope, checkpoint } });
  await f.store.removeClean(scope, () => {});
  expect(f.removed).toEqual(['items', 'images']);
  expect(f.aborted()).toBe(false);
});
