import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Response } from 'express';
import { afterEach, expect, test, vi } from 'vitest';
import type { IWorkbookData } from '@univerjs/core';
import { SetRangeValuesMutation } from '@univerjs/sheets';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore, randomToken } from '../auth/store.ts';
import { AssistantOAuth } from '../auth/oauth.ts';
import { AccessTokens } from '../auth/tokens.ts';
import { CollaborationStore } from '../collaboration/service.ts';
import { McpDocuments } from '../mcp/documents.ts';
import type { TokenIdentity } from '../mcp/documents.ts';
import { migrateSpaceSchema } from '../workspace/space-schema.ts';
import { SpaceStore } from '../workspace/spaces.ts';
import { WorkspaceStore } from '../workspace/store.ts';

vi.setConfig({ testTimeout: 20_000 });
const cleanup: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture(space = false) {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-sync-mcp-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'app.sqlite');
  const db = openDatabase(path);
  cleanup.push(() => {
    if (db.isOpen) db.close();
  });
  let clock = Date.UTC(2026, 9, 26, 12);
  const auth = new AuthStore(db, () => clock);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  migrateSpaceSchema(db);
  const owner = auth.createUser('Owner'),
    editor = auth.createUser('Editor');
  const sessions = new Map(
    [owner, editor].map((user) => [user.id, auth.createSession(user.id).session]),
  );
  const spaces = new SpaceStore(workspace);
  const root = space
    ? spaces.createRoot(owner.id, { name: 'Project', parentId: null }).space
    : undefined;
  const item = root
    ? spaces.createChild(owner.id, root.id, { name: 'Budget', kind: 'sheet', parentId: root.id })
        .item
    : workspace.create(owner.id, { name: 'Budget', kind: 'sheet', parentId: null });
  if (root) spaces.share(owner.id, root.id, editor.id, 'editor');
  else workspace.share(owner.id, item.id, editor.id, 'editor');
  const custom = (user = owner.id) => ({
    sessionHash: sessions.get(user)!.token_hash,
    ...(root && { spaceId: root.id, spaceItem: item.id }),
  });
  const collab = new CollaborationStore(workspace, path, { syncServer: true });
  cleanup.push(() => collab.close());
  const documents = new McpDocuments(workspace, collab);
  const oauth = new AssistantOAuth(auth, 'https://spinel.example');
  const client = oauth.clientsStore.registerClient({
    client_name: 'Integration test assistant',
    redirect_uris: ['https://client.example/callback'],
    token_endpoint_auth_method: 'none',
  });
  const resource = new URL(oauth.resource);
  const connect = async (scopes = ['documents:read', 'documents:write']) => {
    let destination = '';
    const response = {
      redirect(_status: number, url: string) {
        destination = url;
      },
    } as unknown as Response;
    await oauth.authorize(
      client,
      {
        redirectUri: client.redirect_uris[0],
        codeChallenge: randomToken(),
        state: 'test-state',
        scopes,
        resource,
      },
      response,
    );
    const request = new URL(destination, oauth.origin).searchParams.get('request')!;
    const callback = new URL(oauth.consent(request, sessions.get(editor.id)!, true).redirect);
    const tokens = await oauth.exchangeAuthorizationCode(
      client,
      callback.searchParams.get('code')!,
      undefined,
      client.redirect_uris[0],
      resource,
    );
    return { tokens, identity: oauth.authenticate(tokens.access_token) };
  };
  const edit = async (identity: TokenIdentity, value = 99) => {
    const read = await documents.readSheet(identity, { id: item.id });
    return {
      id: item.id,
      unitId: read.unitId,
      revision: read.revision,
      requestId: randomUUID(),
      sheetId: 'first',
      cells: [{ row: 0, column: 0, value }],
    };
  };
  const load = () => collab.load(owner.id, item.id, custom());
  return {
    db,
    auth,
    workspace,
    spaces,
    root,
    owner,
    editor,
    item,
    custom,
    collab,
    documents,
    oauth,
    client,
    resource,
    connect,
    edit,
    load,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

for (const space of [false, true]) {
  const scope = space ? 'Space' : 'ordinary';

  test(`${scope}: MCP refresh retries return the same durable edit without a second revision`, async () => {
    const f = await fixture(space);
    const connection = await f.connect();
    const edit = await f.edit(connection.identity);
    expect(await f.documents.edit(connection.identity, 'sheet', edit)).toMatchObject({
      revision: 2,
      status: 'committed',
    });
    const refreshed = await f.oauth.exchangeRefreshToken(
      f.client,
      connection.tokens.refresh_token!,
      undefined,
      f.resource,
    );
    const renewed = f.oauth.authenticate(refreshed.access_token);
    expect(renewed.hash).not.toBe(connection.identity.hash);
    expect(renewed.connectionId).toBe(connection.identity.connectionId);
    expect(await f.documents.edit(renewed, 'sheet', edit)).toMatchObject({
      revision: 2,
      status: 'already-committed',
    });
    expect((await f.load()).revision).toBe(2);
    expect(f.db.prepare('SELECT count(*) AS n FROM spinel_sync_revisions').get()!.n).toBe(1);
    f.oauth.disconnect(f.editor.id, renewed.connectionId);
    await expect(f.documents.edit(renewed, 'sheet', edit)).rejects.toThrow();
    expect((await f.load()).revision).toBe(2);
  });

  test(`${scope}: a human edit after MCP validation causes a revision conflict (409) without transformation`, async () => {
    const f = await fixture(space);
    const connection = await f.connect();
    const edit = await f.edit(connection.identity);
    const original = f.collab.submitChangeset.bind(f.collab);
    let inserted = false;
    vi.spyOn(f.collab, 'submitChangeset').mockImplementation(async (input, context) => {
      if (!inserted) {
        inserted = true;
        await f.collab.submitSync(
          {
            unitId: input.changeset.unitID,
            baseRevision: input.changeset.baseRev,
            mutationId: randomUUID(),
            mutations: [
              {
                id: SetRangeValuesMutation.id,
                params: {
                  unitId: input.changeset.unitID,
                  subUnitId: 'first',
                  cellValue: { 0: { 0: { v: 44 } } },
                },
              },
            ],
          },
          { userID: f.owner.id, customData: f.custom() },
        );
      }
      return original(input, context);
    });
    await expect(f.documents.edit(connection.identity, 'sheet', edit)).rejects.toMatchObject({
      status: 409,
    });
    expect(inserted).toBe(true);
    expect((await f.load()).revision).toBe(2);
    expect(((await f.load()).snapshot as IWorkbookData).sheets.first.cellData?.[0]?.[0]?.v).toBe(
      44,
    );
    expect(f.db.prepare('SELECT count(*) AS n FROM spinel_sync_revisions').get()!.n).toBe(1);
  });

  for (const revoked of ['expiry', 'scope', 'disconnect', 'account', 'grant'] as const) {
    test(`${scope}: OAuth ${revoked} change after admission is refused at the final own-server boundary`, async () => {
      const f = await fixture(space);
      const connection = await f.connect();
      const edit = await f.edit(connection.identity);
      let reached = false;
      f.collab.onSubmitting(async () => {
        reached = true;
        if (revoked === 'expiry') f.advance(15 * 60_000 + 1);
        if (revoked === 'scope') {
          // Change the current stored authority after the tool's initial scope
          // check. The final guard must reread it, not trust the earlier identity.
          f.db
            .prepare('UPDATE oauth_access SET scopes=? WHERE id=?')
            .run(JSON.stringify(['documents:read']), connection.identity.id);
        }
        if (revoked === 'disconnect')
          f.oauth.disconnect(f.editor.id, connection.identity.connectionId);
        if (revoked === 'account')
          f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.editor.id);
        if (revoked === 'grant') {
          if (f.root) f.spaces.share(f.owner.id, f.root.id, f.editor.id, null);
          else f.workspace.share(f.owner.id, f.item.id, f.editor.id, null);
        }
        await Promise.resolve();
      });
      const committed = vi.fn();
      f.collab.onCommitted(committed);
      await expect(f.documents.edit(connection.identity, 'sheet', edit)).rejects.toThrow();
      expect(reached).toBe(true);
      expect(committed).not.toHaveBeenCalled();
      expect((await f.load()).revision).toBe(1);
      expect(f.db.prepare('SELECT count(*) AS n FROM spinel_sync_revisions').get()!.n).toBe(0);
    });
  }
}

test('read-only OAuth scope and wrong connection/resource never acquire write authority from the document grant', async () => {
  const f = await fixture(true);
  const connection = await f.connect(['documents:read']);
  const edit = await f.edit(connection.identity);
  await expect(f.documents.edit(connection.identity, 'sheet', edit)).rejects.toMatchObject({
    status: 403,
  });
  for (const identity of [
    { ...connection.identity, connectionId: randomUUID() },
    { ...connection.identity, resource: 'https://other.example/mcp' },
  ]) {
    await expect(f.documents.readSheet(identity, { id: f.item.id })).rejects.toThrow();
    await expect(f.documents.edit(identity, 'sheet', edit)).rejects.toThrow();
  }
  expect((await f.load()).revision).toBe(1);
});

test('a personal access token revoked during own-server preparation cannot commit its MCP write', async () => {
  const f = await fixture();
  const tokens = new AccessTokens(f.auth);
  const issued = tokens.create(f.editor.id, 'Assistant');
  const identity = tokens.authenticate(issued.token);
  const edit = await f.edit(identity);
  let reached = false;
  f.collab.onSubmitting(async () => {
    reached = true;
    tokens.revoke(f.editor.id, issued.id);
  });
  await expect(f.documents.edit(identity, 'sheet', edit)).rejects.toThrow();
  expect(reached).toBe(true);
  expect((await f.load()).revision).toBe(1);
  expect(f.db.prepare('SELECT count(*) AS n FROM spinel_sync_revisions').get()!.n).toBe(0);
});
