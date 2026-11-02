import express from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';
import { WorkspaceFiles } from './files.ts';
import { SpaceStore } from './spaces.ts';
import { migrateSpaceSchema } from './space-schema.ts';
import { workspaceRoutes } from './routes.ts';

test('access details are account-only, uncached, scoped and reauthorized without leaking private ancestry', async () => {
  const database = new DatabaseSync(':memory:');
  const auth = new AuthStore(database);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  migrateSpaceSchema(database);
  const files = new WorkspaceFiles(workspace);
  const spaces = new SpaceStore(workspace);
  const owner = auth.createUser('Owner');
  const reader = auth.createUser('Collaborator');
  const operator = auth.createUser('Operator', true);
  const privateFolder = workspace.create(owner.id, {
    name: 'Private folder',
    kind: 'folder',
    parentId: null,
  });
  const folder = workspace.create(owner.id, {
    name: 'Budgets',
    kind: 'folder',
    parentId: privateFolder.id,
  });
  const doc = workspace.create(owner.id, { name: 'Report', kind: 'doc', parentId: folder.id });
  workspace.share(owner.id, folder.id, reader.id, 'editor');
  const space = spaces.createRoot(owner.id, { name: 'Household', parentId: folder.id }).space;
  const child = spaces.createChild(owner.id, space.id, {
    name: 'Checklist',
    kind: 'doc',
    parentId: space.id,
  }).item;
  const app = express();
  app.use('/api/items', workspaceRoutes(auth, 'http://localhost:3000', workspace));
  const server = createServer(app);
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/items`;
    const cookie = `${COOKIE_NAME}=${auth.createSession(reader.id).token}`;
    const request = (path: string, credential = cookie, headers: Record<string, string> = {}) =>
      fetch(`${base}${path}`, { headers: { Cookie: credential, ...headers } });
    const response = await request(`/${doc.id}/access`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      details: { access: 'editor', source: { kind: 'folder', id: folder.id, name: 'Budgets' } },
    });
    const scoped = await request(`/${child.id}/access?spaceId=${space.id}`);
    expect(scoped.status).toBe(200);
    expect(await scoped.json()).toEqual({
      details: {
        access: 'editor',
        source: { kind: 'folder', id: folder.id, name: 'Budgets' },
        space: { id: space.id, name: 'Household' },
      },
    });
    for (const suffix of [
      '?spaceId=',
      '?spaceId=invalid',
      `?spaceId=${space.id}&spaceId=${space.id}`,
      `?userId=${owner.id}`,
      `?spaceId=${space.id}&userId=${owner.id}`,
    ])
      expect((await request(`/${child.id}/access${suffix}`)).status).toBe(400);
    expect((await request(`/${child.id}/access`)).status).toBe(404);
    expect((await request(`/${doc.id}/access?spaceId=${space.id}`)).status).toBe(404);
    expect((await request(`/${doc.id}/access`, '')).status).toBe(401);
    expect(
      (
        await request(
          `/${doc.id}/access`,
          `${COOKIE_NAME}=${auth.createSession(operator.id).token}`,
        )
      ).status,
    ).toBe(403);
    expect(
      (await request(`/${doc.id}/access`, cookie, { 'x-spinel-offline-account': owner.id })).status,
    ).toBe(409);
    workspace.share(owner.id, doc.id, reader.id, 'viewer');
    workspace.share(owner.id, folder.id, reader.id, null);
    const direct = await request(`/${doc.id}/access`);
    expect(await direct.json()).toEqual({
      details: { access: 'viewer', source: { kind: 'direct' } },
    });
    const revoked = await request(`/${child.id}/access?spaceId=${space.id}`);
    expect(revoked.status).toBe(404);
    const deniedBody = JSON.stringify(await revoked.json());
    for (const value of [privateFolder.id, privateFolder.name, folder.id, folder.name, space.name])
      expect(deniedBody).not.toContain(value);
    files.share(owner.id, space.id, reader.id, 'viewer');
    const root = await request(`/${space.id}/access`);
    expect(await root.json()).toEqual({
      details: {
        access: 'viewer',
        source: { kind: 'direct' },
        space: { id: space.id, name: 'Household' },
      },
    });
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    database.close();
  }
});
