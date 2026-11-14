import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, test, vi } from 'vitest';
import { LocaleType } from '@univerjs/core';
import type { IWorkbookData } from '@univerjs/core';
import { openDatabase } from '../../../server/database.ts';
import { AuthError, AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { documentIdentity } from '../collaboration/identity.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import { guestCookieName } from '../workspace/links.ts';
import { migrateSpaceSchema } from '../workspace/space-schema.ts';
import { SpaceStore } from '../workspace/spaces.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { formulaRoutes } from './routes.ts';
import { formulaAdmission } from './admission.ts';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const db = openDatabase(':memory:');
  cleanup.push(() => db.close());
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  migrateSpaceSchema(db);
  const spaces = new SpaceStore(workspace);
  const owner = auth.createUser('Private owner identity');
  const other = auth.createUser('Other');
  const root = spaces.createRoot(owner.id, { name: 'Project', parentId: null }).space;
  const host = spaces.createChild(owner.id, root.id, {
    kind: 'doc',
    name: 'Report',
    parentId: root.id,
  }).item;
  const source = spaces.createChild(owner.id, root.id, {
    kind: 'sheet',
    name: 'Budget',
    parentId: root.id,
  }).item;
  const external = workspace.create(owner.id, {
    kind: 'sheet',
    name: 'Private external name',
    parentId: null,
  });
  const otherRoot = spaces.createRoot(owner.id, { name: 'Other project', parentId: null }).space;
  const outside = spaces.createChild(owner.id, otherRoot.id, {
    kind: 'sheet',
    name: 'Other source',
    parentId: otherRoot.id,
  }).item;
  const snapshot = (id: string): IWorkbookData => ({
    id,
    name: 'Workbook',
    appVersion: '1.1.0',
    locale: LocaleType.EN_US,
    styles: {},
    sheetOrder: ['summary'],
    sheets: { summary: { id: 'summary', name: 'Summary', cellData: { 0: { 0: { v: 42 } } } } },
  });
  const load = vi.fn(async (_user: string, id: string, _custom: Record<string, unknown>) => ({
    snapshot: snapshot(id),
    revision: 1,
    access: 'viewer',
  }));
  const collaboration = {
    prepare: vi.fn(async () => {}),
    load,
    generations: { active: (id: string) => ({ unitId: `unit-${id}` }), restoring: () => false },
  } as unknown as CollaborationStore;
  const app = express();
  const scoped = (request: Request) => ({
    spaceId: String(request.params.spaceId),
    spaceItem: String(request.params.itemId),
  });
  // Exercise the public Formula router's ingress contract with the real account
  // and root-guest identity selector. The full application owns Origin middleware.
  app.use(
    '/api/spaces/:spaceId/items/:itemId/formulas',
    formulaRoutes(
      workspace,
      collaboration,
      (request) => documentIdentity(workspace, request.headers, undefined, scoped(request)),
      false,
      'itemId',
    ),
  );
  app.use(
    '/api/guest-spaces/:spaceId/items/:itemId/formulas',
    formulaRoutes(
      workspace,
      collaboration,
      (request) =>
        documentIdentity(
          workspace,
          request.headers,
          String(request.params.spaceId),
          scoped(request),
        ),
      true,
      'itemId',
    ),
  );
  app.use(
    '/api/items/:id/formulas',
    formulaRoutes(workspace, collaboration, (request) =>
      documentIdentity(workspace, request.headers),
    ),
  );
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const status =
      error instanceof AuthError ? error.status : error instanceof SyntaxError ? 400 : 500;
    response
      .status(status)
      .json({ error: error instanceof AuthError ? error.message : 'Invalid request.' });
  });
  const server = createServer(app);
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cookie = (userId: string) => `${COOKIE_NAME}=${auth.createSession(userId).token}`;
  const ownerCookie = cookie(owner.id);
  const link = workspace.links.begin(root.id, 'editor');
  workspace.links.finish(root.id, link.epoch, true);
  const guest = workspace.links.exchange(root.id, link.token);
  const guestCookie = `${guestCookieName(root.id)}=${guest.token}`;
  const endpoint = `/api/spaces/${root.id}/items/${host.id}/formulas`;
  const guestEndpoint = `/api/guest-spaces/${root.id}/items/${host.id}/formulas`;
  const send = (
    path: string,
    credential: string,
    body?: unknown,
    contentType = 'application/json',
    signal?: AbortSignal,
  ) =>
    fetch(base + path, {
      signal,
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Cookie: credential,
        ...(body === undefined ? {} : { 'Content-Type': contentType }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return {
    db,
    workspace,
    spaces,
    owner,
    other,
    root,
    host,
    source,
    external,
    otherRoot,
    outside,
    load,
    snapshot,
    cookie,
    ownerCookie,
    guestCookie,
    guest,
    endpoint,
    guestEndpoint,
    send,
  };
}

test('Space Formula HTTP uses the exact child and namespace-selected credential family', async () => {
  const f = await fixture();
  const mixed = `${f.ownerCookie}; ${f.guestCookie}`;
  const discovery = await f.send(`${f.guestEndpoint}/sources`, mixed);
  expect(discovery.status).toBe(200);
  expect(discovery.headers.get('cache-control')).toBe('no-store');
  expect(await discovery.json()).toEqual({ sources: [{ itemId: f.source.id, name: 'Budget' }] });
  expect((await f.send(`${f.guestEndpoint}/sources`, f.ownerCookie)).status).toBe(404);
  expect((await f.send(`${f.endpoint}/sources`, f.guestCookie)).status).toBe(401);
  expect((await f.send(`${f.endpoint}/sources`, f.cookie(f.other.id))).status).toBe(404);
  const account = await f.send(`${f.endpoint}/sources`, mixed);
  expect((await account.json()).sources).toEqual(
    expect.arrayContaining([
      { itemId: f.external.id, name: 'Private external name' },
      { itemId: f.outside.id, name: 'Other source' },
    ]),
  );
  for (const path of [
    `/api/spaces/${f.otherRoot.id}/items/${f.host.id}/formulas/sources`,
    `/api/spaces/${f.root.id}/items/${f.external.id}/formulas/sources`,
    `/api/items/${f.host.id}/formulas/sources`,
    `/api/guest-spaces/${f.otherRoot.id}/items/${f.host.id}/formulas/sources`,
  ]) {
    const response = await f.send(path, mixed);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('Private');
  }
});

test('Space guest Formula HTTP supports picker resolution and refuses external IDs or body scope', async () => {
  const f = await fixture();
  const mixed = `${f.ownerCookie}; ${f.guestCookie}`;
  const worksheets = await f.send(`${f.guestEndpoint}/sources/${f.source.id}`, mixed);
  expect(await worksheets.json()).toEqual({ sheets: [{ sheetId: 'summary', name: 'Summary' }] });
  const resolved = await f.send(`${f.guestEndpoint}/resolve`, mixed, {
    expression: '=Budget.Summary.A1',
  });
  expect(resolved.status).toBe(200);
  expect(resolved.headers.get('cache-control')).toBe('no-store');
  const { definition } = await resolved.json();
  expect(definition.references[0]).toMatchObject({ itemId: f.source.id, sheetId: 'summary' });
  f.load.mockClear();
  for (const id of [f.external.id, f.outside.id]) {
    const response = await f.send(`${f.guestEndpoint}/sources/${id}`, mixed);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('Private');
    const denied = await f.send(`${f.guestEndpoint}/evaluate`, mixed, {
      definition: { ...definition, references: [{ ...definition.references[0], itemId: id }] },
    });
    expect(await denied.json()).toEqual({ ok: false, reason: 'private-source' });
  }
  expect(f.load).not.toHaveBeenCalled();
  expect(
    (
      await f.send(`${f.guestEndpoint}/resolve`, mixed, {
        expression: '=1',
        spaceId: f.otherRoot.id,
      })
    ).status,
  ).toBe(400);
  expect(
    (await f.send(`${f.guestEndpoint}/resolve`, mixed, { expression: '=1' }, 'text/plain')).status,
  ).toBe(400);
  const forged = await f.send(`${f.guestEndpoint}/evaluate`, mixed, {
    definition: { ...definition, cachedValue: 'DO NOT RETURN' },
  });
  expect(await forged.json()).toEqual({ ok: false, reason: 'invalid-formula' });
});

test('Space guest worksheet HTTP discards names loaded before root link revocation', async () => {
  const f = await fixture();
  f.load.mockImplementationOnce(async (_user, id) => {
    f.workspace.links.begin(f.root.id, null);
    return { snapshot: f.snapshot(id), revision: 1, access: 'viewer' };
  });
  const response = await f.send(
    `${f.guestEndpoint}/sources/${f.source.id}`,
    `${f.ownerCookie}; ${f.guestCookie}`,
  );
  expect(response.status).toBe(404);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.text()).not.toContain('Summary');
});

test('account, Space and root-guest routers share capacity; disconnect removes queued work and promotion reauthorizes', async () => {
  const f = await fixture();
  const ordinary = f.workspace.create(f.owner.id, {
    kind: 'doc',
    name: 'Ordinary',
    parentId: null,
  });
  const release = await formulaAdmission.acquire(() => {});
  const acquire = vi.spyOn(formulaAdmission, 'acquire');
  const controller = new AbortController();
  const cancelled = f.send(
    `${f.endpoint}/sources/${f.source.id}`,
    f.ownerCookie,
    undefined,
    'application/json',
    controller.signal,
  );
  const cancelledOutcome = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
  const requests: Promise<unknown>[] = [cancelledOutcome];
  try {
    await vi.waitFor(() => expect(acquire).toHaveBeenCalledTimes(1));
    const guest = f.send(`${f.guestEndpoint}/sources/${f.source.id}`, f.guestCookie);
    requests.push(guest);
    await vi.waitFor(() => expect(acquire).toHaveBeenCalledTimes(2));
    const overflow = await f.send(`/api/items/${ordinary.id}/formulas/resolve`, f.ownerCookie, {
      expression: '=1',
    });
    expect(overflow.status).toBe(429);
    expect(f.load).not.toHaveBeenCalled();
    const cancelledSignal = acquire.mock.calls[0][1]!;
    controller.abort();
    await cancelledOutcome;
    await vi.waitFor(() => expect(cancelledSignal.aborted).toBe(true));
    // Capacity is recovered immediately, while the actual active work still owns its permit.
    const saved = f.send(`/api/items/${ordinary.id}/formulas/resolve`, f.ownerCookie, {
      expression: '=1',
    });
    requests.push(saved);
    await vi.waitFor(() => expect(acquire).toHaveBeenCalledTimes(4));
    f.workspace.links.begin(f.root.id, null);
    release();
    const revoked = await guest;
    expect(revoked.status).toBe(404);
    expect(await revoked.text()).not.toContain('Summary');
    const resolved = await saved;
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toEqual({
      definition: { version: 1, expression: '=1', references: [] },
    });
    expect(f.load).not.toHaveBeenCalled();
  } finally {
    controller.abort();
    release();
    await Promise.allSettled(requests);
    acquire.mockRestore();
  }
});
