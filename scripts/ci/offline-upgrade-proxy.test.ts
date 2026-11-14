import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, get } from 'node:http';
import type { Server, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { forwardUpgradeRequest } from '../../e2e/offline-upgrade-proxy.ts';

async function listen(t: TestContext, server: Server) {
  const sockets = new Set<Socket>();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return address.port;
}

async function streaming(t: TestContext) {
  const ready = Promise.withResolvers<ServerResponse>();
  const upstreamPort = await listen(
    t,
    createServer((_incoming, outgoing) => {
      outgoing.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': 100 });
      outgoing.write('partial body');
      ready.resolve(outgoing);
    }),
  );
  const proxyPort = await listen(
    t,
    createServer((incoming, outgoing) => forwardUpgradeRequest(incoming, outgoing, upstreamPort)),
  );
  const client = get(`http://127.0.0.1:${proxyPort}/retained-asset`);
  t.after(() => client.destroy());
  const [response] = await once(client, 'response');
  response.on('error', () => {});
  response.resume();
  return { upstream: await ready.promise, client, response };
}

test(
  'upstream truncation terminates the downstream response as a failure',
  { timeout: 5000 },
  async (t) => {
    const { upstream, response } = await streaming(t);
    const closed = once(response, 'aborted', { signal: AbortSignal.timeout(1000) });
    upstream.destroy();
    await closed;
    assert.equal(response.complete, false, 'A truncated public asset is never a complete body.');
  },
);

test(
  'an abandoned downstream response releases the upstream body owner',
  { timeout: 5000 },
  async (t) => {
    const { upstream, client } = await streaming(t);
    const closed = once(upstream, 'close', { signal: AbortSignal.timeout(1000) });
    client.destroy();
    await closed;
    assert.equal(upstream.destroyed, true);
  },
);

test(
  'a complete response preserves status, headers and exact bytes',
  { timeout: 5000 },
  async (t) => {
    const bytes = Buffer.from('A complete cached app asset.\n');
    const upstreamPort = await listen(
      t,
      createServer((_incoming, outgoing) => {
        outgoing.writeHead(206, {
          'Content-Type': 'text/javascript',
          'Content-Length': bytes.length,
          'X-Upgrade-Control': 'complete',
        });
        outgoing.end(bytes);
      }),
    );
    const proxyPort = await listen(
      t,
      createServer((incoming, outgoing) => forwardUpgradeRequest(incoming, outgoing, upstreamPort)),
    );
    const response = await fetch(`http://127.0.0.1:${proxyPort}/asset`, {
      signal: AbortSignal.timeout(1000),
    });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('x-upgrade-control'), 'complete');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  },
);

test('a backend failure before headers is an explicit 502', { timeout: 5000 }, async (t) => {
  const upstreamPort = await listen(
    t,
    createServer((_incoming, outgoing) => outgoing.destroy()),
  );
  const proxyPort = await listen(
    t,
    createServer((incoming, outgoing) => forwardUpgradeRequest(incoming, outgoing, upstreamPort)),
  );
  const response = await fetch(`http://127.0.0.1:${proxyPort}/asset`, {
    signal: AbortSignal.timeout(1000),
  });
  assert.equal(response.status, 502);
  await response.arrayBuffer();
});
