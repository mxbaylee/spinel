import express from 'express';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, vi } from 'vitest';
import { createHttpServer, extendArchiveBodyDeadline } from './http.ts';

test('only an admitted archive body outlives the ordinary five-minute deadline', async () => {
  const app = express();
  const server = createHttpServer(app);
  expect(server.requestTimeout).toBe(60 * 60_000);
  expect(server.headersTimeout).toBe(60_000);
  let entered = () => {};
  let requestClosed = () => {};
  app.post('/:kind', (request, response) => {
    if (request.params.kind === 'admitted-archive') extendArchiveBodyDeadline(request);
    if (request.params.kind === 'rejected') response.status(403).end('rejected');
    request.once('close', () => requestClosed());
    request.on('end', () => {
      if (!response.headersSent) response.end('received');
    });
    request.resume();
    entered();
  });
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const timer = vi.spyOn(globalThis, 'setTimeout');
  try {
    for (const kind of ['ordinary', 'admitted-archive', 'rejected']) {
      const count = timer.mock.calls.length;
      const ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const closed = new Promise<void>((resolve) => {
        requestClosed = resolve;
      });
      let client!: ReturnType<typeof httpRequest>;
      const reply = new Promise<number>((resolve, reject) => {
        client = httpRequest(`${root}/${kind}`, { method: 'POST' }, (response) => {
          response.resume();
          resolve(response.statusCode!);
        });
        client.on('error', reject);
        client.write('some bytes');
      });
      await ready;
      const deadline = timer.mock.calls.slice(count).find((call) => call[1] === 5 * 60_000)!;
      expect(deadline).toBeDefined();
      if (kind === 'rejected') expect(await reply).toBe(403);
      // A callback already queued when admission extends the body window must
      // also become harmless; ordinary slow bodies still receive HTTP408.
      (deadline[0] as () => void)();
      if (kind === 'admitted-archive') client.end('remaining bytes');
      if (kind !== 'rejected') expect(await reply).toBe(kind === 'ordinary' ? 408 : 200);
      await closed;
      client.destroy();
    }
  } finally {
    timer.mockRestore();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
