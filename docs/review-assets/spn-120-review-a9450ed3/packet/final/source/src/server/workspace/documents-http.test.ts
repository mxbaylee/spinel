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
import { IMAGE_LIMIT } from './documents.ts';

test('document HTTP routes protect raw uploads and image reads and reject oversized requests', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-doc-http-'));
  const path = join(directory, 'db.sqlite');
  await writeFile(join(directory, 'index.html'), 'Fixture');
  const app = await createApp({ databasePath: path, staticDirectory: directory });
  const db = openDatabase(path);
  try {
    await new Promise<void>((ready) => app.server.listen(0, '127.0.0.1', ready));
    const root = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const auth = new AuthStore(db);
    const owner = auth.createUser('Owner');
    const other = auth.createUser('Other');
    const admin = auth.createUser('Operator', true);
    const item = new WorkspaceStore(auth).create(owner.id, {
      kind: 'doc',
      name: 'Journal',
      parentId: null,
    });
    const cookie = (id: string) => `${COOKIE_NAME}=${auth.createSession(id).token}`;
    const ownerCookie = cookie(owner.id);
    const headers = {
      Cookie: ownerCookie,
      Origin: 'http://localhost:3000',
      'Content-Type': 'image/png',
    };
    const url = `${root}/api/items/${item.id}`;
    const bytes = await sharp({
      create: { width: 3, height: 2, channels: 4, background: '#ff9900' },
    })
      .png()
      .toBuffer();
    const upload = (supplied = headers, body: Uint8Array = bytes) =>
      fetch(`${url}/images`, { method: 'POST', headers: supplied, body: new Uint8Array(body) });
    expect((await upload({ ...headers, Origin: 'https://evil.example' })).status).toBe(403);
    expect((await upload({ ...headers, 'Content-Type': 'image/svg+xml' })).status).toBe(403);
    expect((await upload(headers, new Uint8Array(IMAGE_LIMIT + 1))).status).toBe(413);
    const created = await upload();
    expect(created.status).toBe(201);
    const image = await created.json();
    const saved = await fetch(`${root}${image.url}`, { headers: { Cookie: ownerCookie } });
    expect(saved.status).toBe(200);
    expect(saved.headers.get('content-type')).toContain('image/png');
    expect(saved.headers.get('x-content-type-options')).toBe('nosniff');
    expect(saved.headers.get('cache-control')).toBe('no-store');
    expect((await sharp(Buffer.from(await saved.arrayBuffer())).metadata()).width).toBe(3);
    const payload = {
      snapshot: { id: item.id, body: { dataStream: 'Saved\r\n' } },
      revision: 0,
      writeId: randomUUID(),
    };
    const jsonHeaders = { ...headers, 'Content-Type': 'application/json' };
    expect(
      (
        await fetch(`${url}/doc`, {
          method: 'PUT',
          headers: { ...jsonHeaders, Origin: 'https://evil.example' },
          body: JSON.stringify(payload),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${url}/doc`, {
          method: 'PUT',
          headers: jsonHeaders,
          body: JSON.stringify(payload),
        })
      ).status,
    ).toBe(200);
    for (const [credential, status] of [
      ['', 401],
      [cookie(other.id), 404],
      [cookie(admin.id), 403],
    ] as const) {
      expect((await fetch(`${url}/doc`, { headers: { Cookie: credential } })).status).toBe(status);
      expect((await fetch(`${root}${image.url}`, { headers: { Cookie: credential } })).status).toBe(
        status,
      );
      expect((await upload({ ...headers, Cookie: credential })).status).toBe(status);
      expect(
        (
          await fetch(`${url}/doc`, {
            method: 'PUT',
            headers: { ...jsonHeaders, Cookie: credential },
            body: JSON.stringify(payload),
          })
        ).status,
      ).toBe(status);
    }
    const tooLarge = {
      ...payload,
      snapshot: {
        ...payload.snapshot,
        body: { dataStream: 'x'.repeat(10 * 1024 * 1024) + '\r\n' },
      },
    };
    expect(
      (
        await fetch(`${url}/doc`, {
          method: 'PUT',
          headers: jsonHeaders,
          body: JSON.stringify(tooLarge),
        })
      ).status,
    ).toBe(413);
    auth.database.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(owner.id);
    expect((await fetch(`${root}${image.url}`, { headers: { Cookie: ownerCookie } })).status).toBe(
      401,
    );
  } finally {
    db.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
