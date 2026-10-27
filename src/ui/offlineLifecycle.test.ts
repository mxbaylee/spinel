import { afterEach, expect, test, vi } from 'vitest';
import { LocaleType } from '@univerjs/core';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import type { ClientCheckpoint } from '@spinel/sync-client';
import type { OfflineBundle } from '../shared/offlineBundle.ts';
import type { OfflineRecoveryRequest } from '../shared/offlineRecovery.ts';
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

vi.mock('../../web/offline/download.ts', async (original) => ({
  ...(await original<typeof import('../../web/offline/download.ts')>()),
  downloadForOffline: vi.fn(async () => {}),
}));

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
    .spyOn(offlineStorage, 'openExistingOfflineStore')
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
  const f = storage({ itemId: bundle.itemId, bundle, outbox: { version: 1, ...scope, checkpoint } });
  await f.store.removeClean(scope, () => {});
  expect(f.removed).toEqual(['items', 'images']);
  expect(f.aborted()).toBe(false);
});

function recoveryItem() {
  const saved: ClientCheckpoint = { ...structuredClone(checkpoint), failure: 'stale' };
  const recovery: OfflineRecoveryRequest = {
    recoveryId: '11111111-1111-4111-8111-111111111111',
    filename: 'Notes (offline copy, 2026-10-26 21:07).univer.json',
    snapshot: {
      ...structuredClone(bundle.snapshot),
      title: 'Notes (offline copy, 2026-10-26 21:07)',
    },
    possibleReplayCrash: false,
  };
  const item = {
    itemId: bundle.itemId,
    bundle: structuredClone(bundle),
    outbox: { version: 1 as const, ...scope, checkpoint: saved },
    recovery,
  };
  return { item, saved, recovery };
}

test('begin recovery durably fixes its request before publication and returns an independent value', async () => {
  const data = recoveryItem();
  const item = { bundle: data.item.bundle, outbox: data.item.outbox };
  const f = storage(item);
  const request = structuredClone(data.recovery);
  const result = await f.store.beginRecovery(scope, data.saved, request, () => {});
  expect(f.database.transaction).toHaveBeenCalledWith('items', 'readwrite');
  expect(f.written).toEqual([{ ...item, recovery: request }]);
  expect(f.removed).toEqual([]);
  expect(f.aborted()).toBe(false);
  result.filename = 'Caller changed only its copy';
  expect((f.written[0] as typeof data.item).recovery.filename).toBe(data.recovery.filename);
});

test('begin recovery accepts its exact existing request but refuses another identity or altered content', async () => {
  const original = recoveryItem();
  const repeat = storage(structuredClone(original.item));
  await expect(
    repeat.store.beginRecovery(scope, original.saved, structuredClone(original.recovery), () => {}),
  ).resolves.toEqual(original.recovery);
  for (const change of [
    { recoveryId: '22222222-2222-4222-8222-222222222222' },
    { filename: 'Changed.json' },
    { possibleReplayCrash: true },
    { snapshot: { ...original.recovery.snapshot, title: 'Changed contents' } },
  ]) {
    const f = storage(structuredClone(original.item));
    await expect(
      f.store.beginRecovery(scope, original.saved, { ...original.recovery, ...change }, () => {}),
    ).rejects.toThrow('recovery changed');
    expect(f.written).toEqual([]);
    expect(f.removed).toEqual([]);
    expect(f.aborted()).toBe(true);
  }
});

test.each(['changed checkpoint', 'no pending work'] as const)(
  'begin recovery refuses %s and preserves the stored copy',
  async (mode) => {
    const data = recoveryItem();
    const f = storage(
      mode === 'no pending work'
        ? { bundle: data.item.bundle, outbox: { ...data.item.outbox, checkpoint } }
        : data.item,
    );
    const supplied =
      mode === 'changed checkpoint'
        ? { ...data.saved, revision: data.saved.revision + 1 }
        : checkpoint;
    await expect(f.store.beginRecovery(scope, supplied, data.recovery, () => {})).rejects.toThrow(
      'saved offline changes changed',
    );
    expect(f.written).toEqual([]);
    expect(f.removed).toEqual([]);
  },
);

test('a fixed recovery request prevents subsequent checkpoint edits from changing its meaning', async () => {
  const data = recoveryItem();
  const f = storage(structuredClone(data.item));
  const changed = {
    ...data.saved,
    snapshot: { ...data.saved.snapshot, body: { dataStream: 'Later work\r\n' } },
  };
  await expect(f.store.saveCheckpoint(scope, changed, () => {})).rejects.toThrow(
    'already being recovered',
  );
  expect(f.written).toEqual([]);
  expect(f.aborted()).toBe(true);
  const unchanged = storage(structuredClone(data.item));
  await unchanged.store.saveCheckpoint(scope, structuredClone(data.saved), () => {});
  expect(unchanged.written).toEqual([data.item]);
});

test.each(['begin', 'finish'] as const)(
  '%s recovery verifies exact account, item, Space and generation after the asynchronous read',
  async (action) => {
    for (const field of ['accountId', 'itemId', 'spaceId', 'unitId', 'revisionOffset'] as const) {
      const data = recoveryItem();
      Object.assign(data.item.bundle, { [field]: field === 'revisionOffset' ? 20 : 'foreign' });
      const f = storage(data.item);
      const work =
        action === 'begin'
          ? f.store.beginRecovery(scope, data.saved, data.recovery, () => {})
          : f.store.finishRecovery(scope, data.recovery.recoveryId, () => {}, {
              recovery: data.recovery,
              checkpoint: data.saved,
            });
      await expect(work).rejects.toThrow('device copy changed');
      expect(f.written).toEqual([]);
      expect(f.removed).toEqual([]);
      expect(f.aborted()).toBe(true);
    }
  },
);

test.each(['begin', 'finish'] as const)(
  'an account/host change during %s recovery aborts before data mutation',
  async (action) => {
    const data = recoveryItem();
    const f = storage(data.item);
    let current = true;
    const verify = () => {
      if (!current) throw new Error('Account changed');
    };
    const work =
      action === 'begin'
        ? f.store.beginRecovery(scope, data.saved, data.recovery, verify)
        : f.store.finishRecovery(scope, data.recovery.recoveryId, verify, {
            recovery: data.recovery,
            checkpoint: data.saved,
          });
    current = false;
    await expect(work).rejects.toThrow('Account changed');
    expect(f.written).toEqual([]);
    expect(f.removed).toEqual([]);
    expect(f.aborted()).toBe(true);
  },
);

test.each(['identity', 'payload', 'checkpoint'] as const)(
  'final recovery acknowledgment cannot clear changed %s',
  async (change) => {
    const data = recoveryItem();
    const expected = {
      recovery: structuredClone(data.recovery),
      checkpoint: structuredClone(data.saved),
    };
    if (change === 'identity')
      data.item.recovery.recoveryId = '22222222-2222-4222-8222-222222222222';
    if (change === 'payload')
      data.item.recovery.snapshot = { ...data.item.recovery.snapshot, title: 'Changed payload' };
    if (change === 'checkpoint') data.item.outbox.checkpoint.revision++;
    const f = storage(data.item);
    await expect(
      f.store.finishRecovery(scope, expected.recovery.recoveryId, () => {}, expected),
    ).rejects.toThrow('recovery changed');
    expect(f.removed).toEqual([]);
    expect(f.aborted()).toBe(true);
  },
);

test.each(['acknowledged', 'explicit discard'] as const)(
  '%s recovery deletes its native item and image bytes atomically',
  async (mode) => {
    const data = recoveryItem();
    const f = storage(data.item);
    await f.store.finishRecovery(
      scope,
      mode === 'explicit discard' ? undefined : data.recovery.recoveryId,
      () => {},
      mode === 'explicit discard' ? undefined : { recovery: data.recovery, checkpoint: data.saved },
    );
    expect(f.database.transaction).toHaveBeenCalledWith(['items', 'images'], 'readwrite');
    expect(f.removed).toEqual(['items', 'images']);
    expect(f.aborted()).toBe(false);
  },
);

async function publishingSession(kind: 'doc' | 'sheet' = 'doc') {
  const f = session();
  setPreparedAccount(scope.account);
  const data = recoveryItem();
  data.saved.snapshot = {
    ...data.saved.snapshot,
    body: { dataStream: 'Saved offline work\r\n' },
  };
  if (kind === 'sheet') {
    data.saved.snapshot = {
      id: scope.unitId,
      name: bundle.name,
      appVersion: OFFLINE_SDK_VERSION,
      locale: LocaleType.EN_US,
      styles: {},
      sheetOrder: ['one'],
      sheets: {
        one: { id: 'one', name: 'One', rowCount: 12, columnCount: 6, cellData: {} },
      },
    };
    data.saved.buffer = [
      [
        {
          id: 'sheet.mutation.set-range-values',
          params: {
            unitId: scope.unitId,
            subUnitId: 'one',
            cellValue: { 0: { 3: { v: 731, s: { cl: { rgb: '#221832' } } } } },
            trigger: 'sheet.command.set-range-values',
          },
        },
      ],
    ];
  }
  const downloaded: OfflineBundle =
    kind === 'sheet'
      ? {
          ...structuredClone(bundle),
          kind,
          snapshot: { ...structuredClone(data.saved.snapshot as IWorkbookData), id: scope.item },
        }
      : structuredClone(bundle);
  const download = {
    bundle: downloaded,
    bytes: new Map<string, Uint8Array>(),
    outbox: { version: 1 as const, ...scope, checkpoint: data.saved },
    recovery: undefined as OfflineRecoveryRequest | undefined,
  };
  const begin = vi.fn(
    async (
      _scope: unknown,
      _checkpoint: ClientCheckpoint,
      recovery: OfflineRecoveryRequest,
      verify: () => void,
    ) => {
      verify();
      return structuredClone(recovery);
    },
  );
  const finish = vi.fn(
    async (
      _scope: unknown,
      _id: string | undefined,
      verify: () => void,
      _expected?: { recovery: OfflineRecoveryRequest; checkpoint: ClientCheckpoint },
    ) => verify(),
  );
  Object.assign(f.store, { beginRecovery: begin, finishRecovery: finish, close: vi.fn() });
  Object.assign(f.value, { download });
  const recovery = await f.value.prepareRecovery(data.saved);
  const copy = {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'sheets' in recovery.snapshot ? recovery.snapshot.name : recovery.snapshot.title!,
    kind,
    parentId: null,
    access: 'owner',
    tags: [],
    createdAt: 1,
    updatedAt: 1,
  };
  return { ...f, download, recovery, copy, saved: data.saved, begin, finish };
}

test('prepared recovery publishes the exact account-bound request on retry and only clears its full verified checkpoint after acknowledgment', async () => {
  const f = await publishingSession();
  const fetcher = vi.fn(async () => Response.json({ item: f.copy }, { status: 201 }));
  vi.stubGlobal('fetch', fetcher);
  try {
    expect(f.begin).toHaveBeenCalledOnce();
    expect(f.value.pending).toBe(true);
    for (let retry = 0; retry < 2; retry++)
      expect(
        await f.value.publishRecovery(structuredClone(f.recovery), new AbortController().signal),
      ).toEqual(f.copy);
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [path, init] of fetcher.mock.calls as unknown as Array<[string, RequestInit]>) {
      expect(path).toBe('/api/items/offline-recovery');
      expect(init).toMatchObject({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
      });
      expect(new Headers(init.headers).get('x-spinel-offline-account')).toBe(scope.account);
      expect(new Headers(init.headers).get('content-type')).toBe('application/json');
      expect(JSON.parse(String(init.body))).toEqual(f.recovery);
    }
    // The original Space route is never used as the recovery destination, and
    // an HTTP success alone has not removed the still-durable device checkpoint.
    expect(f.finish).not.toHaveBeenCalled();
    expect(f.value.pending).toBe(true);
    await f.value.finishRecovery(f.recovery.recoveryId);
    expect(f.finish).toHaveBeenCalledWith(scope, f.recovery.recoveryId, expect.any(Function), {
      recovery: f.recovery,
      checkpoint: f.saved,
    });
    expect(f.value.pending).toBe(false);
  } finally {
    f.value.dispose();
  }
});

test.each(['same tab', 'reopened tab'] as const)(
  'a Sheet recovery retries its immutable request after aborted cleanup in the %s',
  async (mode) => {
    const f = await publishingSession('sheet');
    const fetcher = vi.fn(async () => Response.json({ item: f.copy }, { status: 201 }));
    vi.stubGlobal('fetch', fetcher);
    f.finish.mockRejectedValueOnce(new DOMException('Local cleanup aborted', 'AbortError'));
    let active = f.value;
    try {
      expect(await active.publishRecovery(f.recovery, new AbortController().signal)).toEqual(
        f.copy,
      );
      await expect(active.finishRecovery(f.recovery.recoveryId)).rejects.toThrow(
        'Local cleanup aborted',
      );
      expect(active.pending).toBe(true);
      expect(f.download.outbox.checkpoint).toEqual(f.saved);
      expect(f.download.recovery).toEqual(f.recovery);
      if (mode === 'reopened tab') {
        active.dispose();
        active = new OfflineSession(scope.account, scope.item, scope.spaceId, () => true);
        Object.assign(active, {
          store: f.store,
          download: structuredClone(f.download),
          releaseWriter: vi.fn(),
        });
      }
      const retry = await active.prepareRecovery(structuredClone(f.saved));
      expect(retry).toEqual(f.recovery);
      expect(await active.publishRecovery(retry, new AbortController().signal)).toEqual(f.copy);
      await active.finishRecovery(retry.recoveryId);
      expect(active.pending).toBe(false);
      expect(f.begin).toHaveBeenCalledOnce();
      expect(fetcher).toHaveBeenCalledTimes(2);
      for (const [, init] of fetcher.mock.calls as unknown as Array<[string, RequestInit]>)
        expect(JSON.parse(String(init.body))).toEqual(f.recovery);
      expect(f.finish).toHaveBeenCalledTimes(2);
      for (const call of f.finish.mock.calls)
        expect(call).toEqual([
          scope,
          f.recovery.recoveryId,
          expect.any(Function),
          {
            recovery: f.recovery,
            checkpoint: f.saved,
          },
        ]);
    } finally {
      active.dispose();
    }
  },
);

test.each(['response', 'body'] as const)(
  'a late recovery %s after an account switch cannot authorize device cleanup',
  async (stage) => {
    const f = await publishingSession();
    let answer!: () => void;
    const waiting = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const reading = vi.fn();
    const response = Response.json({ item: f.copy }, { status: 201 });
    if (stage === 'body')
      vi.spyOn(response, 'json').mockImplementation(async () => {
        reading();
        await waiting;
        return { item: f.copy };
      });
    const fetcher = vi.fn(async () => {
      if (stage === 'response') await waiting;
      return response;
    });
    vi.stubGlobal('fetch', fetcher);
    try {
      const publication = f.value.publishRecovery(f.recovery, new AbortController().signal);
      const rejected = expect(publication).rejects.toMatchObject({ name: 'AbortError' });
      if (stage === 'body') await vi.waitFor(() => expect(reading).toHaveBeenCalledOnce());
      else expect(fetcher).toHaveBeenCalledOnce();
      offlineStorage.claimOnlineAccount('other');
      answer();
      await rejected;
      expect(f.finish).not.toHaveBeenCalled();
      expect(f.value.pending).toBe(true);
      expect(f.download.outbox.checkpoint).toEqual(f.saved);
      expect(f.download.recovery).toEqual(f.recovery);
    } finally {
      f.value.dispose();
    }
  },
);

test('a stale or unverified recovery request is refused before any POST or cleanup', async () => {
  const f = await publishingSession();
  const fetcher = vi.fn().mockRejectedValue(new Error('Unexpected network request'));
  vi.stubGlobal('fetch', fetcher);
  try {
    for (const changed of [
      { ...f.recovery, recoveryId: '33333333-3333-4333-8333-333333333333' },
      {
        ...f.recovery,
        snapshot: {
          ...f.recovery.snapshot,
          body: { dataStream: 'Changed after verification\r\n' },
        },
      },
    ])
      await expect(f.value.publishRecovery(changed, new AbortController().signal)).rejects.toThrow(
        'has not been verified',
      );
    expect(fetcher).not.toHaveBeenCalled();
    expect(f.finish).not.toHaveBeenCalled();
    expect(f.value.pending).toBe(true);
  } finally {
    f.value.dispose();
  }
});

test('an account switch while final cleanup is waiting keeps the session pending', async () => {
  const f = await publishingSession();
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => {
    finish = resolve;
  });
  f.finish.mockImplementationOnce(async (_scope, _id, verify) => {
    await waiting;
    verify();
  });
  try {
    const completion = f.value.finishRecovery(f.recovery.recoveryId);
    const rejected = expect(completion).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.finish).toHaveBeenCalledOnce();
    offlineStorage.claimOnlineAccount('other');
    finish();
    await rejected;
    expect(f.value.pending).toBe(true);
    expect(f.download.outbox.checkpoint).toEqual(f.saved);
  } finally {
    f.value.dispose();
  }
});

test('a corrupt saved retry request blocks publication while native export still reconstructs the original offline work', async () => {
  const f = await publishingSession();
  const fetcher = vi.fn().mockRejectedValue(new Error('Unexpected network request'));
  vi.stubGlobal('fetch', fetcher);
  try {
    const expected = await f.value.exportSnapshot(f.saved);
    (f.download.recovery!.snapshot as IDocumentData).body!.dataStream = 'CORRUPT SAVED REQUEST\r\n';
    await expect(f.value.prepareRecovery(f.saved)).rejects.toThrow('does not match');
    const exported = (await f.value.exportSnapshot(f.saved)) as IDocumentData;
    expect(exported).toEqual(expected);
    expect(exported.body!.dataStream).toBe('Saved offline work\r\n');
    expect(exported.id).toBe(scope.item);
    expect(fetcher).not.toHaveBeenCalled();
    expect(f.finish).not.toHaveBeenCalled();
    expect(f.value.pending).toBe(true);
  } finally {
    f.value.dispose();
  }
});
