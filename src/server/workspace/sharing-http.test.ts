import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { expect, test } from 'vitest';
import { createApp } from '../../../server/app.ts';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';

test('HTTP sharing enforces current grants on metadata, content and images without onward sharing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-sharing-http-'));
  const path = join(directory, 'db.sqlite');
  await writeFile(join(directory, 'index.html'), 'Fixture');
  const app = await createApp({ databasePath: path, staticDirectory: directory });
  const db = openDatabase(path);
  try {
    await new Promise<void>((ready) => app.server.listen(0, '127.0.0.1', ready));
    const root = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/items`;
    const auth = new AuthStore(db),
      store = new WorkspaceStore(auth);
    const owner = auth.createUser('Owner'),
      collaborator = auth.createUser('Collaborator'),
      admin = auth.createUser('Operator', true);
    const cookie = (id: string) => `${COOKIE_NAME}=${auth.createSession(id).token}`;
    const ownCookie = cookie(owner.id),
      sharedCookie = cookie(collaborator.id),
      adminCookie = cookie(admin.id);
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
    const folder = store.create(owner.id, { name: 'Shared', kind: 'folder', parentId: null });
    const share = (role: string | null) =>
      request(`/${folder.id}/sharing`, ownCookie, 'PUT', { userId: collaborator.id, role });
    expect((await request(`/${folder.id}`, sharedCookie)).status).toBe(404);
    expect(
      (
        await request(
          `/${folder.id}/sharing`,
          ownCookie,
          'PUT',
          { userId: collaborator.id, role: 'editor' },
          'https://evil.example',
        )
      ).status,
    ).toBe(403);
    expect((await share('owner')).status).toBe(400);
    expect((await share('viewer')).status).toBe(200);
    const doc = store.create(owner.id, { name: 'Future doc', kind: 'doc', parentId: folder.id });
    const sheet = store.create(owner.id, {
      name: 'Future sheet',
      kind: 'sheet',
      parentId: folder.id,
    });
    expect(
      (await (await request(`/${folder.id}`, sharedCookie)).json()).children
        .map((item: { id: string }) => item.id)
        .sort(),
    ).toEqual([doc.id, sheet.id].sort());
    expect((await (await request('', sharedCookie)).json()).items).toEqual([]);
    for (const suffix of [`/${folder.id}/sharing`, `/${doc.id}/sharing`]) {
      expect((await request(suffix, sharedCookie)).status).toBe(403);
      expect(
        (await request(suffix, sharedCookie, 'PUT', { userId: owner.id, role: 'editor' })).status,
      ).toBe(403);
    }
    expect((await request(`/${doc.id}`, sharedCookie, 'PATCH', { name: 'Renamed' })).status).toBe(
      403,
    );
    expect((await request(`/${doc.id}`, sharedCookie, 'DELETE')).ok).toBe(false);
    const bytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#c33' } })
      .png()
      .toBuffer();
    const upload = (credential: string) =>
      fetch(`${root}/${doc.id}/images`, {
        method: 'POST',
        headers: {
          Cookie: credential,
          Origin: 'http://localhost:3000',
          'Content-Type': 'image/png',
        },
        body: new Uint8Array(bytes),
      });
    expect((await upload(sharedCookie)).status).toBe(403);
    const image = await (await upload(ownCookie)).json();
    const imageSuffix = image.url.replace('/api/items', '');
    expect((await request(imageSuffix, sharedCookie)).status).toBe(200);
    const writes = [
      { suffix: `/${doc.id}/doc`, snapshot: { id: doc.id, body: { dataStream: 'Shared\r\n' } } },
      {
        suffix: `/${sheet.id}/sheet`,
        snapshot: { id: sheet.id, name: 'Shared', sheetOrder: ['a'], sheets: { a: { id: 'a' } } },
      },
    ];
    for (const { suffix, snapshot } of writes) {
      expect((await (await request(suffix, sharedCookie)).json()).access).toBe('viewer');
      expect(
        (
          await request(suffix, sharedCookie, 'PUT', {
            snapshot,
            revision: 0,
            writeId: randomUUID(),
          })
        ).status,
      ).toBe(403);
    }
    await share('editor');
    expect((await upload(sharedCookie)).status).toBe(201);
    for (const { suffix, snapshot } of writes) {
      const payload = { snapshot, revision: 0, writeId: randomUUID() };
      expect((await request(suffix, sharedCookie, 'PUT', payload)).status).toBe(200);
      expect(
        (await request(suffix, ownCookie, 'PUT', { ...payload, writeId: randomUUID() })).status,
      ).toBe(409);
    }
    await share(null);
    for (const suffix of [`/${folder.id}`, `/${doc.id}/doc`, `/${sheet.id}/sheet`, imageSuffix]) {
      expect((await request(suffix, sharedCookie)).status).toBe(404);
      expect((await request(suffix, adminCookie)).status).toBe(403);
      expect((await request(suffix, '')).status).toBe(401);
    }
    expect((await upload(sharedCookie)).status).toBe(404);
  } finally {
    db.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
