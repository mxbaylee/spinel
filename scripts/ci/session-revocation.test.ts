import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test, { type TestContext } from 'node:test';
import type { CDPSession, Frame, Page, WebSocket } from '@playwright/test';
import {
  cleanupSessionRevocation,
  observeSessionRevocation,
} from '../../e2e/session-revocation.ts';
import { coveragePlan, suiteIds, verifyCoverage } from './plan.ts';

const socketURL = 'wss://spinel.test/sync';

function boundary() {
  const commands: string[] = [];
  let detaches = 0;
  const session = Object.assign(new EventEmitter(), {
    async send(command: string) {
      commands.push(command);
    },
    async detach() {
      detaches++;
      session.emit('close');
    },
  });
  const mainFrame = {} as Frame;
  const page = Object.assign(new EventEmitter(), {
    mainFrame: () => mainFrame,
    context: () => ({ newCDPSession: async () => session as unknown as CDPSession }),
  });
  return {
    session,
    page,
    commands,
    detaches: () => detaches,
    observe: () => observeSessionRevocation(page as unknown as Page, socketURL),
    create: (requestId: string, url = socketURL) =>
      session.emit('Network.webSocketCreated', { requestId, url }),
    open: (requestId: string, status = 101) =>
      session.emit('Network.webSocketHandshakeResponseReceived', {
        requestId,
        response: { status },
      }),
    close: (requestId: string) => session.emit('Network.webSocketClosed', { requestId }),
    frame: (requestId: string, payloadData = 'fixture content') =>
      session.emit('Network.webSocketFrameReceived', {
        requestId,
        response: { opcode: 1, payloadData },
      }),
    navigate: () => page.emit('framenavigated', mainFrame),
    pageSocket: (url = socketURL) => {
      const socket = Object.assign(new EventEmitter(), { url: () => url });
      page.emit('websocket', socket as unknown as WebSocket);
      return socket;
    },
  };
}

async function fixture(t: TestContext) {
  const f = boundary();
  const observer = await f.observe();
  t.after(() => observer.stop());
  return { ...f, observer };
}

for (const order of ['close-first', 'navigation-first'] as const)
  test(`protocol closure survives ${order} ordering and retains frame counts`, async (t) => {
    const f = await fixture(t);
    f.create('revoked');
    f.open('revoked');
    f.frame('revoked');
    f.observer.beforeRevoke();
    if (order === 'navigation-first') f.navigate();
    assert.equal(f.observer.isClosed(), false);
    f.close('revoked');
    if (order === 'close-first') f.navigate();
    assert.doesNotThrow(() => f.observer.assertRevoked(401));
    assert.equal(f.observer.frameCount(), 1);
    // Later frames remain observable even after navigation and a close event;
    // the browser journey owns the assertion that none were broadcast.
    f.frame('revoked');
    assert.equal(f.observer.frameCount(), 2);
    const events = f.observer.snapshot().events.map((event) => event.kind);
    assert.deepEqual(
      events.slice(-2),
      order === 'close-first' ? ['socket-closed', 'navigation'] : ['navigation', 'socket-closed'],
    );
  });

for (const handshake of [undefined, 403])
  test(`a socket without a successful handshake (${handshake ?? 'missing'}) cannot prove revocation`, async (t) => {
    const f = await fixture(t);
    f.create('unestablished');
    if (handshake !== undefined) f.open('unestablished', handshake);
    f.close('unestablished');
    assert.throws(() => f.observer.beforeRevoke(), /observed established socket/);
    assert.throws(() => f.observer.assertRevoked(401), /observed socket close/);
  });

test('unrelated socket closes and frames cannot satisfy the established target', async (t) => {
  const f = await fixture(t);
  f.create('revoked');
  f.open('revoked');
  f.observer.beforeRevoke();
  for (const url of ['wss://elsewhere.test/sync', 'wss://spinel.test/other', 'invalid']) {
    f.create(url, url);
    f.open(url);
    f.frame(url);
    f.close(url);
  }
  f.close('never-observed');
  assert.equal(f.observer.frameCount(), 0);
  assert.throws(() => f.observer.assertRevoked(401), /observed socket close/);
  f.close('revoked');
  assert.doesNotThrow(() => f.observer.assertRevoked(401));
  assert.equal(f.observer.snapshot().targetCount, 1);
});

test('401, navigation and a Playwright close cannot accept a live protocol socket', async (t) => {
  const f = await fixture(t);
  const socket = f.pageSocket();
  f.create('revoked');
  f.open('revoked');
  f.observer.beforeRevoke();
  f.navigate();
  socket.emit('close');
  f.observer.checkpoint('sign-in');
  assert.equal(f.observer.snapshot().openSockets, 1);
  assert.throws(() => f.observer.assertRevoked(401), /observed socket close/);
});

test('a protocol close cannot accept authorization that is still active', async (t) => {
  const f = await fixture(t);
  f.create('revoked');
  f.open('revoked');
  f.observer.beforeRevoke();
  f.close('revoked');
  assert.equal(f.observer.isClosed(), true);
  assert.throws(() => f.observer.assertRevoked(200), /denied by the server/);
});

test('every established target must close before revocation can pass', async (t) => {
  const f = await fixture(t);
  for (const id of ['first', 'second']) {
    f.create(id);
    f.open(id);
  }
  f.observer.beforeRevoke();
  f.close('first');
  assert.throws(() => f.observer.assertRevoked(401), /observed socket close/);
  f.close('second');
  assert.doesNotThrow(() => f.observer.assertRevoked(401));
  assert.equal(f.observer.snapshot().closedTargets, 2);
});

for (const status of [101, 401])
  test(`post-revocation handshake status ${status} preserves the establishment boundary`, async (t) => {
    const f = await fixture(t);
    f.create('revoked');
    f.open('revoked');
    f.observer.beforeRevoke();
    f.close('revoked');
    f.create('new');
    f.open('new', status);
    f.close('new');
    assert.equal(f.observer.snapshot().reopened, status === 101);
    if (status === 101) assert.throws(() => f.observer.assertRevoked(401), /observed socket close/);
    else assert.doesNotThrow(() => f.observer.assertRevoked(401));
  });

test('losing the protocol observer invalidates completed closure evidence', async (t) => {
  const f = await fixture(t);
  f.create('revoked');
  f.open('revoked');
  f.observer.beforeRevoke();
  f.close('revoked');
  f.session.emit('close');
  assert.equal(f.observer.snapshot().observerLost, true);
  assert.throws(() => f.observer.assertRevoked(401), /observed socket close/);
});

test('overflow retains bounded content-free evidence and cannot turn into acceptance', async (t) => {
  const f = await fixture(t);
  const secret = 'DO-NOT-RETAIN-PRIVATE-FIXTURE';
  f.create(secret, `${socketURL}?credential=${secret}`);
  f.open(secret);
  f.frame(secret, secret.repeat(1000));
  f.observer.beforeRevoke();
  f.close(secret);
  for (let index = 0; index < 100; index++) f.navigate();
  const snapshot = f.observer.snapshot();
  assert.equal(snapshot.overflow, true);
  assert.equal(snapshot.events.length, 64);
  assert.equal(snapshot.receivedFrames, 1);
  const json = JSON.stringify(snapshot);
  assert.equal(json.includes(secret), false);
  assert.equal(json.includes(socketURL), false);
  assert.ok(Buffer.byteLength(json) < 8 * 1024);
  assert.throws(() => f.observer.assertRevoked(401), /observed socket close/);
  snapshot.events[0].kind = 'observer-lost';
  assert.equal(f.observer.snapshot().events[0].kind, 'socket-created');
});

test('too many socket identities fail closed without retaining an unbounded map', async (t) => {
  const f = await fixture(t);
  for (let index = 0; index < 17; index++) {
    f.create(String(index));
    f.open(String(index));
  }
  assert.equal(f.observer.snapshot().overflow, true);
  assert.equal(f.observer.snapshot().openSockets, 16);
  assert.throws(() => f.observer.beforeRevoke(), /not ready/);
});

test('failed Network.enable removes listeners and detach failure preserves its original error', async () => {
  const f = boundary();
  const primary = new Error('Network.enable failed');
  const secondary = new Error('detach failed');
  let socket: ReturnType<typeof f.pageSocket> | undefined;
  f.session.send = async (command) => {
    f.commands.push(command);
    socket = f.pageSocket();
    throw primary;
  };
  const detach = f.session.detach;
  f.session.detach = async () => {
    await detach();
    throw secondary;
  };
  await assert.rejects(f.observe(), (error) => error === primary);
  assert.deepEqual(f.commands, ['Network.enable']);
  assert.equal(f.detaches(), 1);
  assert.deepEqual(f.session.eventNames(), []);
  assert.deepEqual(f.page.eventNames(), []);
  assert.equal(socket?.listenerCount('close'), 0);
});

test('failed Network.enable preserves its original error when detach reaches the cleanup bound', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => t.mock.timers.reset());
  const f = boundary();
  const primary = new Error('Network.enable failed');
  let socket: ReturnType<typeof f.pageSocket> | undefined;
  f.session.send = async (command) => {
    f.commands.push(command);
    socket = f.pageSocket();
    throw primary;
  };
  let started!: () => void;
  const reached = new Promise<void>((resolve) => {
    started = resolve;
  });
  const detach = f.session.detach;
  f.session.detach = async () => {
    await detach();
    started();
    return new Promise<void>(() => {});
  };
  let rejected = false;
  const rejection = assert.rejects(f.observe(), (error) => {
    rejected = true;
    return error === primary;
  });
  await reached;
  assert.deepEqual(f.commands, ['Network.enable']);
  assert.equal(f.detaches(), 1);
  assert.deepEqual(f.session.eventNames(), []);
  assert.deepEqual(f.page.eventNames(), []);
  assert.equal(socket?.listenerCount('close'), 0);
  t.mock.timers.tick(4999);
  await Promise.resolve();
  assert.equal(rejected, false);
  t.mock.timers.tick(1);
  await rejection;
  assert.equal(rejected, true);
});

test('stop detaches only owned listeners and prevents late events from changing evidence', async (t) => {
  const f = await fixture(t);
  const socket = f.pageSocket();
  const unrelated = () => {};
  f.page.on('framenavigated', unrelated);
  f.session.on('Network.webSocketClosed', unrelated);
  socket.on('close', unrelated);
  f.create('revoked');
  f.open('revoked');
  f.observer.beforeRevoke();
  f.close('revoked');
  await f.observer.stop();
  assert.deepEqual(f.page.eventNames(), ['framenavigated']);
  assert.deepEqual(f.session.eventNames(), ['Network.webSocketClosed']);
  assert.deepEqual(socket.listeners('close'), [unrelated]);
  assert.deepEqual(f.page.listeners('framenavigated'), [unrelated]);
  assert.deepEqual(f.session.listeners('Network.webSocketClosed'), [unrelated]);
  const snapshot = f.observer.snapshot();
  socket.emit('close');
  f.navigate();
  f.frame('revoked');
  f.close('revoked');
  assert.deepEqual(f.observer.snapshot(), snapshot);
  assert.equal(snapshot.observerLost, false);
  assert.throws(() => f.observer.assertRevoked(401), /observed socket close/);
  await f.observer.stop();
  assert.equal(f.detaches(), 1);
});

test('cleanup runs every remaining owned phase after synchronous and asynchronous rejection', async () => {
  const calls: string[] = [];
  const names = ['writes', 'observer', 'context', 'database', 'diagnostics'] as const;
  const failed = await cleanupSessionRevocation(
    names.map((name) => ({
      name,
      run: () => {
        calls.push(name);
        if (name === 'writes') throw new Error('private write failure');
        if (name === 'observer') return Promise.reject(new Error('private observer failure'));
      },
    })),
  );
  assert.deepEqual(calls, names);
  assert.deepEqual(failed, ['writes', 'observer']);
});

test('a stalled cleanup phase reaches its original bound and still releases later resources', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => t.mock.timers.reset());
  let started!: () => void;
  const reached = new Promise<void>((resolve) => {
    started = resolve;
  });
  let databaseClosed = false;
  const cleanup = cleanupSessionRevocation([
    {
      name: 'writes',
      run: () => {
        started();
        return new Promise(() => {});
      },
    },
    {
      name: 'database',
      run: () => {
        databaseClosed = true;
      },
    },
  ]);
  await reached;
  t.mock.timers.tick(5000);
  assert.deepEqual(await cleanup, ['writes']);
  assert.equal(databaseClosed, true);
});

test('revocation source and shared inputs keep unit/browser owners and fail-closed aggregates', () => {
  const head = 'b'.repeat(40);
  const event = {
    action: 'synchronize',
    pull_request: { base: { sha: 'a'.repeat(40) }, head: { sha: head }, labels: [] },
  };
  for (const path of [
    'e2e/session-revocation.ts',
    'e2e/collaboration.spec.ts',
    'e2e/native-sheet-value.ts',
    'e2e/sync-network.ts',
    'src/server/auth/store.ts',
    'src/server/collaboration/identity.ts',
    'src/server/sync/transport.ts',
    'web/spinelSync.ts',
    'web/App.tsx',
    'scripts/ci/session-revocation.test.ts',
  ]) {
    const plan = coveragePlan('pull_request', event, [path], head);
    assert.equal(plan.suites['unit-tests'].selected, true, path);
    assert.equal(plan.suites['playwright-run'].selected, true, path);
    const complete = Object.fromEntries(
      suiteIds.map((id) => [id, plan.suites[id].selected ? 'success' : 'skipped']),
    );
    assert.doesNotThrow(() => verifyCoverage(plan, 'success', complete, suiteIds));
    for (const id of suiteIds.filter((id) => plan.suites[id].selected))
      for (const status of [undefined, 'failure', 'skipped', 'cancelled'])
        assert.throws(
          () => verifyCoverage(plan, 'success', { ...complete, [id]: status }, suiteIds),
          new RegExp(`Incomplete coverage ${id}:`),
          `${path}: ${id} ${status ?? 'missing'}`,
        );
  }
});
