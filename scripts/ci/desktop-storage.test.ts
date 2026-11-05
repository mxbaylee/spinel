import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import { clearDesktopStorage } from './desktop-storage.ts';

function fixture(fault?: string, rejection = false) {
  let workers = true,
    cache = true,
    database = true,
    entries = 1;
  let expire: (() => void) | undefined;
  let cleared = false;
  let liveDocument = true;
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
    location: { href: 'https://localhost/' },
    document: {
      documentElement: {
        getAttribute: (name: string) =>
          name === 'data-desktop-storage-reset' && !liveDocument && fault !== 'missing-marker'
            ? 'true'
            : null,
      },
      get scripts() {
        return liveDocument || fault === 'scripted-context' ? [{}] : [];
      },
    },
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
      },
      get length() {
        return entries;
      },
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
          // An application effect can write a preference while asynchronous
          // deletion yields. Only unloading that document retires its writer.
          if (liveDocument || fault === 'retained-local-storage') entries = 1;
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
    {
      async goto(url: string) {
        calls.push('navigate');
        if (fault === 'navigation') throw new Error('injected navigation');
        if (fault !== 'live-context') liveDocument = false;
        sandbox.location.href = fault === 'wrong-origin' ? 'https://other.invalid/' : url;
      },
      evaluate: async <T>(script: string) => runInNewContext(script, sandbox) as T,
    },
    'private-test',
    'https://localhost/_desktop-storage-reset',
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
  });
  assert.ok(f.cleared());
});

test('deletion unloads the application before its pending writer can recreate storage', async () => {
  const f = fixture();
  const report = await f.promise;
  assert.equal(report.status, 'passed', JSON.stringify(report));
  assert.equal(f.calls[0], 'navigate');
  assert.equal(f.calls.filter((name) => name === 'local-storage').length, 1);
});

for (const fault of ['live-context', 'wrong-origin', 'missing-marker', 'scripted-context']) {
  test(`${fault} cannot delete storage or be mistaken for the inert same-origin document`, async () => {
    const f = fixture(fault);
    const report = await f.promise;
    assert.equal(report.status, 'failed');
    assert.equal(report.operations[0].name, 'verify-deletion-context');
    assert.match(report.error!, /Storage deletion document is not ready/);
    assert.deepEqual(f.calls, ['navigate']);
  });
}

test('a new storage entry still fails instead of being cleared a second time', async () => {
  const f = fixture('retained-local-storage');
  const report = await f.promise;
  assert.equal(report.status, 'failed');
  assert.match(report.error!, /Storage remains after deletion/);
  assert.equal(f.calls.filter((name) => name === 'local-storage').length, 1);
});

test('failed navigation preserves the first error and performs no deletion', async () => {
  const f = fixture('navigation');
  await assert.rejects(f.promise, /injected navigation/);
  assert.deepEqual(f.calls, ['navigate']);
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
        goto: async () => {},
        evaluate: async () => {
          calls++;
          throw original;
        },
      },
      'private-test',
      'https://localhost/_desktop-storage-reset',
    ),
    (error) => error === original,
  );
  assert.equal(calls, 1);
});
