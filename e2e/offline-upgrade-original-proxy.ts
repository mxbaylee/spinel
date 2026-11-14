import { request } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Negative control only. Exact HTTP forwarding behavior extracted from
 * 04baabd6a68abe7c0b225f8699681532e2205b60:e2e/offline-upgrade.spec.ts:385–403;
 * only the fixed port is parameterized. The acceptance server uses the repaired
 * owner in offline-upgrade-proxy.ts. Retain this defect to prove its consequence.
 */
export function originalUpgradeRequest(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  port: number,
) {
  const upstream = request(
    {
      hostname: '127.0.0.1',
      port,
      path: incoming.url,
      method: incoming.method,
      headers: incoming.headers,
    },
    (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    },
  );
  upstream.on('error', () => {
    if (!outgoing.headersSent) outgoing.writeHead(502);
    outgoing.end();
  });
  incoming.on('aborted', () => upstream.destroy());
  incoming.pipe(upstream);
  return upstream;
}
