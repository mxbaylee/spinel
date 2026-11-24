import express from 'express';
import type { AddressInfo } from 'node:net';
import { expect, test } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';
import { workspaceRoutes } from './routes.ts';
import type { CollaborationStore } from '../collaboration/service.ts';

// Real HTTP/parser/auth boundaries, with a controlled materializer to hold the
// asynchronous admission window without starting another large SDK process.
test('file routes enforce sessions, CSRF, access, parser limits and admission through client abort', async () => {
  const db = new DatabaseSync(':memory:');
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth);
  const owner = auth.createUser('Owner'),
    other = auth.createUser('Other'),
    admin = auth.createUser('Admin', true);
  const ownerCookie = `${COOKIE_NAME}=${auth.createSession(owner.id).token}`;
  const cookie = (id: string) => `${COOKIE_NAME}=${auth.createSession(id).token}`;
  let release = () => {};
  let started = () => {};
  let held: Promise<void> | undefined;
  const collaboration = {
    prepare: async () => {},
    load: async () => {
      started();
      await held;
      return { snapshot: { id: 'source', body: { dataStream: 'Latest\r\n' } } };
    },
    generations: {
      active: (id: string) => ({ unitId: id }),
      restoring: () => false,
    },
  } as unknown as CollaborationStore;
  const app = express();
  app.use('/api/items', workspaceRoutes(auth, 'http://localhost:3000', workspace, collaboration));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((ready) => server.once('listening', ready));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/items`;
  const headers = {
    Cookie: ownerCookie,
    Origin: 'http://localhost:3000',
    'Content-Type': 'application/json',
  };
  const payload = {
    filename: 'a.json',
    parentId: null,
    snapshot: { id: 'source', title: 'Imported', body: { dataStream: 'Hello\r\n' } },
  };
  const upload = (supplied = headers, body = JSON.stringify(payload)) =>
    fetch(`${root}/import`, { method: 'POST', headers: supplied, body });
  try {
    for (const [credential, status] of [
      ['', 401],
      [cookie(admin.id), 403],
    ] as const)
      expect((await upload({ ...headers, Cookie: credential })).status).toBe(status);
    expect((await upload({ ...headers, Origin: 'https://evil.example' })).status).toBe(403);
    expect((await upload(headers, '{bad')).status).toBe(400);
    expect(
      (
        await upload(
          headers,
          JSON.stringify({ ...payload, huge: 'x'.repeat(20 * 1024 * 1024 + 8192) }),
        )
      ).status,
    ).toBe(413);
    // SPN-093: CSV/TSV text uses the same session, CSRF, admission and body limits.
    const table = (filename: string, text: unknown, supplied = headers) =>
      upload(supplied, JSON.stringify({ filename, parentId: null, text }));
    for (const [credential, status] of [
      ['', 401],
      [cookie(admin.id), 403],
    ] as const)
      expect((await table('t.csv', 'a,b\n', { ...headers, Cookie: credential })).status).toBe(
        status,
      );
    expect(
      (await table('t.csv', 'a,b\n', { ...headers, Origin: 'https://evil.example' })).status,
    ).toBe(403);
    const csv = await table('t.csv', 'a,b\n007,"x\ny"\n');
    expect(csv.status).toBe(201);
    expect((await csv.json()).item).toMatchObject({ kind: 'sheet', name: 't' });
    const unsupported = await table('t.txt', 'a,b\n');
    expect(unsupported.status).toBe(400);
    expect((await unsupported.json()).error).toContain('.csv (comma) or .tsv (tab)');
    const malformed = await table('t.tsv', 'a\t"b\n');
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error).toContain('never closed');
    expect((await table('t.csv', 'x'.repeat(20 * 1024 * 1024 + 8192))).status).toBe(413);
    expect(workspace.list(owner.id).filter((entry) => entry.name === 't')).toHaveLength(1);
    const imported = await upload();
    expect(imported.status).toBe(201);
    const { item } = await imported.json();
    const read = (credential = ownerCookie, signal?: AbortSignal) =>
      fetch(`${root}/${item.id}/export`, { headers: { Cookie: credential }, signal });
    for (const [credential, status] of [
      ['', 401],
      [cookie(admin.id), 403],
      [cookie(other.id), 404],
    ] as const)
      expect((await read(credential)).status).toBe(status);
    workspace.share(owner.id, item.id, other.id, 'viewer');
    const download = await read(cookie(other.id));
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toContain('Imported.univer.json');
    expect(download.headers.get('cache-control')).toBe('no-store');
    expect(download.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await download.json()).body.dataStream).toBe('Latest\r\n');
    const foreignFolder = workspace.create(other.id, {
      name: 'Private',
      kind: 'folder',
      parentId: null,
    });
    expect(
      (await upload(headers, JSON.stringify({ ...payload, parentId: foreignFolder.id }))).status,
    ).toBe(404);
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const controller = new AbortController();
    const pending = read(ownerCookie, controller.signal).catch(() => undefined);
    await began;
    controller.abort();
    await pending;
    // A closed socket cannot admit a second transfer while the first still materializes.
    expect((await upload()).status).toBe(429);
    release();
    await expect.poll(async () => (await upload()).status).toBe(201);
    // Revocation during the asynchronous read must not leak a completed download.
    held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const again = new Promise<void>((resolve) => {
      started = resolve;
    });
    const revoked = read();
    await again;
    db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(owner.id);
    release();
    expect((await revoked).status).toBe(401);
  } finally {
    release();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    db.close();
  }
});
