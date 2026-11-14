import { request } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream';

/** The real HTTP hop used while the upgrade fixture replaces its app process. */
export function forwardUpgradeRequest(
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
      // A backend replacement can truncate a body after headers. Propagate that
      // terminal failure instead of leaving the worker's cache.put unfinished.
      pipeline(response, outgoing, (error) => {
        if (error) upstream.destroy();
      });
    },
  );
  upstream.on('error', (error) => {
    if (outgoing.headersSent) outgoing.destroy(error);
    else outgoing.writeHead(502).end();
  });
  incoming.on('aborted', () => upstream.destroy());
  // A completed GET request does not emit incoming.aborted when its reader
  // abandons the response. Its response owner must cancel the upstream too.
  outgoing.once('close', () => {
    if (!outgoing.writableFinished) upstream.destroy();
  });
  incoming.pipe(upstream);
  return upstream;
}
