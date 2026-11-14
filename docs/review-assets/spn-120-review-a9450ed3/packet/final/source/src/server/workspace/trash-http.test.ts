import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { createApp } from '../../../server/app.ts';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';

test('trash API enforces sessions, owner scope, origin and confirmation; restored state survives server restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-trash-http-'));
  const path = join(directory, 'db.sqlite');
  await writeFile(join(directory, 'index.html'), 'Fixture');
  let app = await createApp({ databasePath: path, staticDirectory: directory });
  const db = openDatabase(path);
  try {
    await new Promise<void>((ready) => app.server.listen(0, '127.0.0.1', ready));
    let root = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/items`;
    const auth = new AuthStore(db),
      workspace = new WorkspaceStore(auth);
    const owner = auth.createUser('Owner'),
      other = auth.createUser('Other'),
      admin = auth.createUser('Admin', true);
    const cookie = (id: string) => `${COOKIE_NAME}=${auth.createSession(id).token}`;
    const ownCookie = cookie(owner.id),
      otherCookie = cookie(other.id),
      adminCookie = cookie(admin.id);
    const request = (
      suffix: string,
      method = 'GET',
      body?: unknown,
      credential = ownCookie,
      origin = 'http://localhost:3000',
    ) =>
      fetch(root + suffix, {
        method,
        headers: { Cookie: credential, Origin: origin, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const parent = workspace.create(owner.id, { name: 'Parent', kind: 'folder', parentId: null });
    const doc = workspace.create(owner.id, { name: 'Doc', kind: 'doc', parentId: parent.id });
    workspace.share(owner.id, parent.id, other.id, 'editor');
    for (const credential of ['', adminCookie]) {
      const expected = credential ? 403 : 401;
      for (const [suffix, method, body] of [
        ['/trash', 'GET', undefined],
        [`/${doc.id}/trash`, 'POST', {}],
        [`/${doc.id}/restore`, 'POST', {}],
        ['/trash/empty', 'POST', { version: 'invalid' }],
      ] as const)
        expect((await request(suffix, method, body, credential)).status).toBe(expected);
    }
    expect((await request(`/${doc.id}/trash`, 'POST', {}, otherCookie)).status).toBe(403);
    expect(
      (await request(`/${parent.id}/trash`, 'POST', {}, ownCookie, 'https://evil.example')).status,
    ).toBe(403);
    expect((await request(`/${parent.id}/trash`, 'POST', {})).status).toBe(200);
    expect((await (await request('/trash')).json()).items).toHaveLength(2);
    expect((await request('/trash')).headers.get('cache-control')).toBe('no-store');
    expect((await (await request('/trash', 'GET', undefined, otherCookie)).json()).items).toEqual(
      [],
    );
    for (const credential of [ownCookie, otherCookie]) {
      expect((await request(`/${parent.id}`, 'GET', undefined, credential)).status).toBe(404);
      expect((await request(`/${doc.id}/doc`, 'GET', undefined, credential)).status).toBe(404);
      expect(
        (
          await request(
            `/${doc.id}/doc`,
            'PUT',
            { snapshot: {}, revision: 0, writeId: 'fake' },
            credential,
          )
        ).status,
      ).toBe(404);
      expect((await request(`/${doc.id}/sharing`, 'GET', undefined, credential)).status).toBe(404);
    }
    expect((await request(`/${parent.id}/restore`, 'POST', {}, otherCookie)).status).toBe(404);
    expect((await request('/trash/empty', 'POST', { version: 'stale' })).status).toBe(409);
    // Restart while trashed proves metadata and retained permissions are persistent.
    await app.close();
    app = await createApp({ databasePath: path, staticDirectory: directory });
    await new Promise<void>((ready) => app.server.listen(0, '127.0.0.1', ready));
    root = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/items`;
    expect((await (await request('/trash')).json()).items).toHaveLength(2);
    expect((await request(`/${parent.id}/restore`, 'POST', {})).status).toBe(200);
    expect((await request(`/${doc.id}/doc`, 'GET', undefined, otherCookie)).status).toBe(200);
    await request(`/${parent.id}/trash`, 'POST', {});
    const listing = await (await request('/trash')).json();
    expect(
      (
        await request(
          '/trash/empty',
          'POST',
          { version: listing.version },
          ownCookie,
          'https://evil.example',
        )
      ).status,
    ).toBe(403);
    expect(
      (await (await request('/trash/empty', 'POST', { version: listing.version })).json()).count,
    ).toBe(2);
    expect((await request(`/${doc.id}/restore`, 'POST', {})).status).toBe(404);
    expect((await (await request('')).json()).items).toEqual([]);
  } finally {
    db.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
