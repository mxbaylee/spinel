import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import test, { type TestContext } from 'node:test';
import { type WebSocket, WebSocketServer } from 'ws';
import { startSocketRelay } from '../../e2e/socket-relay.ts';

const path = '/sync/socket';

async function fixture(t: TestContext) {
  const wss = new WebSocketServer({ noServer: true });
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' }).end(request.url);
  });
  const serverSockets: WebSocket[] = [];
  const rawSockets: net.Socket[] = [];
  const waiters = new Set<() => void>();
  const connected = (count: number) =>
    new Promise<void>((resolve) => {
      const check = () => {
        if (serverSockets.length < count) return;
        waiters.delete(check);
        resolve();
      };
      waiters.add(check);
      check();
    });
  let upstreamSeen = 0;
  const upstreamWaiters = new Set<() => void>();
  const upstreamRequests = (count: number) =>
    new Promise<void>((resolve) => {
      const check = () => {
        if (upstreamSeen < count) return;
        upstreamWaiters.delete(check);
        resolve();
      };
      upstreamWaiters.add(check);
      check();
    });
  const seen = () => {
    upstreamSeen++;
    for (const check of upstreamWaiters) check();
  };
  server.on('request', seen);
  server.on('upgrade', seen);
  server.on('upgrade', (request, socket, head) => {
    rawSockets.push(socket as net.Socket);
    wss.handleUpgrade(request, socket, head, (ws) => {
      serverSockets.push(ws);
      for (const check of waiters) check();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  const relay = await startSocketRelay(origin, path);
  const clients: net.Socket[] = [];
  t.after(async () => {
    for (const client of clients) client.destroy();
    for (const ws of serverSockets) ws.terminate();
    await relay.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const proxy = new URL(relay.proxyServer);
  /** A browser-shaped tunnel: CONNECT, then a plain-text WebSocket handshake. */
  async function tunnel(requestPath: string, headers = 'Upgrade: websocket\r\n') {
    const client = net.connect(Number(proxy.port), proxy.hostname);
    clients.push(client);
    await once(client, 'connect');
    const authority = new URL(origin).host;
    client.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
    const [connected] = (await once(client, 'data')) as [Buffer];
    assert.match(connected.toString(), /^HTTP\/1\.1 200 /);
    client.write(
      `GET ${requestPath} HTTP/1.1\r\nHost: ${authority}\r\n${headers}Connection: Upgrade\r\n` +
        `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
    );
    return client;
  }
  return { relay, tunnel, serverSockets, rawSockets, connected, upstreamRequests, origin, proxy };
}

const closed = (client: net.Socket) =>
  client.destroyed ? Promise.resolve() : once(client, 'close').then(() => undefined);

test('a WebSocket tunnel is closed only when the browser connection is fully gone', async (t) => {
  const f = await fixture(t);
  const client = await f.tunnel(path);
  const [handshake] = (await once(client, 'data')) as [Buffer];
  assert.match(handshake.toString(), /^HTTP\/1\.1 101 /);
  assert.deepEqual(
    f.relay.tunnels().map((tunnel) => [tunnel.ordinal, tunnel.closedMs === undefined]),
    [[1, true]],
  );
  client.end();
  await closed(client);
  await f.relay.when(() => f.relay.tunnels()[0].closedMs !== undefined);
  const kinds = f.relay.snapshot().events.map((event) => event.kind);
  assert.deepEqual(kinds, ['tunnel-opened', 'tunnel-closed']);
  // Pins the chosen reading: a browser-side close is accepted whoever initiated it,
  // and the server-first receipt stays empty because the server never ended first.
  assert.equal(f.relay.tunnels()[0].upstreamEndedMs, undefined);
});

test('a server-initiated close is witnessed once the browser side finishes closing', async (t) => {
  const f = await fixture(t);
  const client = await f.tunnel(path);
  await once(client, 'data');
  await f.connected(1);
  f.serverSockets[0].close(1008);
  await once(client, 'data'); // the server's close frame
  // A browser answers with its own masked close frame (1008) before TCP ends.
  client.write(Buffer.from([0x88, 0x82, 0, 0, 0, 0, 0x03, 0xf0]));
  await once(client, 'end');
  client.end();
  await closed(client);
  await f.relay.when(() => f.relay.tunnels()[0].closedMs !== undefined);
  const kinds = f.relay.snapshot().events.map((event) => event.kind);
  assert.deepEqual([kinds[0], kinds.at(-1)], ['tunnel-opened', 'tunnel-closed']);
  const [tunnel] = f.relay.tunnels();
  assert.ok(tunnel.upstreamEndedMs !== undefined && tunnel.upstreamEndedMs <= tunnel.closedMs!);
});

test('a reset server is never a witness even though the browser socket then closes', async (t) => {
  const f = await fixture(t);
  const client = await f.tunnel(path);
  await once(client, 'data');
  f.rawSockets[0].resetAndDestroy();
  await closed(client);
  await f.relay.when(() => f.relay.snapshot().failed === 1);
  const snapshot = f.relay.snapshot();
  assert.equal(snapshot.closed, 0);
  assert.equal(f.relay.tunnels()[0].closedMs, undefined);
  assert.ok(snapshot.events.some((event) => event.kind === 'upstream-error'));
});

test('only the expected WebSocket path becomes a witnessed tunnel', async (t) => {
  const f = await fixture(t);
  await f.tunnel('/sync/other');
  await f.tunnel(path, 'X-Not-Upgrade: websocket\r\n');
  // Classification happens as the upstream sees the forwarded request.
  await f.upstreamRequests(2);
  assert.deepEqual(f.relay.tunnels(), []);
  const upgraded = await f.tunnel(`${path}?ticket=private`);
  await once(upgraded, 'data');
  assert.equal(f.relay.tunnels().length, 1);
});

test('plain requests are forwarded and foreign authorities are refused without a tunnel', async (t) => {
  const f = await fixture(t);
  const ok = await fetchThrough(f.proxy, `${f.origin}/page?x=1`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body, '/page?x=1');
  const foreign = await fetchThrough(f.proxy, 'http://127.0.0.1:1/elsewhere');
  assert.equal(foreign.status, 502);
  assert.equal(f.relay.snapshot().unexpected, 1);
  assert.equal(f.relay.tunnels().length, 0);
});

test('a CONNECT to a foreign authority is refused without a tunnel', async (t) => {
  const f = await fixture(t);
  const client = net.connect(Number(f.proxy.port), f.proxy.hostname);
  await once(client, 'connect');
  client.write('CONNECT 127.0.0.1:1 HTTP/1.1\r\nHost: 127.0.0.1:1\r\n\r\n');
  const [reply] = (await once(client, 'data')) as [Buffer];
  client.destroy();
  assert.match(reply.toString(), /^HTTP\/1\.1 502 /);
  assert.equal(f.relay.snapshot().unexpected, 1);
  assert.equal(f.relay.tunnels().length, 0);
});

test('an unreachable upstream never creates a witness', async (t) => {
  const dead = net.createServer();
  await new Promise<void>((resolve) => dead.listen(0, '127.0.0.1', resolve));
  const port = (dead.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => dead.close(() => resolve()));
  const relay = await startSocketRelay(`http://127.0.0.1:${port}`, path);
  t.after(() => relay.stop());
  const proxy = new URL(relay.proxyServer);
  const client = net.connect(Number(proxy.port), proxy.hostname);
  await once(client, 'connect');
  client.write(`CONNECT 127.0.0.1:${port} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`);
  await closed(client);
  assert.deepEqual(relay.tunnels(), []);
  assert.equal(relay.snapshot().closed, 0);
});

test('receipts and tunnel records never retain request content', async (t) => {
  const f = await fixture(t);
  const secret = 'DO-NOT-RETAIN-RELAY-FIXTURE';
  const client = await f.tunnel(
    `${path}?ticket=${secret}`,
    `Cookie: s=${secret}\r\nUpgrade: websocket\r\n`,
  );
  await once(client, 'data');
  client.destroy();
  await closed(client);
  const json = JSON.stringify([f.relay.snapshot(), f.relay.tunnels()]);
  assert.equal(json.includes(secret), false);
  assert.ok(Buffer.byteLength(json) < 2 * 1024);
});

test('stop is owned cleanup: a tunnel closed by it is not evidence', async (t) => {
  const f = await fixture(t);
  const client = await f.tunnel(path);
  await once(client, 'data');
  await f.relay.stop();
  await closed(client);
  assert.equal(f.relay.isStopped(), true);
  assert.equal(f.relay.tunnels()[0].closedMs, undefined);
  assert.equal(f.relay.snapshot().closed, 0);
});

test('too many tunnels fail closed instead of growing without bound', async (t) => {
  const f = await fixture(t);
  for (let index = 0; index < 17; index++) await once(await f.tunnel(path), 'data');
  assert.equal(f.relay.tunnels().length, 16);
  assert.equal(f.relay.overflowed(), true);
});

function fetchThrough(proxy: URL, target: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = http.request(
      { host: proxy.hostname, port: proxy.port, method: 'GET', path: target },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (body += chunk));
        response.on('end', () => resolve({ status: response.statusCode!, body }));
      },
    );
    request.on('error', reject);
    request.end();
  });
}
