import { DatabaseSync } from '../../../server/database.ts';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterEach, expect, test } from 'vitest';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';
import { SheetStore } from './sheets.ts';
import { DocumentStore } from './documents.ts';
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  databases.push(db);
  const auth = new AuthStore(db),
    owner = auth.createUser('Owner'),
    collaborator = auth.createUser('Collaborator'),
    outsider = auth.createUser('Other'),
    admin = auth.createUser('Operator', true);
  const store = new WorkspaceStore(auth),
    docs = new DocumentStore(store),
    sheets = new SheetStore(store);
  const create = (kind: 'folder' | 'doc' | 'sheet', parentId: string | null = null) =>
    store.create(owner.id, { name: kind, kind, parentId });
  const root = create('folder'),
    folder = create('folder', root.id),
    doc = create('doc', folder.id),
    sheet = create('sheet', folder.id);
  const grant = (id: string, role: 'viewer' | 'editor' | null) =>
    store.share(owner.id, id, collaborator.id, role);
  return {
    db,
    auth,
    owner,
    collaborator,
    outsider,
    admin,
    store,
    docs,
    sheets,
    create,
    root,
    folder,
    doc,
    sheet,
    grant,
  };
}
test('direct and inherited grants combine by strongest access; revocation and moves recompute it', () => {
  const f = fixture(),
    who = f.collaborator.id,
    id = f.doc.id;
  expect(() => f.store.get(who, id)).toThrow('not available');
  f.grant(id, 'viewer');
  expect(f.store.get(who, id)).toMatchObject({ access: 'viewer', parentId: null });
  f.grant(f.folder.id, 'editor');
  expect(f.store.get(who, id)).toMatchObject({ access: 'editor', parentId: f.folder.id });
  expect(f.store.get(who, f.folder.id).parentId).toBeNull();
  expect(f.store.ancestors(who, id).map((item) => item.id)).toEqual([f.folder.id]);
  expect(f.store.ancestors(who, f.folder.id)).toEqual([]);
  f.grant(f.folder.id, 'viewer');
  f.grant(id, 'editor');
  expect(f.store.get(who, id).access).toBe('editor');
  f.grant(id, null);
  expect(f.store.get(who, id).access).toBe('viewer');
  expect(f.store.get(who, f.create('sheet', f.folder.id).id).access).toBe('viewer');
  expect(f.store.children(who, f.folder.id)).toHaveLength(3);
  // A move out of an inherited grant must revoke access without stale ACL caches.
  f.store.update(f.owner.id, id, { parentId: null });
  expect(() => f.store.get(who, id)).toThrow('not available');
  f.store.update(f.owner.id, id, { parentId: f.folder.id });
  expect(f.store.get(who, id).access).toBe('viewer');
  f.grant(f.folder.id, null);
  expect(() => f.store.get(who, id)).toThrow('not available');
});
test('sharing does not grant organization, onward sharing, account access or ancestor disclosure', () => {
  const f = fixture(),
    who = f.collaborator.id;
  f.grant(f.folder.id, 'editor');
  expect(f.store.list(who)).toEqual([]);
  expect(() => f.store.get(who, f.root.id)).toThrow('not available');
  expect(() => f.store.sharing(who, f.folder.id)).toThrow('Only the owner');
  expect(() => f.store.share(who, f.doc.id, f.outsider.id, 'editor')).toThrow('Only the owner');
  expect(() => f.store.update(who, f.doc.id, { name: 'stolen' })).toThrow('Only the owner');
  expect(() => f.store.create(who, { name: 'new', kind: 'doc', parentId: f.folder.id })).toThrow(
    'Only the owner',
  );
  expect(() => f.store.share(f.owner.id, f.doc.id, f.admin.id, 'editor')).toThrow(
    'everyday account',
  );
  expect(() => f.store.share(f.owner.id, f.doc.id, f.owner.id, 'editor')).toThrow(
    'Choose a person',
  );
  expect(() => f.store.share(f.owner.id, f.doc.id, f.outsider.id, 'owner')).toThrow(
    'Choose a person',
  );
  for (const action of [
    () => f.store.get(f.admin.id, f.doc.id),
    () => f.store.sharing(f.admin.id, f.doc.id),
  ])
    expect(action).toThrow('everyday account');
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(who);
  expect(() => f.store.get(who, f.doc.id)).toThrow('Sign in');
  expect(() => f.store.share(f.owner.id, f.doc.id, who, 'viewer')).toThrow('active');
  f.grant(f.folder.id, null);
  expect(f.db.prepare('SELECT count(*) AS n FROM workspace_grants').get()?.n).toBe(0);
});
test('viewer reads snapshots/images; editor writes remain revision checked and revoked retries cannot save', async () => {
  const f = fixture(),
    who = f.collaborator.id;
  f.grant(f.folder.id, 'viewer');
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#c33' } })
    .png()
    .toBuffer();
  const image = await f.docs.upload(f.owner.id, f.doc.id, bytes, 'image/png');
  expect(f.docs.load(who, f.doc.id).access).toBe('viewer');
  expect(f.sheets.load(who, f.sheet.id).access).toBe('viewer');
  expect(f.docs.image(who, f.doc.id, image.id).mime).toBe('image/png');
  const doc = {
    snapshot: { id: f.doc.id, body: { dataStream: 'shared\r\n' } },
    revision: 0,
    writeId: randomUUID(),
  };
  const sheet = {
    snapshot: { id: f.sheet.id, name: 'sheet', sheetOrder: ['a'], sheets: { a: { id: 'a' } } },
    revision: 0,
    writeId: randomUUID(),
  };
  expect(() => f.docs.save(who, f.doc.id, doc)).toThrow('cannot edit');
  expect(() => f.sheets.save(who, f.sheet.id, sheet)).toThrow('cannot edit');
  await expect(f.docs.upload(who, f.doc.id, bytes, 'image/png')).rejects.toThrow('cannot edit');
  f.grant(f.folder.id, 'editor');
  expect(f.docs.save(who, f.doc.id, doc).revision).toBe(1);
  expect(f.sheets.save(who, f.sheet.id, sheet).revision).toBe(1);
  expect(() => f.docs.save(f.owner.id, f.doc.id, { ...doc, writeId: randomUUID() })).toThrow(
    'newer version',
  );
  f.grant(f.folder.id, 'viewer');
  expect(() => f.docs.save(who, f.doc.id, doc)).toThrow('cannot edit');
  f.grant(f.folder.id, null);
  expect(() => f.docs.load(who, f.doc.id)).toThrow('not available');
  expect(() => f.docs.image(who, f.doc.id, image.id)).toThrow('not available');
  expect(f.docs.load(f.owner.id, f.doc.id).revision).toBe(1);
});
test('an in-flight image decode cannot commit after edit access is revoked', async () => {
  const f = fixture();
  f.grant(f.doc.id, 'editor');
  const bytes = await sharp({
    create: { width: 200, height: 200, channels: 3, background: '#366' },
  })
    .png()
    .toBuffer();
  const pending = f.docs.upload(f.collaborator.id, f.doc.id, bytes, 'image/png');
  f.grant(f.doc.id, 'viewer');
  await expect(pending).rejects.toThrow('cannot edit');
  expect(f.db.prepare('SELECT count(*) AS n FROM doc_images').get()?.n).toBe(0);
});
