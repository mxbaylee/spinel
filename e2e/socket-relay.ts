import http from 'node:http';
import net from 'node:net';

type TunnelEvent = 'tunnel-opened' | 'tunnel-closed' | 'upstream-error';
type Tunnel = {
  ordinal: number;
  openedMs: number;
  closedMs?: number;
  /** The server ended its side before the browser did. A receipt, never a gate: navigation can win. */
  upstreamEndedMs?: number;
  failed?: true;
};

const LIMIT = 16;
const EVENT_LIMIT = 64;
const HEADER_LIMIT = 16 * 1024; // room for large cookies; oversize fails loudly at beforeRevoke
// The hop-by-hop headers Chromium and this server actually send, not every RFC name.
const HOP_BY_HOP = [
  'connection',
  'keep-alive',
  'proxy-connection',
  'te',
  'upgrade',
  'transfer-encoding',
];

/** A loopback forward proxy for exactly one application origin. It must proxy plain
 * HTTP as well as CONNECT because the whole revoked browser context is routed here. Chromium sends a
 * navigated-away page's socket close only to the TCP peer, so this relay is the
 * navigation-independent witness: a tunnel is closed when the browser's own TCP
 * connection to the relay is fully closed. The relay never closes a tunnel itself
 * until `stop()`, and a stop-time close is never evidence.
 *
 * Passive and content-free: a tunnel gets an ordinal only when its first request
 * is a WebSocket upgrade for the expected path; bytes are forwarded verbatim and
 * never retained. Receipts keep ordinals, relative monotonic time and event kinds. */
export async function startSocketRelay(origin: string, socketPath: string) {
  const target = new URL(origin);
  const authority = target.host;
  const started = performance.now();
  const now = () => Math.round(performance.now() - started);
  const tunnels: Tunnel[] = [];
  const events: { kind: TunnelEvent; ms: number; tunnel: number }[] = [];
  const live = new Set<net.Socket>();
  const listeners = new Set<() => void>();
  let overflow = false;
  let stopped = false;
  let unexpected = 0;
  const record = (kind: TunnelEvent, tunnel: number) => {
    if (stopped) return;
    if (events.length === EVENT_LIMIT) overflow = true;
    else events.push({ kind, ms: now(), tunnel });
    for (const listener of listeners) listener();
  };
  const isUpgrade = (head: string) => {
    const lines = head.split('\r\n');
    const request = /^GET (\S+) HTTP\/1\.1$/.exec(lines[0]);
    if (!request) return false;
    let path: string;
    try {
      path = new URL(request[1], target).pathname;
    } catch {
      return false;
    }
    return path === socketPath && lines.some((line) => /^upgrade:\s*websocket\s*$/i.test(line));
  };

  const server = http.createServer((request, response) => {
    let url: URL;
    try {
      url = new URL(request.url ?? '');
    } catch {
      unexpected++;
      response.writeHead(400).end();
      return;
    }
    if (url.host !== authority) {
      unexpected++;
      response.writeHead(502).end();
      return;
    }
    const headers = { ...request.headers };
    for (const name of HOP_BY_HOP) delete headers[name];
    const upstream = http.request(
      {
        host: target.hostname,
        port: target.port,
        method: request.method,
        path: url.pathname + url.search,
        headers,
      },
      (reply) => {
        const replyHeaders = { ...reply.headers };
        for (const name of HOP_BY_HOP) delete replyHeaders[name];
        response.writeHead(reply.statusCode ?? 502, replyHeaders);
        reply.pipe(response);
      },
    );
    upstream.on('error', () => response.destroy());
    response.on('close', () => upstream.destroy());
    request.pipe(upstream);
  });

  server.on('connect', (request, browser: net.Socket, head) => {
    if (request.url !== authority || stopped) {
      unexpected++;
      browser.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      return;
    }
    const upstream = net.connect(Number(target.port), target.hostname);
    live.add(browser);
    live.add(upstream);
    let tunnel: Tunnel | undefined;
    let buffered: Buffer[] = head.length ? [head] : [];
    let size = head.length;
    let classified = false;
    const classify = () => {
      const text = Buffer.concat(buffered).toString('latin1');
      const end = text.indexOf('\r\n\r\n');
      if (end === -1 && size < HEADER_LIMIT) return false;
      classified = true;
      if (end !== -1 && isUpgrade(text.slice(0, end))) {
        if (tunnels.length === LIMIT) overflow = true;
        else {
          tunnel = { ordinal: tunnels.length + 1, openedMs: now() };
          tunnels.push(tunnel);
          record('tunnel-opened', tunnel.ordinal);
        }
      }
      return true;
    };
    const flush = () => {
      for (const chunk of buffered) upstream.write(chunk);
      buffered = [];
    };
    upstream.once('connect', () => {
      browser.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (classify()) flush();
      browser.on('data', (chunk: Buffer) => {
        if (classified) {
          upstream.write(chunk);
          return;
        }
        buffered.push(chunk);
        size += chunk.length;
        if (classify()) flush();
      });
      upstream.on('data', (chunk: Buffer) => browser.write(chunk));
    });
    upstream.once('end', () => {
      // Only an end that precedes the browser's own end is server-first.
      if (tunnel && !browserEnded) tunnel.upstreamEndedMs = now();
      browser.end();
    });
    let browserEnded = false;
    browser.once('end', () => {
      browserEnded = true;
      upstream.end();
    });
    upstream.once('close', () => live.delete(upstream));
    // A reset or crashed server is not a revocation close: the tunnel is marked
    // failed and never becomes a witness, even though the browser socket then closes.
    upstream.once('error', () => {
      if (tunnel && tunnel.closedMs === undefined) {
        tunnel.failed = true;
        record('upstream-error', tunnel.ordinal);
      }
      browser.destroy();
    });
    browser.once('error', () => upstream.destroy());
    // The browser's connection to the relay is the witness: closed only when the
    // browser side is fully gone, never because the relay chose to drop it.
    browser.once('close', () => {
      if (tunnel && tunnel.closedMs === undefined && !tunnel.failed && !stopped) {
        tunnel.closedMs = now();
        record('tunnel-closed', tunnel.ordinal);
      }
      upstream.destroy();
      live.delete(browser);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as net.AddressInfo).port;

  return {
    proxyServer: `http://127.0.0.1:${port}`,
    tunnels: () => tunnels.map((tunnel) => ({ ...tunnel })),
    overflowed: () => overflow,
    isStopped: () => stopped,
    /** Event barrier for tests that must wait on the relay's own bookkeeping, which
     * runs after the client sees its socket close; polling would need a sleep. */
    when(done: () => boolean) {
      return new Promise<void>((resolve) => {
        const check = () => {
          if (!done()) return;
          listeners.delete(check);
          resolve();
        };
        listeners.add(check);
        check();
      });
    },
    snapshot: () => ({
      established: tunnels.length,
      closed: tunnels.filter((tunnel) => tunnel.closedMs !== undefined).length,
      failed: tunnels.filter((tunnel) => tunnel.failed).length,
      serverEnded: tunnels.filter((tunnel) => tunnel.upstreamEndedMs !== undefined).length,
      unexpected,
      overflow,
      events: events.map((event) => ({ ...event })),
    }),
    async stop() {
      if (stopped) return;
      stopped = true;
      for (const socket of live) socket.destroy();
      live.clear();
      listeners.clear();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}

export type SocketRelay = Awaited<ReturnType<typeof startSocketRelay>>;
