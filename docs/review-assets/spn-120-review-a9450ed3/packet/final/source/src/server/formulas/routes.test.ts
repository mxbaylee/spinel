import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { createApp } from '../../../server/app.ts';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { guestCookieName } from '../workspace/links.ts';

test('formula HTTP routes require scoped credentials and origin, and never cache results', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-formula-http-'));
  const databasePath = join(directory, 'db.sqlite');
  await writeFile(join(directory, 'index.html'), 'Fixture');
  const app = await createApp({ databasePath, staticDirectory: directory });
  const database = openDatabase(databasePath);
  try {
    await new Promise<void>((ready) => app.server.listen(0, '127.0.0.1', ready));
    const origin = 'http://localhost:3000';
    const root = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const auth = new AuthStore(database);
    const owner = auth.createUser('Owner');
    const other = auth.createUser('Other');
    const admin = auth.createUser('Operator', true);
    const workspace = new WorkspaceStore(auth);
    const host = workspace.create(owner.id, { name: 'Report', kind: 'doc', parentId: null });
    const cookie = (user: string) => `${COOKIE_NAME}=${auth.createSession(user).token}`;
    const ownerCookie = cookie(owner.id);
    const headers = { Cookie: ownerCookie, Origin: origin, 'Content-Type': 'application/json' };
    const endpoint = `${root}/api/items/${host.id}/formulas`;
    const post = (path: string, body: unknown, supplied = headers) =>
      fetch(`${endpoint}/${path}`, {
        method: 'POST',
        headers: supplied,
        body: JSON.stringify(body),
      });
    for (const [credential, status] of [
      ['', 401],
      [cookie(other.id), 404],
      [cookie(admin.id), 403],
    ] as const)
      expect(
        (await post('resolve', { expression: '=1+2' }, { ...headers, Cookie: credential })).status,
      ).toBe(status);
    expect(
      (
        await post(
          'resolve',
          { expression: '=1+2' },
          { ...headers, Origin: 'https://elsewhere.example' },
        )
      ).status,
    ).toBe(403);
    const resolved = await post('resolve', { expression: '={1,2;3,4}' });
    expect(resolved.status).toBe(200);
    expect(resolved.headers.get('cache-control')).toBe('no-store');
    const { definition } = await resolved.json();
    expect(definition).toEqual({ version: 1, expression: '={1,2;3,4}', references: [] });
    expect(
      await (
        await post('evaluate', { definition: { ...definition, cachedValue: 'SECRET' } })
      ).json(),
    ).toEqual({
      ok: false,
      reason: 'invalid-formula',
    });
    const link = workspace.links.begin(host.id, 'viewer');
    workspace.links.finish(host.id, link.epoch, true);
    const guest = workspace.links.exchange(host.id, link.token, undefined);
    const guestHeaders = { ...headers, Cookie: `${guestCookieName(host.id)}=${guest.token}` };
    const guestEndpoint = `${root}/api/guest/${host.id}/formulas`;
    // There is no guest catalog route; the ordinary account API rejects a guest-only cookie.
    expect((await fetch(`${guestEndpoint}/sources`, { headers: guestHeaders })).status).toBe(401);
    const calculated = await fetch(`${guestEndpoint}/evaluate`, {
      method: 'POST',
      headers: guestHeaders,
      body: JSON.stringify({ definition }),
    });
    expect(calculated.status).toBe(200);
    expect(calculated.headers.get('cache-control')).toBe('no-store');
    expect(await calculated.json()).toEqual({
      ok: true,
      kind: 'table',
      rows: [
        [1, 2],
        [3, 4],
      ],
    });
    workspace.links.begin(host.id, null);
    expect(
      (
        await fetch(`${guestEndpoint}/evaluate`, {
          method: 'POST',
          headers: guestHeaders,
          body: JSON.stringify({ definition }),
        })
      ).status,
    ).toBe(404);
  } finally {
    database.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 20000);
