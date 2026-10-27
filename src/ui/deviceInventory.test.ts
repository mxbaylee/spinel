import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { OfflineStore, StoredImage, StoredItem } from '../../web/offline/offlineStore.ts';
import type { RuntimeReadiness } from '../../web/offline/runtime.ts';

const boundary = vi.hoisted(() => ({
  open: vi.fn<(accountId: string) => Promise<OfflineStore | null>>(),
  readiness: vi.fn<(accountId: string, verifyCurrent: () => void) => Promise<RuntimeReadiness>>(),
  release: vi.fn<(accountId: string, verifyCurrent: () => void) => Promise<void>>(),
}));

vi.mock('../../web/offline/offlineStore.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../web/offline/offlineStore.ts')>()),
  openExistingOfflineStore: boundary.open,
}));
vi.mock('../../web/offline/runtime.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../web/offline/runtime.ts')>()),
  accountRuntimeReadiness: boundary.readiness,
  releaseAccountRuntime: boundary.release,
}));

const account = 'device-account';
const itemId = 'device-item';
const preparedKey = 'spinel.offline.account';
let values: Map<string, string>;
let persist: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
let persisted: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
let estimate: ReturnType<typeof vi.fn<() => Promise<StorageEstimate>>>;

beforeEach(() => {
  vi.resetModules();
  boundary.open.mockReset().mockResolvedValue(null);
  boundary.readiness.mockReset().mockResolvedValue({
    kind: 'ready',
    buildId: '0123456789abcdef',
    compatibility: { format: 1, sdkVersion: '1.1.0' },
  });
  boundary.release.mockReset().mockResolvedValue(undefined);
  values = new Map();
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
        removeItem: (key: string) => {
          values.delete(key);
        },
      },
    }),
  );
  vi.stubGlobal('location', { origin: 'https://spinel.example' });
  persist = vi.fn(async () => false);
  persisted = vi.fn(async () => false);
  estimate = vi.fn(async () => ({ usage: 7200, quota: 64000 }));
  type LockCallback = (lock: { name: string }) => unknown;
  vi.stubGlobal('navigator', {
    storage: { persist, persisted, estimate },
    locks: {
      request: vi.fn(
        async (
          name: string,
          optionsOrCallback: LockOptions | LockCallback,
          callback?: LockCallback,
        ) => {
          const run = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback!;
          return run({ name });
        },
      ),
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function copy(name = '旅の記録 🌿'): StoredItem {
  return {
    itemId,
    name,
    kind: 'doc',
    readOnly: false,
    revision: 3,
    downloadedAt: 123,
    bundle: {
      version: 1,
      accountId: account,
      itemId,
      unitId: itemId,
      name,
      kind: 'doc',
      access: 'owner',
      readOnly: false,
      revision: 3,
      revisionOffset: 0,
      sdkVersion: '1.1.0',
      images: [],
      snapshot: { id: itemId, body: { dataStream: '旅の記録 🌿\r\n' }, documentStyle: {} },
    },
  };
}

function pendingCopy() {
  const item = copy();
  item.outbox = {
    version: 1,
    account,
    item: itemId,
    unitId: itemId,
    revisionOffset: 0,
    checkpoint: {
      version: 1,
      unitId: itemId,
      revision: 2,
      snapshot: item.bundle.snapshot,
      sent: null,
      inflight: [],
      buffer: [[{ id: 'doc.mutation.insert-text', params: { text: 'Saved here' } }]],
    },
  };
  return item;
}

function addImage(item: StoredItem, bytes = new Uint8Array([0, 1, 2, 255])): StoredImage {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const source = `/api/items/${itemId}/images/${sha256}`;
  item.bundle.images.push({ source, sha256, mime: 'image/png', byteLength: bytes.byteLength });
  return { itemId, source, bytes };
}

function drawing(snapshot: unknown, source: string) {
  Object.assign(snapshot as object, { drawings: { photo: { source } } });
}

function existing(item: unknown = copy(), images: StoredImage[] = []) {
  const saved = { item, images };
  const store = {
    accountId: account,
    itemIds: vi.fn(async () => [itemId]),
    inspect: vi.fn(async (_itemId: string) => saved),
    downloads: vi.fn(async () => []),
    removeDeviceItem: vi.fn(
      async (_itemId: string, verify: () => void, _discardPending?: boolean) => {
        verify();
        return { status: 'needs-recovery' as const, itemId };
      },
    ),
    close: vi.fn(),
  };
  boundary.open.mockResolvedValue(store as unknown as OfflineStore);
  return { store, saved };
}

const api = () => import('../../web/offline/deviceStorage.ts');
const verify = () => {};

test('logical bytes include UTF-8 metadata, the full checkpoint, and every stored image while origin usage remains separate', async () => {
  const item = pendingCopy();
  const image = addImage(item);
  drawing(item.bundle.snapshot, image.source);
  const extra = { itemId, source: '/retained-extra-image', bytes: new Uint8Array([8, 9, 10]) };
  const images = [image, extra];
  const f = existing(item, images);
  const expected = Buffer.byteLength(JSON.stringify(item), 'utf8') + 7;
  const { readDeviceInventory, storedItemBytes } = await api();
  expect(storedItemBytes(item, images)).toBe(expected);
  expect(expected).toBeGreaterThan(JSON.stringify(item).length + 7);
  const result = await readDeviceInventory(account, verify);
  expect(result).toMatchObject({
    state: 'ready',
    bytes: expected,
    origin: { usage: 7200, quota: 64000 },
    items: [{ itemId, name: item.bundle.name, pending: true, available: true, bytes: expected }],
  });
  expect(f.store.close).toHaveBeenCalledOnce();
  expect(persist).not.toHaveBeenCalled();
});

test('unmeasurable bytes remain unknown rather than reporting a misleading zero', async () => {
  const { storedItemBytes } = await api();
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  expect(storedItemBytes(cyclic, [])).toBeNull();
  expect(storedItemBytes(undefined, [])).toBeNull();
  expect(storedItemBytes({}, [{ bytes: 'damaged' as unknown as Uint8Array }])).toBeNull();
});

test.each([
  [undefined, 'empty'],
  [account, 'missing'],
  ['another-account', 'empty'],
] as const)(
  'an absent store with prepared marker %s reports %s without creating or preparing anything',
  async (marker, state) => {
    if (marker) values.set(preparedKey, marker);
    const before = new Map(values);
    const result = await (await api()).readDeviceInventory(account, verify);
    expect(result).toMatchObject({ state, items: [], bytes: 0 });
    expect(boundary.open).toHaveBeenCalledExactlyOnceWith(account);
    expect(boundary.readiness).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(values).toEqual(before);
  },
);

test('an existing empty store is empty; a failed read is unavailable and retains its prepared marker', async () => {
  values.set(preparedKey, account);
  const { store } = existing();
  store.itemIds.mockResolvedValueOnce([]);
  const { readDeviceInventory } = await api();
  expect(await readDeviceInventory(account, verify)).toMatchObject({
    state: 'empty',
    items: [],
    bytes: 0,
  });
  store.itemIds.mockRejectedValueOnce(new Error('Device storage is blocked.'));
  expect(await readDeviceInventory(account, verify)).toMatchObject({
    state: 'unavailable',
    items: [],
    bytes: null,
    problem: 'Device storage is blocked.',
  });
  expect(values.get(preparedKey)).toBe(account);
  expect(store.close).toHaveBeenCalledTimes(2);
  expect(store.removeDeviceItem).not.toHaveBeenCalled();
  expect(boundary.readiness).not.toHaveBeenCalled();
});

test('a rejected database open is unavailable rather than empty or missing', async () => {
  boundary.open.mockRejectedValueOnce(new Error('IndexedDB could not be opened.'));
  expect(await (await api()).readDeviceInventory(account, verify)).toMatchObject({
    state: 'unavailable',
    items: [],
    bytes: null,
    problem: 'IndexedDB could not be opened.',
  });
});

test('persistence reads distinguish a first non-grant from an actual denial and never request protection', async () => {
  const { readDeviceInventory, requestPersistence } = await api();
  expect((await readDeviceInventory(account, verify)).persistence).toBe('not-requested');
  expect(persist).not.toHaveBeenCalled();
  expect(await requestPersistence()).toBe('denied');
  expect((await readDeviceInventory(account, verify)).persistence).toBe('denied');
  expect(persist).toHaveBeenCalledOnce();
  persisted.mockResolvedValueOnce(true);
  expect((await readDeviceInventory(account, verify)).persistence).toBe('granted');
  expect(persist).toHaveBeenCalledOnce();
});

test('unsupported and failed persistence checks preserve a truthful state and optional usage estimate', async () => {
  const { readDeviceInventory, requestPersistence } = await api();
  persisted.mockRejectedValueOnce(new Error('Storage blocked'));
  estimate.mockResolvedValueOnce({ usage: Number.NaN, quota: -1 });
  expect(await readDeviceInventory(account, verify)).toMatchObject({
    persistence: 'error',
    origin: {},
  });
  persist.mockRejectedValueOnce(new Error('Request blocked'));
  expect(await requestPersistence()).toBe('error');
  vi.stubGlobal('navigator', { storage: { estimate } });
  expect(await readDeviceInventory(account, verify)).toMatchObject({ persistence: 'unsupported' });
  expect(await requestPersistence()).toBe('unsupported');
});

test.each(['account', 'bundle-item', 'record-item', 'kind', 'missing-bundle'] as const)(
  'invalid %s metadata retains a generic pending row without exposing its stored title or contents',
  async (damage) => {
    const item = copy('Secret foreign document');
    const raw = item as unknown as Record<string, unknown>;
    if (damage === 'account') item.bundle.accountId = 'another-account';
    if (damage === 'bundle-item') item.bundle.itemId = 'another-item';
    if (damage === 'record-item') item.itemId = 'another-item';
    if (damage === 'kind') Object.assign(item.bundle, { kind: 'unknown' });
    if (damage === 'missing-bundle') delete raw.bundle;
    const { store } = existing(raw);
    const result = await (await api()).readDeviceInventory(account, verify);
    expect(result).toMatchObject({
      state: 'ready',
      items: [
        {
          itemId,
          name: 'Unavailable device copy',
          available: false,
          uncertain: true,
          pending: true,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('Secret foreign document');
    expect(JSON.stringify(result)).not.toContain('旅の記録');
    expect(store.removeDeviceItem).not.toHaveBeenCalled();
  },
);

test.each(['bundle', 'checkpoint'] as const)(
  'a required native image omitted from the %s manifest check cannot appear available',
  async (place) => {
    const item = pendingCopy();
    // Separate the native checkpoint so both saved shapes must be checked.
    item.outbox!.checkpoint.snapshot = structuredClone(item.bundle.snapshot);
    drawing(
      place === 'bundle' ? item.bundle.snapshot : item.outbox!.checkpoint.snapshot,
      'https://spinel.example/api/items/device-item/images/' + 'a'.repeat(64),
    );
    const before = structuredClone(item);
    const { store } = existing(item);
    const result = await (await api()).readDeviceInventory(account, verify);
    expect(result.items).toMatchObject([
      {
        itemId,
        available: false,
        pending: true,
        problem: 'An image required by this device copy is missing from its download.',
      },
    ]);
    expect(item).toEqual(before);
    expect(store.removeDeviceItem).not.toHaveBeenCalled();
  },
);

test.each(['account', 'item', 'space', 'unit', 'revision-offset'] as const)(
  'a structurally valid queue with a mismatched %s scope is retained with its own bundle title but cannot be available',
  async (damage) => {
    const item = pendingCopy();
    const outbox = item.outbox!;
    if (damage === 'account') outbox.account = 'foreign-account';
    if (damage === 'item') outbox.item = 'foreign-item';
    if (damage === 'space') outbox.spaceId = 'foreign-space';
    if (damage === 'revision-offset') outbox.revisionOffset = 42;
    if (damage === 'unit') {
      outbox.unitId = 'foreign-unit';
      outbox.checkpoint.unitId = 'foreign-unit';
      outbox.checkpoint.snapshot = { ...structuredClone(item.bundle.snapshot), id: 'foreign-unit' };
    }
    const before = structuredClone(item);
    const { store } = existing(item);
    const { isKnownOfflineOutbox } = await import('../../web/offline/offlineStore.ts');
    expect(isKnownOfflineOutbox(outbox)).toBe(true);
    const result = await (await api()).readDeviceInventory(account, verify);
    expect(result.items).toMatchObject([
      {
        itemId,
        name: item.bundle.name,
        available: false,
        uncertain: true,
        pending: true,
      },
    ]);
    expect(item).toEqual(before);
    expect(store.removeDeviceItem).not.toHaveBeenCalled();
  },
);

test('a manifest with missing image bytes and an incomplete public runtime both retain pending data as unavailable', async () => {
  const item = pendingCopy();
  const image = addImage(item);
  const { store } = existing(item);
  const { readDeviceInventory } = await api();
  expect((await readDeviceInventory(account, verify)).items).toMatchObject([
    {
      available: false,
      pending: true,
      problem: 'An image is missing or incomplete.',
    },
  ]);
  store.inspect.mockResolvedValueOnce({ item, images: [image] });
  boundary.readiness.mockResolvedValueOnce({ kind: 'unavailable', reason: 'incomplete-cache' });
  expect((await readDeviceInventory(account, verify)).items).toMatchObject([
    {
      available: false,
      pending: true,
      problem: 'The offline app is missing or incomplete. Connect and download this copy again.',
    },
  ]);
  expect(store.removeDeviceItem).not.toHaveBeenCalled();
});

test.each(['open', 'inspect'] as const)(
  'account cancellation after the awaited %s rejects without returning private data and closes the store',
  async (stage) => {
    const { store, saved } = existing();
    let finish!: () => void;
    const waiting = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const reached = vi.fn();
    if (stage === 'open')
      boundary.open.mockImplementationOnce(async () => {
        reached();
        await waiting;
        return store as unknown as OfflineStore;
      });
    else
      store.inspect.mockImplementationOnce(async () => {
        reached();
        await waiting;
        return saved;
      });
    let current = true;
    const assertCurrent = () => {
      if (!current) throw new DOMException('This account is no longer current.', 'AbortError');
    };
    const reading = (await api()).readDeviceInventory(account, assertCurrent);
    const rejected = expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(reached).toHaveBeenCalledOnce());
    current = false;
    finish();
    await rejected;
    expect(store.close).toHaveBeenCalledOnce();
    expect(store.removeDeviceItem).not.toHaveBeenCalled();
  },
);

test('pending removal returns the recovery item and keeps account preparation and runtime without a cleanup read', async () => {
  values.set(preparedKey, account);
  const { store } = existing(pendingCopy());
  const result = await (await api()).removeDeviceCopy(account, itemId, verify);
  expect(result).toEqual({ status: 'needs-recovery', itemId });
  expect(store.removeDeviceItem).toHaveBeenCalledExactlyOnceWith(itemId, verify, undefined);
  expect(store.downloads).not.toHaveBeenCalled();
  expect(boundary.release).not.toHaveBeenCalled();
  expect(values.get(preparedKey)).toBe(account);
  expect(store.close).toHaveBeenCalledOnce();
});
