import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { createApp } from '../../../server/app.ts';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';
import { SpaceStore } from './spaces.ts';

test('Guest links HTTP inventory is owner-only, secret-free, CSRF-protected and guarded against stale or expired actions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-guest-links-http-'));
  const path = join(directory, 'db.sqlite');
  await writeFile(join(directory, 'index.html'), '<html><head></head><body>Fixture</body></html>');
  const app = await createApp({ databasePath: path, staticDirectory: directory });
  const db = openDatabase(path);
  let closed = false;
  try {
    await new Promise<void>((ready) => app.server.listen(0, '127.0.0.1', ready));
    const root = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const auth = new AuthStore(db),
      workspace = new WorkspaceStore(auth, { spacesEnabled: true });
    const spaces = new SpaceStore(workspace);
    const owner = auth.createUser('Private owner'),
      collaborator = auth.createUser('File admin'),
      operator = auth.createUser('Operator', true);
    const cookie = (id: string) => `${COOKIE_NAME}=${auth.createSession(id).token}`;
    const ownCookie = cookie(owner.id),
      collaboratorCookie = cookie(collaborator.id),
      operatorCookie = cookie(operator.id);
    const request = (
      suffix: string,
      credential = ownCookie,
      method = 'GET',
      data?: unknown,
      origin = 'http://localhost:3000',
    ) =>
      fetch(root + suffix, {
        method,
        headers: { Cookie: credential, Origin: origin, 'Content-Type': 'application/json' },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
    const doc = workspace.create(owner.id, { kind: 'doc', name: 'Private title', parentId: null });
    const space = spaces.createRoot(owner.id, { name: 'Private Space', parentId: null }).space;
    workspace.share(owner.id, doc.id, collaborator.id, 'admin');
    const created = [];
    for (const item of [doc, space]) {
      const response = await request(`/api/items/${item.id}/link`, ownCookie, 'PUT', {
        role: 'editor',
        expiryDays: 7,
      });
      expect(response.status).toBe(200);
      const link = await response.json();
      expect(link).toMatchObject({ enabled: true, role: 'editor', expired: false });
      expect(link.expiresAt - link.enabledAt).toBe(7 * 86_400_000);
      created.push({ item, link });
    }
    const listed = await request('/api/guest-links');
    expect(listed.headers.get('cache-control')).toBe('no-store');
    const listing = await listed.json();
    expect(listing.items.map((item: { id: string }) => item.id).sort()).toEqual(
      [doc.id, space.id].sort(),
    );
    expect((await (await request('/api/guest-links', collaboratorCookie)).json()).items).toEqual(
      [],
    );
    for (const [credential, status] of [
      [operatorCookie, 403],
      ['', 401],
    ] as const) {
      const response = await request('/api/guest-links', credential);
      expect(response.status).toBe(status);
      expect(await response.text()).not.toContain('Private');
    }
    for (const { item, link } of created) {
      const url = new URL(link.url),
        secret = url.hash.slice(1),
        preview = url.searchParams.get('preview');
      for (const text of [
        JSON.stringify(listing),
        await (await request(`/api/items/${item.id}/link`)).text(),
      ]) {
        expect(text).not.toContain(secret);
        expect(text).not.toContain(preview!);
        expect(text).not.toContain('url');
      }
      const path = `/api/guest-links/${item.id}`;
      const state = db
        .prepare(
          'SELECT epoch,token_hash,preview_hash,enabled_at FROM workspace_links WHERE item_id=?',
        )
        .get(item.id);
      const expected = { epoch: link.epoch, expectedExpiresAt: link.expiresAt };
      expect(
        (
          await request(
            path,
            ownCookie,
            'PATCH',
            { ...expected, expiryDays: 30 },
            'https://other.example',
          )
        ).status,
      ).toBe(403);
      for (const invalid of [
        { expiryDays: 1 },
        { epoch: link.epoch, expiryDays: 7 },
        { ...expected, expiryDays: 2 },
        { ...expected, expiryDays: '7' },
        { ...expected, expiryDays: 7, url: 'forged' },
      ])
        expect((await request(path, ownCookie, 'PATCH', invalid)).status).toBe(400);
      expect(
        (await request(path, collaboratorCookie, 'PATCH', { ...expected, expiryDays: 1 })).ok,
      ).toBe(false);
      expect((await request(path, collaboratorCookie, 'DELETE', expected)).ok).toBe(false);
      const changed = await request(path, ownCookie, 'PATCH', { ...expected, expiryDays: 1 });
      expect(changed.status).toBe(200);
      expect(await changed.json()).toMatchObject({
        id: item.id,
        epoch: link.epoch,
        status: 'active',
      });
      expect(
        db
          .prepare(
            'SELECT epoch,token_hash,preview_hash,enabled_at FROM workspace_links WHERE item_id=?',
          )
          .get(item.id),
      ).toEqual(state);
      expect(
        (await request(path, ownCookie, 'PATCH', { ...expected, expiryDays: 30 })).status,
      ).toBe(409);
      expect((await request(path, ownCookie, 'DELETE', expected)).status).toBe(409);
      const exchanged = await request(`/api/guest/${item.id}/session`, '', 'POST', {
        token: secret,
      });
      expect(exchanged.status).toBe(204);
      const guestCookie = exchanged.headers.get('set-cookie')!.split(';')[0];
      expect((await request(`/api/guest/${item.id}`, guestCookie)).status).toBe(200);
      const previewPath = `/share/${item.id}?preview=${preview}`;
      expect(await (await request(previewPath, '')).text()).toContain(item.name);
      db.prepare('UPDATE workspace_links SET expires_at=? WHERE item_id=?').run(
        Date.now(),
        item.id,
      );
      expect((await request(`/api/guest/${item.id}`, guestCookie)).status).toBe(404);
      expect(
        (await request(`/api/guest/${item.id}/session`, '', 'POST', { token: secret })).status,
      ).toBe(404);
      expect(await (await request(previewPath, '')).text()).not.toContain(item.name);
      expect(
        (await request(path, ownCookie, 'PATCH', { ...expected, expiryDays: null })).status,
      ).toBe(409);
      expect(await (await request(`/api/items/${item.id}/link`)).json()).toMatchObject({
        enabled: false,
        expired: true,
      });
      const expired = (await (await request('/api/guest-links')).json()).items.find(
        (entry: { id: string }) => entry.id === item.id,
      );
      expect(expired).toMatchObject({ role: 'editor', status: 'expired' });
      expect(
        (
          await request(path, ownCookie, 'PATCH', {
            epoch: expired.epoch,
            expectedExpiresAt: expired.expiresAt,
            expiryDays: null,
          })
        ).status,
      ).toBe(409);
      const replaced = await (
        await request(`/api/items/${item.id}/link`, ownCookie, 'PUT', { role: 'viewer' })
      ).json();
      expect(replaced).toMatchObject({ enabled: true, expired: false, expiresAt: null });
      expect(
        (
          await request(path, ownCookie, 'DELETE', {
            epoch: expired.epoch,
            expectedExpiresAt: expired.expiresAt,
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await request(path, ownCookie, 'PATCH', {
            epoch: expired.epoch,
            expectedExpiresAt: expired.expiresAt,
            expiryDays: null,
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await request(path, ownCookie, 'DELETE', {
            epoch: replaced.epoch,
            expectedExpiresAt: replaced.expiresAt,
          })
        ).status,
      ).toBe(204);
      expect(
        (await (await request('/api/guest-links')).json()).items.some(
          (entry: { id: string }) => entry.id === item.id,
        ),
      ).toBe(false);
    }
    // Existing delegated sharing controls remain available to a File admin.
    expect(
      (await request(`/api/items/${doc.id}/link`, collaboratorCookie, 'PUT', { role: 'viewer' }))
        .status,
    ).toBe(200);
    await app.close();
    closed = true;
    const epoch = Number(
      db.prepare('SELECT epoch FROM workspace_links WHERE item_id=?').get(doc.id)?.epoch,
    );
    db.prepare('UPDATE workspace_links SET expires_at=? WHERE item_id=?').run(Date.now(), doc.id);
    await new Promise((resolve) => setTimeout(resolve, 650));
    expect(
      db.prepare('SELECT epoch,state FROM workspace_links WHERE item_id=?').get(doc.id),
    ).toEqual({ epoch, state: 'active' });
  } finally {
    if (!closed) await app.close();
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
