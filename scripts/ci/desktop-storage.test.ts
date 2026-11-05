import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import { clearDesktopStorage } from './desktop-storage.ts';

function fixture(fault?: string, rejection = false, scripts = 0, rewrite = false) {
  let workers = true,
    cache = true,
    database = true,
    entries = 1;
  let expire: (() => void) | undefined;
  let cleared = false;
  const calls: string[] = [];
  function operation<T>(name: string, action: () => T): T | Promise<never> {
    calls.push(name);
    if (name !== fault) return action();
    if (rejection) throw new Error(`injected ${name}`);
    return new Promise<never>(() => {});
  }
  const sandbox = {
    performance,
    console,
    document: {
      getElementsByTagNameNS: (namespace: string, name: string) => ({
        length: namespace === '*' && name === 'script' ? scripts : 0,
      }),
    },
    location: { pathname: scripts ? '/' : '/favicon.svg' },
    setTimeout(callback: () => void, timeout: number) {
      assert.equal(timeout, 28000);
      expire = callback;
      return 1;
    },
    clearTimeout() {
      cleared = true;
    },
    navigator: {
      serviceWorker: {
        getRegistrations: () =>
          operation('workers', () =>
            workers
              ? [
                  {
                    scope: 'https://localhost/',
                    unregister: () =>
                      operation('unregister', () => {
                        workers = false;
                        return true;
                      }),
                  },
                ]
              : [],
          ),
      },
    },
    caches: {
      keys: () => operation('cache-names', () => (cache ? ['shell'] : [])),
      delete: () =>
        operation('cache-delete', () => {
          cache = false;
          return true;
        }),
    },
    localStorage: {
      clear() {
        operation('local-storage', () => {
          entries = 0;
        });
        // A loaded app writing its key again right after the clear.
        if (rewrite) queueMicrotask(() => (entries = 1));
      },
      get length() {
        return entries;
      },
      key: (index: number) => (index < entries ? 'spinel.offline.account' : null),
    },
    indexedDB: {
      deleteDatabase(name: string) {
        assert.equal(name, 'private-test');
        calls.push('database-delete');
        const request = {
          onsuccess: () => {},
          onerror: () => {},
          onblocked: () => {},
          error: new Error('injected database-delete'),
        };
        queueMicrotask(() => {
          if (fault === 'blocked') request.onblocked();
          else if (fault === 'database-delete') {
            if (rejection) request.onerror();
          } else {
            database = fault === 'retained';
            request.onsuccess();
          }
        });
        return request;
      },
      databases: () =>
        operation('database-names', () => (database ? [{ name: 'private-test' }] : [])),
    },
  };
  const promise = clearDesktopStorage(
    { evaluate: async <T>(script: string) => runInNewContext(script, sandbox) as T },
    'private-test',
  );
  return { promise, calls, sandbox, expire: () => expire!(), cleared: () => cleared };
}

test('serialized browser deletion removes every store and proves the resulting state', async () => {
  const f = fixture();
  const report = await f.promise;
  assert.equal(report.status, 'passed');
  assert.ok(report.operations.every((entry) => entry.status === 'passed'));
  assert.deepEqual(JSON.parse(JSON.stringify(report.operations.at(-1)!.value)), {
    workers: [],
    cacheNames: [],
    databases: [],
    localStorageEntries: 0,
    localStorageKeys: [],
  });
  assert.equal(report.operations[0]!.name, 'verify-no-page-scripts');
  assert.equal(report.operations[0]!.value, '/favicon.svg');
  assert.ok(f.cleared());
});

for (const [fault, name] of [
  ['workers', 'serviceWorker.getRegistrations'],
  ['unregister', 'serviceWorker.unregister:https://localhost/'],
  ['cache-names', 'caches.keys'],
  ['cache-delete', 'caches.delete:shell'],
  ['database-delete', 'indexedDB.deleteDatabase:private-test'],
  ['database-names', 'verify-database-names'],
]) {
  for (const rejection of [false, true])
    test(`${fault} ${rejection ? 'rejection' : 'pending'} names the first failing operation`, async () => {
      const f = fixture(fault, rejection);
      for (let i = 0; i < 20 && !f.calls.includes(fault); i++) await setImmediate();
      assert.ok(f.calls.includes(fault));
      if (!rejection) f.expire();
      const report = await f.promise;
      assert.equal(report.status, 'failed');
      assert.equal(report.operations.at(-1)!.name, name);
      assert.match(report.error!, rejection ? /injected/ : /deadline exceeded/);
      assert.equal(report.operations.filter((entry) => entry.status === 'failed').length, 1);
      assert.ok(f.cleared());
    });
}

test('blocked IndexedDB fails immediately and retains that cause', async () => {
  const report = await fixture('blocked').promise;
  assert.equal(report.status, 'failed');
  assert.match(
    report.error!,
    /indexedDB.deleteDatabase:private-test: Error: Private database is still open/,
  );
});

test('a reported deletion success cannot conceal a retained database', async () => {
  const report = await fixture('retained').promise;
  assert.equal(report.status, 'failed');
  assert.match(report.error!, /Storage remains after deletion/);
});

test('deletion refuses a page that runs scripts before touching any store', async () => {
  const f = fixture(undefined, false, 1);
  const report = await f.promise;
  assert.equal(report.status, 'failed');
  assert.match(report.error!, /verify-no-page-scripts: Error: A page with scripts is still loaded/);
  assert.deepEqual(f.calls, []);
});

test('an entry written again after the clear fails and names its key', async () => {
  const report = await fixture(undefined, false, 0, true).promise;
  assert.equal(report.status, 'failed');
  assert.match(report.error!, /Storage remains after deletion/);
  assert.match(report.error!, /"localStorageKeys":\["spinel\.offline\.account"\]/);
});

test('synchronous storage rejection is retained without continuing to database deletion', async () => {
  const f = fixture('local-storage', true);
  const report = await f.promise;
  assert.equal(report.status, 'failed');
  assert.match(report.error!, /localStorage.clear: Error: injected local-storage/);
  assert.ok(!f.calls.includes('database-delete'));
});

test('crashed or timed-out driver propagates the first error without another diagnostic request', async () => {
  const original = new Error('driver process exited during deletion');
  let calls = 0;
  await assert.rejects(
    clearDesktopStorage(
      {
        evaluate: async () => {
          calls++;
          throw original;
        },
      },
      'private-test',
    ),
    (error) => error === original,
  );
  assert.equal(calls, 1);
});
