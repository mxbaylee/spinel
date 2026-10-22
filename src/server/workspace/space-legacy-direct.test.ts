import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { GUEST_TTL, guestCookieName } from './links.ts';
import { migrateSpaceSchema } from './space-schema.ts';
import { WorkspaceStore } from './store.ts';
import { DAY_MS, TRASH_RETENTION_MS, TrashStore } from './trash.ts';

const databases: DatabaseSync[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  databases.splice(0).forEach((database) => database.close());
});

function fixture(migrated = true) {
  let now = Date.UTC(2026, 9, 22);
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  const auth = new AuthStore(db, () => now);
  const workspace = new WorkspaceStore(auth);
  const owner = auth.createUser('Owner');
  const other = auth.createUser('Other owner');
  if (migrated) migrateSpaceSchema(db);
  const trash = new TrashStore(workspace);
  const create = (kind = 'doc', parentId: string | null = null, name = 'Ordinary item') =>
    workspace.create(owner.id, { kind, parentId, name });
  const insert = (kind: string, parentId: string | null = null, spaceId: string | null = null) => {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO workspace_items
      (id,owner_id,parent_id,kind,name,created_at,updated_at,space_id,space_position)
      VALUES(?,?,?,?,?,?,?, ?,?)`,
    ).run(
      id,
      owner.id,
      parentId,
      kind,
      `Hidden ${kind} ${id}`,
      now,
      now,
      spaceId,
      spaceId ? 0 : null,
    );
    return id;
  };
  const mark = (ids: string[], batch: string, when = now) => {
    const update = db.prepare('UPDATE workspace_items SET trashed_at=?,trash_batch=? WHERE id=?');
    for (const id of ids) update.run(when, batch, id);
  };
  return {
    db,
    auth,
    workspace,
    owner,
    other,
    trash,
    create,
    insert,
    mark,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

type Fixture = ReturnType<typeof fixture>;

function hiddenTree(f: Fixture, parentId: string | null = null) {
  const space = f.insert('space', parentId);
  const doc = f.insert('doc', space, space);
  const sheet = f.insert('sheet', doc, space);
  // Imported/malformed ordinary-kind descendants must not bypass membership by
  // omitting their Space columns. Detached membership is hidden as well.
  const missingMetadata = f.insert('folder', space);
  const missingMetadataChild = f.insert('doc', missingMetadata);
  const detached = f.insert('doc', null, space);
  return {
    space,
    doc,
    sheet,
    missingMetadata,
    missingMetadataChild,
    detached,
    ids: [space, doc, sheet, missingMetadata, missingMetadataChild, detached],
  };
}

const digest = (secret: string) => createHash('sha256').update(secret).digest('hex');

function seededLink(f: Fixture, id: string) {
  const token = randomBytes(32).toString('base64url');
  const preview = randomBytes(32).toString('base64url');
  const guest = randomBytes(32).toString('base64url');
  const sessionId = randomUUID();
  f.db
    .prepare(
      `INSERT INTO workspace_links(item_id,epoch,state,role,token_hash,preview_hash)
    VALUES(?,1,'active','editor',?,?)`,
    )
    .run(id, digest(token), digest(preview));
  f.db
    .prepare('INSERT INTO workspace_guest_sessions VALUES(?,?,?,?,?)')
    .run(sessionId, digest(guest), id, 1, f.auth.now() + GUEST_TTL);
  return { token, preview, guest, userId: `guest:${sessionId}` };
}

function rows(f: Fixture, table: string) {
  return f.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
}

function recovery(f: Fixture, space: string, doc: string, child: string) {
  f.mark([doc, child], 'internal-batch');
  f.db
    .prepare('INSERT INTO workspace_space_trash VALUES(?,?,?,?,?,?,?)')
    .run(doc, space, space, 0, f.auth.now(), f.owner.id, 'internal-batch');
  f.db.exec(`CREATE TABLE doc_snapshots (
    item_id TEXT PRIMARY KEY REFERENCES workspace_items(id) ON DELETE CASCADE,
    snapshot TEXT NOT NULL,revision INTEGER NOT NULL,write_id TEXT NOT NULL
  ) STRICT`);
  f.db
    .prepare('INSERT INTO doc_snapshots VALUES(?,?,1,?)')
    .run(
      doc,
      JSON.stringify({ id: doc, body: { dataStream: 'Keep this internal document\r\n' } }),
      randomUUID(),
    );
}

test.each([false, true])('ordinary links and Trash still work with migration=%s', (migrated) => {
  const f = fixture(migrated);
  const folder = f.create('folder');
  const doc = f.create('doc', folder.id);
  const links = f.workspace.links;
  const change = links.begin(doc.id, 'editor');
  links.finish(doc.id, change.epoch, true);
  const session = links.exchange(doc.id, change.token);
  expect(links.preview(doc.id, change.previewToken)).toEqual({ name: doc.name, kind: 'doc' });
  expect(links.access(session.userId, doc.id)?.role).toBe('editor');
  f.trash.trash(f.owner.id, folder.id);
  expect(links.access(session.userId, doc.id)).toBeUndefined();
  expect(f.trash.list(f.owner.id).items).toHaveLength(2);
  f.trash.restore(f.owner.id, folder.id);
  expect(links.access(session.userId, doc.id)?.role).toBe('editor');
  f.trash.trash(f.owner.id, folder.id);
  expect(f.trash.empty(f.owner.id, f.trash.list(f.owner.id).version)).toEqual({ count: 2 });
  expect(rows(f, 'workspace_items')).toEqual([]);
});

test('legacy capabilities reveal and mutate no Space root, member or malformed descendant', () => {
  const f = fixture();
  const hidden = hiddenTree(f);
  const links = f.workspace.links;
  const capabilities = hidden.ids.map((id) => ({ id, ...seededLink(f, id) }));
  const beforeLinks = rows(f, 'workspace_links');
  const beforeGuests = rows(f, 'workspace_guest_sessions');
  for (const capability of capabilities) {
    const { id, token, preview, guest, userId } = capability;
    expect(links.preview(id, preview)).toBeUndefined();
    expect(links.state(id)).toBeUndefined();
    expect(links.epoch(id)).toBe(0);
    expect(() => links.assertEpoch(id, 0)).toThrow('This link no longer works.');
    expect(() => links.begin(id, 'viewer')).toThrow('This link no longer works.');
    expect(() => links.begin(id, null)).toThrow('This link no longer works.');
    expect(() => links.finish(id, 1, true)).toThrow('This link no longer works.');
    expect(() => links.exchange(id, token)).toThrow('This link no longer works.');
    expect(() => links.exchange(id, token, guest)).toThrow('This link no longer works.');
    expect(links.access(userId, id)).toBeUndefined();
    expect(links.access(userId)).toBeUndefined();
    expect(() => links.session(userId, digest(guest))).toThrow('This link no longer works.');
    expect(() => links.principal({ cookie: `${guestCookieName(id)}=${guest}` }, id)).toThrow(
      'This link no longer works.',
    );
  }
  expect(rows(f, 'workspace_links')).toEqual(beforeLinks);
  expect(rows(f, 'workspace_guest_sessions')).toEqual(beforeGuests);
});

test('link admission and existing sessions recheck structural scope after membership changes', () => {
  const f = fixture();
  const space = f.insert('space');
  const doc = f.create();
  const links = f.workspace.links;
  const change = links.begin(doc.id, 'viewer');
  links.finish(doc.id, change.epoch, true);
  const session = links.exchange(doc.id, change.token);
  f.db
    .prepare('UPDATE workspace_items SET parent_id=?,space_id=?,space_position=0 WHERE id=?')
    .run(space, space, doc.id);
  expect(links.preview(doc.id, change.previewToken)).toBeUndefined();
  expect(links.access(session.userId)).toBeUndefined();
  expect(() => links.exchange(doc.id, change.token, session.token)).toThrow('no longer works');

  const pending = f.create();
  const pendingChange = links.begin(pending.id, 'editor');
  f.db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=?').run(space, pending.id);
  expect(() => links.finish(pending.id, pendingChange.epoch, true)).toThrow('no longer works');
  expect(
    f.db.prepare('SELECT state FROM workspace_links WHERE item_id=?').get(pending.id)?.state,
  ).toBe('pending');
  // Error cleanup can still revoke a previously pending capability after its
  // scope changed; refusing activation must never trap a capability in limbo.
  links.finish(pending.id, pendingChange.epoch, false);
  expect(
    f.db
      .prepare('SELECT state,token_hash,preview_hash FROM workspace_links WHERE item_id=?')
      .get(pending.id),
  ).toEqual({
    state: 'off',
    token_hash: null,
    preview_hash: null,
  });
});

test('ordinary Trash hides internal names, tags and generations and refuses direct restoration', () => {
  const f = fixture();
  const ordinary = f.create();
  f.trash.trash(f.owner.id, ordinary.id);
  const before = f.trash.list(f.owner.id);
  const hidden = hiddenTree(f);
  f.mark(hidden.ids, 'hidden-batch');
  f.db.prepare('INSERT INTO workspace_tags VALUES(?,?)').run(f.owner.id, 'private-internal-tag');
  f.db
    .prepare('INSERT INTO workspace_tag_assignments VALUES(?,?,?)')
    .run(f.owner.id, hidden.doc, 'private-internal-tag');
  const items = rows(f, 'workspace_items');
  expect(f.trash.list(f.owner.id)).toEqual(before);
  for (const id of hidden.ids) {
    expect(() => f.trash.restore(f.owner.id, id)).toThrow('This item is not in your trash.');
    expect(() => f.trash.restore(f.other.id, id)).toThrow('This item is not in your trash.');
  }
  expect(rows(f, 'workspace_items')).toEqual(items);
  f.db
    .prepare('UPDATE workspace_items SET trash_batch=? WHERE id=?')
    .run('new-hidden-batch', hidden.doc);
  expect(f.trash.list(f.owner.id)).toEqual(before);
  expect(f.trash.empty(f.owner.id, before.version)).toEqual({ count: 1 });
  expect(rows(f, 'workspace_items').map((row) => row.id)).toEqual(hidden.ids);
  expect(rows(f, 'workspace_tag_assignments')).toHaveLength(1);
});

test('ordinary ancestor trash and restore refuse an entire hidden subtree without changing internal batches', () => {
  const f = fixture();
  const outer = f.create('folder');
  const sibling = f.create('doc', outer.id);
  const hidden = hiddenTree(f, outer.id);
  const liveItems = rows(f, 'workspace_items');
  for (const id of hidden.ids) expect(() => f.trash.trash(f.owner.id, id)).toThrow();
  expect(rows(f, 'workspace_items')).toEqual(liveItems);
  recovery(f, hidden.space, hidden.doc, hidden.sheet);
  const before = rows(f, 'workspace_items');
  const recoveryBefore = rows(f, 'workspace_space_trash');
  const contentsBefore = rows(f, 'doc_snapshots');
  expect(() => f.trash.trash(f.owner.id, outer.id)).toThrow('This item cannot be changed here.');
  expect(rows(f, 'workspace_items')).toEqual(before);

  // Simulate a retained outer deletion from an older/incomplete implementation.
  // Restoration must not extract a child or revive a prior internal deletion.
  f.mark([outer.id, sibling.id, hidden.space], 'outer-batch');
  const trashed = rows(f, 'workspace_items');
  expect(() => f.trash.restore(f.owner.id, outer.id)).toThrow('This item cannot be changed here.');
  expect(() => f.trash.restore(f.owner.id, hidden.doc)).toThrow('not in your trash');
  expect(rows(f, 'workspace_items')).toEqual(trashed);
  expect(rows(f, 'workspace_space_trash')).toEqual(recoveryBefore);
  expect(rows(f, 'doc_snapshots')).toEqual(contentsBefore);
});

test.each(['empty', 'expiry'] as const)(
  '%s preserves blocked outer subtrees and all internal recovery while cleaning unrelated ordinary trash',
  (operation) => {
    const f = fixture();
    const outer = f.create('folder');
    const sibling = f.create('doc', outer.id);
    const hidden = hiddenTree(f, outer.id);
    recovery(f, hidden.space, hidden.doc, hidden.sheet);
    f.mark(
      [
        outer.id,
        sibling.id,
        hidden.space,
        hidden.missingMetadata,
        hidden.missingMetadataChild,
        hidden.detached,
      ],
      'outer-batch',
    );
    const blockedItems = rows(f, 'workspace_items');
    const recoveryBefore = rows(f, 'workspace_space_trash');
    const contentsBefore = rows(f, 'doc_snapshots');
    const unrelated = f.create('folder');
    f.create('doc', unrelated.id);
    f.trash.trash(f.owner.id, unrelated.id);
    f.advance(TRASH_RETENTION_MS + DAY_MS);

    if (operation === 'empty')
      expect(f.trash.empty(f.owner.id, f.trash.list(f.owner.id).version)).toEqual({ count: 2 });
    else expect(f.trash.purgeExpired()).toBe(2);

    expect(rows(f, 'workspace_items')).toEqual(blockedItems);
    expect(rows(f, 'workspace_space_trash')).toEqual(recoveryBefore);
    expect(rows(f, 'doc_snapshots')).toEqual(contentsBefore);
    expect(f.trash.purgeExpired()).toBe(0);
    expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  },
);

test('a deep ordinary Trash batch reads each ancestry once and deletes each leaf once', () => {
  const f = fixture();
  const ids: string[] = [];
  f.auth.transaction(() => {
    let parent: string | null = null;
    for (let depth = 0; depth < 1_000; depth++) {
      parent = f.insert('folder', parent);
      ids.push(parent);
    }
    f.mark(ids, 'deep-batch');
  });
  const prepare = f.db.prepare.bind(f.db);
  let lookups = 0;
  let executions = 0;
  let deletions = 0;
  vi.spyOn(f.db, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql);
    return {
      get: (...values) => {
        lookups++;
        executions++;
        return statement.get(...values);
      },
      all: (...values) => {
        executions++;
        return statement.all(...values);
      },
      run: (...values) => {
        executions++;
        if (sql.startsWith('DELETE FROM workspace_items')) deletions++;
        return statement.run(...values);
      },
    };
  });
  const listing = f.trash.list(f.owner.id);
  expect(listing.items).toHaveLength(ids.length);
  expect(lookups).toBeLessThanOrEqual(ids.length + 4);
  lookups = executions = 0;
  expect(f.trash.empty(f.owner.id, listing.version)).toEqual({ count: ids.length });
  expect(lookups).toBeLessThanOrEqual(2 * ids.length + 10);
  expect(executions).toBeLessThanOrEqual(5 * ids.length + 20);
  expect(deletions).toBe(ids.length);
  expect(rows(f, 'workspace_items')).toEqual([]);
});

test('an oversized descendant graph is bounded while fetching and refuses before any deletion', () => {
  const f = fixture();
  const outer = f.create('folder');
  const unrelated = f.create();
  f.auth.transaction(() => {
    // Only two candidates are expired; the hidden amount of descendant work
    // must be bounded independently before any otherwise eligible row is deleted.
    for (let index = 0; index < 10_001; index++) f.insert('folder', outer.id);
    f.mark([outer.id, unrelated.id], 'oversized-batch');
  });
  f.advance(TRASH_RETENTION_MS);
  const prepare = f.db.prepare.bind(f.db);
  let returnedRows = 0;
  let deletions = 0;
  const spy = vi.spyOn(f.db, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql);
    return {
      get: statement.get,
      all: (...values) => {
        const result = statement.all(...values);
        returnedRows += result.length;
        return result;
      },
      run: (...values) => {
        if (sql.startsWith('DELETE FROM workspace_items')) deletions++;
        return statement.run(...values);
      },
    };
  });
  expect(() => f.trash.purgeExpired()).toThrow('too large to process at once');
  expect(returnedRows).toBeLessThanOrEqual(10_003);
  expect(deletions).toBe(0);
  spy.mockRestore();
  expect(f.db.prepare('SELECT count(*) AS total FROM workspace_items').get()?.total).toBe(10_003);
  expect(
    f.db.prepare('SELECT trash_batch FROM workspace_items WHERE id=?').get(unrelated.id)
      ?.trash_batch,
  ).toBe('oversized-batch');
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
