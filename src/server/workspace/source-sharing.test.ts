import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { getDocsEmptySnapshot, JSONX } from '@univerjs/core';
import type { IDocumentBody, IDocumentData } from '@univerjs/core';
import { RichTextEditingMutation } from '@univerjs/docs';
import { docFormulas, formulaBody, parseFormula } from '@spinel/doc-formulas';
import { openDatabase } from '../../../server/database.ts';
import { AuthError, AuthStore, hashToken } from '../auth/store.ts';
import { CollaborationStore } from '../collaboration/service.ts';
import { DocFormulas } from '../formulas/service.ts';
import { resolveDocument } from './document-access.ts';
import { DocumentStore } from './documents.ts';
import { WorkspaceFiles } from './files.ts';
import { migrateSpaceSchema } from './space-schema.ts';
import { SpaceStore } from './spaces.ts';
import { SourceSharing, SOURCE_SHARING_LIMITS } from './source-sharing.ts';
import { WorkspaceStore } from './store.ts';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

function bodyFor(ids: string[]): IDocumentBody {
  const body: IDocumentBody = { dataStream: '', customRanges: [] };
  for (const [index, itemId] of ids.entries()) {
    const expression = `=Source${index}.Summary.A1`;
    const fragment = formulaBody(`formula-${index}`, {
      version: 1,
      expression,
      references: parseFormula(expression).map((reference) => ({
        start: reference.start,
        end: reference.end,
        range: reference.range,
        itemId,
        sheetId: 'summary',
      })),
    });
    body.customRanges!.push(
      ...fragment.customRanges!.map((range) => ({
        ...range,
        startIndex: range.startIndex + body.dataStream.length,
        endIndex: range.endIndex + body.dataStream.length,
      })),
    );
    body.dataStream += expression + ' ';
  }
  body.dataStream += '\r\n';
  return body;
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-source-sharing-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'db.sqlite');
  const db = openDatabase(path);
  cleanup.push(() => db.close());
  const auth = new AuthStore(db);
  const owner = auth.createUser('Owner');
  const recipient = auth.createUser('Recipient');
  const other = auth.createUser('Other owner');
  const operator = auth.createUser('Operator', true);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  migrateSpaceSchema(db);
  const files = new WorkspaceFiles(workspace);
  const spaces = new SpaceStore(workspace);
  const documents = new DocumentStore(workspace);
  const create = (
    kind: 'doc' | 'sheet' | 'folder',
    name: string,
    user = owner.id,
    parentId: string | null = null,
  ) => workspace.create(user, { kind, name, parentId });
  const host = create('doc', 'Report');
  const source = create('sheet', 'Budget');
  const second = create('sheet', 'Forecast');
  const collaboration = new CollaborationStore(workspace, path);
  cleanup.push(() => collaboration.close());
  const service = new SourceSharing(workspace, collaboration);
  const custom = (user = owner.id) => ({
    sessionHash: auth.createSession(user).session.token_hash,
  });
  const context = custom();
  const save = (id: string, ids: string[]) => {
    const previous = documents.load(owner.id, id);
    documents.save(owner.id, id, {
      snapshot: { ...getDocsEmptySnapshot(id), body: bodyFor(ids) },
      revision: previous.revision,
      writeId: randomUUID(),
    });
  };
  const native = async (id: string, ids: string[], spaceId?: string) => {
    const scope = spaceId ? { ...context, spaceId, spaceItem: id } : context;
    await collaboration.prepare(owner.id, id, scope);
    const before = await collaboration.load(owner.id, id, scope);
    const generation = collaboration.generations.active(id);
    await collaboration.submitSync(
      {
        unitId: generation.unitId,
        baseRevision: before.revision - generation.offset,
        mutationId: randomUUID(),
        mutations: [
          {
            id: RichTextEditingMutation.id,
            params: {
              unitId: generation.unitId,
              actions: new JSONX().replaceOp(
                ['body'],
                (before.snapshot as IDocumentData).body,
                bodyFor(ids),
              ),
              textRanges: [],
            },
          },
        ],
      },
      { userID: owner.id, customData: scope },
    );
  };
  const review = (role: 'viewer' | 'editor' | 'admin' | null = 'viewer', id = host.id) =>
    service.review(owner.id, id, recipient.id, role, context);
  const apply = (
    version: string,
    role: 'viewer' | 'editor' | 'admin' | null = 'viewer',
    id = host.id,
  ) => service.apply(owner.id, id, recipient.id, role, version, context);
  const grants = () => db.prepare('SELECT * FROM workspace_grants ORDER BY item_id,user_id').all();
  save(host.id, [source.id]);
  return {
    db,
    auth,
    owner,
    recipient,
    other,
    operator,
    workspace,
    files,
    spaces,
    documents,
    host,
    source,
    second,
    collaboration,
    service,
    custom,
    context,
    create,
    save,
    native,
    review,
    apply,
    grants,
  };
}

test('review is read-only, binds exact stable sources, and grants only explicit Viewer access', async () => {
  const f = await fixture();
  f.workspace.update(f.owner.id, f.second.id, { name: f.source.name });
  f.save(f.host.id, [f.source.id, f.second.id, f.source.id]);
  const before = f.grants();
  const review = f.review();
  expect(review.targets).toHaveLength(2);
  expect(review.targets.map((target) => target.id).sort()).toEqual(
    [f.source.id, f.second.id].sort(),
  );
  expect(review.targets.every((target) => target.state === 'grant' && target.access === null)).toBe(
    true,
  );
  expect(f.grants()).toEqual(before);
  const result = f.apply(review.version);
  expect(result.sourceOutcome).toMatchObject({ host: 'updated', complete: true, failed: [] });
  expect(result.sourceOutcome.shared.sort()).toEqual([f.source.id, f.second.id].sort());
  for (const id of [f.host.id, f.source.id, f.second.id])
    expect(f.files.get(f.recipient.id, id).access).toBe('viewer');
});

test('existing direct, inherited, File admin and recipient ownership access cause zero source writes', async () => {
  const f = await fixture();
  const folder = f.create('folder', 'Shared inputs');
  const inherited = f.create('sheet', 'Inherited', f.owner.id, folder.id);
  const owned = f.create('sheet', 'Recipient own source', f.recipient.id);
  const view = f.create('sheet', 'Already viewable');
  f.workspace.share(f.owner.id, f.source.id, f.recipient.id, 'editor');
  f.workspace.share(f.owner.id, f.second.id, f.recipient.id, 'admin');
  f.workspace.share(f.owner.id, folder.id, f.recipient.id, 'editor');
  f.workspace.share(f.recipient.id, owned.id, f.owner.id, 'viewer');
  f.workspace.share(f.owner.id, view.id, f.recipient.id, 'viewer');
  f.save(f.host.id, [f.source.id, f.second.id, inherited.id, owned.id, view.id]);
  const before = f.grants();
  const review = f.review();
  expect(new Set(review.targets.map((target) => target.access))).toEqual(
    new Set(['viewer', 'editor', 'admin', 'owner']),
  );
  expect(review.targets.every((target) => target.state === 'kept')).toBe(true);
  expect(f.apply(review.version).sourceOutcome.shared).toEqual([]);
  // Existing access and shared_at are part of the product contract, including
  // the absence of a direct grant when access is inherited or is ownership.
  expect(f.grants().filter((grant) => grant.item_id !== f.host.id)).toEqual(before);
});

test('an already-shared host accepts source-only additions without rewriting its grant', async () => {
  const f = await fixture();
  f.files.share(f.owner.id, f.host.id, f.recipient.id, 'editor');
  const before = f.grants().find((grant) => grant.item_id === f.host.id);
  const result = f.apply(f.review('editor').version, 'editor');
  expect(result.sourceOutcome).toMatchObject({ host: 'unchanged', shared: [f.source.id] });
  expect(f.grants().find((grant) => grant.item_id === f.host.id)).toEqual(before);
  expect(f.files.get(f.recipient.id, f.source.id).access).toBe('viewer');
});

test('No direct access may retain inherited host access but cannot add sources to an unreadable host', async () => {
  const f = await fixture();
  const none = f.review(null);
  expect(none.hostAccess).toBeNull();
  expect(() => f.apply(none.version, null)).toThrow('access to the report');
  expect(f.grants()).toEqual([]);
  const folder = f.create('folder', 'Shared reports');
  f.workspace.update(f.owner.id, f.host.id, { parentId: folder.id });
  f.files.share(f.owner.id, folder.id, f.recipient.id, 'viewer');
  f.files.share(f.owner.id, f.host.id, f.recipient.id, 'editor');
  const inherited = f.review(null);
  expect(inherited.hostAccess).toBe('viewer');
  f.apply(inherited.version, null);
  expect(f.files.get(f.recipient.id, f.host.id).access).toBe('viewer');
  expect(f.grants().some((grant) => grant.item_id === f.host.id)).toBe(false);
  expect(f.files.get(f.recipient.id, f.source.id).access).toBe('viewer');
});

test('known owner-required sources produce truthful partial results and private sources expose no metadata', async () => {
  const f = await fixture();
  const readable = f.create('sheet', 'Other owner budget', f.other.id);
  const privateSource = f.create('sheet', 'Never reveal this title', f.other.id);
  f.workspace.share(f.other.id, readable.id, f.owner.id, 'viewer');
  f.save(f.host.id, [f.source.id, readable.id, privateSource.id]);
  const review = f.review();
  expect(review.targets.find((target) => target.id === readable.id)?.state).toBe('requires-owner');
  expect(review.unavailable).toBe(true);
  expect(JSON.stringify(review)).not.toContain(privateSource.id);
  expect(JSON.stringify(review)).not.toContain(privateSource.name);
  const result = f.apply(review.version);
  expect(result.sourceOutcome).toMatchObject({
    shared: [f.source.id],
    failed: [readable.id],
    complete: false,
  });
  expect(f.files.get(f.recipient.id, f.host.id).access).toBe('viewer');
  expect(() => f.files.get(f.recipient.id, readable.id)).toThrow('not available');
  expect(() => f.files.get(f.recipient.id, privateSource.id)).toThrow('not available');
});

test('an unreadable source says nothing about recipient access, including recipient ownership', async () => {
  const f = await fixture();
  const owned = f.create('sheet', 'Recipient private title', f.recipient.id);
  f.save(f.host.id, [owned.id]);
  const review = f.review();
  expect(review).toMatchObject({ targets: [], unavailable: true });
  expect(JSON.stringify(review)).not.toContain(owned.id);
  expect(JSON.stringify(review)).not.toContain(owned.name);
  expect(f.files.get(f.recipient.id, owned.id).access).toBe('owner');
});

test.each(['name', 'dependencies', 'recipient-role', 'space-boundary'] as const)(
  '%s changes require a new unchecked review before any host or source grant',
  async (change) => {
    const f = await fixture();
    const review = f.review();
    if (change === 'name') f.workspace.update(f.owner.id, f.source.id, { name: 'Renamed source' });
    if (change === 'dependencies') f.save(f.host.id, [f.second.id]);
    if (change === 'recipient-role')
      f.workspace.share(f.owner.id, f.source.id, f.recipient.id, 'editor');
    if (change === 'space-boundary') {
      const root = f.spaces.createRoot(f.owner.id, {
        name: 'Entire private Space',
        parentId: null,
      }).space;
      // Model a valid concurrent membership change while retaining stable IDs.
      f.db
        .prepare('UPDATE workspace_items SET parent_id=?,space_id=?,space_position=0 WHERE id=?')
        .run(root.id, root.id, f.source.id);
    }
    const before = f.grants();
    expect(() => f.apply(review.version)).toThrow('Formula sources changed');
    expect(f.grants()).toEqual(before);
    expect(f.review().version).not.toBe(review.version);
    if (change === 'space-boundary') expect(f.review().targets[0].kind).toBe('space');
  },
);

test('source-only confirmation cannot overwrite a concurrent host promotion', async () => {
  const f = await fixture();
  f.files.share(f.owner.id, f.host.id, f.recipient.id, 'viewer');
  const review = f.review();
  f.files.share(f.owner.id, f.host.id, f.recipient.id, 'admin');
  expect(() => f.apply(review.version)).toThrow('Formula sources changed');
  expect(f.files.get(f.recipient.id, f.host.id).access).toBe('admin');
  expect(() => f.files.get(f.recipient.id, f.source.id)).toThrow('not available');
});

test.each(['viewer', null] as const)(
  'source authority revoked to %s cannot use the old confirmation or stale title',
  async (role) => {
    const f = await fixture();
    const external = f.create('sheet', 'External confidential source', f.other.id);
    f.files.share(f.other.id, external.id, f.owner.id, 'admin');
    f.save(f.host.id, [external.id]);
    const review = f.review();
    f.files.share(f.other.id, external.id, f.owner.id, role);
    const before = f.grants();
    expect(() => f.apply(review.version)).toThrow('Formula sources changed');
    expect(f.grants()).toEqual(before);
    const current = f.review();
    if (role === null) {
      expect(current.targets).toEqual([]);
      expect(JSON.stringify(current)).not.toContain(external.id);
      expect(JSON.stringify(current)).not.toContain(external.name);
    } else expect(current.targets[0].state).toBe('requires-owner');
  },
);

test('a current File admin can confirm host sharing and Viewer access to independently administered sources', async () => {
  const f = await fixture();
  const admin = f.auth.createUser('File admin');
  const context = f.custom(admin.id);
  f.files.share(f.owner.id, f.host.id, admin.id, 'admin');
  f.files.share(f.owner.id, f.source.id, admin.id, 'admin');
  const before = f.grants().filter((grant) => grant.user_id === admin.id);
  const review = f.service.review(admin.id, f.host.id, f.recipient.id, 'editor', context);
  const result = f.service.apply(
    admin.id,
    f.host.id,
    f.recipient.id,
    'editor',
    review.version,
    context,
  );
  expect(result.sourceOutcome).toMatchObject({
    host: 'updated',
    shared: [f.source.id],
    failed: [],
    complete: true,
  });
  expect(f.files.get(f.recipient.id, f.host.id).access).toBe('editor');
  expect(f.files.get(f.recipient.id, f.source.id).access).toBe('viewer');
  expect(f.grants().filter((grant) => grant.user_id === admin.id)).toEqual(before);
});

test('current actor, recipient and host authority are required at confirmation', async () => {
  const f = await fixture();
  const admin = f.auth.createUser('File admin');
  const context = f.custom(admin.id);
  f.files.share(f.owner.id, f.host.id, admin.id, 'admin');
  f.files.share(f.owner.id, f.source.id, admin.id, 'admin');
  const review = f.service.review(admin.id, f.host.id, f.recipient.id, 'viewer', context);
  f.files.share(f.owner.id, f.host.id, admin.id, 'viewer');
  expect(() =>
    f.service.apply(admin.id, f.host.id, f.recipient.id, 'viewer', review.version, context),
  ).toThrow('file admin');
  const ownerReview = f.review();
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.recipient.id);
  expect(() => f.apply(ownerReview.version)).toThrow('active everyday account');
  f.db.prepare('UPDATE auth_users SET disabled=0 WHERE id=?').run(f.recipient.id);
  f.db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(f.context.sessionHash);
  expect(() => f.apply(ownerReview.version)).toThrow('credential');
  expect(f.grants().some((grant) => grant.user_id === f.recipient.id)).toBe(false);
});

test('operators, trusted callers, viewers and editors cannot inspect source metadata', async () => {
  const f = await fixture();
  const operatorContext = f.custom(f.operator.id);
  expect(() =>
    f.service.review(f.operator.id, f.host.id, f.recipient.id, 'viewer', operatorContext),
  ).toThrow();
  expect(() => f.service.review(f.owner.id, f.host.id, f.recipient.id, 'viewer', {})).toThrow(
    'Sign in',
  );
  for (const role of ['viewer', 'editor'] as const) {
    f.files.share(f.owner.id, f.host.id, f.other.id, role);
    expect(() =>
      f.service.review(f.other.id, f.host.id, f.recipient.id, 'viewer', f.custom(f.other.id)),
    ).toThrow('file admin');
  }
});

test('current committed native formulas supersede stale legacy snapshots and restoration invalidates review', async () => {
  const f = await fixture();
  await f.native(f.host.id, [f.second.id]);
  expect(JSON.stringify(f.documents.load(f.owner.id, f.host.id).snapshot)).toContain(f.source.id);
  const review = f.review();
  expect(review.targets.map((target) => target.id)).toEqual([f.second.id]);
  const snapshot = (await f.collaboration.load(f.owner.id, f.host.id, f.context)).snapshot;
  await f.collaboration.restore(
    f.owner.id,
    f.host.id,
    f.host.id,
    randomUUID(),
    randomUUID(),
    snapshot,
    async () => () => {},
    () => {},
    f.context,
  );
  expect(() => f.apply(review.version)).toThrow('Formula sources changed');
  expect(f.review().targets.map((target) => target.id)).toEqual([f.second.id]);
});

test('active restoration or missing prepared native storage cannot fall back to legacy formulas', async () => {
  const f = await fixture();
  await f.native(f.host.id, [f.second.id]);
  const requestId = randomUUID();
  f.collaboration.generations.begin(
    f.owner.id,
    f.host.id,
    f.host.id,
    requestId,
    randomUUID(),
    f.context,
  );
  expect(() => f.review()).toThrow('being restored');
  f.collaboration.generations.cancel(requestId);
  f.db.prepare('DELETE FROM spinel_sync_units WHERE unit_id=?').run(f.host.id);
  expect(() => f.review()).toThrow('not ready');
  expect(f.grants()).toEqual([]);
});

test('Space review covers all live Docs, inherits local sources and grants external Space roots once', async () => {
  const f = await fixture();
  const root = f.spaces.createRoot(f.owner.id, { name: 'Report Space', parentId: null }).space;
  const external = f.spaces.createRoot(f.owner.id, {
    name: 'External Space',
    parentId: null,
  }).space;
  const child = (spaceId: string, kind: 'doc' | 'sheet', name: string) =>
    f.spaces.createChild(f.owner.id, spaceId, { kind, name, parentId: spaceId }).item;
  const first = child(root.id, 'doc', 'First report');
  const second = child(root.id, 'doc', 'Second report');
  const local = child(root.id, 'sheet', 'Local input');
  const remote = child(external.id, 'sheet', 'Remote input');
  const remoteTwo = child(external.id, 'sheet', 'Another remote input');
  const unrelated = child(external.id, 'doc', 'Unrelated external page');
  await f.native(first.id, [local.id, f.source.id], root.id);
  await f.native(second.id, [remote.id, remoteTwo.id], root.id);
  const review = f.review('viewer', root.id);
  expect(review.targets.find((target) => target.id === root.id)?.state).toBe('included');
  expect(review.targets.find((target) => target.id === external.id)).toMatchObject({
    kind: 'space',
    state: 'grant',
    sources: expect.arrayContaining([
      { id: remote.id, name: remote.name },
      { id: remoteTwo.id, name: remoteTwo.name },
    ]),
  });
  expect(JSON.stringify(review)).not.toContain(unrelated.id);
  expect(JSON.stringify(review)).not.toContain(unrelated.name);
  const result = f.apply(review.version, 'viewer', root.id);
  expect(result.sourceOutcome.shared.sort()).toEqual([f.source.id, external.id].sort());
  for (const id of [local.id, remote.id, remoteTwo.id])
    expect(f.grants().some((grant) => grant.item_id === id)).toBe(false);
  const recipientContext = f.custom(f.recipient.id);
  expect(
    resolveDocument(f.workspace, f.recipient.id, unrelated.id, 'read', {
      ...recipientContext,
      spaceId: external.id,
      spaceItem: unrelated.id,
    }).access,
  ).toBe('viewer');
});

test('a source grant write failure rolls back both the host and all newly granted sources', async () => {
  const f = await fixture();
  f.save(f.host.id, [f.source.id, f.second.id]);
  const review = f.review();
  const last = review.targets.at(-1)!.id;
  f.db.exec(
    `CREATE TRIGGER refuse_source BEFORE INSERT ON workspace_grants WHEN NEW.item_id='${last}' BEGIN SELECT RAISE(ABORT,'injected source write failure'); END`,
  );
  const before = f.grants();
  expect(() => f.apply(review.version)).toThrow('injected source write failure');
  expect(f.grants()).toEqual(before);
});

test('capacity limits refuse whole reviews without truncation or any grant', async () => {
  const f = await fixture();
  const snapshot = f.documents.load(f.owner.id, f.host.id).snapshot!;
  expect(() =>
    f.collaboration.committedDocumentSnapshot(f.owner.id, f.host.id, f.context, 1),
  ).toThrow('too large');
  const oversizedRanges = {
    ...snapshot,
    body: {
      ...snapshot.body!,
      customRanges: Array.from(
        { length: SOURCE_SHARING_LIMITS.ranges + 1 },
        () => snapshot.body!.customRanges![0],
      ),
    },
  };
  f.db
    .prepare('UPDATE doc_snapshots SET snapshot=? WHERE item_id=?')
    .run(JSON.stringify(oversizedRanges), f.host.id);
  expect(() => f.review()).toThrow('too many formula sources');
  const ids = Array.from({ length: SOURCE_SHARING_LIMITS.sources + 1 }, () => randomUUID());
  f.db
    .prepare('UPDATE doc_snapshots SET snapshot=? WHERE item_id=?')
    .run(JSON.stringify({ ...snapshot, body: bodyFor(ids) }), f.host.id);
  expect(() => f.review()).toThrow('too many formula sources');
  expect(f.grants()).toEqual([]);
});

test('a Space with too many live Docs refuses source review instead of omitting later Docs', async () => {
  const f = await fixture();
  const root = f.spaces.createRoot(f.owner.id, { name: 'Many reports', parentId: null }).space;
  for (let index = 0; index <= SOURCE_SHARING_LIMITS.documents; index++)
    f.spaces.createChild(f.owner.id, root.id, {
      name: `Report ${index}`,
      kind: 'doc',
      parentId: root.id,
    });
  expect(() => f.review('viewer', root.id)).toThrow('too many formula sources');
  expect(f.grants()).toEqual([]);
});

test('aggregate snapshot budget refuses a Space even when each Doc is below its individual save limit', async () => {
  const f = await fixture();
  const root = f.spaces.createRoot(f.owner.id, { name: 'Large reports', parentId: null }).space;
  const insert = f.db.prepare('INSERT INTO doc_snapshots VALUES(?,?,0,?)');
  for (let index = 0; index < 4; index++) {
    const doc = f.spaces.createChild(f.owner.id, root.id, {
      name: `Report ${index}`,
      kind: 'doc',
      parentId: root.id,
    }).item;
    // Four valid sub-10MiB committed Docs must spend one shared review budget;
    // checking them separately must not turn an oversized Space into a pass.
    const snapshot = {
      ...getDocsEmptySnapshot(doc.id),
      body: { dataStream: 'x'.repeat(9 * 1024 * 1024) + '\r\n' },
    };
    insert.run(doc.id, JSON.stringify(snapshot), randomUUID());
  }
  expect(() => f.review('viewer', root.id)).toThrow('source review is too large');
  expect(f.grants()).toEqual([]);
});

test('the combined ancestry budget refuses otherwise valid deep source paths without partial grants', async () => {
  const f = await fixture();
  let parent: string | null = null;
  const insert = f.db.prepare(
    "INSERT INTO workspace_items(id,owner_id,parent_id,kind,name,created_at,updated_at) VALUES(?,?,?,'folder',?,0,0)",
  );
  f.auth.transaction(() => {
    for (let index = 0; index < SOURCE_SHARING_LIMITS.ancestorReads / 2; index++) {
      const id = randomUUID();
      insert.run(id, f.owner.id, parent, `Level ${index}`);
      parent = id;
    }
    f.db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=?').run(parent, f.source.id);
  });
  // Each valid path is below the resolver's individual limit. Reviewing it as
  // both source and grant target must still spend the shared request budget.
  expect(() => f.review()).toThrow('too many formula sources');
  expect(f.grants()).toEqual([]);
});

test.each(['ordinary-doc', 'space-external-sheet', 'space-external-space'] as const)(
  '%s account source sharing preserves existing public links and never expands a guest capability',
  async (kind) => {
    const f = await fixture();
    const hostRoot =
      kind === 'ordinary-doc'
        ? f.host
        : f.spaces.createRoot(f.owner.id, { name: 'Public report Space', parentId: null }).space;
    const hostDoc =
      kind === 'ordinary-doc'
        ? f.host
        : f.spaces.createChild(f.owner.id, hostRoot.id, {
            name: 'Report',
            kind: 'doc',
            parentId: hostRoot.id,
          }).item;
    const sourceRoot =
      kind === 'space-external-space'
        ? f.spaces.createRoot(f.owner.id, { name: 'Public source Space', parentId: null }).space
        : f.source;
    const source =
      kind === 'space-external-space'
        ? f.spaces.createChild(f.owner.id, sourceRoot.id, {
            name: 'External budget',
            kind: 'sheet',
            parentId: sourceRoot.id,
          }).item
        : f.source;
    await f.native(hostDoc.id, [source.id], kind === 'ordinary-doc' ? undefined : hostRoot.id);
    const guest = (id: string) => {
      const change = f.workspace.links.begin(id, 'editor');
      f.workspace.links.finish(id, change.epoch, true);
      return f.workspace.links.exchange(id, change.token);
    };
    const hostGuest = guest(hostRoot.id);
    const sourceGuest = guest(sourceRoot.id);
    const links = () => f.db.prepare('SELECT * FROM workspace_links ORDER BY item_id').all();
    const sessions = () => f.db.prepare('SELECT * FROM workspace_guest_sessions ORDER BY id').all();
    const linksBefore = links();
    const sessionsBefore = sessions();
    const review = f.review('viewer', hostRoot.id);
    expect(f.apply(review.version, 'viewer', hostRoot.id).sourceOutcome.shared).toEqual([
      sourceRoot.id,
    ]);
    // Preserve the complete capability rows and sessions: token hashes, epochs,
    // roles and preview hashes must not change as a side effect of account grants.
    expect(links()).toEqual(linksBefore);
    expect(sessions()).toEqual(sessionsBefore);
    expect(f.workspace.links.session(sourceGuest.userId, hashToken(sourceGuest.token)).role).toBe(
      'editor',
    );
    expect(f.files.get(f.recipient.id, sourceRoot.id).access).toBe('viewer');
    const prepare = vi.spyOn(f.collaboration, 'prepare');
    const load = vi.spyOn(f.collaboration, 'load');
    const formula = docFormulas(bodyFor([source.id]))[0].definition;
    const guestContext = {
      guestItem: hostRoot.id,
      guestHash: hashToken(hostGuest.token),
      ...(kind === 'ordinary-doc' ? {} : { spaceId: hostRoot.id, spaceItem: hostDoc.id }),
    };
    expect(
      await new DocFormulas(f.workspace, f.collaboration).evaluate(
        hostGuest.userId,
        hostDoc.id,
        formula,
        () => {},
        true,
        guestContext,
      ),
    ).toEqual({ ok: false, reason: kind === 'ordinary-doc' ? 'missing-source' : 'private-source' });
    expect(prepare).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  },
);

test('expired credential discovered while reading cannot return source metadata', async () => {
  const f = await fixture();
  const original = f.collaboration.committedDocumentSnapshot.bind(f.collaboration);
  vi.spyOn(f.collaboration, 'committedDocumentSnapshot').mockImplementationOnce((...args) => {
    const result = original(...args);
    f.db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(f.context.sessionHash);
    return result;
  });
  expect(() => f.review()).toThrow(AuthError);
});
