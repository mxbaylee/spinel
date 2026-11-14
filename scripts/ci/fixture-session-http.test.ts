import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { request } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { test } from 'node:test';
import { verifyPreparedSession } from '../../e2e/fixture-session.ts';
import type { SetupAttempt } from '../../e2e/fixture-session.ts';
import { withFixtureCleanup } from '../../e2e/owned-process.ts';

for (const mode of ['one-reset', 'no-recovery', 'exhausted', 'server-closed'] as const) {
  test(`the real Playwright request transport preserves setup policy: ${mode}`, async () => {
    let reads = 0;
    const requests: string[] = [];
    const attempts: SetupAttempt[] = [];
    const server = createServer((incoming, response) => {
      requests.push(`${incoming.method} ${incoming.url}`);
      assert.equal(incoming.method, 'GET');
      if (incoming.url === '/api/health') {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ status: 'ok' }));
      } else {
        assert.equal(incoming.url, '/api/auth/session');
        reads++;
        if (reads === 1 || mode === 'exhausted') {
          // A real TCP reset exercises Playwright's actual error envelope and
          // proves its own hidden request retry is disabled by maxRetries: 0.
          incoming.socket.resetAndDestroy();
          if (mode === 'server-closed') server.close();
        } else {
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify({ user: { id: 'fixture-account' } }));
        }
      }
    });
    let context: APIRequestContext | undefined;
    await withFixtureCleanup(
      async () => {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(0, '127.0.0.1', resolve);
        });
        const port = (server.address() as { port: number }).port;
        const prepared = await request.newContext({ baseURL: `http://127.0.0.1:${port}` });
        context = prepared;
        const setup = verifyPreparedSession({
          expectedId: 'fixture-account',
          recovery: mode !== 'no-recovery',
          read: (timeout) => prepared.get('/api/auth/session', { timeout, maxRetries: 0 }),
          healthy: async (timeout) => {
            if (!server.listening) throw new Error('Owned server has terminated.');
            const response = await prepared.get('/api/health', { timeout, maxRetries: 0 });
            assert.equal(response.status(), 200);
          },
          record: (attempt) => attempts.push(attempt),
        });
        if (mode === 'one-reset') {
          await setup;
          assert.equal(reads, 2);
          assert.deepEqual(requests, [
            'GET /api/auth/session',
            'GET /api/health',
            'GET /api/auth/session',
          ]);
          assert.equal(attempts[1].identityMatch, true);
        } else {
          await assert.rejects(setup);
          assert.equal(reads, mode === 'exhausted' ? 2 : 1);
        }
        assert.equal(attempts[0].result, 'transport-error');
        assert.equal(attempts[0].reason, 'ECONNRESET');
      },
      async () => {
        try {
          await context?.dispose();
        } finally {
          server.closeAllConnections();
          if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      },
    );
  });
}
