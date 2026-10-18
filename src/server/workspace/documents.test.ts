import { randomUUID } from 'node:crypto';
import { DatabaseSync } from '../../../server/database.ts';
import sharp from 'sharp';
import { afterEach, expect, test } from 'vitest';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';
import { DocumentStore, DOCUMENT_IMAGE_LIMIT, IMAGE_LIMIT } from './documents.ts';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  databases.push(db);
  const auth = new AuthStore(db);
  const owner = auth.createUser('Owner');
  const workspace = new WorkspaceStore(auth);
  const docs = new DocumentStore(workspace);
  const item = workspace.create(owner.id, { name: 'Journal', kind: 'doc', parentId: null });
  const snapshot = {
    id: item.id,
    title: 'Journal',
    body: { dataStream: 'Journal\r\n', paragraphs: [{ startIndex: 7 }] },
    resources: [{ name: 'future-plugin', data: 'preserve me' }],
  };
  return { db, auth, owner, workspace, docs, item, snapshot };
}
const png = () =>
  sharp({ create: { width: 3, height: 2, channels: 4, background: '#ff9900' } })
    .png()
    .toBuffer();

test('native document snapshots preserve their complete data and the shared revision/retry contract', () => {
  const f = fixture();
  const payload = { snapshot: f.snapshot, revision: 0, writeId: randomUUID() };
  expect(f.docs.save(f.owner.id, f.item.id, payload)).toEqual({ revision: 1 });
  expect(f.docs.save(f.owner.id, f.item.id, payload)).toEqual({ revision: 1 });
  expect(new DocumentStore(f.workspace).load(f.owner.id, f.item.id)).toEqual({
    access: 'owner',
    snapshot: f.snapshot,
    revision: 1,
  });
  expect(() => f.docs.save(f.owner.id, f.item.id, { ...payload, writeId: randomUUID() })).toThrow(
    'newer version',
  );
  expect(() =>
    f.docs.save(f.owner.id, f.item.id, {
      ...payload,
      snapshot: { ...f.snapshot, title: 'changed' },
      revision: 1,
    }),
  ).toThrow('newer version');
});

test('decoded images persist inside SQLite, deduplicate retries, and remain scoped to their document', async () => {
  const f = fixture();
  const bytes = await png();
  const uploaded = await f.docs.upload(f.owner.id, f.item.id, bytes, 'image/png');
  expect(await f.docs.upload(f.owner.id, f.item.id, bytes, 'image/png')).toEqual(uploaded);
  const image = new DocumentStore(f.workspace).image(f.owner.id, f.item.id, uploaded.id);
  expect(image.mime).toBe('image/png');
  expect((await sharp(Buffer.from(image.data)).metadata()).width).toBe(3);
  const otherDoc = f.workspace.create(f.owner.id, { name: 'Other', kind: 'doc', parentId: null });
  expect(() => f.docs.image(f.owner.id, otherDoc.id, uploaded.id)).toThrow('not found');
  const drawing = { drawingType: 0, imageSourceType: 'URL', source: uploaded.url };
  const snapshot = {
    ...f.snapshot,
    drawings: { image: drawing },
    resources: [{ name: 'DOC_DRAWING_PLUGIN', data: JSON.stringify({ image: drawing }) }],
  };
  f.docs.save(f.owner.id, f.item.id, { snapshot, revision: 0, writeId: randomUUID() });
  expect(f.docs.load(f.owner.id, f.item.id).snapshot).toEqual(snapshot);
  f.db.prepare('DELETE FROM workspace_items WHERE id=?').run(f.item.id);
  expect(f.db.prepare('SELECT count(*) AS n FROM doc_images').get()?.n).toBe(0);
});

test('image validation rejects unsupported, disguised, broken, oversized and excessive-pixel files', async () => {
  const f = fixture();
  const bytes = await png();
  for (const [input, type] of [
    [Buffer.from('<svg/>'), 'image/svg+xml'],
    [bytes, 'image/jpeg'],
    [bytes.subarray(0, 35), 'image/png'],
  ] as const)
    await expect(f.docs.upload(f.owner.id, f.item.id, input, type)).rejects.toThrow();
  // Bounds favour the Operator's 2 GB target while keeping ordinary document images useful (#21).
  await expect(
    f.docs.upload(f.owner.id, f.item.id, Buffer.alloc(IMAGE_LIMIT + 1), 'image/png'),
  ).rejects.toThrow('5 MiB');
  const huge = await sharp({
    create: { width: 4001, height: 4000, channels: 3, background: '#ffffff' },
  })
    .png()
    .toBuffer();
  await expect(f.docs.upload(f.owner.id, f.item.id, huge, 'image/png')).rejects.toThrow(
    '16 megapixels',
  );
  expect(f.db.prepare('SELECT count(*) AS n FROM doc_images').get()?.n).toBe(0);
});

test('document quota fails visibly without deleting previously stored images', async () => {
  const f = fixture();
  f.db
    .prepare('INSERT INTO doc_images VALUES(?,?,?,zeroblob(?))')
    .run(f.item.id, 'existing', 'image/png', DOCUMENT_IMAGE_LIMIT);
  await expect(f.docs.upload(f.owner.id, f.item.id, await png(), 'image/png')).rejects.toThrow(
    '50 MiB',
  );
  expect(f.db.prepare('SELECT length(data) AS n FROM doc_images').get()?.n).toBe(
    DOCUMENT_IMAGE_LIMIT,
  );
});

test('document reads, writes and images reject other owners, administrators and disabled users', async () => {
  const f = fixture();
  const bytes = await png();
  const image = await f.docs.upload(f.owner.id, f.item.id, bytes, 'image/png');
  for (const user of [f.auth.createUser('Other'), f.auth.createUser('Admin', true)]) {
    expect(() => f.docs.load(user.id, f.item.id)).toThrow();
    expect(() =>
      f.docs.save(user.id, f.item.id, { snapshot: f.snapshot, revision: 0, writeId: randomUUID() }),
    ).toThrow();
    expect(() => f.docs.image(user.id, f.item.id, image.id)).toThrow();
    await expect(f.docs.upload(user.id, f.item.id, bytes, 'image/png')).rejects.toThrow();
  }
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
  await expect(f.docs.upload(f.owner.id, f.item.id, bytes, 'image/png')).rejects.toThrow('Sign in');
});

test('invalid document data and external/missing image references never replace saved content', () => {
  const f = fixture();
  for (const snapshot of [
    null,
    { ...f.snapshot, id: 'wrong' },
    { ...f.snapshot, body: { dataStream: 'bad terminator' } },
    { ...f.snapshot, drawings: { image: { source: 'https://external.invalid/image.png' } } },
    {
      ...f.snapshot,
      resources: [
        {
          name: 'DOC_DRAWING_PLUGIN',
          data: JSON.stringify({
            image: { source: `/api/items/${f.item.id}/images/${'a'.repeat(64)}` },
          }),
        },
      ],
    },
  ])
    expect(() =>
      f.docs.save(f.owner.id, f.item.id, { snapshot, revision: 0, writeId: randomUUID() }),
    ).toThrow();
  expect(f.docs.load(f.owner.id, f.item.id).snapshot).toBeNull();
});
