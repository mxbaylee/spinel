import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { IDocumentData } from '@univerjs/core';
import { afterEach, expect, test, vi } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { cookieToken } from '../auth/routes.ts';
import { AuthError, AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { AccessTokens } from '../auth/tokens.ts';
import { CollaborationGenerations } from '../collaboration/generations.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import {
  createHistoryReadContext,
  resolveDocument,
  validateDocumentCredentials,
} from '../workspace/document-access.ts';
import { DocumentStore } from '../workspace/documents.ts';
import { guestCookieName } from '../workspace/links.ts';
import { migrateSpaceSchema } from '../workspace/space-schema.ts';
import { SpaceStore } from '../workspace/spaces.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { DAY } from './policy.ts';
import { historyRoutes } from './routes.ts';
import { HistoryStore } from './store.ts';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

function fixture(spacesEnabled = true) {
  const db = new DatabaseSync(':memory:');
  cleanup.push(() => db.close());
  const auth = new AuthStore(db);
  auth.now = () => Date.UTC(2026, 9, 22, 12);
  const workspace = new WorkspaceStore(auth, { spacesEnabled });
  migrateSpaceSchema(db);
  const owner = auth.createUser('Owner');
  const editor = auth.createUser('Editor');
  const viewer = auth.createUser('Viewer');
  const sessions = new Map(
    [owner, editor, viewer].map((user) => [user.id, auth.createSession(user.id)]),
  );
  const spaces = new SpaceStore(workspace);
  const space = spaces.createRoot(owner.id, { name: 'Project', parentId: null }).space;
  const folder = spaces.createChild(owner.id, space.id, {
    name: 'Section',
    kind: 'folder',
    parentId: space.id,
  }).item;
  const doc = spaces.createChild(owner.id, space.id, {
    name: 'Notes',
    kind: 'doc',
    parentId: folder.id,
  }).item;
  const sibling = spaces.createChild(owner.id, space.id, {
    name: 'Other notes',
    kind: 'doc',
    parentId: space.id,
  }).item;
  const other = spaces.createRoot(owner.id, { name: 'Another project', parentId: null }).space;
  spaces.share(owner.id, space.id, editor.id, 'editor');
  spaces.share(owner.id, space.id, viewer.id, 'viewer');
  new DocumentStore(workspace);
  db.exec(`CREATE TABLE workspace_collaboration (
    item_id TEXT PRIMARY KEY REFERENCES workspace_items(id), state TEXT NOT NULL
  ) STRICT;`);
  const snapshots = new Map<string, { snapshot: IDocumentData; revision: number }>();
  for (const item of [doc, sibling]) {
    snapshots.set(item.id, {
      snapshot: { id: item.id, documentStyle: {}, body: { dataStream: item.name + '\r\n' } },
      revision: 1,
    });
    db.prepare("INSERT INTO workspace_collaboration VALUES(?,'ready')").run(item.id);
  }
  const context = (user = owner.id, id = doc.id) => ({
    sessionHash: sessions.get(user)!.session.token_hash,
    spaceId: space.id,
    spaceItem: id,
  });
  const guest = (role: 'viewer' | 'editor' = 'editor') => {
    const link = workspace.links.begin(space.id, role);
    workspace.links.finish(space.id, link.epoch, true);
    const session = workspace.links.exchange(space.id, link.token!);
    const principal = workspace.links.principal(
      { cookie: `${guestCookieName(space.id)}=${session.token}` },
      space.id,
    );
    return {
      user: principal.userId,
      custom: {
        guestHash: principal.guestHash,
        guestItem: space.id,
        spaceId: space.id,
        spaceItem: doc.id,
      },
    };
  };
  const generations = new CollaborationGenerations(workspace);
  let prepared:
    ((user: string, id: string, custom: Record<string, unknown>) => Promise<void>) | undefined;
  type Submission = Parameters<CollaborationStore['onSubmitting']>[0];
  let submitting: Submission | undefined;
  const read = (user: string, id: string, custom: Record<string, unknown> = {}) => ({
    ...structuredClone(snapshots.get(id)!),
    access: resolveDocument(workspace, user, id, 'read', custom).access,
  });
  const load = vi.fn(async (user: string, id: string, custom: Record<string, unknown> = {}) =>
    read(user, id, custom),
  );
  const getUnit = vi.fn(async (_context: unknown, unitId: string) => {
    const generation = generations.resolve(unitId);
    const snapshot = generation && snapshots.get(generation.itemId);
    return snapshot ? { headRevision: snapshot.revision - generation!.offset } : undefined;
  });
  const prepare = vi.fn(async (user: string, id: string, custom: Record<string, unknown> = {}) => {
    resolveDocument(workspace, user, id, 'read', custom);
    db.prepare("INSERT OR REPLACE INTO workspace_collaboration VALUES(?,'ready')").run(id);
    await prepared!(user, id, custom);
  });
  // Exercise real history storage, authorization and generation transactions;
  // the native engine itself is covered by the collaboration integration tests.
  const restore = vi.fn(async (...args: Parameters<CollaborationStore['restore']>) => {
    const [
      user,
      id,
      expectedUnit,
      requestId,
      checkpoint,
      snapshot,
      before,
      checkSession,
      custom = {},
    ] = args;
    const job = generations.begin(user, id, expectedUnit, requestId, checkpoint, custom);
    const current = await load(user, id, custom);
    const preserve = await before(current);
    const finished = generations.finish(job.id, current.revision, preserve, checkSession, custom);
    snapshots.set(id, {
      snapshot: { ...snapshot, id } as IDocumentData,
      revision: finished.revision!,
    });
    return finished;
  });
  const collaboration = {
    onPrepared: (callback: typeof prepared) => {
      prepared = callback;
      return { dispose() {} };
    },
    itemForUnit: (id: string) => generations.resolve(id)?.itemId ?? id,
    onSubmitting: (callback: Submission) => {
      submitting = callback;
      return { dispose() {} };
    },
    onCommitted: () => ({ dispose() {} }),
    headRevision: async (user: string, unit: string, custom: Record<string, unknown>) =>
      (await getUnit({ userID: user, customData: custom, request: {} }, unit))?.headRevision,
    generations,
    load,
    prepare,
    restore,
  } as unknown as CollaborationStore;
  const history = new HistoryStore(workspace, collaboration);
  cleanup.push(() => history.close());
  const seed = (revision: number, id = doc.id) => {
    const checkpoint = randomUUID();
    db.prepare('INSERT INTO history_checkpoints VALUES(?,?,?,?,?,NULL,?)').run(
      checkpoint,
      id,
      'collaboration',
      revision,
      auth.now() - 2 * DAY,
      gzipSync(JSON.stringify({ id, body: { dataStream: `Version ${revision}\r\n` } })),
    );
    return checkpoint;
  };
  const rows = (id = doc.id) =>
    db.prepare('SELECT * FROM history_checkpoints WHERE item_id=? ORDER BY revision').all(id);
  return {
    db,
    auth,
    workspace,
    owner,
    editor,
    viewer,
    sessions,
    spaces,
    space,
    folder,
    doc,
    sibling,
    other,
    context,
    guest,
    snapshots,
    generations,
    read,
    load,
    getUnit,
    prepare,
    restore,
    collaboration,
    history,
    seed,
    rows,
    prepared: (user: string, id: string, custom: Record<string, unknown>) =>
      prepared!(user, id, custom),
    submit: async (
      user: string,
      id: string,
      custom: Record<string, unknown>,
      next: () => Promise<void>,
    ) => {
      await submitting!({ userID: user, customData: custom }, id);
      await next();
    },
  };
}

test('Space history is account-only and binds every checkpoint to its exact root and child', async () => {
  const f = fixture();
  const version = await f.history.nameCurrent(
    f.editor.id,
    f.doc.id,
    'Approved',
    undefined,
    f.context(f.editor.id),
  );
  expect(f.history.list(f.viewer.id, f.doc.id, f.context(f.viewer.id))).toEqual([
    expect.objectContaining({ id: version.id, name: 'Approved' }),
  ]);
  expect((await f.history.load(f.viewer.id, f.doc.id, version.id, f.context(f.viewer.id))).id).toBe(
    f.doc.id,
  );
  expect(() =>
    f.history.rename(f.viewer.id, f.doc.id, version.id, 'Denied', f.context(f.viewer.id)),
  ).toThrow();
  f.history.rename(f.editor.id, f.doc.id, version.id, 'Renamed', f.context(f.editor.id));
  expect(f.history.list(f.owner.id, f.doc.id, f.context())[0].name).toBe('Renamed');
  for (const custom of [
    {},
    { sessionHash: f.context().sessionHash },
    { ...f.context(), spaceId: f.other.id },
    { ...f.context(), spaceItem: f.sibling.id },
    { ...f.context(), guestHash: undefined },
  ])
    expect(() => f.history.list(f.owner.id, f.doc.id, custom)).toThrow();
  await expect(
    f.history.load(f.owner.id, f.sibling.id, version.id, f.context(f.owner.id, f.sibling.id)),
  ).rejects.toMatchObject({ status: 404 });
  const guest = f.guest();
  const tokens = new AccessTokens(f.auth);
  const token = tokens.create(f.editor.id, 'Assistant');
  const mcp = {
    mcpTokenHash: tokens.authenticate(token.token).hash,
    spaceId: f.space.id,
    spaceItem: f.doc.id,
  };
  const background = createHistoryReadContext(f.workspace, f.owner.id, f.space.id, f.doc.id);
  for (const [user, custom] of [
    [guest.user, guest.custom],
    [f.editor.id, mcp],
    [f.owner.id, background],
  ] as const) {
    expect(() => f.history.list(user, f.doc.id, custom)).toThrow();
    await expect(f.history.load(user, f.doc.id, version.id, custom)).rejects.toThrow();
    await expect(
      f.history.nameCurrent(user, f.doc.id, 'Denied', undefined, custom),
    ).rejects.toThrow();
    await expect(
      f.history.restore(user, f.doc.id, version.id, f.doc.id, randomUUID(), undefined, custom),
    ).rejects.toThrow();
  }
  expect(f.restore).not.toHaveBeenCalled();
});

test('prepared and raw edit baselines retain the originating guest credentials without granting public history', async () => {
  const f = fixture();
  const guest = f.guest();
  await f.prepared(guest.user, f.doc.id, guest.custom);
  expect(f.rows()).toHaveLength(1);
  expect(f.load).toHaveBeenCalledWith(guest.user, f.doc.id, guest.custom);
  expect(() => f.history.list(guest.user, f.doc.id, guest.custom)).toThrow();
  const next = vi.fn(async () => {});
  await f.submit(guest.user, f.doc.id, guest.custom, next);
  expect(next).toHaveBeenCalledOnce();
  f.workspace.links.begin(f.space.id, null);
  await expect(f.submit(guest.user, f.doc.id, guest.custom, next)).rejects.toThrow();
  expect(next).toHaveBeenCalledOnce();
  expect(f.rows()).toHaveLength(1);
});

test('coalesced capture independently checks every waiting account session', async () => {
  const f = fixture();
  const gate = Promise.withResolvers<void>();
  f.load.mockImplementationOnce(async (user, id, custom) => {
    const value = f.read(user, id, custom);
    await gate.promise;
    return value;
  });
  const first = f.history.capture(f.owner.id, f.doc.id, 'collaboration', f.context());
  const waiter = f.history.capture(f.editor.id, f.doc.id, 'collaboration', f.context(f.editor.id));
  const refused = expect(waiter).rejects.toMatchObject({ status: 401 });
  f.auth.revokeSession(f.sessions.get(f.editor.id)!.session.token_hash);
  gate.resolve();
  await first;
  await refused;
  expect(f.load).toHaveBeenCalledOnce();
  expect(f.rows()).toHaveLength(1);
});

test('capture rejects a revoked originating session or a replaced generation while awaiting native data', async () => {
  for (const change of ['session', 'generation'] as const) {
    const f = fixture();
    const gate = Promise.withResolvers<void>();
    f.load.mockImplementationOnce(async (user, id, custom) => {
      const value = f.read(user, id, custom);
      await gate.promise;
      return value;
    });
    const custom = f.context();
    const pending = f.history.capture(f.owner.id, f.doc.id, 'collaboration', custom);
    const refused = expect(pending).rejects.toMatchObject({
      status: change === 'session' ? 401 : 409,
    });
    if (change === 'session') {
      f.auth.revokeSession(f.sessions.get(f.owner.id)!.session.token_hash);
      // Replacing a mutable caller's credentials cannot rescue the original request.
      custom.sessionHash = f.auth.createSession(f.owner.id).session.token_hash;
    } else
      f.db.prepare('INSERT INTO spinel_live_units VALUES(?,?,?)').run(f.doc.id, randomUUID(), 4);
    gate.resolve();
    await refused;
    expect(f.rows()).toEqual([]);
  }
});

test('naming and decompression recheck Space role, session and live ancestry after yielding', async () => {
  const f = fixture();
  const checkpoint = f.seed(1);
  const naming = f.history.nameCurrent(
    f.editor.id,
    f.doc.id,
    'Late name',
    undefined,
    f.context(f.editor.id),
  );
  await Promise.resolve();
  f.spaces.share(f.owner.id, f.space.id, f.editor.id, 'viewer');
  await expect(naming).rejects.toMatchObject({ status: 403 });
  expect(f.rows()[0].name).toBeNull();
  const opening = f.history.load(f.viewer.id, f.doc.id, checkpoint, f.context(f.viewer.id));
  f.db
    .prepare('UPDATE workspace_items SET trashed_at=?,trash_batch=? WHERE id=?')
    .run(f.auth.now(), randomUUID(), f.folder.id);
  await expect(opening).rejects.toMatchObject({ status: 404 });
  expect(f.rows()).toHaveLength(1);
});

test('a generation change during version naming cannot label the previous live generation as current', async () => {
  const f = fixture();
  const gate = Promise.withResolvers<void>();
  f.load.mockImplementationOnce(async (user, id, custom) => {
    const value = f.read(user, id, custom);
    await gate.promise;
    return value;
  });
  const naming = f.history.nameCurrent(
    f.editor.id,
    f.doc.id,
    'Changed',
    undefined,
    f.context(f.editor.id),
  );
  f.db.prepare('INSERT INTO spinel_live_units VALUES(?,?,?)').run(f.doc.id, randomUUID(), 7);
  gate.resolve();
  await expect(naming).rejects.toMatchObject({ status: 409 });
  expect(f.rows()).toEqual([]);
});

test('restore carries the account scope into generation receipts and preserves the exact before-state', async () => {
  const f = fixture();
  const checkpoint = f.seed(1);
  f.snapshots.set(f.doc.id, {
    snapshot: { id: f.doc.id, documentStyle: {}, body: { dataStream: 'Before restore\r\n' } },
    revision: 4,
  });
  const request = randomUUID();
  const restored = await f.history.restore(
    f.editor.id,
    f.doc.id,
    checkpoint,
    f.doc.id,
    request,
    undefined,
    f.context(f.editor.id),
  );
  expect(restored.nextUnit).not.toBe(f.doc.id);
  expect(restored.revision).toBe(5);
  expect(f.restore.mock.calls[0].at(-1)).toEqual(f.context(f.editor.id));
  const before = f.history
    .list(f.viewer.id, f.doc.id, f.context(f.viewer.id))
    .find((point) => point.beforeRestore)!;
  expect(before.revision).toBe(4);
  expect(
    (await f.history.load(
      f.viewer.id,
      f.doc.id,
      before.id,
      f.context(f.viewer.id),
    )) as IDocumentData,
  ).toMatchObject({ body: { dataStream: 'Before restore\r\n' } });
  expect(
    await f.history.restore(
      f.editor.id,
      f.doc.id,
      checkpoint,
      f.doc.id,
      request,
      undefined,
      f.context(f.editor.id),
    ),
  ).toEqual(restored);
  expect(f.restore).toHaveBeenCalledOnce();
  f.spaces.share(f.owner.id, f.space.id, f.editor.id, 'viewer');
  await expect(
    f.history.restore(
      f.editor.id,
      f.doc.id,
      checkpoint,
      f.doc.id,
      request,
      undefined,
      f.context(f.editor.id),
    ),
  ).rejects.toThrow();
});

test('Space retention stays deferred until an enabled supported capture or metadata read succeeds', async () => {
  const disabled = fixture(false);
  disabled.seed(1);
  disabled.seed(2);
  const deferred = disabled.rows();
  await disabled.history.tick();
  disabled.history.prune();
  expect(disabled.rows()).toEqual(deferred);
  expect(disabled.getUnit).not.toHaveBeenCalled();
  const f = fixture();
  f.seed(1);
  f.seed(2);
  f.history.prune();
  expect(f.rows()).toHaveLength(2);
  f.snapshots.get(f.doc.id)!.revision = 3;
  await f.history.tick();
  expect(f.rows().map((row) => row.revision)).toEqual([2, 3]);
  const metadata = f.getUnit.mock.calls.find(([, id]) => id === f.doc.id)![0] as {
    userID: string;
    customData: Record<string, unknown>;
  };
  expect(metadata.customData).toMatchObject({ spaceId: f.space.id, spaceItem: f.doc.id });
  expect(metadata.customData).not.toHaveProperty('sessionHash');
  expect(validateDocumentCredentials(f.workspace, metadata.userID, metadata.customData)).toBe(
    'history',
  );
  expect(() =>
    resolveDocument(f.workspace, metadata.userID, f.doc.id, 'edit', metadata.customData),
  ).toThrow();
  expect(() =>
    resolveDocument(f.workspace, metadata.userID, f.sibling.id, 'read', metadata.customData),
  ).toThrow();
});

test('disabled owners, trashed ancestors and post-await revocation preserve deferred Space checkpoints', async () => {
  for (const change of ['disabled', 'trashed', 'moved'] as const) {
    const f = fixture();
    f.seed(1);
    f.seed(2);
    const before = f.rows();
    const gate = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const original = f.getUnit.getMockImplementation()!;
    f.getUnit.mockImplementation(async (context, unit) => {
      const value = await original(context, unit);
      if (unit === f.doc.id) {
        entered.resolve();
        await gate.promise;
      }
      return value;
    });
    const scan = f.history.tick();
    await entered.promise;
    if (change === 'disabled')
      f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
    else if (change === 'trashed')
      f.db
        .prepare('UPDATE workspace_items SET trashed_at=?,trash_batch=? WHERE id=?')
        .run(f.auth.now(), randomUUID(), f.folder.id);
    else f.db.prepare('UPDATE workspace_items SET space_id=? WHERE id=?').run(f.other.id, f.doc.id);
    gate.resolve();
    await scan;
    expect(f.rows()).toEqual(before);
    expect(
      f.db
        .prepare("SELECT 1 FROM history_progress WHERE item_id=? AND source='collaboration'")
        .get(f.doc.id),
    ).toBeUndefined();
  }
});

test('the scoped history router preserves account, child and session checks around every response', async () => {
  const f = fixture();
  const app = express();
  app.use((request, response, next) => {
    response.set('Cache-Control', 'no-store');
    if (request.method !== 'GET' && request.headers.origin !== 'https://spinel.example')
      throw new AuthError(403, 'Wrong origin.');
    next();
  });
  app.use(
    '/spaces/:spaceId/items/:itemId/history',
    historyRoutes(f.workspace, f.collaboration, f.history, (request) => {
      const session = f.auth.session(cookieToken(request));
      if (!session?.user_id) throw new AuthError(401, 'Sign in to continue.');
      return {
        userId: session.user_id,
        itemId: String(request.params.itemId),
        customData: {
          sessionHash: session.token_hash,
          spaceId: String(request.params.spaceId),
          spaceItem: String(request.params.itemId),
        },
      };
    }),
  );
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    response
      .status(error instanceof AuthError ? error.status : 500)
      .json({ error: error instanceof Error ? error.message : 'Failed.' });
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const path = `/spaces/${f.space.id}/items/${f.doc.id}/history`;
  const request = (suffix = '', user = f.editor.id, method = 'GET', body?: unknown) =>
    fetch(origin + path + suffix, {
      method,
      headers: {
        Cookie: `${COOKIE_NAME}=${f.sessions.get(user)!.token}`,
        Origin: 'https://spinel.example',
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const named = await request('', f.editor.id, 'POST', { name: 'Review' });
  expect(named.status).toBe(201);
  const version = (await named.json()).version;
  const list = await request('', f.viewer.id);
  expect(list.headers.get('Cache-Control')).toBe('no-store');
  expect(await list.json()).toMatchObject({ canName: false, versions: [{ id: version.id }] });
  expect((await request(`/${version.id}`, f.viewer.id)).status).toBe(200);
  expect((await request(`/${version.id}`, f.viewer.id, 'PATCH', { name: 'Denied' })).status).toBe(
    403,
  );
  expect(
    (await request('', f.editor.id, 'POST', { name: 'Denied', spaceId: f.other.id })).status,
  ).toBe(400);
  f.auth.revokeSession(f.sessions.get(f.editor.id)!.session.token_hash);
  expect((await request(`/${version.id}`)).status).toBe(401);
});
