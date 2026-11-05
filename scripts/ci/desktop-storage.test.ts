import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import {
  clearDesktopStorage,
  unregisterDesktopStorageWorkers,
  safariStorageLossTabsScript,
  validateStorageLossTabs,
  validateStorageLossHandles,
  verifyDesktopStorageQuiescence,
  type StorageLossTabMode,
} from './desktop-storage.ts';

const preparationURL = 'https://localhost/_desktop-storage-loss';

test('window inventory compares handle membership independently of driver ordering', () => {
  validateStorageLossHandles(['foreground', 'background'], ['background', 'foreground']);
  for (const after of [
    [],
    ['foreground'],
    ['foreground', 'new'],
    ['foreground', 'foreground'],
    ['foreground', null],
  ])
    assert.throws(() => validateStorageLossHandles(['foreground', 'background'], after));
});

function fixture(fault?: string, rejection = false, preparation: boolean | 'verify' = false) {
  let workers = preparation === true || fault === 'registered',
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
    location: { href: fault === 'wrong-url' ? 'https://localhost/' : preparationURL },
    document: {
      body: { dataset: { spinelStorageLoss: fault === 'wrong-document' ? undefined : 'inert' } },
      scripts: { length: fault === 'app-script' ? 1 : 0 },
    },
    performance,
    console,
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
        controller:
          preparation === true || fault === 'controlled'
            ? { scriptURL: 'https://localhost/worker.js' }
            : null,
        getRegistrations: () =>
          operation('workers', () =>
            workers
              ? [
                  {
                    scope: 'https://localhost/',
                    unregister: () =>
                      operation('unregister', () => {
                        workers = fault === 'reregistered';
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
          // A writer can recreate a cache even though deletion returned true.
          cache = false;
          if (fault === 'recreated-cache')
            queueMicrotask(() => {
              cache = true;
            });
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
            request.onsuccess();
          }
        });
        return request;
      },
      databases: () =>
        operation('database-names', () => (database ? [{ name: 'private-test' }] : [])),
    },
  };
  const action =
    preparation === 'verify'
      ? verifyDesktopStorageQuiescence
      : preparation
        ? unregisterDesktopStorageWorkers
        : clearDesktopStorage;
  const promise = action(
    { evaluate: async <T>(script: string) => runInNewContext(script, sandbox) as T },
    'private-test',
    preparationURL,
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
      const f = fixture(fault, rejection, fault === 'unregister');
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
        evaluate: async () => {
          calls++;
          throw original;
        },
      },
      'private-test',
      preparationURL,
    ),
    (error) => error === original,
  );
  assert.equal(calls, 1);
});

test('unregistration reports the still-live controller and never starts storage deletion', async () => {
  const f = fixture(undefined, false, true);
  const report = await f.promise;
  assert.equal(report.phase, 'unregister');
  assert.equal(report.status, 'passed');
  assert.deepEqual(JSON.parse(JSON.stringify(report.operations.at(-1)!.value)), {
    workers: [],
    controller: 'https://localhost/worker.js',
  });
  assert.deepEqual(f.calls, ['workers', 'unregister', 'workers']);
  assert.ok(f.cleared());
});

test('a worker registered again during preparation fails before deletion', async () => {
  const f = fixture('reregistered', false, true);
  const report = await f.promise;
  assert.equal(report.status, 'failed');
  assert.match(report.error!, /Workers remain registered/);
  assert.ok(!f.calls.includes('cache-delete'));
});

for (const fault of ['wrong-url', 'wrong-document', 'app-script', 'registered', 'controlled'])
  test(`${fault} refuses storage deletion before any mutation`, async () => {
    const f = fixture(fault);
    const report = await f.promise;
    assert.equal(report.status, 'failed');
    assert.ok(f.calls.every((name) => name === 'workers'));
    assert.match(report.error!, /requires the inert fixture document|producers are still present/);
  });

test('reported cache deletion success cannot conceal recreation or cause another deletion', async () => {
  const f = fixture('recreated-cache');
  const report = await f.promise;
  assert.equal(report.status, 'failed');
  assert.match(report.error!, /Storage remains after deletion/);
  assert.equal(f.calls.filter((name) => name === 'cache-delete').length, 1);
});

for (const urls of [
  [],
  ['about:blank'],
  [preparationURL, 'https://localhost/?item=background'],
  [preparationURL, ''],
])
  test(`tab inventory rejects incomplete or active fixture clients: ${JSON.stringify(urls)}`, () => {
    assert.throws(() => validateStorageLossTabs(preparationURL, urls));
  });

test('inert fixture tabs and unrelated origins are explicitly accounted for', () => {
  const urls = [preparationURL, 'about:blank', 'http://localhost:8175/probe', preparationURL];
  assert.deepEqual(validateStorageLossTabs(preparationURL, urls), urls);
});

function safariTabs(mode: StorageLossTabMode, fault?: string) {
  const current = [preparationURL, 'https://localhost/?item=background', 'https://example.test/'];
  const writes: Array<{ index: number; url: string }> = [];
  let time = 0;
  let inventories = 0;
  const contexts = current.map((url) => ({
    location: { href: url },
    document: {
      readyState: 'complete',
      body: { dataset: { spinelStorageLoss: 'inert' } },
      scripts: { length: 0 },
    },
    navigator: { serviceWorker: { controller: { scriptURL: 'worker.js' } as object | null } },
  }));
  const tabs = current.map((_url, index) => ({
    index: () => (index === 0 ? 1 : index),
    get url() {
      return () => current[index];
    },
    set url(value: unknown) {
      assert.equal(typeof value, 'string');
      writes.push({ index, url: value as string });
      if (fault === 'navigation-error') throw new Error('first navigation error');
      if (fault === 'pending') return;
      current[index] = value as string;
      const old = contexts[index];
      contexts[index] = {
        ...old,
        location: { href: value as string },
        document: {
          ...old.document,
          body: { dataset: { spinelStorageLoss: fault === 'wrong-marker' ? '' : 'inert' } },
          scripts: { length: fault === 'app-script' ? 1 : 0 },
        },
        navigator: {
          serviceWorker: {
            controller: fault === 'controlled' ? { scriptURL: 'worker.js' } : null,
          },
        },
      };
      if (fault !== 'same-document')
        delete (contexts[index] as unknown as Record<string, unknown>).__handoff;
    },
  }));
  return {
    current,
    writes,
    execute() {
      return JSON.parse(
        runInNewContext(
          safariStorageLossTabsScript + '; run(args)',
          {
            args: [
              '42',
              mode === 'handoff' ? preparationURL + '?phase=uncontrolled' : preparationURL,
              'https://localhost/',
              mode,
              '__handoff',
            ],
            Application(pid: number) {
              assert.equal(pid, 42);
              return {
                windows: () => {
                  inventories++;
                  return [
                    { id: () => 1, tabs: () => tabs.slice(0, 1) },
                    {
                      id: () => 2,
                      tabs: () => (fault === 'missing-tab' && inventories > 1 ? [] : tabs.slice(1)),
                    },
                  ];
                },
                doJavaScript(source: string, options: { in: (typeof tabs)[number] }) {
                  if (fault === 'evaluation-error') throw new Error('first evaluation error');
                  const index = tabs.indexOf(options.in);
                  assert.notEqual(index, 2, 'Unrelated tabs must not be evaluated.');
                  return runInNewContext(source, contexts[index]);
                },
              };
            },
            Date: { now: () => time },
            delay: () => {
              time += 50;
            },
          },
          { timeout: 100 },
        ),
      );
    },
  };
}

test('native Safari preparation moves background fixture tabs once and preserves unrelated tabs', () => {
  const f = safariTabs('prepare');
  const inventory = f.execute();
  assert.equal(inventory.before[1], 'https://localhost/?item=background');
  assert.deepEqual(f.writes, [{ index: 1, url: preparationURL }]);
  assert.deepEqual(inventory.after, [preparationURL, preparationURL, 'https://example.test/']);
  validateStorageLossTabs(preparationURL, inventory.after);
});

test('post-restart Safari inventory refuses a restored producer without navigating it again', () => {
  const f = safariTabs('verify');
  assert.throws(() => f.execute(), /Another fixture tab remains active/);
  assert.deepEqual(f.writes, []);
});

test('a background navigation that never settles fails within its bound without another mutation', () => {
  const f = safariTabs('prepare', 'pending');
  assert.throws(() => f.execute(), /Another fixture tab remains active/);
  assert.deepEqual(f.writes, [{ index: 1, url: preparationURL }]);
});

test('fresh-document handoff replaces every controlled fixture tab exactly once', () => {
  const f = safariTabs('handoff');
  const inventory = f.execute();
  assert.deepEqual(f.writes, [
    { index: 0, url: preparationURL + '?phase=uncontrolled' },
    { index: 1, url: preparationURL + '?phase=uncontrolled' },
  ]);
  assert.equal(inventory.documents.length, 2);
  for (const state of inventory.documents) {
    assert.equal(state.fresh, true);
    assert.equal(state.controller, null);
    assert.equal(state.marker, 'inert');
    assert.equal(state.scripts, 0);
  }
});

for (const fault of [
  'pending',
  'same-document',
  'wrong-marker',
  'app-script',
  'controlled',
  'missing-tab',
])
  test(`handoff rejects ${fault} without repeating navigation`, () => {
    const f = safariTabs('handoff', fault);
    assert.throws(() => f.execute(), /Another fixture tab remains active|Safari tabs changed/);
    assert.equal(f.writes.length, 2);
  });

for (const fault of ['navigation-error', 'evaluation-error'])
  test(`handoff preserves ${fault} without retrying the native request`, () => {
    const f = safariTabs('handoff', fault);
    assert.throws(() => f.execute(), /first .* error/);
    assert.equal(f.writes.length, fault === 'navigation-error' ? 1 : 0);
  });

test('pre-stop quiescence only observes registrations and leaves every store intact', async () => {
  const f = fixture(undefined, false, 'verify');
  const report = await f.promise;
  assert.equal(report.phase, 'verify');
  assert.equal(report.status, 'passed');
  assert.deepEqual(f.calls, ['workers']);
});

for (const fault of ['registered', 'controlled'])
  test(`pre-stop quiescence rejects ${fault} before any mutation`, async () => {
    const f = fixture(fault, false, 'verify');
    const report = await f.promise;
    assert.equal(report.status, 'failed');
    assert.match(report.error!, /producers are still present/);
    assert.deepEqual(f.calls, ['workers']);
  });
