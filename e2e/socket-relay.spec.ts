import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { expect, test } from '@playwright/test';
import { WebSocketServer, type WebSocket } from 'ws';
import { cleanupSessionRevocation, observeSessionRevocation } from './session-revocation.ts';
import { startSocketRelay } from './socket-relay.ts';

// SPN-161 real-boundary owner. A task-owned loopback server, fresh real Chromium
// contexts and the production helper prove the three orderings that matter. This
// owns no application state and builds no app: it only needs a browser.
type Connection = { ws: WebSocket; tcp: Socket };

async function startServer() {
  const wss = new WebSocketServer({ noServer: true });
  const waiting: ((connection: Connection) => void)[] = [];
  const server = http.createServer((request, response) => {
    if (request.url === '/denied') response.writeHead(401).end();
    else if (request.url === '/next') response.writeHead(200).end('<p>next</p>');
    else
      response
        .writeHead(200, { 'content-type': 'text/html' })
        .end(`<script>new WebSocket('ws://'+location.host+'/sock')</script>`);
  });
  server.on('upgrade', (request, tcp: Socket, head) =>
    wss.handleUpgrade(request, tcp, head, (ws) => waiting.shift()?.({ ws, tcp })),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    nextConnection: () => new Promise<Connection>((resolve) => waiting.push(resolve)),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

test.describe.configure({ retries: 0 }); // the ticket bounds this check to one run

for (const order of ['close-first', 'navigation-first', 'live-socket'] as const)
  test(`relay witnesses the real socket for ${order}`, async ({ browser }) => {
    test.setTimeout(30_000);
    const server = await startServer();
    const relay = await startSocketRelay(server.origin, '/sock');
    const context = await browser.newContext({ proxy: { server: relay.proxyServer } });
    const page = await context.newPage();
    const observer = await observeSessionRevocation(
      page,
      `${server.origin.replace('http:', 'ws:')}/sock`,
      relay,
    );
    let failed: string[] = [];
    try {
      const connection = server.nextConnection();
      await page.goto(`${server.origin}/`);
      const { ws, tcp } = await connection;
      await expect.poll(() => observer.snapshot().openSockets).toBe(1);
      const physical = new Promise<void>((resolve) => tcp.once('close', () => resolve()));
      observer.beforeRevoke();
      if (order === 'close-first') {
        ws.close(1008);
        await expect.poll(() => observer.isClosed(), { timeout: 5000 }).toBe(true);
        // Server-initiated: the relay saw the server end before the browser closed.
        const [tunnel] = relay.tunnels();
        expect(tunnel.upstreamEndedMs).toBeDefined();
        expect(tunnel.upstreamEndedMs!).toBeLessThanOrEqual(tunnel.closedMs!);
        await page.goto(`${server.origin}/next`);
        observer.assertRevoked(401);
      } else if (order === 'navigation-first') {
        await page.goto(`${server.origin}/next`);
        // The browser closes the document's socket; Chromium reports no close
        // event for it, so only the relay's TCP witness can prove it.
        await expect.poll(() => observer.isClosed(), { timeout: 5000 }).toBe(true);
        await physical;
        // Deliberate canary: if a Chromium upgrade starts reporting this close, update
        // this expectation and the SPN-161 record rather than loosening the witness.
        expect(observer.snapshot().closedTargets).toBe(0);
        observer.assertRevoked(401);
      } else {
        const denied = await context.request.get(`${server.origin}/denied`);
        expect(denied.status()).toBe(401);
        expect(observer.isClosed()).toBe(false);
        expect(() => observer.assertRevoked(denied.status())).toThrow(/observed socket close/);
        ws.close(1008); // owned cleanup only
        await physical;
      }
      expect(relay.snapshot()).toMatchObject({ established: 1, unexpected: 0, failed: 0 });
    } finally {
      failed = await cleanupSessionRevocation([
        { name: 'observer', run: () => observer.stop() },
        { name: 'context', run: () => context.close() },
        { name: 'relay', run: () => relay.stop() },
        { name: 'server', run: () => server.close() },
      ]);
    }
    expect(failed).toEqual([]);
  });
