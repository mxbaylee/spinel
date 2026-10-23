import express from 'express';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, test } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { DiagnosticsStore } from './store.ts';
import { DiagnosticRateLimit, diagnosticsRoutes } from './routes.ts';

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'spinel-diagnostics-http-'));
  const db = new DatabaseSync(join(directory, 'application.sqlite'));
  const auth = new AuthStore(db), workspace = new WorkspaceStore(auth);
  const owner = auth.createUser('Private owner'), other = auth.createUser('Private collaborator'), admin = auth.createUser('Operator', true);
  const item = workspace.create(owner.id, { name: 'Secret document title', kind: 'doc', parentId: null });
  const diagnostics = new DiagnosticsStore({ path: join(directory, 'diagnostics.sqlite'), build: 'test' });
  const origin = 'https://spinel.example';
  const app = express();
  app.use('/api', diagnosticsRoutes(workspace, diagnostics, origin));
  app.post('/api/unrelated', express.json({ limit: '1mb' }), (_request, response) => response.sendStatus(204));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const token = auth.createSession(owner.id).token;
  const cookie = `${COOKIE_NAME}=${token}`;
  const adminCookie = `${COOKIE_NAME}=${auth.createSession(admin.id).token}`;
  const otherCookie = `${COOKIE_NAME}=${auth.createSession(other.id).token}`;
  const post = (path: string, body: unknown, overrides: Record<string, string> = {}) => fetch(`${root}${path}`, {
    method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', ...overrides }, body: JSON.stringify(body),
  });
  const data = () => ({ id: randomUUID(), occurredAt: 1234, event: { name: 'operation.result', details: { operation: 'document-open', outcome: 'success', durationMs: 10 } }, context: { component: 'editor', fileId: item.id, route: '/files/:id', runId: randomUUID() } });
  const batch = (record = data()) => ({ generation: diagnostics.status().generation!, records: [record] });
  return { db, auth, workspace, diagnostics, owner, other, item, root, token, cookie, otherCookie, adminCookie, post, data, batch,
    async close() { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); await diagnostics.close(); db.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('ingestion derives actor, rejects spoofing/raw content and rechecks file grants and sessions', async () => {
  const f = await fixture();
  try {
    expect((await f.post('/diagnostics/events', f.batch())).status).toBe(200);
    expect((await f.post('/diagnostics/events', { ...f.batch(), actorId: f.other.id })).status).toBe(400);
    const spoofed = { ...f.data(), actorId: f.other.id };
    expect((await f.post('/diagnostics/events', { generation: f.diagnostics.status().generation, records: [spoofed] })).status).toBe(400);
    const content = f.data();
    expect((await f.post('/diagnostics/events', { generation: f.diagnostics.status().generation, records: [{ ...content, event: { ...content.event, details: { ...content.event.details, text: 'PRIVATE BODY' } } }] })).status).toBe(400);
    expect((await f.post('/diagnostics/events', f.batch(), { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await f.post('/diagnostics/events', f.batch(), { Cookie: '' })).status).toBe(401);
    expect((await f.post('/diagnostics/events', f.batch(), { Cookie: f.otherCookie })).status).toBe(404);
    f.workspace.share(f.owner.id, f.item.id, f.other.id, 'viewer');
    expect((await f.post('/diagnostics/events', f.batch(), { Cookie: f.otherCookie })).status).toBe(200);
    f.workspace.share(f.owner.id, f.item.id, f.other.id, null);
    expect((await f.post('/diagnostics/events', f.batch(), { Cookie: f.otherCookie })).status).toBe(404);
    f.auth.revokeSession(f.auth.session(f.token)!.token_hash);
    expect((await f.post('/diagnostics/events', f.batch())).status).toBe(401);
    const stored = new DatabaseSync(f.diagnostics.path);
    try {
      const rows = stored.prepare('SELECT * FROM events ORDER BY received_at').all();
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.actor_id))).toEqual(new Set([f.owner.id, f.other.id]));
      expect(rows.every((row) => row.source === 'frontend')).toBe(true);
      const encoded = JSON.stringify(rows);
      for (const secret of ['Secret document title', 'PRIVATE BODY', 'Private owner', f.token]) expect(encoded).not.toContain(secret);
    } finally { stored.close(); }
  } finally { await f.close(); }
});

test('operator export/clear are distinct from submission and require current confirmation/generation', async () => {
  const f = await fixture();
  try {
    const batch = f.batch();
    await f.post('/diagnostics/events', batch);
    expect((await f.post('/admin/diagnostics/download', {})).status).toBe(404);
    expect((await f.post('/admin/diagnostics/truncate', { confirm: true, generation: batch.generation })).status).toBe(404);
    expect((await f.post('/admin/diagnostics/truncate', { generation: batch.generation }, { Cookie: f.adminCookie })).status).toBe(400);
    expect(f.diagnostics.status().recordCount).toBe(1);
    const clear = await f.post('/admin/diagnostics/truncate', { confirm: true, generation: batch.generation }, { Cookie: f.adminCookie });
    expect(clear.status).toBe(200);
    expect(f.diagnostics.status().recordCount).toBe(0);
    expect((await f.post('/diagnostics/events', batch)).status).toBe(409);
    expect((await f.post('/admin/diagnostics/truncate', { confirm: true, generation: batch.generation }, { Cookie: f.adminCookie })).status).toBe(409);
    expect(f.workspace.get(f.owner.id, f.item.id).name).toBe('Secret document title');
    expect((await fetch(`${f.root}/admin/diagnostics`, { headers: { Cookie: f.cookie } })).status).toBe(404);
  } finally { await f.close(); }
});

test('batch caps and rate admission are bounded and do not impose diagnostics parsing on other APIs', async () => {
  const f = await fixture();
  try {
    expect((await f.post('/diagnostics/events', { generation: f.diagnostics.status().generation, records: Array.from({ length: 65 }, () => f.data()) })).status).toBe(400);
    expect((await f.post('/diagnostics/events', { oversized: 'x'.repeat(65536) })).status).toBe(413);
    expect((await f.post('/unrelated', { content: 'x'.repeat(65536) })).status).toBe(204);
    let now = 0;
    const rate = new DiagnosticRateLimit(() => now);
    expect(rate.take('a', 120)).toBe(true);
    expect(rate.take('a', 1)).toBe(false);
    for (const actor of ['b', 'c', 'd', 'e']) expect(rate.take(actor, 120)).toBe(true);
    expect(rate.take('f', 1)).toBe(false);
    now = 60_000;
    expect(rate.take('a', 1)).toBe(true);
  } finally { await f.close(); }
});
