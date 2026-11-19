import assert from 'node:assert/strict';
import test from 'node:test';
import { installInflightTracker, readInflight } from '../../e2e/worker-inflight.ts';

// 🎲 SPN-167: the observer runs inside a service worker. A fake scope proves what a
// failure message would name, that it stays content-free and that it never alters
// the worker's own promises.

class FakeExtendable {
  type = 'message';
  data?: unknown;
  waited: unknown[] = [];
  waitUntil(promise: Promise<unknown>) {
    this.waited.push(promise);
  }
}
class FakeFetch extends FakeExtendable {
  type = 'fetch';
  request = { url: 'http://localhost:3110/x', mode: 'navigate' };
  responded: unknown[] = [];
  respondWith(response: unknown) {
    this.responded.push(response);
  }
}

function scope() {
  // Fresh subclasses per test, so wrapping one scope never leaks into another.
  class Extendable extends FakeExtendable {}
  class Fetch extends FakeFetch {}
  const worker = { ExtendableEvent: Extendable, FetchEvent: Fetch } as never;
  installInflightTracker(worker);
  return { worker, Extendable, Fetch };
}

const pending = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
};

test('an unfinished event is named and a finished one is not', async () => {
  const { worker, Extendable } = scope();
  const held = pending();
  const message = new Extendable();
  message.data = { type: 'spinel-runtime', request: { type: 'prepare', accountId: 'secret' } };
  message.waitUntil(held.promise);
  const quick = new Extendable();
  quick.type = 'install';
  quick.waitUntil(Promise.resolve());
  await new Promise((resolve) => setImmediate(resolve));
  const open = readInflight(worker);
  assert.ok(Array.isArray(open));
  assert.deepEqual(
    open.map(({ type, detail }) => ({ type, detail })),
    [{ type: 'message', detail: 'prepare' }],
  );
  held.release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(readInflight(worker), []);
});

test('a fetch is described by mode and a path with ids removed, never its query', () => {
  const { worker, Fetch } = scope();
  const fetching = new Fetch();
  fetching.request = {
    url: 'http://localhost:3110/api/items/3f2b8c1e-1111-4222-8333-444455556666/sheet?token=SECRET',
    mode: 'cors',
  };
  fetching.respondWith(pending().promise);
  const open = readInflight(worker);
  assert.ok(Array.isArray(open));
  assert.equal(open[0].detail, 'cors /api/items/<id>/sheet');
  assert.doesNotMatch(JSON.stringify(open), /SECRET|3f2b8c1e/);
  const named = new Fetch();
  named.request = { url: 'http://localhost:3110/files/quarterly-budget/export', mode: 'cors' };
  named.respondWith(pending().promise);
  const later = readInflight(worker);
  assert.ok(Array.isArray(later));
  assert.equal(later[1].detail, 'cors /files/<id>/export');
});

test('unknown request types and bad events are recorded without content or a throw', () => {
  const { worker, Extendable, Fetch } = scope();
  const odd = new Extendable();
  odd.data = { request: { type: 'user-typed-secret' } };
  odd.waitUntil(pending().promise);
  const broken = new Fetch();
  broken.request = { url: 'not a url', mode: 'cors' };
  assert.doesNotThrow(() => broken.respondWith(pending().promise));
  const open = readInflight(worker);
  assert.ok(Array.isArray(open));
  assert.deepEqual(
    open.map(({ detail }) => detail),
    [null, null],
  );
});

test('the worker still receives its own promise and installing twice wraps once', () => {
  const { worker: fake, Extendable } = scope();
  installInflightTracker(fake);
  const event = new Extendable();
  const promise = pending().promise;
  event.waitUntil(promise);
  assert.deepEqual(event.waited, [promise]);
  const open = readInflight(fake);
  assert.ok(Array.isArray(open));
  assert.equal(open.length, 1);
});

test('a scope that was never tracked says so', () => {
  assert.equal(readInflight({} as never), 'not tracking');
});
