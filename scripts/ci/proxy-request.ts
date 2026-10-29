import assert from 'node:assert/strict';
import { get } from 'node:http';

/** Fetch normalizes Host; use HTTP directly to exercise the deployment's vhost. */
export function maintenanceProxyRequest(binding: string, path: string): Promise<Response> {
  assert.match(binding, /^127\.0\.0\.1:\d+$/);
  assert.ok(path.startsWith('/'));
  return new Promise((resolve, reject) => {
    const request = get(
      `http://${binding}${path}`,
      {
        headers: { Host: 'spinel.proxy-smoke.test' },
        signal: AbortSignal.timeout(2_000),
      },
      (response) => {
        let bytes = 0;
        const chunks: Buffer[] = [];
        response.once('error', reject);
        response.once('aborted', () => reject(new Error('Proxy response was interrupted.')));
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 65_536) {
            response.destroy(new Error('Proxy response exceeds the fixture budget.'));
            return;
          }
          chunks.push(chunk);
        });
        response.once('end', () => {
          try {
            const headers = new Headers();
            for (let i = 0; i < response.rawHeaders.length; i += 2)
              headers.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
            resolve(
              new Response(Buffer.concat(chunks).toString('utf8'), {
                status: response.statusCode,
                headers,
              }),
            );
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.once('error', reject);
  });
}
