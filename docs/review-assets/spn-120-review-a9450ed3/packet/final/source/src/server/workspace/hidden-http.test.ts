import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { createApp } from '../../../server/app.ts';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';

test('HTTP Hide/Show is account scoped, strict, origin protected and independent of access', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-hidden-http-'));
  const databasePath = join(directory, 'db.sqlite');
  await writeFile(join(directory, 'index.html'), 'Fixture');
  const app = await createApp({ databasePath, staticDirectory: directory });
  const db = openDatabase(databasePath);
  try {
    await new Promise<void>((ready) => app.server.listen(0, '127.0.0.1', ready));
    const root = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/items`;
    const auth = new AuthStore(db);
    const workspace = new WorkspaceStore(auth);
    const owner = auth.createUser('Owner');
    const reader = auth.createUser('Reader');
    const operator = auth.createUser('Operator', true);
    const doc = workspace.create(owner.id, { name: 'Shared notes', kind: 'doc', parentId: null });
    workspace.share(owner.id, doc.id, reader.id, 'viewer');
    const cookies = new Map(
      [owner, reader, operator].map((user) => [
        user.id,
        `${COOKIE_NAME}=${auth.createSession(user.id).token}`,
      ]),
    );
    const request = (
      suffix: string,
      options: {
        user?: string;
        method?: string;
        body?: unknown;
        origin?: string;
      } = {},
    ) =>
      fetch(root + suffix, {
        method: options.method ?? 'GET',
        headers: {
          Cookie: cookies.get(options.user ?? reader.id) ?? '',
          Origin: options.origin ?? 'http://localhost:3000',
          'Content-Type': 'application/json',
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    const hide = (body: unknown, options = {}) =>
      request(`/${doc.id}/hidden`, {
        ...options,
        method: 'PUT',
        body,
      });
    expect((await hide({ hidden: true }, { origin: 'https://untrusted.example' })).status).toBe(
      403,
    );
    expect((await hide({ hidden: true }, { user: '' })).status).toBe(401);
    expect((await hide({ hidden: true }, { user: operator.id })).status).toBe(403);
    expect((await hide({ hidden: true }, { user: owner.id })).status).toBe(400);
    expect((await hide({ hidden: true, userId: owner.id })).status).toBe(400);
    expect((await hide({ hidden: 'true' })).status).toBe(400);
    const hidden = await hide({ hidden: true });
    expect(hidden.status).toBe(200);
    expect((await hidden.json()).items).toEqual([
      expect.objectContaining({ id: doc.id, hidden: true }),
    ]);
    expect((await (await request('/shared')).json()).items).toEqual([]);
    expect((await (await request('/search')).json()).items).toEqual([]);
    expect((await (await request('/search?includeHidden=1')).json()).items).toEqual([
      expect.objectContaining({ id: doc.id, hidden: true }),
    ]);
    for (const query of [
      'includeHidden=true',
      'includeHidden=1&q=Shared',
      'includeHidden=1&includeHidden=1',
    ])
      expect((await request(`/search?${query}`)).status).toBe(400);
    expect((await (await request('/shared?includeHidden=1')).json()).items).toHaveLength(1);
    for (const query of ['includeHidden=true', 'includeHidden=1&includeHidden=1', 'userId=another'])
      expect((await request(`/shared?${query}`)).status).toBe(400);
    expect((await request(`/${doc.id}`)).status).toBe(200);
    expect((await request(`/${doc.id}/doc`)).status).toBe(200);
    expect((await hide({ hidden: false })).status).toBe(200);
    expect((await (await request('/search')).json()).items).toHaveLength(1);
    await hide({ hidden: true });
    workspace.share(owner.id, doc.id, reader.id, null);
    expect((await (await request('/shared?includeHidden=1')).json()).items).toEqual([]);
    expect((await request(`/${doc.id}/doc`)).status).toBe(404);
    expect((await hide({ hidden: false })).status).toBe(404);
  } finally {
    db.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
