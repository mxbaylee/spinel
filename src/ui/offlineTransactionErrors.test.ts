import { afterEach, expect, test, vi } from 'vitest';
import { offlineErrorMessage } from '../shared/offlineError.ts';
import type { ClientCheckpoint } from '@spinel/sync-client';
import type { OfflineBundle } from '../shared/offlineBundle.ts';
import {
  OfflineStore,
  offlineAccountRead,
  offlinePreparation,
  preparedAccount,
  setPreparedAccount,
  watchOfflineChanges,
} from '../../web/offline/offlineStore.ts';
import { emptyRuntimeState, writeRuntimeState } from '../../web/offline/runtimeStore.ts';
import { OFFLINE_SDK_VERSION } from '../../web/offline/OfflineAccess.ts';

afterEach(() => vi.unstubAllGlobals());

/** Only IDB event delivery is controlled; the real write/completion adapters run. */
function transactionFixture() {
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
  setPreparedAccount(null);
  const put = vi.fn();
  const reading = {
    result: undefined as unknown,
    onsuccess: undefined as (() => void) | undefined,
  };
  const transaction = {
    error: null as DOMException | null,
    oncomplete: undefined as (() => void) | undefined,
    onabort: undefined as (() => void) | undefined,
    onerror: undefined as ((event: { target: { error: DOMException | null } }) => void) | undefined,
    objectStore: () => ({ put, get: () => reading }),
    abort() {
      transaction.onabort?.();
    },
  };
  const database = { transaction: vi.fn(() => transaction), close: vi.fn() };
  const opening = { result: database, onsuccess: undefined as (() => void) | undefined };
  vi.stubGlobal('indexedDB', { open: () => opening });
  return { transaction, database, opening, reading, put };
}

// This boundary owns the stored envelope and IDB completion, not native mutation
// interpretation (covered by the sync-client's actual Doc/Sheet fixtures).
function acknowledgedCheckpoint() {
  const scope = { account: 'owner', item: 'item', unitId: 'unit', revisionOffset: 0 };
  const mutation = { id: 'doc.mutation.rich-text-editing', params: { unitId: scope.unitId } };
  const base: ClientCheckpoint = {
    version: 1,
    unitId: scope.unitId,
    revision: 1,
    snapshot: { id: scope.unitId, body: { dataStream: '\r\n' }, documentStyle: {} },
    sent: {
      type: 'submit',
      mutationId: 'original-retry-identity',
      baseRevision: 1,
      mutations: [mutation],
    },
    inflight: [mutation],
    buffer: [],
  };
  const bundle: OfflineBundle = {
    version: 1,
    accountId: scope.account,
    itemId: scope.item,
    unitId: scope.unitId,
    name: 'Saved notes',
    kind: 'doc',
    revision: 1,
    revisionOffset: 0,
    access: 'owner',
    readOnly: false,
    sdkVersion: OFFLINE_SDK_VERSION,
    images: [],
    snapshot: { id: scope.item, body: { dataStream: '\r\n' }, documentStyle: {} },
  };
  const previous = {
    itemId: scope.item,
    bundle,
    outbox: { version: 1, ...scope, checkpoint: base },
  };
  const acknowledged: ClientCheckpoint = {
    ...structuredClone(base),
    revision: 2,
    snapshot: {
      id: scope.unitId,
      body: { dataStream: 'Acknowledged native content\r\n' },
      documentStyle: {},
    },
    sent: null,
    inflight: [],
    buffer: [],
  };
  return { scope, previous, acknowledged };
}

test('checkpoint acknowledgement notifies the file list only after the whole transaction commits', async () => {
  const f = transactionFixture();
  const data = acknowledgedCheckpoint();
  f.reading.result = structuredClone(data.previous);
  const changed = vi.fn();
  const stop = watchOfflineChanges(data.scope.account, changed);
  const store = new OfflineStore(data.scope.account, f.database as unknown as IDBDatabase);
  let settled = false;
  const outcome = store
    .saveCheckpoint(data.scope, data.acknowledged, () => {})
    .then(() => {
      settled = true;
    });
  try {
    f.reading.onsuccess!();
    await Promise.resolve();
    expect(f.database.transaction).toHaveBeenCalledWith(['items', 'images'], 'readwrite');
    expect(f.put).toHaveBeenCalledExactlyOnceWith({
      ...data.previous,
      outbox: { version: 1, ...data.scope, checkpoint: data.acknowledged },
    });
    expect(settled).toBe(false);
    expect(changed).not.toHaveBeenCalled();
    f.transaction.oncomplete!();
    await outcome;
    expect(settled).toBe(true);
    expect(changed).toHaveBeenCalledExactlyOnceWith({
      accountId: data.scope.account,
      itemId: data.scope.item,
      pending: false,
    });
  } finally {
    try {
      f.transaction.oncomplete?.();
      await outcome;
    } finally {
      stop();
    }
  }
});

test.each(['request error', 'delayed abort', 'abort without a cause'] as const)(
  'checkpoint acknowledgement retains the %s and never publishes a clean-copy notice',
  async (delivery) => {
    const f = transactionFixture();
    const data = acknowledgedCheckpoint();
    f.reading.result = structuredClone(data.previous);
    const changed = vi.fn();
    const stop = watchOfflineChanges(data.scope.account, changed);
    const store = new OfflineStore(data.scope.account, f.database as unknown as IDBDatabase);
    let settled = false;
    const outcome = store
      .saveCheckpoint(data.scope, data.acknowledged, () => {})
      .then(
        () => {
          settled = true;
          return undefined;
        },
        (error: unknown) => {
          settled = true;
          return error;
        },
      );
    try {
      f.reading.onsuccess!();
      await Promise.resolve();
      expect(f.put).toHaveBeenCalledOnce();
      expect(changed).not.toHaveBeenCalled();
      const quota = new DOMException('', 'QuotaExceededError');
      if (delivery === 'request error') f.transaction.onerror!({ target: { error: quota } });
      else {
        f.transaction.onerror!({ target: { error: null } });
        await Promise.resolve();
        expect(settled).toBe(false);
        if (delivery === 'delayed abort') f.transaction.error = quota;
        f.transaction.onabort!();
      }
      const error = await outcome;
      if (delivery === 'abort without a cause')
        expect(error).toMatchObject({ message: 'Storage write cancelled.' });
      else expect(error).toBe(quota);
      // Even a late completion event cannot turn this rejected checkpoint into
      // a clean notification. The browser owns actual rollback durability.
      f.transaction.oncomplete!();
      await Promise.resolve();
      expect(changed).not.toHaveBeenCalled();
    } finally {
      f.transaction.onabort?.();
      await outcome;
      stop();
    }
  },
);

test.each(['device read', 'commit'] as const)(
  'checkpoint acknowledgement cannot notify a replacement account after invalidation at %s',
  async (stage) => {
    const f = transactionFixture();
    const data = acknowledgedCheckpoint();
    f.reading.result = structuredClone(data.previous);
    setPreparedAccount(data.scope.account);
    const current = offlineAccountRead(data.scope.account);
    const changed = vi.fn();
    const stop = watchOfflineChanges(data.scope.account, changed);
    const verify = () => {
      if (!current()) throw new Error('Account changed');
    };
    const store = new OfflineStore(data.scope.account, f.database as unknown as IDBDatabase);
    const outcome = store.saveCheckpoint(data.scope, data.acknowledged, verify).then(
      () => undefined,
      (error: unknown) => error,
    );
    try {
      if (stage === 'device read') setPreparedAccount('replacement');
      f.reading.onsuccess!();
      await Promise.resolve();
      if (stage === 'commit') {
        expect(f.put).toHaveBeenCalledOnce();
        setPreparedAccount('replacement');
        f.transaction.oncomplete!();
      }
      expect(await outcome).toMatchObject({ message: 'Account changed' });
      expect(f.put).toHaveBeenCalledTimes(stage === 'device read' ? 0 : 1);
      expect(changed).not.toHaveBeenCalled();
    } finally {
      f.transaction.onabort?.();
      await outcome;
      stop();
    }
  },
);

for (const stage of ['catalog', 'runtime control'] as const)
  test.each(['request error', 'delayed abort', 'abort without a cause'] as const)(
    `${stage} preserves the storage outcome from %s`,
    async (delivery) => {
      const f = transactionFixture();
      const completion: Promise<unknown> =
        stage === 'catalog'
          ? offlinePreparation('owner', () => true).finish(
              new OfflineStore('owner', f.database as unknown as IDBDatabase),
              { id: 'owner', name: 'Owner' },
              { syncedAt: 1, items: [], shared: [], views: {} },
            )
          : writeRuntimeState(emptyRuntimeState(), () => {});
      let settled = false;
      const outcome = completion.then(
        () => {
          settled = true;
          return undefined;
        },
        (error: unknown) => {
          settled = true;
          return error;
        },
      );
      if (stage === 'runtime control') {
        f.opening.onsuccess?.();
        await Promise.resolve();
      } else {
        // Admit the catalog write after the real monotonic-cutoff read.
        f.reading.onsuccess?.();
        await Promise.resolve();
      }
      expect(f.put).toHaveBeenCalledTimes(stage === 'catalog' ? 2 : 1);
      const quota = new DOMException('', 'QuotaExceededError');
      if (delivery === 'request error') {
        // IDBRequest.error is available while transaction.error is still null.
        f.transaction.onerror!({ target: { error: quota } });
      } else {
        f.transaction.onerror!({ target: { error: null } });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(settled).toBe(false);
        if (delivery === 'delayed abort') f.transaction.error = quota;
        f.transaction.onabort!();
      }
      const error = await outcome;
      if (delivery === 'abort without a cause')
        expect(error).toMatchObject({
          message:
            stage === 'catalog' ? 'Storage write cancelled.' : 'Offline runtime write failed.',
        });
      else {
        expect(error).toBe(quota);
        // Catalog completion runs after the private download has returned; its
        // raw quota failure must still become the actionable availability text.
        expect(
          offlineErrorMessage(error, 'Could not change offline availability. Try again.'),
        ).toBe('This device is out of space for offline documents.');
      }
      expect(preparedAccount()).toBeNull();
      if (stage === 'runtime control') expect(f.database.close).toHaveBeenCalledOnce();
    },
  );
