import express from 'express';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, test, vi } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { PortableFiles } from './portable.ts';
import { workspaceRoutes } from './routes.ts';
import { WorkspaceStore } from './store.ts';

afterEach(() => vi.restoreAllMocks());

async function fixture() {
  const db = new DatabaseSync(':memory:');
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth);
  const owner = auth.createUser('Owner');
  const other = auth.createUser('Other');
  const operator = auth.createUser('Operator', true);
  const session = auth.createSession(owner.id);
  const cookie = (id: string) => `${COOKIE_NAME}=${auth.createSession(id).token}`;
  const headers: Record<string, string> = {
    Cookie: `${COOKIE_NAME}=${session.token}`,
    Origin: 'http://localhost:3000',
    'Content-Type': 'application/json',
    'x-spinel-offline-account': owner.id,
  };
  const app = express();
  app.use('/api/items', workspaceRoutes(auth, headers.Origin, workspace));
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/items`;
  const input = {
    recoveryId: randomUUID(),
    filename: 'offline.univer.json',
    snapshot: { id: 'old-id', title: 'Notes (offline copy, 2026-10-26 21.00)', body: { dataStream: 'My retained edits\r\n' } },
  };
  const recover = (body: unknown = input, overrides = headers) =>
    fetch(`${root}/offline-recovery`, { method: 'POST', headers: overrides, body: JSON.stringify(body) });
  return {
    db, auth, workspace, owner, other, operator, session, cookie, headers, input, root, recover,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    },
  };
}

test('recovery HTTP is account-fenced, no-store and idempotent after an ignored response', async () => {
  const f = await fixture();
  try {
    const original = f.workspace.create(f.other.id, { name: 'Original', kind: 'doc', parentId: null });
    f.input.snapshot.id = original.id;
    const before = f.db.prepare('SELECT * FROM workspace_items WHERE id=?').get(original.id);
    const first = await f.recover();
    expect(first.status).toBe(201);
    expect(first.headers.get('cache-control')).toBe('no-store');
    // The device may lose a success body before updating IndexedDB. The second
    // delivery must find the committed copy rather than invent another one.
    await first.body!.cancel();
    const response = await f.recover();
    expect(response.status).toBe(201);
    const { item } = await response.json();
    expect(item).toMatchObject({ kind: 'doc', access: 'owner', parentId: null, name: f.input.snapshot.title });
    expect(item.id).not.toBe(original.id);
    expect(f.workspace.fileOwner(item.id)).toBe(f.owner.id);
    expect(f.workspace.list(f.owner.id)).toEqual([item]);
    expect(f.db.prepare('SELECT * FROM workspace_items WHERE id=?').get(original.id)).toEqual(before);
    expect((await f.recover({ ...f.input, possibleReplayCrash: true })).status).toBe(409);
  } finally { await f.close(); }
});

test('recovery rejects guests, operators, disabled accounts, CSRF and mismatched/missing account fences before publication', async () => {
  const f = await fixture();
  try {
    const withoutFence = { ...f.headers };
    delete withoutFence['x-spinel-offline-account'];
    const attempts: Array<[Record<string, string>, number]> = [
      [{ ...f.headers, Cookie: '' }, 401],
      [{ ...f.headers, Cookie: '', Authorization: 'Bearer an-mcp-token' }, 401],
      [{ ...f.headers, Cookie: f.cookie(f.operator.id), 'x-spinel-offline-account': f.operator.id }, 403],
      [{ ...f.headers, Cookie: f.cookie(f.other.id) }, 409],
      [{ ...f.headers, Cookie: f.cookie(f.operator.id) }, 409],
      [withoutFence, 409],
      [{ ...f.headers, Origin: 'https://foreign.example' }, 403],
      [{ ...f.headers, 'Content-Type': 'text/plain' }, 403],
    ];
    for (const [headers, status] of attempts) expect((await f.recover(f.input, headers)).status).toBe(status);
    f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
    expect((await f.recover()).status).toBe(401);
    expect(f.db.prepare('SELECT count(*) AS count FROM workspace_items').get()!.count).toBe(0);
    expect(f.db.prepare('SELECT count(*) AS count FROM workspace_offline_recoveries').get()!.count).toBe(0);
  } finally { await f.close(); }
});

test('recovery rejects original/destination routing fields, invalid payloads and remote images without a partial copy', async () => {
  const f = await fixture();
  try {
    for (const body of [
      { ...f.input, parentId: randomUUID() },
      { ...f.input, spaceId: randomUUID() },
      { ...f.input, sourceId: randomUUID() },
      { ...f.input, recoveryId: 'not-an-id' },
      { ...f.input, possibleReplayCrash: 'true' },
      { ...f.input, snapshot: {} },
      { ...f.input, snapshot: { ...f.input.snapshot, drawings: { picture: { source: 'https://foreign.example/a.png' } } } },
    ]) expect((await f.recover(body)).status).toBe(400);
    expect(f.db.prepare('SELECT count(*) AS count FROM workspace_items').get()!.count).toBe(0);
    expect(f.db.prepare('SELECT count(*) AS count FROM workspace_offline_recoveries').get()!.count).toBe(0);
    expect(f.db.prepare('SELECT count(*) AS count FROM doc_images').get()!.count).toBe(0);
    // Refused transfers release admission, so the preserved work remains retryable.
    expect((await f.recover()).status).toBe(201);
  } finally { await f.close(); }
});

test('a session revoked during image preparation cannot publish a copy or receipt', async () => {
  const f = await fixture();
  try {
    const original = PortableFiles.prototype.prepare;
    vi.spyOn(PortableFiles.prototype, 'prepare').mockImplementation(async function (this: PortableFiles, ...args) {
      const prepared = await original.apply(this, args);
      f.db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(f.session.session.token_hash);
      return prepared;
    });
    const response = await f.recover();
    expect(response.status).toBe(401);
    expect(f.db.prepare('SELECT count(*) AS count FROM workspace_items').get()!.count).toBe(0);
    expect(f.db.prepare('SELECT count(*) AS count FROM workspace_offline_recoveries').get()!.count).toBe(0);
  } finally { await f.close(); }
});
