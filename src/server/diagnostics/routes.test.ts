import express from 'express';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, test, vi } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { DiagnosticsStore } from './store.ts';
import type { DiagnosticsSnapshot } from './store.ts';
import { DiagnosticRateLimit, diagnosticsRoutes } from './routes.ts';
import type { DiagnosticEvent } from '@spinel/diagnostics';

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'spinel-diagnostics-http-'));
  const db = new DatabaseSync(join(directory, 'application.sqlite'));
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth);
  const owner = auth.createUser('Private owner'),
    other = auth.createUser('Private collaborator'),
    admin = auth.createUser('Operator', true);
  const item = workspace.create(owner.id, {
    name: 'Secret document title',
    kind: 'doc',
    parentId: null,
  });
  const diagnostics = new DiagnosticsStore({
    path: join(directory, 'diagnostics.sqlite'),
    build: 'test',
  });
  const origin = 'https://spinel.example';
  const app = express();
  app.use('/api', diagnosticsRoutes(workspace, diagnostics, origin));
  app.post('/api/unrelated', express.json({ limit: '1mb' }), (_request, response) =>
    response.sendStatus(204),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const token = auth.createSession(owner.id).token;
  const cookie = `${COOKIE_NAME}=${token}`;
  const adminCookie = `${COOKIE_NAME}=${auth.createSession(admin.id).token}`;
  const otherCookie = `${COOKIE_NAME}=${auth.createSession(other.id).token}`;
  const post = (path: string, body: unknown, overrides: Record<string, string> = {}) =>
    fetch(`${root}${path}`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: origin,
        'Content-Type': 'application/json',
        'X-Spinel-Diagnostic-Account': owner.id,
        ...overrides,
      },
      body: JSON.stringify(body),
    });
  const data = () => ({
    id: randomUUID(),
    occurredAt: 1234,
    event: {
      name: 'operation.result',
      details: { operation: 'document-open', outcome: 'success', durationMs: 10 },
    },
    context: { component: 'editor', fileId: item.id, route: '/files/:id', runId: randomUUID() },
  });
  const binding = async (cookie: string, account: string) =>
    (
      await (
        await fetch(`${root}/diagnostics/collection`, {
          headers: { Cookie: cookie, 'X-Spinel-Diagnostic-Account': account },
        })
      ).json()
    ).binding as string;
  const ownerBinding = await binding(cookie, owner.id),
    otherBinding = await binding(otherCookie, other.id);
  const batch = (record = data(), binding = ownerBinding) => ({
    generation: diagnostics.status().generation!,
    binding,
    records: [record],
  });
  const otherHeaders = { Cookie: otherCookie, 'X-Spinel-Diagnostic-Account': other.id };
  return {
    directory,
    db,
    auth,
    workspace,
    diagnostics,
    owner,
    other,
    admin,
    item,
    root,
    token,
    cookie,
    otherCookie,
    otherHeaders,
    otherBinding,
    binding,
    adminCookie,
    post,
    data,
    batch,
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await diagnostics.close();
      db.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('ingestion derives actor, rejects spoofing/raw content and rechecks file grants and sessions', async () => {
  const f = await fixture();
  try {
    expect((await f.post('/diagnostics/events', f.batch())).status).toBe(200);
    expect(
      (await f.post('/diagnostics/events', { ...f.batch(), actorId: f.other.id })).status,
    ).toBe(400);
    const spoofed = { ...f.data(), actorId: f.other.id };
    expect((await f.post('/diagnostics/events', { ...f.batch(), records: [spoofed] })).status).toBe(
      400,
    );
    const content = f.data();
    expect(
      (
        await f.post('/diagnostics/events', {
          ...f.batch(),
          records: [
            {
              ...content,
              event: {
                ...content.event,
                details: { ...content.event.details, text: 'PRIVATE BODY' },
              },
            },
          ],
        })
      ).status,
    ).toBe(400);
    expect(
      (await f.post('/diagnostics/events', f.batch(), { Origin: 'https://evil.example' })).status,
    ).toBe(403);
    expect((await f.post('/diagnostics/events', f.batch(), { Cookie: '' })).status).toBe(401);
    expect(
      (await f.post('/diagnostics/events', f.batch(undefined, f.otherBinding), f.otherHeaders))
        .status,
    ).toBe(404);
    f.workspace.share(f.owner.id, f.item.id, f.other.id, 'viewer');
    expect(
      (await f.post('/diagnostics/events', f.batch(undefined, f.otherBinding), f.otherHeaders))
        .status,
    ).toBe(200);
    f.workspace.share(f.owner.id, f.item.id, f.other.id, null);
    expect(
      (await f.post('/diagnostics/events', f.batch(undefined, f.otherBinding), f.otherHeaders))
        .status,
    ).toBe(404);
    f.auth.revokeSession(f.auth.session(f.token)!.token_hash);
    expect((await f.post('/diagnostics/events', f.batch())).status).toBe(401);
    const stored = new DatabaseSync(f.diagnostics.path);
    try {
      const rows = stored.prepare('SELECT * FROM events ORDER BY received_at').all();
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.actor_id))).toEqual(new Set([f.owner.id, f.other.id]));
      expect(rows.every((row) => row.source === 'frontend')).toBe(true);
      const encoded = JSON.stringify(rows);
      for (const secret of ['Secret document title', 'PRIVATE BODY', 'Private owner', f.token])
        expect(encoded).not.toContain(secret);
    } finally {
      stored.close();
    }
  } finally {
    await f.close();
  }
});

test('browser admission permits only exact client observations and keeps source, actor and access authoritative', async () => {
  const f = await fixture();
  const client: DiagnosticEvent = {
    name: 'sync.client.connection',
    details: {
      reason: 'transport',
      outcome: 'success',
      durationMs: 40,
      pendingCount: 2,
      oldestPendingAgeMs: null,
    },
  };
  const send = (event: unknown, headers: Record<string, string> = {}, extraContext = {}) =>
    f.post(
      '/diagnostics/events',
      {
        ...f.batch(),
        records: [{ ...f.data(), event, context: { ...f.data().context, ...extraContext } }],
      },
      headers,
    );
  try {
    expect((await send(client)).status).toBe(200);
    for (const event of [
      {
        name: 'runtime.cpu',
        metric: { kind: 'gauge', unit: 'milliseconds', value: 5 },
        details: { windowMs: 60000 },
      },
      { name: 'maintenance.phase', details: { phase: 'running' } },
      {
        name: 'sync.edit.transformed',
        metric: { kind: 'counter', unit: 'count', value: 1 },
        details: {},
      },
      { name: 'offline.server.publication', details: { outcome: 'published', durationMs: 1 } },
      { ...client, details: { ...client.details, secret: 'PRIVATE CONTENT' } },
    ])
      expect((await send(event)).status).toBe(400);
    expect((await send(client, {}, { component: 'server' })).status).toBe(400);
    expect((await send(client, { Cookie: '' })).status).toBe(401);
    expect((await send(client, { Cookie: f.otherCookie })).status).toBe(403);
    expect((await send(client, {}, { fileId: randomUUID() })).status).toBe(404);
    const db = new DatabaseSync(f.diagnostics.path);
    try {
      expect(db.prepare('SELECT name,source,actor_id FROM events').all()).toEqual([
        { name: client.name, source: 'frontend', actor_id: f.owner.id },
      ]);
    } finally {
      db.close();
    }
  } finally {
    await f.close();
  }
});

test('operator export/clear are distinct from submission and require current confirmation/generation', async () => {
  const f = await fixture();
  try {
    const batch = f.batch();
    await f.post('/diagnostics/events', batch);
    expect((await f.post('/admin/diagnostics/download', {})).status).toBe(404);
    expect(
      (await f.post('/admin/diagnostics/truncate', { confirm: true, generation: batch.generation }))
        .status,
    ).toBe(404);
    expect(
      (
        await f.post(
          '/admin/diagnostics/truncate',
          { generation: batch.generation },
          { Cookie: f.adminCookie },
        )
      ).status,
    ).toBe(400);
    expect(f.diagnostics.status().recordCount).toBe(1);
    const clear = await f.post(
      '/admin/diagnostics/truncate',
      { confirm: true, generation: batch.generation },
      { Cookie: f.adminCookie },
    );
    expect(clear.status).toBe(200);
    expect(f.diagnostics.status().recordCount).toBe(0);
    expect((await f.post('/diagnostics/events', batch)).status).toBe(409);
    expect(
      (
        await f.post(
          '/admin/diagnostics/truncate',
          { confirm: true, generation: batch.generation },
          { Cookie: f.adminCookie },
        )
      ).status,
    ).toBe(409);
    expect(f.workspace.get(f.owner.id, f.item.id).name).toBe('Secret document title');
    expect(
      (await fetch(`${f.root}/admin/diagnostics`, { headers: { Cookie: f.cookie } })).status,
    ).toBe(404);
  } finally {
    await f.close();
  }
});

test('an authorized Operator downloads the real private SQLite snapshot and releases its lease', async () => {
  const f = await fixture();
  try {
    expect((await f.post('/diagnostics/events', f.batch())).status).toBe(200);
    const response = await f.post('/admin/diagnostics/download', {}, { Cookie: f.adminCookie });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/vnd.sqlite3');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename=spinel-diagnostics.sqlite',
    );
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 16).toString()).toBe('SQLite format 3\0');
    const downloadedPath = join(f.directory, 'downloaded.sqlite');
    writeFileSync(downloadedPath, bytes);
    const downloaded = new DatabaseSync(downloadedPath);
    try {
      expect(downloaded.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      expect(downloaded.prepare('SELECT actor_id, source FROM events').all()).toEqual([
        { actor_id: f.owner.id, source: 'frontend' },
      ]);
    } finally {
      downloaded.close();
    }
    await expect.poll(() => f.diagnostics.status().exporting).toBe(false);
    expect(
      readdirSync(f.directory).filter((name) => name.startsWith('.diagnostics-export-')),
    ).toEqual([]);
    expect(f.diagnostics.status().recordCount).toBe(1);
    expect(() => f.diagnostics.truncate()).not.toThrow();
  } finally {
    await f.close();
  }
});

test.each(['session', 'role'] as const)(
  'revoking an Operator %s while a snapshot is pending denies delivery and removes its private lease',
  async (revocation) => {
    const f = await fixture();
    const prepared = Promise.withResolvers<DiagnosticsSnapshot>();
    const released = Promise.withResolvers<void>();
    const snapshot = f.diagnostics.snapshot.bind(f.diagnostics);
    const intercepted = vi.spyOn(f.diagnostics, 'snapshot').mockImplementation(async (signal) => {
      try {
        // Exercise the actual worker, private SQLite file and export lease, then
        // hold the route at its await boundary before its final authorization check.
        const result = await snapshot(signal);
        prepared.resolve(result);
        await released.promise;
        return result;
      } catch (error) {
        prepared.reject(error);
        throw error;
      }
    });
    let pending: Promise<Response> | undefined;
    try {
      expect((await f.post('/diagnostics/events', f.batch())).status).toBe(200);
      pending = f.post('/admin/diagnostics/download', {}, { Cookie: f.adminCookie });
      const result = await prepared.promise;
      const dispose = vi.spyOn(result, 'dispose');
      expect(existsSync(result.path)).toBe(true);
      expect(f.diagnostics.status().exporting).toBe(true);
      expect(() => f.diagnostics.truncate()).toThrow('download is active');
      if (revocation === 'session') {
        const token = f.adminCookie.slice(COOKIE_NAME.length + 1);
        f.auth.revokeSession(f.auth.session(token)!.token_hash);
      } else {
        f.db.prepare('UPDATE auth_users SET is_admin=0 WHERE id=?').run(f.admin.id);
      }
      released.resolve();
      const response = await pending;
      expect(response.status).toBe(revocation === 'session' ? 401 : 404);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(response.headers.get('content-disposition')).toBeNull();
      const body = await response.text();
      expect(body).not.toContain('SQLite format 3');
      expect(body).not.toContain('Secret document title');
      expect(body).not.toContain(result.path);
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(existsSync(result.path)).toBe(false);
      expect(
        readdirSync(f.directory).filter((name) => name.startsWith('.diagnostics-export-')),
      ).toEqual([]);
      expect(f.diagnostics.status()).toMatchObject({ exporting: false, recordCount: 1 });
      // Cleanup releases the real lock: a later authorized clear can proceed.
      expect(() => f.diagnostics.truncate()).not.toThrow();
    } finally {
      released.resolve();
      if (pending) await pending.catch(() => {});
      intercepted.mockRestore();
      await f.close();
    }
  },
);

test('batch caps and rate admission are bounded and do not impose diagnostics parsing on other APIs', async () => {
  const f = await fixture();
  try {
    expect(
      (
        await f.post('/diagnostics/events', {
          ...f.batch(),
          records: Array.from({ length: 65 }, () => f.data()),
        })
      ).status,
    ).toBe(400);
    expect((await f.post('/diagnostics/events', { oversized: 'x'.repeat(65536) })).status).toBe(
      413,
    );
    expect((await f.post('/unrelated', { content: 'x'.repeat(65536) })).status).toBe(204);
    let now = 0;
    const rate = new DiagnosticRateLimit(() => now);
    expect(rate.take('a', 120)).toBe(true);
    expect(rate.take('a', 1)).toBe(false);
    for (const actor of ['b', 'c', 'd', 'e']) expect(rate.take(actor, 120)).toBe(true);
    expect(rate.take('f', 1)).toBe(false);
    now = 60_000;
    expect(rate.take('a', 1)).toBe(true);
  } finally {
    await f.close();
  }
});

test('old queued batches cannot be reassigned to a switched account or a replacement session', async () => {
  const f = await fixture();
  try {
    f.workspace.share(f.owner.id, f.item.id, f.other.id, 'viewer');
    const queued = f.batch();
    // Both people can read the same file; current file authorization alone cannot
    // distinguish the old tab's observation from the new cookie's actor.
    expect((await f.post('/diagnostics/events', queued, { Cookie: f.otherCookie })).status).toBe(
      403,
    );
    expect((await f.post('/diagnostics/events', queued, f.otherHeaders)).status).toBe(409);
    f.auth.revokeSession(f.auth.session(f.token)!.token_hash);
    const replacement = `${COOKIE_NAME}=${f.auth.createSession(f.owner.id).token}`;
    expect((await f.post('/diagnostics/events', queued, { Cookie: replacement })).status).toBe(409);
    expect(f.diagnostics.status().recordCount).toBe(0);
    const binding = await f.binding(replacement, f.owner.id);
    expect(binding).not.toBe(queued.binding);
    expect(
      (await f.post('/diagnostics/events', f.batch(undefined, binding), { Cookie: replacement }))
        .status,
    ).toBe(200);
    const stored = new DatabaseSync(f.diagnostics.path);
    try {
      const rows = JSON.stringify(stored.prepare('SELECT * FROM events').all());
      expect(rows).not.toContain(binding);
      expect(rows).not.toContain(queued.binding);
    } finally {
      stored.close();
    }
  } finally {
    await f.close();
  }
});
