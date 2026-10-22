import { afterEach, expect, test } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';
import { WorkspaceFiles } from './files.ts';
import { SpaceStore } from './spaces.ts';
import { SpaceRecoveryStore } from './space-recovery.ts';
import { migrateSpaceSchema } from './space-schema.ts';
import { TrashStore } from './trash.ts';
import type { FileKind, GrantRole } from '../../shared/workspace.ts';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function fixture(enabled = true) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  databases.push(db);
  const auth = new AuthStore(db);
  const store = new WorkspaceStore(auth, { spacesEnabled: enabled });
  migrateSpaceSchema(db);
  const files = new WorkspaceFiles(store),
    spaces = new SpaceStore(store),
    trash = new TrashStore(store);
  const owner = auth.createUser('Owner').id,
    admin = auth.createUser('File administrator').id;
  const other = auth.createUser('Other collaborator').id,
    operator = auth.createUser('Operator', true).id;
  const create = (kind: FileKind, parentId: string | null = null, who = owner) =>
    files.create(who, { name: kind, kind, parentId });
  return { db, auth, store, files, spaces, trash, owner, admin, other, operator, create };
}

test.each(['doc', 'sheet', 'folder', 'space'] as const)(
  '%s: complete account role matrix preserves the sole owner and Operator boundary',
  (kind) => {
    const f = fixture();
    const parent = f.create('folder'),
      item = f.create(kind, parent.id);
    for (const role of ['viewer', 'editor', 'admin'] as const) {
      f.files.share(f.owner, item.id, f.admin, role);
      expect(f.files.get(f.admin, item.id).access).toBe(role);
      if (role !== 'viewer') expect(f.files.get(f.admin, item.id, 'edit').access).toBe(role);
      else expect(() => f.files.get(f.admin, item.id, 'edit')).toThrow();
      if (role !== 'admin') {
        expect(() => f.files.share(f.admin, item.id, f.other, 'admin')).toThrow();
        expect(() => f.files.update(f.admin, item.id, { name: 'No' })).toThrow();
        expect(() => f.trash.trash(f.admin, item.id)).toThrow();
        continue;
      }
      for (const grant of ['viewer', 'editor', 'admin', null] as const) {
        f.files.share(f.admin, item.id, f.other, grant);
        if (grant) expect(f.files.get(f.other, item.id).access).toBe(grant);
        else expect(() => f.files.get(f.other, item.id)).toThrow();
      }
      for (const invalid of ['owner', 'operator', '', 4])
        expect(() => f.files.share(f.admin, item.id, f.other, invalid)).toThrow();
      for (const grant of ['viewer', 'admin', null])
        expect(() => f.files.share(f.admin, item.id, f.owner, grant)).toThrow();
      expect(
        f.files
          .sharing(f.admin, item.id)
          .some((person) => person.id === f.owner || person.id === f.admin),
      ).toBe(false);
      expect(() => f.files.share(f.admin, item.id, f.operator, 'admin')).toThrow();
      expect(() => f.files.get(f.operator, item.id)).toThrow();
      expect(() => f.files.get(f.admin, item.id, 'owner')).toThrow();
      expect(f.files.update(f.admin, item.id, { name: 'Renamed' })).toMatchObject({
        name: 'Renamed',
        parentId: null,
      });
      // A redacted parent is not a request to move out of the Owner's private folder.
      expect(f.files.get(f.owner, item.id).parentId).toBe(parent.id);
    }
    f.files.share(f.owner, item.id, f.admin, null);
    expect(f.files.get(f.owner, item.id).access).toBe('owner');
    expect(() => f.files.get(f.admin, item.id)).toThrow();
    expect(f.store.fileOwner(item.id)).toBe(f.owner);
  },
);

test.each(['doc', 'sheet', 'folder', 'space'] as const)(
  '%s: moves check both authorities, preserve owner and redact inaccessible ancestors',
  (kind) => {
    const f = fixture();
    const hidden = f.create('folder'),
      source = f.create('folder', hidden.id),
      destination = f.create('folder', hidden.id);
    const item = f.create(kind, source.id),
      foreign = f.create('folder', null, f.admin);
    f.files.share(f.owner, source.id, f.admin, 'admin');
    f.files.share(f.owner, destination.id, f.admin, 'editor');
    expect(() => f.files.update(f.admin, item.id, { parentId: destination.id })).toThrow();
    expect(() => f.files.update(f.admin, item.id, { parentId: foreign.id })).toThrow();
    expect(() => f.files.update(f.admin, item.id, { parentId: null })).toThrow();
    f.files.share(f.owner, destination.id, f.admin, 'admin');
    const choices = f.files.moveDestinations(f.admin, item.id);
    expect(choices.map((choice) => choice.id).sort()).toEqual([source.id, destination.id].sort());
    expect(JSON.stringify(choices)).not.toContain(hidden.id);
    expect(f.files.update(f.admin, item.id, { parentId: destination.id })).toMatchObject({
      access: 'admin',
      parentId: destination.id,
    });
    expect(f.store.fileOwner(item.id)).toBe(f.owner);
    f.files.share(f.owner, destination.id, f.admin, 'viewer');
    expect(() => f.files.update(f.admin, item.id, { parentId: source.id })).toThrow();
    if (kind === 'folder') {
      f.files.share(f.owner, destination.id, f.admin, 'admin');
      const child = f.create('folder', item.id);
      expect(() => f.files.update(f.admin, item.id, { parentId: child.id })).toThrow('itself');
      expect(f.files.moveDestinations(f.admin, item.id).map((entry) => entry.id)).not.toContain(
        child.id,
      );
    }
  },
);

test('inherited Admin wins over every direct role and applies uniformly to current and future Space pages', () => {
  const f = fixture();
  const outer = f.create('folder'),
    root = f.create('space', outer.id);
  f.files.share(f.owner, outer.id, f.admin, 'admin');
  for (const role of [null, 'viewer', 'editor', 'admin'] as (GrantRole | null)[]) {
    f.files.share(f.owner, root.id, f.admin, role);
    expect(f.files.get(f.admin, root.id).access).toBe('admin');
    expect(f.files.sharing(f.owner, root.id).find((person) => person.id === f.admin)).toMatchObject(
      { directRole: role, effectiveRole: 'admin' },
    );
  }
  const doc = f.spaces.createChild(f.admin, root.id, {
    kind: 'doc',
    name: 'Created by admin',
    parentId: root.id,
  }).item;
  const sheet = f.spaces.createChild(f.admin, root.id, {
    kind: 'sheet',
    name: 'Nested',
    parentId: doc.id,
  }).item;
  expect(f.spaces.get(f.admin, root.id, sheet.id).access).toBe('admin');
  expect(() => f.files.share(f.admin, doc.id, f.other, 'admin')).toThrow();
  expect(() => f.spaces.share(f.admin, doc.id, f.other, 'admin')).toThrow();
  const recovery = new SpaceRecoveryStore(f.store);
  recovery.trash(f.admin, root.id, doc.id);
  expect(recovery.list(f.admin, root.id).items).toHaveLength(1);
  expect(() => recovery.previewDelete(f.admin, root.id, doc.id)).toThrow();
  recovery.restore(f.admin, root.id, doc.id);
  f.files.share(f.owner, root.id, f.admin, null);
  f.files.share(f.owner, outer.id, f.admin, 'viewer');
  expect(f.spaces.get(f.admin, root.id, sheet.id).access).toBe('viewer');
  expect(() => f.spaces.updateChild(f.admin, root.id, doc.id, { name: 'Denied' })).toThrow();
  f.auth.database.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.admin);
  expect(() => f.spaces.get(f.admin, root.id, doc.id)).toThrow();
});

test.each([true, false])(
  'Admin recoverable trash uses the Owner recovery collection (Spaces enabled: %s)',
  (enabled) => {
    const f = fixture(enabled);
    const outer = f.create('folder'),
      doc = f.create('doc', outer.id);
    const root = enabled ? f.create('space', outer.id) : undefined;
    f.files.share(f.owner, outer.id, f.admin, 'admin');
    f.trash.trash(f.admin, outer.id);
    expect(f.trash.list(f.admin).items).toEqual([]);
    expect(() => f.trash.restore(f.admin, outer.id)).toThrow();
    expect(f.trash.list(f.owner).items.map((item) => item.id)).toContain(doc.id);
    f.trash.restore(f.owner, outer.id);
    expect(f.files.get(f.admin, doc.id).access).toBe('admin');
    if (root) expect(f.files.get(f.admin, root.id).access).toBe('admin');
  },
);

test('legacy grants migrate atomically without changing roles or timestamps and survive reopen', () => {
  const f = fixture();
  const doc = f.create('doc');
  f.db.exec(`DROP TABLE workspace_grants;
    CREATE TABLE workspace_grants(item_id TEXT NOT NULL REFERENCES workspace_items(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('viewer','editor')), shared_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(item_id,user_id)) STRICT;`);
  f.db.prepare('INSERT INTO workspace_grants VALUES(?,?,?,?)').run(doc.id, f.admin, 'editor', 123);
  const reopened = new WorkspaceStore(f.auth);
  expect(reopened.get(f.admin, doc.id).access).toBe('editor');
  reopened.share(f.owner, doc.id, f.admin, 'admin');
  expect(f.db.prepare('SELECT shared_at FROM workspace_grants').get()?.shared_at).toBe(123);
  expect(new WorkspaceStore(f.auth).get(f.admin, doc.id).access).toBe('admin');
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
