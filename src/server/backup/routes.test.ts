import express from 'express';
import { createServer, request as httpRequest } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { openDatabase, DatabaseSync } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME, VERIFICATION_MS } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { restoreArchive } from './archive.ts';
import { backupRoutes } from './routes.ts';
import { BackupService } from './service.ts';

const cleanups: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0).reverse()) await close();
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-export-http-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'spinel.sqlite');
  const db = openDatabase(databasePath);
  cleanups.push(() => db.close());
  let now = Date.now();
  const auth = new AuthStore(db, () => now);
  const workspace = new WorkspaceStore(auth);
  const operator = auth.createUser('Operator', true);
  const other = auth.createUser('Other Operator', true);
  const member = auth.createUser('Owner');
  const file = workspace.create(member.id, {
    name: 'Private retained workspace',
    kind: 'doc',
    parentId: null,
  });
  for (const user of [operator, other])
    db.prepare('INSERT INTO auth_passkeys VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
      user.id,
      user.id,
      Buffer.from('synthetic-public-key'),
      0,
      '[]',
      'Browser',
      'Passkey',
      now,
      null,
      0,
      'singleDevice',
    );
  const session = auth.createSession(operator.id, undefined, operator.id);
  const alternate = auth.createSession(other.id, undefined, other.id);
  auth.markVerified(alternate.session, other.id);
  const ordinary = auth.createSession(member.id);
  const key = randomBytes(32);
  const keyFile = join(directory, 'recovery.key');
  const runtimeEnvironmentFile = join(directory, 'runtime.env');
  const configPath = join(directory, 'backup.json');
  await writeFile(keyFile, key, { mode: 0o600 });
  await writeFile(runtimeEnvironmentFile, 'PRIVATE_FIXTURE=must-stay-encrypted\n', { mode: 0o600 });
  await writeFile(
    configPath,
    JSON.stringify({
      version: 1,
      type: 'manual',
      prefix: 'http-fixture',
      keyId: 'http-key',
      keyFile,
      runtimeEnvironmentFile,
    }),
    { mode: 0o600 },
  );
  const origin = 'http://localhost:3000';
  const backups = new BackupService(db, {
    databasePath,
    configPath,
    origin,
    image: `sha256:${'a'.repeat(64)}`,
    now: () => now,
  });
  await backups.start();
  cleanups.push(() => backups.close());
  const app = express();
  app.use('/api/admin/backups', backupRoutes(auth, backups, origin));
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/backups`;
  const request = (
    path: string,
    {
      method = 'POST',
      token = session.token,
      account: accountId = operator.id,
      from = origin,
      body = '{}',
      content = 'application/json',
    }: {
      method?: string;
      token?: string;
      account?: string;
      from?: string;
      body?: string;
      content?: string;
    } = {},
  ) =>
    fetch(root + path, {
      method,
      headers: {
        Cookie: `${COOKIE_NAME}=${token}`,
        Origin: from,
        'X-Spinel-Account': accountId,
        'Content-Type': content,
      },
      ...(method === 'POST' ? { body } : {}),
    });
  const ready = async () => {
    let job: { id: string; state: string; bytes: number } | null = null;
    await vi.waitFor(
      async () => {
        const response = await request('/exports', { method: 'GET' });
        expect(response.status).toBe(200);
        job = (await response.json()).job;
        expect(job?.state).toBe('ready');
      },
      { timeout: 10_000, interval: 20 },
    );
    return job! as { id: string; state: string; bytes: number };
  };
  const authorize = async (id: string) => {
    const response = await request(`/exports/${id}/authorize`);
    expect(response.status).toBe(200);
    return (await response.json()) as { token: string; expiresAt: number };
  };
  const delivery = (id: string, token: string, overrides: Parameters<typeof request>[1] = {}) =>
    request(`/exports/${id}/file`, {
      body: new URLSearchParams({ token, accountId: operator.id }).toString(),
      content: 'application/x-www-form-urlencoded',
      ...overrides,
    });
  return {
    directory,
    db,
    auth,
    backups,
    operator,
    other,
    session,
    alternate,
    ordinary,
    file,
    key,
    root,
    origin,
    request,
    ready,
    authorize,
    delivery,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
    verify: () => auth.markVerified(session.session, operator.id),
  };
}

test('manual-only HTTP export requires fresh session-bound Operator authority and downloads a real restorable encrypted workspace', async () => {
  const f = await fixture();
  for (const token of ['', f.ordinary.token]) {
    expect((await f.request('', { method: 'GET', token })).status).toBe(404);
    expect((await f.request('/exports', { token })).status).toBe(404);
  }
  expect((await f.request('/exports', { from: 'https://outside.example' })).status).toBe(403);
  expect((await f.request('/exports', { content: 'text/plain' })).status).toBe(403);
  expect((await f.request('/exports', { account: f.other.id })).status).toBe(409);
  expect((await f.request('/exports')).status).toBe(428);
  f.verify();
  for (const body of [
    '[]',
    '{"path":"/private"}',
    '{"dataset":"diagnostics"}',
    '{"artifactId":"../secret"}',
  ])
    expect((await f.request('/exports', { body })).status).toBe(400);
  expect(
    (await f.request('/exports', { body: JSON.stringify({ unused: 'x'.repeat(2048) }) })).status,
  ).toBe(413);
  const status = await f.request('', { method: 'GET' });
  expect(status.headers.get('cache-control')).toBe('no-store');
  expect(await status.json()).toMatchObject({
    destination: null,
    offsite: false,
    policy: { automatic: false, manualDownload: true, manualReady: true },
  });
  const created = await f.request('/exports');
  expect(created.status).toBe(202);
  const job = await f.ready();
  expect(job.bytes).toBeGreaterThan(36);
  const safeState = await (await f.request('/exports', { method: 'GET' })).text();
  expect(safeState).not.toMatch(/token_hash|must-stay-encrypted|Private retained workspace/);
  expect(safeState).not.toContain(f.directory);
  expect(
    await (
      await f.request('/exports', {
        method: 'GET',
        token: f.alternate.token,
        account: f.other.id,
      })
    ).json(),
  ).toEqual({ job: null });
  expect(
    (
      await f.request(`/exports/${job.id}/cancel`, {
        token: f.alternate.token,
        account: f.other.id,
      })
    ).status,
  ).toBe(404);
  expect(
    (await f.request('/exports', { token: f.alternate.token, account: f.other.id })).status,
  ).toBe(409);

  const capability = await f.authorize(job.id);
  expect(
    (await f.delivery(job.id, capability.token, { from: 'https://outside.example' })).status,
  ).toBe(403);
  const response = await f.delivery(job.id, capability.token);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-disposition')).toContain('.spinel');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('content-length')).toBe(String(job.bytes));
  const encrypted = Buffer.from(await response.arrayBuffer());
  expect(encrypted.subarray(0, 8).toString()).toBe('SPINEL01');
  expect(encrypted.includes(Buffer.from('Private retained workspace'))).toBe(false);
  expect(encrypted.includes(Buffer.from('must-stay-encrypted'))).toBe(false);
  expect(encrypted.includes(f.key)).toBe(false);
  expect((await f.delivery(job.id, capability.token)).status).toBe(410);
  const archive = join(f.directory, 'download.spinel');
  await writeFile(archive, encrypted, { mode: 0o600 });
  const restored = join(f.directory, 'restored');
  const metadata = await restoreArchive(archive, f.key, f.directory, restored);
  expect(metadata.keyId).toBe('http-key');
  const restoredDb = new DatabaseSync(join(restored, 'spinel.sqlite'));
  try {
    expect(
      restoredDb.prepare('SELECT name FROM workspace_items WHERE id=?').get(f.file.id)?.name,
    ).toBe('Private retained workspace');
  } finally {
    restoredDb.close();
  }
  await vi.waitFor(async () => {
    expect((await (await f.request('/exports', { method: 'GET' })).json()).job.state).toBe(
      'delivered',
    );
    expect(
      (await readdir(f.directory)).filter((name) => name.startsWith('.backup-export-')),
    ).toEqual([]);
  });
  // Manual handoff proves neither automatic publication nor independent retention.
  expect(f.backups.status().lastGood).toBeNull();
  expect(f.backups.status().offsite).toBe(false);
});

test('expired, reused and cross-session delivery capabilities fail closed; cancellation releases the real artifact', async () => {
  const f = await fixture();
  f.verify();
  expect((await f.request('/exports')).status).toBe(202);
  const job = await f.ready();
  const first = await f.authorize(job.id);
  f.advance(60_001);
  expect((await f.delivery(job.id, first.token)).status).toBe(410);
  const second = await f.authorize(job.id);
  expect(
    (
      await f.delivery(job.id, second.token, {
        token: f.alternate.token,
        account: f.other.id,
        body: new URLSearchParams({ token: second.token, accountId: f.other.id }).toString(),
      })
    ).status,
  ).toBe(410);
  f.advance(VERIFICATION_MS);
  expect((await f.delivery(job.id, second.token)).status).toBe(428);
  // Cancellation never requires a new passkey proof; it only removes this session's staging.
  const cancelled = await f.request(`/exports/${job.id}/cancel`);
  expect(cancelled.status).toBe(200);
  expect((await cancelled.json()).job.state).toBe('cancelled');
  f.verify();
  expect((await f.request(`/exports/${job.id}/authorize`)).status).toBe(409);
  expect((await f.request('/exports')).status).toBe(202);
  const next = await f.ready();
  const token = await f.authorize(next.id);
  f.auth.revokeSession(f.session.session.token_hash);
  expect((await f.delivery(next.id, token.token)).status).toBe(404);
});

test('asynchronous metadata never returns to an Operator whose session was revoked during retrieval', async () => {
  const f = await fixture();
  const current = f.backups.exports.current.bind(f.backups.exports);
  vi.spyOn(f.backups.exports, 'current').mockImplementationOnce(async (session) => {
    const value = await current(session);
    f.auth.revokeSession(session);
    return value;
  });
  expect((await f.request('/exports', { method: 'GET' })).status).toBe(404);
});

test.each(['disconnect', 'revocation'] as const)(
  'a real backpressured HTTP download releases its archive and lease after %s',
  async (failure) => {
    const f = await fixture();
    // Incompressible bytes exceed a loopback socket's send buffers, keeping the
    // real pipeline active while the client pauses reading. No timing barrier
    // or substituted streaming implementation can manufacture this outcome.
    f.db.exec('CREATE TABLE export_payload (id TEXT PRIMARY KEY, bytes BLOB)');
    f.db
      .prepare('INSERT INTO export_payload VALUES (?,?)')
      .run('fixture', randomBytes(16 * 1024 ** 2));
    f.verify();
    expect((await f.request('/exports')).status).toBe(202);
    const job = await f.ready();
    expect(job.bytes).toBeGreaterThan(16 * 1024 ** 2);
    const permission = await f.authorize(job.id);
    const body = new URLSearchParams({
      token: permission.token,
      accountId: f.operator.id,
    }).toString();
    const request = httpRequest(`${f.root}/exports/${job.id}/file`, {
      method: 'POST',
      headers: {
        Cookie: `${COOKIE_NAME}=${f.session.token}`,
        Origin: f.origin,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': String(Buffer.byteLength(body)),
      },
    });
    const incoming = new Promise<IncomingMessage>((resolve, reject) => {
      request.once('response', (response) => {
        response.on('error', () => {});
        response.pause();
        resolve(response);
      });
      request.once('error', reject);
    });
    request.end(body);
    const response = await incoming;
    try {
      expect(response.statusCode).toBe(200);
      expect((await f.backups.exports.current(f.session.session.token_hash))?.state).toBe(
        'downloading',
      );
      if (failure === 'disconnect') response.destroy();
      else f.auth.revokeSession(f.session.session.token_hash);
      await vi.waitFor(
        async () => {
          expect((await f.backups.exports.current(f.session.session.token_hash))?.state).toBe(
            'failed',
          );
          expect(f.backups.state().owner).toBeNull();
          expect(
            (await readdir(f.directory)).filter((name) => name.startsWith('.backup-export-')),
          ).toEqual([]);
        },
        { timeout: 10_000, interval: 30 },
      );
    } finally {
      response.destroy();
      request.destroy();
    }
  },
  30_000,
);
