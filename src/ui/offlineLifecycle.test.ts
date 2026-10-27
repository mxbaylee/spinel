import { afterEach, expect, test, vi } from 'vitest';
import type { ClientCheckpoint } from '@spinel/sync-client';
import type { OfflineBundle } from '../shared/offlineBundle.ts';
import { OfflineSession } from '../../web/offline/OfflineSession.ts';
import * as offlineStorage from '../../web/offline/offlineStore.ts';
import {
  OfflineStore,
  offlineAccountRead,
  setPreparedAccount,
} from '../../web/offline/offlineStore.ts';
import { downloadForOffline } from '../../web/offline/download.ts';
import { OFFLINE_SDK_VERSION } from '../../web/offline/OfflineAccess.ts';
import { sha256 } from '../../web/offline/PreparedImages.ts';
import { openLocalStart } from '../../web/offline/localStart.ts';

vi.mock('../../web/offline/download.ts', () => ({ downloadForOffline: vi.fn(async () => {}) }));

afterEach(() => {
  vi.restoreAllMocks();
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
        removeItem: (key: string) => values.delete(key),
      },
    }),
  );
  const store = {
    accountId: scope.account,
    downloads: vi.fn(async () => []),
    removeClean: vi.fn(async (_scope: unknown, verify: () => void) => verify()),
  };
  const value = new OfflineSession(scope.account, scope.item, scope.spaceId, () => true);
  Object.assign(value, {
    store,
    download: { bundle: { ...bundle, readOnly: !writer } },
    releaseWriter: writer ? vi.fn() : undefined,
  });
  return { value, store, values };
}

test('immediate expiry keeps a held local save alive through a repeated 401 while rejecting all HTTP', async () => {
  const f = session();
  setPreparedAccount(scope.account);
  let answer!: (response: Response) => void;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        answer = resolve;
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  const oldRequest = f.value.fetch('/api/items/item/collaboration');
  const rejected = expect(oldRequest).rejects.toThrow('no longer current');
  let finishWrite!: () => void;
  const waiting = new Promise<void>((resolve) => {
    finishWrite = resolve;
  });
  const save = vi.fn(async (_scope: unknown, _checkpoint: unknown, verify: () => void) => {
    await waiting;
    verify();
  });
  Object.assign(f.store, { saveCheckpoint: save });
  f.value.stopAuthenticationHTTP();
  f.value.endAuthentication();
  const locked = vi.fn();
  f.value.onLock = locked;
  const drain = f.value.persist(checkpoint);
  await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(f.values.has('spinel.offline.account')).toBe(false);
  offlineStorage.expirePreparedAccount();
  expect(f.value.current).toBe(true);
  expect(locked).not.toHaveBeenCalled();
  await expect(f.value.fetch('/api/items/item')).rejects.toThrow('no longer current');
  answer(Response.json({}));
  await rejected;
  expect(fetcher).toHaveBeenCalledOnce();
  // The held write still completes under this tab's narrow recovery fence.
  finishWrite();
  await drain;
  expect(f.value.current).toBe(true);
});

test.each(['body', 'hash', 'blob'] as const)(
  'a remote image %s completion cannot be admitted after authentication stops',
  async (stage) => {
    const f = session();
    const bytes = new Uint8Array([1, 2, 3]);
    const hash = await sha256(bytes);
    const source = `/api/items/item/images/${hash}`;
    const response = new Response(bytes, { headers: { 'Content-Type': 'image/png' } });
    let finish!: () => void;
    const waiting = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const reached = vi.fn();
    if (stage === 'body')
      vi.spyOn(response, 'arrayBuffer').mockImplementation(async () => {
        reached();
        await waiting;
        return bytes.buffer;
      });
    else if (stage === 'blob')
      vi.spyOn(response, 'blob').mockImplementation(async () => {
        reached();
        await waiting;
        return new Blob([bytes]);
      });
    else {
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (algorithm, input) => {
        reached();
        await waiting;
        return digest(algorithm, input);
      });
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    );
    const download = { bundle: { ...bundle }, bytes: new Map() };
    const add = vi.fn();
    if (stage !== 'blob') Object.assign(f.value, { download, images: { add } });
    const preparing =
      stage === 'blob' ? f.value.downloadImage(source) : f.value.prepareImages(source);
    const rejected = expect(preparing).rejects.toThrow('no longer current');
    await vi.waitFor(() => expect(reached).toHaveBeenCalledOnce());
    f.value.stopAuthenticationHTTP();
    finish();
    await rejected;
    expect(download.bytes.size).toBe(0);
    expect(add).not.toHaveBeenCalled();
    expect(f.value.current).toBe(true);
  },
);

test('ended authentication blocks all cold starts and HTTP while the frozen tab can save local image recovery', async () => {
  const { values } = session();
  vi.stubGlobal('location', { origin: 'https://spinel.test' });
  vi.stubGlobal('navigator', {
    locks: {
      request: async (_name: string, _options: unknown, work: (lock: object) => Promise<void>) =>
        work({}),
    },
  });
  offlineStorage.claimOnlineAccount(scope.account);
  setPreparedAccount(scope.account);
  const before = offlineAccountRead(scope.account);
  const bytes = new Uint8Array([1, 2, 3]);
  const hash = await sha256(bytes);
  const source = `/api/items/${scope.item}/images/${hash}`;
  const imageFiles = [{ source, sha256: hash, mime: 'image/png', byteLength: bytes.length }];
  const download = { bundle: { ...bundle, images: imageFiles }, bytes: new Map([[source, bytes]]) };
  const saved: ClientCheckpoint[] = [];
  const store = {
    bundle: vi.fn(async () => download),
    close: vi.fn(),
    saveCheckpoint: vi.fn(async (_scope: unknown, value: ClientCheckpoint, verify: () => void) => {
      verify();
      saved.push(structuredClone(value));
    }),
  };
  const opened = vi
    .spyOn(offlineStorage, 'openOfflineStore')
    .mockResolvedValue(store as unknown as OfflineStore);
  const active = new OfflineSession(scope.account, scope.item, scope.spaceId, () => true);
  const locked = vi.fn();
  active.onLock = locked;
  try {
    await active.activate();
    const local = active.toVisible(source);
    expect(local).toMatch(/^blob:/);
    let answer!: (response: Response) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    const oldRequest = active.fetch(
      `/api/spaces/${scope.spaceId}/items/${scope.item}/collaboration`,
    );
    const rejected = expect(oldRequest).rejects.toThrow('no longer current');
    active.endAuthentication();
    answer(Response.json({}));
    await rejected;
    expect(values.has('spinel.offline.account')).toBe(false);
    expect(before()).toBe(false);
    expect(await openLocalStart()).toBeNull();
    expect(locked).not.toHaveBeenCalled();
    expect(active.current).toBe(true);
    offlineStorage.expirePreparedAccount();
    expect(active.current).toBe(true);
    expect(active.toCanonical(local)).toBe(source);
    expect(await active.getImage(source)).toBe(local);
    await active.persist(checkpoint);
    expect(saved).toEqual([checkpoint]);
    expect(opened).toHaveBeenCalledOnce();
    await expect(active.fetch(`/api/spaces/${scope.spaceId}/items/${scope.item}`)).rejects.toThrow(
      'no longer current',
    );
    await expect(active.refreshClean(() => {})).rejects.toThrow('no longer current');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(values.has('spinel.offline.account')).toBe(false);
    // A verified different account always ends the narrow retained-tab fence.
    offlineStorage.claimOnlineAccount('other');
    expect(active.current).toBe(false);
    expect(locked).toHaveBeenCalledOnce();
    expect(() => active.toCanonical(local)).toThrow();
    await expect(active.persist(checkpoint)).rejects.toThrow('no longer current');
    expect(saved).toEqual([checkpoint]);
  } finally {
    active.dispose();
  }
});

test('clean removal clears final preparation only after scoped deletion has completed', async () => {
  const f = session();
  setPreparedAccount(scope.account);
  Object.assign(f.value, { readCurrent: offlineAccountRead(scope.account) });
  const locked = vi.fn();
  f.value.onLock = locked;
  f.store.removeClean.mockImplementationOnce(async (_scope, verify) => {
    verify();
    expect(f.values.get('spinel.offline.account')).toBe(scope.account);
    expect(locked).not.toHaveBeenCalled();
  });
  await f.value.removeClean(() => {});
  expect(f.values.has('spinel.offline.account')).toBe(false);
  expect(locked).toHaveBeenCalledOnce();
});

test('clean access removal reuses the mounted writer and checks exact native scope', async () => {
  const request = vi.fn(async (_name: string, work: () => Promise<void>) => work());
  vi.stubGlobal('navigator', { locks: { request } });
  const f = session();
  const verify = vi.fn();
  await f.value.removeClean(verify);
  expect(request).not.toHaveBeenCalledWith(
    'spinel-offline:owner:item',
    expect.anything(),
    expect.anything(),
  );
  expect(f.store.removeClean).toHaveBeenCalledWith(scope, expect.any(Function));
  expect(verify.mock.calls.length).toBeGreaterThanOrEqual(2);
});

test.each(['remove', 'refresh'] as const)(
  'a viewer holds an exclusive item writer during clean %s and releases it afterward',
  async (action) => {
    let held = false;
    const request = vi.fn(
      async (name: string, options: unknown, work?: (lock: object) => Promise<void>) => {
        if (name.startsWith('spinel-offline-catalog:')) return (options as () => Promise<void>)();
        held = true;
        await work!({});
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
