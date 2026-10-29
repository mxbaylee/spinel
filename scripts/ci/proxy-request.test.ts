import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { maintenanceProxyRequest } from './proxy-request.ts';

async function fixture(handle: RequestListener) {
  const server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const binding = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    binding,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

test('proxy smoke sends the exact deployment Host and preserves the fallback response', async () => {
  const seen: Array<{ host: string | undefined; path: string | undefined }> = [];
  const app = await fixture((request, response) => {
    seen.push({ host: request.headers.host, path: request.url });
    response.writeHead(request.headers.host === 'spinel.proxy-smoke.test' ? 503 : 421, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Retry-After': '30',
    });
    response.end(JSON.stringify({ code: 'MAINTENANCE' }));
  });
  try {
    const result = await maintenanceProxyRequest(app.binding, '/api/maintenance');
    assert.equal(result.status, 503);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal(result.headers.get('retry-after'), '30');
    assert.deepEqual(await result.json(), { code: 'MAINTENANCE' });
    assert.deepEqual(seen, [{ host: 'spinel.proxy-smoke.test', path: '/api/maintenance' }]);
  } finally {
    await app.close();
  }
});

test('proxy smoke refuses an oversized response and closes its connection', async () => {
  const app = await fixture((_request, response) => {
    response.writeHead(503);
    response.end('x'.repeat(65_537));
  });
  try {
    await assert.rejects(maintenanceProxyRequest(app.binding, '/sign-in'), /budget|interrupted/);
  } finally {
    await app.close();
  }
});

test('proxy smoke has a bounded response deadline', async () => {
  const app = await fixture(() => {});
  try {
    await assert.rejects(maintenanceProxyRequest(app.binding, '/sign-in'), {
      name: 'AbortError',
    });
  } finally {
    await app.close();
  }
});
