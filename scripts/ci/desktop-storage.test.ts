import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import { clearDesktopStorage } from './desktop-storage.ts';

const page = 'https://localhost/_desktop-storage-clear/fixture';

function fixture(fault?: string, rejection = false, unloadApplication = true) {
  let workers = true,
    cache = true,
    database = true,
    entries = 1;
  let applicationActive = true,
    interleavedWrite = false;
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
    location: { href: 'https://localhost/' },
    document: {
      documentElement: {
        hasAttribute: (name: string) =>
          name === 'data-desktop-storage-clear' && fault !== 'unmarked-page',
      },
      scripts: { length: fault === 'scripted-page' ? 1 : 0 },
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
          if (fault === 'blocked') request.onblocked();
          else if (fault === 'database-delete') {
            if (rejection) request.onerror();
          } else {
            database = fault === 'retained';
            if (fault === 'concurrent-writer') {
              interleavedWrite = true;
              if (applicationActive) entries = 1;
            }
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
      goto: async (url) => {
        calls.push('navigate');
        assert.equal(url, page);
        if (fault === 'navigation') throw new Error('injected navigation');
        sandbox.location.href = fault === 'wrong-page' ? 'https://localhost/' : url;
        if (unloadApplication) applicationActive = false;
      },
      evaluate: async <T>(script: string) => {
        calls.push('evaluate');
        return runInNewContext(script, sandbox) as T;
      },
    },
    'private-test',
    page,
  );
  return {
    promise,
    calls,
    sandbox,
    expire: () => expire!(),
    cleared: () => cleared,
    interleavedWrite: () => interleavedWrite,
  };
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

test('unloading the page stops an application write interleaved with database deletion', async () => {
  const f = fixture('concurrent-writer');
  const report = await f.promise;
  assert.equal(report.status, 'passed');
  assert.ok(f.interleavedWrite());
  assert.deepEqual(f.calls.slice(0, 2), ['navigate', 'evaluate']);
});

test('an interleaved live writer still fails the strict empty-storage predicate', async () => {
  const f = fixture('concurrent-writer', false, false);
  const report = await f.promise;
  assert.ok(f.interleavedWrite());
  assert.equal(report.status, 'failed');
  assert.match(report.error!, /Storage remains after deletion:.*"localStorageEntries":1/);
});

for (const fault of ['wrong-page', 'unmarked-page', 'scripted-page'])
  test(`${fault} is rejected before any storage operation`, async () => {
    const f = fixture(fault);
    const report = await f.promise;
    assert.equal(report.status, 'failed');
    assert.equal(report.operations.at(-1)!.name, 'verify-inert-page');
    assert.deepEqual(f.calls, ['navigate', 'evaluate']);
  });

test('failed navigation preserves the first error and never attempts deletion', async () => {
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
      page,
    ),
    (error) => error === original,
  );
  assert.equal(calls, 1);
});
