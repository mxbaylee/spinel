import { createServer, request } from 'node:http';
import type { ClientRequest } from 'node:http';
import { connect } from 'node:net';
import type { Socket } from 'node:net';
import { expect } from '@playwright/test';

export type CreationTransportPost = { path: string; at: number; outcome: 'forwarded' | 'blocked' };

/** A real HTTP outage reaches service-worker traffic as well as page requests. */
export async function offlineCreationNetwork(baseURL: string) {
  const origin = new URL(baseURL);
  if (origin.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(origin.hostname))
    throw new Error('Offline creation acceptance requires its loopback HTTP fixture.');
  let offline = false;
  const sockets = new Set<Socket>();
  const active = new Set<ClientRequest>();
  const posts: CreationTransportPost[] = [];
  const track = (socket: Socket) => {
    if (sockets.has(socket)) return;
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  };
  const destination = (path: string | undefined) => {
    try {
      const url = new URL(path ?? '/', origin);
      return ['http:', 'ws:'].includes(url.protocol) && url.host === origin.host ? url : undefined;
    } catch {
      return undefined;
    }
  };
  const server = createServer((incoming, outgoing) => {
    const url = destination(incoming.url);
    if (incoming.method === 'POST')
      posts.push({
        path: url?.pathname ?? 'outside-fixture',
        at: Date.now(),
        outcome: offline || !url ? 'blocked' : 'forwarded',
      });
    if (offline || !url) {
      incoming.socket.destroy();
      return;
    }
    const upstream = request(
      {
        hostname: origin.hostname,
        port: Number(origin.port || 80),
        path: `${url.pathname}${url.search}`,
        method: incoming.method,
        headers: { ...incoming.headers, host: origin.host },
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    active.add(upstream);
    upstream.once('socket', track);
    upstream.once('close', () => active.delete(upstream));
    upstream.on('error', () => outgoing.destroy());
    incoming.on('aborted', () => upstream.destroy());
    incoming.pipe(upstream);
  });
  server.on('connection', track);
  // Playwright's APIRequestContext tunnels even an HTTP origin. Admit only
  // this exact fixture target and include the tunnel in disconnect teardown.
  server.on('connect', (incoming, socket, head) => {
    if (offline || incoming.url !== origin.host) return socket.destroy();
    const upstream = connect(Number(origin.port || 80), origin.hostname, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    track(upstream);
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    upstream.on('close', () => socket.destroy());
    socket.on('close', () => upstream.destroy());
  });
  server.on('upgrade', (incoming, socket, head) => {
    const url = destination(incoming.url);
    if (offline || !url) return socket.destroy();
    const upstream = connect(Number(origin.port || 80), origin.hostname, () => {
      const headers = incoming.rawHeaders.reduce<string[]>((lines, value, index, values) => {
        if (index % 2 === 0) lines.push(`${value}: ${values[index + 1]}`);
        return lines;
      }, []);
      upstream.write(
        `${incoming.method} ${url.pathname}${url.search} HTTP/${incoming.httpVersion}\r\n${headers.join('\r\n')}\r\n\r\n`,
      );
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    track(upstream);
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    upstream.on('close', () => socket.destroy());
    socket.on('close', () => upstream.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture proxy address.');
  const setOffline = (value: boolean) => {
    offline = value;
    if (value) {
      for (const pending of active) pending.destroy();
      for (const socket of sockets) socket.destroy();
    }
  };
  return {
    // Chromium normally bypasses proxies for loopback. Explicitly disable that
    // bypass while preserving the actual app origin, cookies and service worker.
    proxy: { server: `http://127.0.0.1:${address.port}`, bypass: '<-loopback>' },
    posts,
    setOffline,
    async verifyDisconnected() {
      const before = posts.length;
      // A raw HTTP client is outside browser routing/offline emulation. Its
      // failed POST plus the proxy record prove the publication transport closes.
      const probe = new Promise<number | undefined>((resolve, reject) => {
        const outgoing = request(
          {
            hostname: '127.0.0.1',
            port: address.port,
            path: `${origin.origin}/api/items/offline-create`,
            method: 'POST',
            agent: false,
            headers: {
              Host: origin.host,
              Origin: origin.origin,
              'Content-Type': 'application/json',
            },
          },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          },
        );
        outgoing.once('error', reject);
        outgoing.setTimeout(5000, () =>
          outgoing.destroy(new Error('The proxy outage probe timed out.')),
        );
        outgoing.end('{}');
      });
      await expect(probe).rejects.toThrow();
      expect(posts.slice(before)).toContainEqual(
        expect.objectContaining({ path: '/api/items/offline-create', outcome: 'blocked' }),
      );
    },
    async close() {
      setOffline(true);
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
