import { afterEach, expect, test, vi } from 'vitest';
import { offlineErrorMessage } from '../shared/offlineError.ts';
import {
  OfflineStore,
  offlinePreparation,
  preparedAccount,
  setPreparedAccount,
} from '../../web/offline/offlineStore.ts';
import { emptyRuntimeState, writeRuntimeState } from '../../web/offline/runtimeStore.ts';

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
  const transaction = {
    error: null as DOMException | null,
    oncomplete: undefined as (() => void) | undefined,
    onabort: undefined as (() => void) | undefined,
    onerror: undefined as ((event: { target: { error: DOMException | null } }) => void) | undefined,
    objectStore: () => ({ put }),
  };
  const database = { transaction: () => transaction, close: vi.fn() };
  const opening = { result: database, onsuccess: undefined as (() => void) | undefined };
  vi.stubGlobal('indexedDB', { open: () => opening });
  return { transaction, database, opening, put };
}

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
