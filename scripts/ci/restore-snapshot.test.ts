import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { RequestListener } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { test } from 'node:test';
import { request } from '@playwright/test';
import { readRestoreSnapshot } from '../../e2e/restore-snapshot.ts';

async function fixture(handle: RequestListener) {
  const server = createServer(handle);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

const client = (baseURL: string) =>
  request.newContext({
    baseURL,
    storageState: {
      cookies: [
        {
          name: 'restore-observer-session',
          value: 'fixture-session',
          domain: '127.0.0.1',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: 'Strict',
        },
      ],
      origins: [],
    },
  });

test('restore observation avoids a reused-connection reset and preserves authenticated snapshots', async (t) => {
  const seen = new Set<Socket>();
  const calls: Array<{
    socket: Socket;
    method: string | undefined;
    path: string | undefined;
    cookie: string | undefined;
  }> = [];
  const snapshot = { revision: 7, snapshot: { name: 'Original' } };
  const app = await fixture((incoming, response) => {
    calls.push({
      socket: incoming.socket,
      method: incoming.method,
      path: incoming.url,
      cookie: incoming.headers.cookie,
    });
    if (seen.has(incoming.socket)) {
      // Deterministically exercise a reset on reuse, without timing an idle race.
      incoming.socket.resetAndDestroy();
      return;
    }
    seen.add(incoming.socket);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(snapshot));
  });
  t.after(() => app.close());
  const pooled = await client(app.url);
  t.after(() => pooled.dispose());
  const observer = await client(app.url);
  t.after(() => observer.dispose());
  assert.deepEqual(await (await pooled.get('/snapshot?kind=sheet')).json(), snapshot);
  await assert.rejects(pooled.get('/snapshot?kind=sheet'), /ECONNRESET/);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.socket, calls[1]!.socket);

  assert.deepEqual(await readRestoreSnapshot(observer, '/snapshot?kind=sheet'), snapshot);
  assert.deepEqual(await readRestoreSnapshot(observer, '/snapshot?kind=sheet'), snapshot);
  assert.equal(calls.length, 4);
  assert.notEqual(calls[2]!.socket, calls[3]!.socket);
  assert.deepEqual(
    calls.map(({ method, path, cookie }) => ({ method, path, cookie })),
    Array.from({ length: 4 }, () => ({
      method: 'GET',
      path: '/snapshot?kind=sheet',
      cookie: 'restore-observer-session=fixture-session',
    })),
  );
});

test('restore observation retains a fresh-connection reset without retrying', async (t) => {
  let calls = 0;
  const app = await fixture((incoming) => {
    calls++;
    incoming.socket.resetAndDestroy();
  });
  t.after(() => app.close());
  const observer = await client(app.url);
  t.after(() => observer.dispose());
  await assert.rejects(readRestoreSnapshot(observer, '/snapshot'), /ECONNRESET/);
  assert.equal(calls, 1);
});

test('restore observation rejects an HTTP failure even when its JSON looks like a snapshot', async (t) => {
  let calls = 0;
  const app = await fixture((_incoming, response) => {
    calls++;
    response.writeHead(503, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ revision: 7, snapshot: { name: 'Original' } }));
  });
  t.after(() => app.close());
  const observer = await client(app.url);
  t.after(() => observer.dispose());
  await assert.rejects(readRestoreSnapshot(observer, '/snapshot'), /HTTP 503/);
  assert.equal(calls, 1);
});
