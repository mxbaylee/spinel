import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  downloadSummary,
  hasOfflineEdits,
  hasStoredEdits,
  isKnownOfflineOutbox,
  OfflineStore,
} from '../../web/offline/offlineStore.ts';
import type { OfflineOutbox, StoredItem } from '../../web/offline/offlineStore.ts';

const account = 'protected-account';
const itemId = 'protected-document';

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('location', { origin: 'https://spinel.test' });
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('IDBKeyRange', { bound: (lower: unknown, upper: unknown) => ({ lower, upper }) });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function cleanCopy(): StoredItem {
  return {
    itemId,
    name: 'Protected notes',
    kind: 'doc',
    readOnly: false,
    revision: 3,
    downloadedAt: 1,
    bundle: {
      version: 1,
      accountId: account,
      itemId,
      unitId: itemId,
      name: 'Protected notes',
      kind: 'doc',
      access: 'owner',
      readOnly: false,
      revision: 3,
      revisionOffset: 0,
      sdkVersion: '1.1.0',
      images: [],
      snapshot: { id: itemId, body: { dataStream: 'Original notes\r\n' }, documentStyle: {} },
    },
  };
}

function cleanOutbox(): OfflineOutbox {
  return {
    version: 1,
    account,
    item: itemId,
    unitId: itemId,
    revisionOffset: 0,
    checkpoint: {
      version: 1,
      unitId: itemId,
      revision: 3,
      snapshot: cleanCopy().bundle.snapshot,
      sent: null,
      inflight: [],
      buffer: [],
    },
  };
}

function pendingCopy() {
  const outbox = cleanOutbox();
  outbox.checkpoint.buffer = [
    [{ id: 'doc.mutation.rich-text-editing', params: { unitId: itemId, text: 'Keep this work' } }],
  ];
  return { ...cleanCopy(), outbox };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * One manually completed IDB read/transaction boundary. The real store methods
 * decide whether any destructive request is allowed; browser tests cover actual
 * database atomicity, writer ownership, and persisted bytes.
 */
function heldStorage() {
  const entered = deferred<void>();
  const writes: { store: string; action: 'delete' | 'put' | 'clear'; value?: unknown }[] = [];
  let reading: { result: unknown; onsuccess?: () => void } | undefined;
  let aborted = false;
  const read = () => {
    if (reading) throw new Error('This fixture supports one IDB read.');
    reading = { result: undefined };
    entered.resolve();
    return reading;
  };
  const transaction = {
    error: null,
    oncomplete: undefined as (() => void) | undefined,
    onabort: undefined as (() => void) | undefined,
    objectStore(name: string) {
      return {
        get: read,
        count: read,
        delete: (value: unknown) => {
          writes.push({ store: name, action: 'delete', value });
        },
        put: (value: unknown) => {
          writes.push({ store: name, action: 'put', value });
        },
        clear: () => {
          writes.push({ store: name, action: 'clear' });
        },
      };
    },
    abort: vi.fn(() => {
      aborted = true;
      transaction.onabort?.();
    }),
  };
  const database = { transaction: vi.fn(() => transaction) };
  return {
    store: new OfflineStore(account, database as unknown as IDBDatabase),
    database,
    transaction,
    writes,
    entered: entered.promise,
    async answer(value: unknown) {
      await entered.promise;
      reading!.result = structuredClone(value);
      reading!.onsuccess?.();
      await Promise.resolve();
    },
    complete() {
      if (!aborted) transaction.oncomplete?.();
    },
  };
}

test('only a known empty queue is clean; in-flight native work is retained even before a retry envelope exists', () => {
  const clean = cleanOutbox();
  expect(hasOfflineEdits(undefined)).toBe(false);
  expect(hasOfflineEdits(clean)).toBe(false);
  expect(hasStoredEdits({ ...cleanCopy(), outbox: clean })).toBe(false);
  clean.checkpoint.inflight = [
    { id: 'doc.mutation.rich-text-editing', params: { unitId: itemId, text: 'Not yet sent' } },
  ];
  expect(isKnownOfflineOutbox(clean)).toBe(false);
  expect(hasOfflineEdits(clean)).toBe(true);
  expect(hasStoredEdits({ ...cleanCopy(), outbox: clean })).toBe(true);
  expect(downloadSummary({ ...cleanCopy(), outbox: clean }, account, itemId)).toMatchObject({
    pending: true,
    uncertain: true,
    available: false,
  });
});

const unknownQueues = [
  'outbox-version',
  'checkpoint-version',
  'zero-revision',
  'outbox-field',
  'checkpoint-field',
  'failure',
  'buffer',
  'sent',
  'null',
  'snapshot-unit',
  'inflight',
  'missing-recovery-without-failure',
  'recovery-snapshot-without-failure',
  'missing-and-present-recovery',
] as const;

function unknownQueue(kind: (typeof unknownQueues)[number]): unknown {
  const outbox = cleanOutbox();
  switch (kind) {
    case 'outbox-version':
      return { ...outbox, version: 2 };
    case 'checkpoint-version':
      return { ...outbox, checkpoint: { ...outbox.checkpoint, version: 2 } };
    case 'zero-revision':
      return { ...outbox, checkpoint: { ...outbox.checkpoint, revision: 0 } };
    case 'outbox-field':
      return { ...outbox, futureQueue: { content: 'Retain this unknown work' } };
    case 'checkpoint-field':
      return {
        ...outbox,
        checkpoint: { ...outbox.checkpoint, futurePending: ['Retain this work'] },
      };
    case 'failure':
      return { ...outbox, checkpoint: { ...outbox.checkpoint, failure: 'future-failure' } };
    case 'buffer':
      return { ...outbox, checkpoint: { ...outbox.checkpoint, buffer: [[]] } };
    case 'sent':
      return {
        ...outbox,
        checkpoint: {
          ...outbox.checkpoint,
          sent: { type: 'submit', mutationId: 'retry-identity', baseRevision: 3, mutations: [] },
        },
      };
    case 'null':
      return null;
    case 'snapshot-unit':
      return {
        ...outbox,
        checkpoint: {
          ...outbox.checkpoint,
          snapshot: { ...outbox.checkpoint.snapshot, id: 'different-generation' },
        },
      };
    case 'inflight':
      return { ...outbox, checkpoint: { ...outbox.checkpoint, inflight: null } };
    case 'missing-recovery-without-failure':
      return { ...outbox, checkpoint: { ...outbox.checkpoint, recoveryMissing: true } };
    case 'recovery-snapshot-without-failure':
      return {
        ...outbox,
        checkpoint: { ...outbox.checkpoint, recoverySnapshot: outbox.checkpoint.snapshot },
      };
    case 'missing-and-present-recovery':
      return {
        ...outbox,
        checkpoint: {
          ...outbox.checkpoint,
          failure: 'refused',
          recoveryMissing: true,
          recoverySnapshot: outbox.checkpoint.snapshot,
        },
      };
  }
}

test.each(unknownQueues)(
  'an unknown or malformed %s queue cannot be automatically treated as clean or deleted',
  async (kind) => {
    const outbox = unknownQueue(kind);
    const item = { ...cleanCopy(), outbox };
    const before = structuredClone(item);
    expect(isKnownOfflineOutbox(outbox)).toBe(false);
    expect(hasOfflineEdits(outbox)).toBe(true);
    expect(hasStoredEdits(item)).toBe(true);
    expect(downloadSummary(item, account, itemId)).toMatchObject({
      pending: true,
      uncertain: true,
      available: false,
    });
    const f = heldStorage();
    const removal = f.store.removeDeviceItem(itemId, () => {});
    await f.answer(item);
    f.complete();
    await expect(removal).resolves.toEqual({ status: 'needs-recovery', itemId });
    expect(f.writes).toEqual([]);
    expect(item).toEqual(before);
  },
);

test('an orphaned recovery result prevents a refreshed download from replacing the retained document and images', async () => {
  const item = {
    ...cleanCopy(),
    recovery: {
      recoveryId: '11111111-1111-4111-8111-111111111111',
      filename: 'Recovered notes.univer.json',
      snapshot: cleanCopy().bundle.snapshot,
      possibleReplayCrash: false,
    },
  };
  expect(hasStoredEdits(item)).toBe(true);
  expect(downloadSummary(item, account, itemId)).toMatchObject({ pending: true, uncertain: true });
  const f = heldStorage();
  const replacing = f.store.saveDownload({ ...cleanCopy().bundle, revision: 4 }, new Map());
  const rejected = expect(replacing).rejects.toThrow('changes on this device');
  await f.answer(item);
  await rejected;
  expect(f.transaction.abort).toHaveBeenCalledOnce();
  expect(f.writes).toEqual([]);
});

const uncertainRecords = [
  'foreign-account',
  'bundle-item',
  'outer-item',
  'kind',
  'future-sdk',
  'empty-unit',
  'unknown-access',
  'invalid-read-only',
  'writable-viewer',
  'space-is-item',
  'sheet-without-sheets',
  'sheet-null-child',
  'sheet-zero-rows',
  'doc-with-sheets',
  'bundle-snapshot-identity',
  'recovery-snapshot-identity',
  'recovery-doc-body',
  'recovery-doc-stream',
  'recovery-sheet-order',
  'recovery-sheet-order-entry',
  'null',
] as const;
function uncertainRecord(kind: (typeof uncertainRecords)[number]): unknown {
  if (kind === 'null') return null;
  const item = cleanCopy();
  if (kind === 'foreign-account') item.bundle.accountId = 'another-account';
  if (kind === 'bundle-item') item.bundle.itemId = 'another-document';
  if (kind === 'outer-item') item.itemId = 'another-storage-key';
  if (kind === 'kind') Object.assign(item.bundle, { kind: 'future-document' });
  if (kind === 'future-sdk') item.bundle.sdkVersion = '999.0.0';
  if (kind === 'empty-unit') item.bundle.unitId = '';
  if (kind === 'unknown-access') Object.assign(item.bundle, { access: 'future-role' });
  if (kind === 'invalid-read-only') Object.assign(item.bundle, { readOnly: 'false' });
  if (kind === 'writable-viewer') item.bundle.access = 'viewer';
  if (kind === 'space-is-item') item.bundle.spaceId = itemId;
  if (kind === 'sheet-without-sheets') {
    item.bundle.kind = 'sheet';
    item.bundle.snapshot = {
      id: itemId,
      sheets: {},
    } as unknown as StoredItem['bundle']['snapshot'];
    item.outbox = cleanOutbox();
    item.outbox.checkpoint.snapshot = { id: itemId } as OfflineOutbox['checkpoint']['snapshot'];
  }
  if (kind === 'sheet-null-child' || kind === 'sheet-zero-rows') {
    item.kind = item.bundle.kind = 'sheet';
    item.bundle.snapshot = {
      id: itemId,
      sheets: { tab: kind === 'sheet-null-child' ? null : { rowCount: 0 } },
      sheetOrder: ['tab'],
    } as unknown as StoredItem['bundle']['snapshot'];
  }
  if (kind === 'doc-with-sheets') Object.assign(item.bundle.snapshot, { sheets: {} });
  if (kind === 'bundle-snapshot-identity') item.bundle.snapshot.id = 'another-item';
  if (kind === 'recovery-snapshot-identity') {
    item.outbox = cleanOutbox();
    item.outbox.checkpoint.failure = 'stale';
    item.outbox.checkpoint.recoverySnapshot = {
      ...structuredClone(item.bundle.snapshot),
      id: 'another-unit',
    };
  }
  if (kind.startsWith('recovery-doc-') || kind.startsWith('recovery-sheet-')) {
    if (kind.startsWith('recovery-sheet-')) {
      item.kind = 'sheet';
      item.bundle.kind = 'sheet';
      item.bundle.snapshot = {
        id: itemId,
        sheets: {},
        sheetOrder: [],
      } as unknown as StoredItem['bundle']['snapshot'];
    }
    item.outbox = cleanOutbox();
    item.outbox.checkpoint.snapshot = structuredClone(item.bundle.snapshot);
    item.outbox.checkpoint.failure = 'refused';
    const recovery = structuredClone(item.bundle.snapshot) as unknown as Record<string, unknown>;
    if (kind === 'recovery-doc-body') delete recovery.body;
    if (kind === 'recovery-doc-stream') recovery.body = { dataStream: 42 };
    if (kind === 'recovery-sheet-order') delete recovery.sheetOrder;
    if (kind === 'recovery-sheet-order-entry') recovery.sheetOrder = [42];
    item.outbox.checkpoint.recoverySnapshot =
      recovery as unknown as OfflineOutbox['checkpoint']['snapshot'];
  }
  return item;
}

test.each(
  uncertainRecords.flatMap((kind) =>
    (['remove', 'replace'] as const).map((action) => [kind, action] as const),
  ),
)('a transactional %s record read cannot %s an unverified device copy', async (kind, action) => {
  const f = heldStorage();
  const item = uncertainRecord(kind);
  if (action === 'remove') {
    const removal = f.store.removeDeviceItem(itemId, () => {});
    await f.answer(item);
    f.complete();
    await expect(removal).resolves.toEqual({ status: 'needs-recovery', itemId });
  } else {
    const replacement = f.store.saveDownload(cleanCopy().bundle, new Map());
    const rejected = expect(replacement).rejects.toThrow();
    await f.answer(item);
    await rejected;
    expect(f.transaction.abort).toHaveBeenCalledOnce();
  }
  expect(f.writes).toEqual([]);
});

test('explicit confirmed discard can remove an unverified record and only the requested item’s images', async () => {
  const f = heldStorage();
  const removal = f.store.removeDeviceItem(itemId, () => {}, true);
  await f.answer(uncertainRecord('foreign-account'));
  f.complete();
  await expect(removal).resolves.toEqual({ status: 'removed' });
  expect(f.writes).toEqual([
    { store: 'items', action: 'delete', value: itemId },
    {
      store: 'images',
      action: 'delete',
      value: { lower: [itemId, ''], upper: [itemId, '\uffff'] },
    },
  ]);
});

test('a removal chosen from a clean summary rereads a newly pending queue before issuing any delete', async () => {
  expect(downloadSummary(cleanCopy(), account, itemId).pending).toBe(false);
  const f = heldStorage();
  const removal = f.store.removeDeviceItem(itemId, () => {});
  const newer = pendingCopy();
  await f.answer(newer);
  expect(f.writes).toEqual([]);
  f.complete();
  await expect(removal).resolves.toEqual({ status: 'needs-recovery', itemId });
  expect(f.writes).toEqual([]);
});

test('explicit discard still aborts after an account change during its transactional read', async () => {
  const f = heldStorage();
  let current = true;
  const verify = () => {
    if (!current) throw new DOMException('Account changed', 'AbortError');
  };
  const removing = f.store.removeDeviceItem(itemId, verify, true);
  const rejected = expect(removing).rejects.toMatchObject({ name: 'AbortError' });
  await f.entered;
  current = false;
  await f.answer({ ...cleanCopy(), outbox: unknownQueue('checkpoint-version') });
  await rejected;
  expect(f.transaction.abort).toHaveBeenCalledOnce();
  expect(f.writes).toEqual([]);
});

test('all-account deletion checks cancellation inside the transaction before clearing any private store', async () => {
  const f = heldStorage();
  let current = true;
  const verify = () => {
    if (!current) throw new DOMException('Account changed', 'AbortError');
  };
  const clearing = f.store.clearAccount(verify);
  const rejected = expect(clearing).rejects.toMatchObject({ name: 'AbortError' });
  await f.entered;
  current = false;
  await f.answer(3);
  await rejected;
  expect(f.transaction.abort).toHaveBeenCalledOnce();
  expect(f.writes).toEqual([]);
});

test.each(['unsupported', 'held'] as const)(
  'public removal with an %s writer lock cannot start a destructive transaction',
  async (state) => {
    const f = heldStorage();
    if (state === 'held')
      vi.stubGlobal('navigator', {
        locks: {
          request: async (
            _name: string,
            _options: LockOptions,
            callback: (lock: null) => Promise<void>,
          ) => callback(null),
        },
      });
    await expect(f.store.remove(itemId)).rejects.toThrow(
      state === 'held' ? 'every tab' : 'Web Locks',
    );
    expect(f.database.transaction).not.toHaveBeenCalled();
    expect(f.writes).toEqual([]);
  },
);

test('failed compatible-runtime preparation never opens a private write transaction', async () => {
  const f = heldStorage();
  await expect(
    f.store.saveDownload(
      cleanCopy().bundle,
      new Map(),
      () => {},
      async () => {
        throw new Error('The compatible offline app is incomplete.');
      },
    ),
  ).rejects.toThrow('compatible offline app');
  expect(f.database.transaction).not.toHaveBeenCalled();
  expect(f.writes).toEqual([]);
});

test('cancellation after compatible-runtime preparation completes cannot start a private write', async () => {
  const f = heldStorage();
  const entered = deferred<void>();
  const prepared = deferred<void>();
  let current = true;
  const verify = () => {
    if (!current) throw new DOMException('Account changed', 'AbortError');
  };
  const saving = f.store.saveDownload(cleanCopy().bundle, new Map(), verify, async () => {
    entered.resolve();
    await prepared.promise;
  });
  const rejected = expect(saving).rejects.toMatchObject({ name: 'AbortError' });
  await entered.promise;
  current = false;
  prepared.resolve();
  await rejected;
  expect(f.database.transaction).not.toHaveBeenCalled();
  expect(f.writes).toEqual([]);
});

test('compatible-runtime reservation and private completion stay within one account catalog lock', async () => {
  const f = heldStorage();
  const entered = deferred<void>();
  const prepared = deferred<void>();
  let held = false;
  const request = vi.fn(async (_name: string, run: () => Promise<unknown>) => {
    held = true;
    try {
      return await run();
    } finally {
      held = false;
    }
  });
  vi.stubGlobal('navigator', { locks: { request } });
  const saving = f.store.saveDownload(
    cleanCopy().bundle,
    new Map(),
    () => {},
    async () => {
      expect(held).toBe(true);
      entered.resolve();
      await prepared.promise;
    },
  );
  await entered.promise;
  expect(f.database.transaction).not.toHaveBeenCalled();
  prepared.resolve();
  await f.answer(undefined);
  expect(held).toBe(true);
  expect(f.writes.some((write) => write.store === 'items' && write.action === 'put')).toBe(true);
  f.complete();
  await expect(saving).resolves.toMatchObject({ itemId, name: 'Protected notes', pending: false });
  expect(held).toBe(false);
  expect(request).toHaveBeenCalledExactlyOnceWith(
    `spinel-offline-catalog:${account}`,
    expect.any(Function),
  );
});
