import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { expect, test, vi } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { healthRoutes } from './routes.ts';
import { HealthMonitor } from './monitor.ts';
import { HealthJobs } from './jobs.ts';

test('healthz exposes only up/down while aggregate health requires a still-current Operator', async () => {
  const db = new DatabaseSync(':memory:');
  const auth = new AuthStore(db);
  const operator = auth.createUser('Operator', true);
  const member = auth.createUser('Owner');
  const adminSession = auth.createSession(operator.id);
  const ownerSession = auth.createSession(member.id);
  const gate = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const monitor = new HealthMonitor({
    applicationPath: 'app', diagnosticsPath: 'diag', jobs: new HealthJobs(),
    editorConnections: () => 0, logicalDatabaseBytes: () => 0,
    memory: async () => {
      entered.resolve();
      await gate.promise;
      return { processRssBytes: 10, systemTotalBytes: 100, systemUsedBytes: 50, systemMeasure: 'available', containerUsedBytes: null, containerLimitBytes: null };
    },
    database: async () => null, freeBytes: async () => null,
  });
  const app = express();
  app.use(healthRoutes(auth, monitor));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const alive = await fetch(origin + '/healthz');
    expect(alive.status).toBe(200);
    expect(alive.headers.get('cache-control')).toBe('no-store');
    expect(await alive.json()).toEqual({ status: 'up' });
    for (const token of [undefined, ownerSession.token]) {
      const response = await fetch(origin + '/api/admin/health', { headers: token ? { Cookie: `${COOKIE_NAME}=${token}` } : {} });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'Not found' });
    }
    const pending = fetch(origin + '/api/admin/health', { headers: { Cookie: `${COOKIE_NAME}=${adminSession.token}` } });
    await entered.promise;
    auth.revokeSession(adminSession.session.token_hash);
    gate.resolve();
    const revoked = await pending;
    expect(revoked.status).toBe(404);
    expect(await revoked.json()).toEqual({ error: 'Not found' });
    const fresh = auth.createSession(operator.id);
    const allowed = await fetch(origin + '/api/admin/health', { headers: { Cookie: `${COOKIE_NAME}=${fresh.token}` } });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({ editorConnections: 0, application: null });
    const failing = vi.spyOn(db, 'prepare').mockImplementation(() => { throw new Error('secret database path'); });
    const down = await fetch(origin + '/healthz');
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ status: 'down' });
    failing.mockRestore();
  } finally {
    gate.resolve();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
  }
});
