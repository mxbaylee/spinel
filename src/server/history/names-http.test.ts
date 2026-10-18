import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { createApp } from '../../../server/app.ts';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';

test('history naming routes enforce current access, sessions, origin and document scope', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-names-http-'));
  const path = join(directory, 'db.sqlite');
  await writeFile(join(directory, 'index.html'), 'Fixture');
  const app = await createApp({ databasePath: path, staticDirectory: directory });
  const db = openDatabase(path);
  try {
    await new Promise<void>((ready) => app.server.listen(0, '127.0.0.1', ready));
    const root = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/items`;
    const auth = new AuthStore(db),
      workspace = new WorkspaceStore(auth);
    const owner = auth.createUser('Owner'),
      editor = auth.createUser('Editor'),
      viewer = auth.createUser('Viewer'),
      other = auth.createUser('Other'),
      admin = auth.createUser('Operator', true);
    const sessions = [owner, editor, viewer, other, admin].map((u) => auth.createSession(u.id));
    const request = (
      suffix: string,
      who = 0,
      method = 'GET',
      data?: unknown,
      origin = 'http://localhost:3000',
    ) =>
      fetch(root + suffix, {
        method,
        headers: {
          Cookie: who < 0 ? '' : `${COOKIE_NAME}=${sessions[who].token}`,
          Origin: origin,
          'Content-Type': 'application/json',
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
    const item = workspace.create(owner.id, { name: 'Named doc', kind: 'doc', parentId: null });
    const foreign = workspace.create(other.id, { name: 'Other doc', kind: 'doc', parentId: null });
    workspace.share(owner.id, item.id, editor.id, 'editor');
    workspace.share(owner.id, item.id, viewer.id, 'viewer');
    expect(
      (
        await request(`/${item.id}/doc`, 0, 'PUT', {
          snapshot: { id: item.id, body: { dataStream: 'Contents\r\n' } },
          revision: 0,
          writeId: randomUUID(),
        })
      ).ok,
    ).toBe(true);
    const result = await request(`/${item.id}/history`, 1, 'POST', { name: 'Checkpoint' });
    expect(result.status).toBe(201);
    const point = (await result.json()).version;
    const list = await request(`/${item.id}/history`, 2);
    expect(list.headers.get('cache-control')).toBe('no-store');
    expect(await list.json()).toMatchObject({
      canName: false,
      versions: [{ id: point.id, name: 'Checkpoint' }],
    });
    for (const who of [-1, 2, 3, 4]) {
      expect((await request(`/${item.id}/history`, who, 'POST', { name: 'Denied' })).ok).toBe(
        false,
      );
      expect(
        (await request(`/${item.id}/history/${point.id}`, who, 'PATCH', { name: null })).ok,
      ).toBe(false);
    }
    expect(
      (await request(`/${foreign.id}/history/${point.id}`, 3, 'PATCH', { name: 'Wrong doc' }))
        .status,
    ).toBe(404);
    expect(
      (
        await request(
          `/${item.id}/history/${point.id}`,
          1,
          'PATCH',
          { name: 'Bad origin' },
          'https://evil.example',
        )
      ).status,
    ).toBe(403);
    expect(
      (await request(`/${item.id}/history`, 0, 'POST', { name: ' ', unexpected: true })).status,
    ).toBe(400);
    workspace.share(owner.id, item.id, editor.id, null);
    expect((await request(`/${item.id}/history`, 1)).status).toBe(404);
    expect(
      (await request(`/${item.id}/history/${point.id}`, 0, 'PATCH', { name: 'Renamed' })).ok,
    ).toBe(true);
    auth.revokeSession(sessions[0].session.token_hash);
    expect((await request(`/${item.id}/history`, 0)).status).toBe(401);
  } finally {
    await app.close();
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
