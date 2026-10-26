import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { getDocsEmptySnapshot, JSONX } from '@univerjs/core';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { RichTextEditingMutation } from '@univerjs/docs';
import { SetRangeValuesMutation } from '@univerjs/sheets';
import { UniverType } from '@univerjs/protocol';
import type { IChangeset } from '@univerjs/protocol';
import { isDiagnosticEvent } from '@spinel/diagnostics';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { AccessTokens } from '../auth/tokens.ts';
import { CollaborationStore } from '../collaboration/service.ts';
import { DocumentStore } from '../workspace/documents.ts';
import { guestCookieName } from '../workspace/links.ts';
import { migrateSpaceSchema } from '../workspace/space-schema.ts';
import { SpaceStore } from '../workspace/spaces.ts';
import { WorkspaceStore } from '../workspace/store.ts';

vi.setConfig({ testTimeout: 20_000 });
const cleanup: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture(space = false, syncServer = true) {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-owned-sync-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'app.sqlite');
  const db = openDatabase(path);
  cleanup.push(() => { if (db.isOpen) db.close(); });
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  migrateSpaceSchema(db);
  const owner = auth.createUser('Owner');
  const editor = auth.createUser('Editor');
  const viewer = auth.createUser('Viewer');
  const fileAdmin = auth.createUser('File admin');
  const operator = auth.createUser('Operator', true);
  const sessions = new Map([owner, editor, viewer, fileAdmin, operator].map((user) => [user.id, auth.createSession(user.id)]));
  const spaces = new SpaceStore(workspace);
  const root = space ? spaces.createRoot(owner.id, { name: 'Project', parentId: null }).space : undefined;
  const sheet = root
    ? spaces.createChild(owner.id, root.id, { name: 'Budget', kind: 'sheet', parentId: root.id }).item
    : workspace.create(owner.id, { name: 'Budget', kind: 'sheet', parentId: null });
  const doc = root
    ? spaces.createChild(owner.id, root.id, { name: 'Notes', kind: 'doc', parentId: root.id }).item
    : workspace.create(owner.id, { name: 'Notes', kind: 'doc', parentId: null });
  for (const [user, role] of [[editor, 'editor'], [viewer, 'viewer'], [fileAdmin, 'admin']] as const) {
    if (root) spaces.share(owner.id, root.id, user.id, role);
    else for (const item of [sheet, doc]) workspace.share(owner.id, item.id, user.id, role);
  }
  const custom = (user = owner.id, id = sheet.id): Record<string, unknown> => ({
    sessionHash: sessions.get(user)!.session.token_hash,
    ...(root && { spaceId: root.id, spaceItem: id }),
  });
  const diagnostics = vi.fn();
  let collab = new CollaborationStore(workspace, path, { syncServer, diagnostics });
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await collab.close(); } };
  cleanup.push(close);
  const restart = async () => {
    await close();
    collab = new CollaborationStore(workspace, path, { syncServer, diagnostics });
    closed = false;
    return collab;
  };
  const request = (value: string | number, column = 0, baseRevision = 1) => ({
    unitId: sheet.id,
    baseRevision,
    mutationId: randomUUID(),
    mutations: [{ id: SetRangeValuesMutation.id, params: {
      unitId: sheet.id, subUnitId: 'first',
      cellValue: { 0: { [column]: { v: value } } },
      trigger: 'sheet.command.set-range-values',
    } }],
  });
  const submit = (edit: ReturnType<typeof request>, user = owner.id, data = custom(user)) =>
    collab.submitSync(edit, { userID: user, customData: data });
  const load = () => collab.load(owner.id, sheet.id, custom());
  return { db, path, auth, workspace, spaces, root, owner, editor, viewer, fileAdmin, operator, sessions, custom, collab, diagnostics, restart, request, submit, load };
}

for (const space of [false, true]) {
  const scope = space ? 'Space' : 'ordinary';
  test(`${scope}: concurrent edits are durably ordered and retry after reconnect/restart cannot duplicate one`, async () => {
    const f = await fixture(space);
    await f.collab.prepare(f.owner.id, f.request(1).unitId, f.custom());
    const first = f.request('first', 0);
    const second = f.request('second', 1);
    const [a, b] = await Promise.all([f.submit(first), f.submit(second, f.editor.id)]);
    expect([a.edit.revision, b.edit.revision]).toEqual([2, 3]);
    expect(b.missing.map((edit) => edit.revision)).toEqual([2, 3]);
    expect(a.edit.mutations[0].params.trigger).toBe(first.mutations[0].params.trigger);
    expect((await f.load()).snapshot).toMatchObject({ sheets: { first: { cellData: { 0: { 0: { v: 'first' }, 1: { v: 'second' } } } } } });
    expect(await f.submit(first)).toMatchObject({ duplicate: true, edit: { revision: 2 } });
    await f.restart();
    expect(await f.submit(second, f.editor.id)).toMatchObject({ duplicate: true, edit: { revision: 3 } });
    expect((await f.load()).revision).toBe(3);
    expect(f.db.prepare('SELECT count(*) AS n FROM spinel_sync_revisions').get()!.n).toBe(2);
  });

  test(`${scope}: viewers and Operators are refused and audited; File admins may edit`, async () => {
    const f = await fixture(space);
    const id = f.request(1).unitId;
    await f.collab.prepare(f.owner.id, id, f.custom());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const user of [f.viewer, f.operator]) {
      await expect(f.submit(f.request('private refused edit'), user.id)).rejects.toThrow();
      expect(warn).toHaveBeenLastCalledWith(expect.stringContaining('collaboration.edit_denied'));
    }
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private refused edit');
    await expect(f.submit(f.request('allowed'), f.fileAdmin.id)).resolves.toMatchObject({ edit: { revision: 2 } });
    expect((await f.load()).revision).toBe(2);
  });

  for (const boundary of ['session', 'grant', 'epoch'] as const) {
    test(`${scope}: ${boundary} revocation during asynchronous preparation is checked again at commit`, async () => {
      const f = await fixture(space);
      const id = f.request(1).unitId;
      await f.collab.prepare(f.owner.id, id, f.custom());
      const entered = Promise.withResolvers<void>();
      const resume = Promise.withResolvers<void>();
      f.collab.onSubmitting(async () => { entered.resolve(); await resume.promise; });
      const committed = vi.fn();
      f.collab.onCommitted(committed);
      const result = f.submit(f.request('revoked'), f.editor.id);
      const rejected = expect(result).rejects.toThrow();
      await entered.promise;
      if (boundary === 'session') f.auth.revokeSession(f.sessions.get(f.editor.id)!.session.token_hash);
      if (boundary === 'grant') {
        if (f.root) f.spaces.share(f.owner.id, f.root.id, f.editor.id, null);
        else f.workspace.share(f.owner.id, id, f.editor.id, null);
      }
      if (boundary === 'epoch') {
        const root = f.root?.id ?? id;
        const off = f.workspace.links.begin(root, null);
        f.workspace.links.finish(root, off.epoch, false);
      }
      resume.resolve();
      await rejected;
      expect(committed).not.toHaveBeenCalled();
      expect((await f.load()).revision).toBe(1);
      expect(f.db.prepare('SELECT count(*) AS n FROM spinel_sync_revisions').get()!.n).toBe(0);
    });
  }

  test(`${scope}: root-scoped guest authority is preserved and revoked links cannot write`, async () => {
    const f = await fixture(space);
    const id = f.request(1).unitId;
    await f.collab.prepare(f.owner.id, id, f.custom());
    const root = f.root?.id ?? id;
    const link = f.workspace.links.begin(root, 'editor');
    f.workspace.links.finish(root, link.epoch, true);
    const session = f.workspace.links.exchange(root, link.token!);
    const principal = f.workspace.links.principal({ cookie: `${guestCookieName(root)}=${session.token}` }, root);
    const custom = { guestHash: principal.guestHash, guestItem: root, ...(f.root && { spaceId: root, spaceItem: id }) };
    await expect(f.submit(f.request('guest'), principal.userId, custom)).resolves.toMatchObject({ edit: { revision: 2 } });
    const off = f.workspace.links.begin(root, null);
    f.workspace.links.finish(root, off.epoch, false);
    await expect(f.submit(f.request('revoked', 1, 2), principal.userId, custom)).rejects.toThrow();
    expect((await f.load()).revision).toBe(2);
  });
}

test('Space native service never falls back from wrong, missing or mixed credentials to ordinary access', async () => {
  const f = await fixture(true);
  const id = f.request(1).unitId;
  await f.collab.prepare(f.owner.id, id, f.custom());
  const other = f.spaces.createRoot(f.owner.id, { name: 'Other', parentId: null }).space;
  for (const custom of [
    {}, { sessionHash: f.sessions.get(f.owner.id)!.session.token_hash },
    { ...f.custom(), spaceId: other.id }, { ...f.custom(), spaceItem: other.id },
    { ...f.custom(), guestHash: 'forged', guestItem: f.root!.id },
  ]) {
    await expect(f.collab.load(f.owner.id, id, custom)).rejects.toThrow();
    await expect(f.submit(f.request('forged scope'), f.owner.id, custom)).rejects.toThrow();
  }
  expect((await f.load()).revision).toBe(1);
});

test('cross-unit and unsupported mutations are refused without persistence or content-bearing diagnostics', async () => {
  const f = await fixture();
  const edit = f.request('private-cell-text');
  await f.collab.prepare(f.owner.id, edit.unitId, f.custom());
  edit.mutations[0].params.unitId = randomUUID();
  await expect(f.submit(edit)).rejects.toThrow();
  const unsupported = f.request('private-cell-text');
  unsupported.mutations[0].id = 'private-untrusted-command';
  await expect(f.submit(unsupported)).rejects.toThrow();
  expect((await f.load()).revision).toBe(1);
  expect(f.diagnostics.mock.calls.every(([event]) => isDiagnosticEvent(event))).toBe(true);
  expect(JSON.stringify(f.diagnostics.mock.calls)).not.toContain('private-cell-text');
  expect(JSON.stringify(f.diagnostics.mock.calls)).not.toContain('private-untrusted-command');
});

test('a candidate over 10 MiB and a failed SQLite commit leave the prior native state usable', async () => {
  const f = await fixture();
  const id = f.request(1).unitId;
  await f.collab.prepare(f.owner.id, id, f.custom());
  const large = 'x'.repeat(6 * 1024 * 1024);
  await f.submit(f.request(large));
  await expect(f.submit(f.request(large, 1, 2))).rejects.toThrow();
  expect((await f.load()).revision).toBe(2);
  expect(((await f.load()).snapshot as IWorkbookData).sheets.first.cellData?.[0]?.[1]).toBeUndefined();
  f.db.exec(`CREATE TEMP TRIGGER reject_owned_head BEFORE UPDATE ON spinel_sync_units
    BEGIN SELECT RAISE(ABORT,'simulated disk failure'); END;`);
  const retry = f.request('retry', 1, 2);
  await expect(f.submit(retry)).rejects.toThrow();
  expect((await f.load()).revision).toBe(2);
  f.db.exec('DROP TRIGGER reject_owned_head');
  await expect(f.submit(retry)).resolves.toMatchObject({ duplicate: false, edit: { revision: 3 } });
  expect(((await f.load()).snapshot as IWorkbookData).sheets.first.cellData?.[0]?.[1]?.v).toBe('retry');
});

test('MCP writes retain exact revision semantics and token-specific durable retry identity', async () => {
  const f = await fixture();
  const id = f.request(1).unitId;
  await f.collab.prepare(f.owner.id, id, f.custom());
  const tokens = new AccessTokens(f.auth);
  const token = tokens.create(f.owner.id, 'Assistant');
  const identity = tokens.authenticate(token.token);
  const edit = f.request('assistant');
  const changeset: IChangeset = {
    unitID: id, type: UniverType.UNIVER_SHEET, baseRev: 1, revision: 0,
    userID: f.owner.id, memberID: 'mcp:test', sid: 'mcp:test', reqId: 1,
    mutations: edit.mutations.map((mutation) => ({ id: mutation.id, data: JSON.stringify(mutation.params) })),
  };
  const context = { userID: f.owner.id, customData: { mcpTokenHash: identity.hash } };
  await expect(f.collab.submitChangeset({ changeset }, context)).resolves.toMatchObject({ changeset: { revision: 2 } });
  await expect(f.collab.submitChangeset({ changeset }, context)).resolves.toMatchObject({ status: 'duplicate', changeset: { revision: 2 } });
  await f.submit(f.request('human', 1, 2));
  await expect(f.collab.submitChangeset({ changeset: { ...changeset, reqId: 2 } }, context)).rejects.toThrow('stale');
  expect((await f.load()).revision).toBe(3);
  tokens.revoke(f.owner.id, token.id);
  await expect(f.collab.submitChangeset({ changeset }, context)).rejects.toThrow();
});

test('an enabled server prepares native Docs but refuses automatic migration of a legacy collaboration document', async () => {
  const f = await fixture();
  const doc = f.workspace.create(f.owner.id, { name: 'Native Doc', kind: 'doc', parentId: null });
  new DocumentStore(f.workspace).save(f.owner.id, doc.id, {
    snapshot: { ...getDocsEmptySnapshot(doc.id), body: { dataStream: 'Original\r\n' } },
    revision: 0, writeId: randomUUID(),
  });
  await f.collab.prepare(f.owner.id, doc.id, f.custom(f.owner.id, doc.id));
  const before = (await f.collab.load(f.owner.id, doc.id, f.custom(f.owner.id, doc.id))).snapshot as IDocumentData;
  await f.collab.submitSync({
    unitId: doc.id, baseRevision: 1, mutationId: randomUUID(), mutations: [{
      id: RichTextEditingMutation.id,
      params: { unitId: doc.id, actions: new JSONX().replaceOp(['body'], before.body, { dataStream: 'Changed\r\n' }), textRanges: [] },
    }],
  }, { userID: f.owner.id, customData: f.custom(f.owner.id, doc.id) });
  expect((await f.collab.load(f.owner.id, doc.id, f.custom(f.owner.id, doc.id))).snapshot).toMatchObject({ body: { dataStream: 'Changed\r\n' } });
  const legacy = f.workspace.create(f.owner.id, { name: 'Legacy', kind: 'sheet', parentId: null });
  f.db.prepare("INSERT INTO workspace_collaboration VALUES(?,'ready')").run(legacy.id);
  await expect(f.collab.prepare(f.owner.id, legacy.id, f.custom(f.owner.id, legacy.id))).rejects.toThrow('migration');
  expect(f.db.prepare('SELECT 1 FROM spinel_sync_units WHERE unit_id=?').get(legacy.id)).toBeUndefined();
});

test('the own server remains disabled unless explicitly enabled', async () => {
  const f = await fixture(false, false);
  expect(f.collab.sync).toBeUndefined();
  await expect(f.submit(f.request('not enabled'))).rejects.toThrow('unavailable');
  expect(f.db.prepare("SELECT 1 FROM sqlite_schema WHERE name='spinel_sync_units'").get()).toBeUndefined();
});
