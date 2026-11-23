import { randomUUID } from 'node:crypto';
import { DatabaseSync } from '../../../server/database.ts';
import sharp from 'sharp';
import { afterEach, expect, test } from 'vitest';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';
import { DocumentStore, DOCUMENT_IMAGE_LIMIT, IMAGE_LIMIT } from './documents.ts';
import { restoreFenceSchema } from '../collaboration/restore-fences.ts';
import { guestCookieName } from './links.ts';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function fixture(kind: 'doc' | 'sheet' = 'doc') {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  databases.push(db);
  const auth = new AuthStore(db);
  const owner = auth.createUser('Owner');
  const workspace = new WorkspaceStore(auth);
  const docs = new DocumentStore(workspace);
  const item = workspace.create(owner.id, { name: 'Journal', kind, parentId: null });
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

test('legacy saves retain accepted revisions after deletion and failed observers cannot advance the clock', () => {
  const f = fixture();
  f.db.exec(restoreFenceSchema);
  f.docs.save(f.owner.id, f.item.id, { snapshot: f.snapshot, revision: 0, writeId: randomUUID() });
  const listener = f.workspace.onSnapshotSaved(() => {
    throw new Error('fixture observer refusal');
  });
  const second = {
    snapshot: { ...f.snapshot, title: 'Changed' },
    revision: 1,
    writeId: randomUUID(),
  };
  expect(() => f.docs.save(f.owner.id, f.item.id, second)).toThrow('fixture observer refusal');
  expect(f.db.prepare('SELECT revision FROM spinel_restore_revision').get()!.revision).toBe(1);
  expect(f.docs.load(f.owner.id, f.item.id).revision).toBe(1);
  listener.dispose();
  f.docs.save(f.owner.id, f.item.id, second);
  f.db.prepare('DELETE FROM workspace_items WHERE id=?').run(f.item.id);
  expect(f.db.prepare('SELECT revision FROM spinel_restore_revision').get()!.revision).toBe(2);
});

test('a restored lazy document refuses a matching old full-snapshot save without changing its content', () => {
  const f = fixture(),
    db = f.workspace.auth.database;
  const payload = { snapshot: f.snapshot, revision: 0, writeId: randomUUID() };
  f.docs.save(f.owner.id, f.item.id, payload);
  db.exec(restoreFenceSchema);
  db.prepare("INSERT INTO spinel_restore_fences VALUES('identity',?)").run(f.item.id);
  expect(() => f.docs.save(f.owner.id, f.item.id, payload)).toThrow('recovered');
  expect(() =>
    f.docs.save(f.owner.id, f.item.id, {
      ...payload,
      revision: 1,
      writeId: randomUUID(),
      snapshot: { ...f.snapshot, title: 'Stale replacement' },
    }),
  ).toThrow('recovered');
  expect(f.docs.load(f.owner.id, f.item.id).snapshot).toEqual(f.snapshot);
  expect(f.docs.load(f.owner.id, f.item.id).revision).toBe(1);
});

test('native document snapshots preserve their complete data and the shared revision/retry contract', () => {
  const f = fixture();
  f.db.exec(restoreFenceSchema);
  const payload = { snapshot: f.snapshot, revision: 0, writeId: randomUUID() };
  expect(f.docs.save(f.owner.id, f.item.id, payload)).toEqual({ revision: 1 });
  expect(f.db.prepare('SELECT revision FROM spinel_restore_revision').get()!.revision).toBe(1);
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

test.each(['doc', 'sheet'] as const)(
  '%s image validation rejects unsupported, disguised, broken, oversized and excessive-pixel files',
  async (kind) => {
    const f = fixture(kind);
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
  },
);

test.each(['doc', 'sheet'] as const)(
  '%s image quota fails visibly without deleting previously stored images',
  async (kind) => {
    const f = fixture(kind);
    f.db
      .prepare('INSERT INTO doc_images VALUES(?,?,?,zeroblob(?))')
      .run(f.item.id, 'existing', 'image/png', DOCUMENT_IMAGE_LIMIT);
    await expect(f.docs.upload(f.owner.id, f.item.id, await png(), 'image/png')).rejects.toThrow(
      '50 MiB',
    );
    expect(f.db.prepare('SELECT length(data) AS n FROM doc_images').get()?.n).toBe(
      DOCUMENT_IMAGE_LIMIT,
    );
  },
);

test('Sheet uploads retain supported formats and only current account owners or editors can add bytes', async () => {
  const f = fixture('sheet');
  const editor = f.auth.createUser('Editor');
  const viewer = f.auth.createUser('Viewer');
  const outsider = f.auth.createUser('Outsider');
  const operator = f.auth.createUser('Operator', true);
  const credential = new Map(
    [f.owner, editor, viewer, outsider, operator].map((user) => [
      user.id,
      { sessionHash: f.auth.createSession(user.id).session.token_hash },
    ]),
  );
  f.workspace.share(f.owner.id, f.item.id, editor.id, 'editor');
  f.workspace.share(f.owner.id, f.item.id, viewer.id, 'viewer');
  const other = f.workspace.create(f.owner.id, {
    name: 'Other Sheet',
    kind: 'sheet',
    parentId: null,
  });
  for (const format of ['png', 'jpeg', 'webp'] as const) {
    const bytes = await sharp(await png())
      .toFormat(format)
      .toBuffer();
    const mime = `image/${format}`;
    const uploaded = await f.docs.upload(
      editor.id,
      f.item.id,
      bytes,
      mime,
      credential.get(editor.id),
    );
    expect(
      await f.docs.upload(f.owner.id, f.item.id, bytes, mime, credential.get(f.owner.id)),
    ).toEqual(uploaded);
    expect(uploaded.url).toBe(`/api/items/${f.item.id}/images/${uploaded.id}`);
    const image = f.docs.image(viewer.id, f.item.id, uploaded.id, credential.get(viewer.id));
    expect(image.mime).toBe(mime);
    expect(await sharp(Buffer.from(image.data)).metadata()).toMatchObject({
      format,
      width: 3,
      height: 2,
    });
    expect(() =>
      f.docs.image(f.owner.id, other.id, uploaded.id, credential.get(f.owner.id)),
    ).toThrow('not found');
    for (const user of [viewer, outsider, operator])
      await expect(
        f.docs.upload(user.id, f.item.id, bytes, mime, credential.get(user.id)),
      ).rejects.toThrow();
  }
  expect(f.db.prepare('SELECT count(*) AS n FROM doc_images').get()?.n).toBe(3);
  const folder = f.workspace.create(f.owner.id, { name: 'Folder', kind: 'folder', parentId: null });
  await expect(
    f.docs.upload(f.owner.id, folder.id, await png(), 'image/png', credential.get(f.owner.id)),
  ).rejects.toThrow('cannot contain images');
});

test.each(['viewer', 'editor'] as const)(
  'ordinary Sheet %s guests can read stored images but cannot upload',
  async (role) => {
    const f = fixture('sheet');
    const bytes = await png();
    const uploaded = await f.docs.upload(f.owner.id, f.item.id, bytes, 'image/png');
    const link = f.workspace.links.begin(f.item.id, role);
    f.workspace.links.finish(f.item.id, link.epoch, true);
    const session = f.workspace.links.exchange(f.item.id, link.token!);
    const guest = f.workspace.links.principal(
      { cookie: `${guestCookieName(f.item.id)}=${session.token}` },
      f.item.id,
    );
    const custom = { guestHash: guest.guestHash, guestItem: f.item.id };
    expect(f.docs.image(guest.userId, f.item.id, uploaded.id, custom).mime).toBe('image/png');
    // Even an edit link cannot create Sheet image bytes; Doc edit links remain supported.
    await expect(
      f.docs.upload(guest.userId, f.item.id, bytes, 'image/png', custom),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.db.prepare('SELECT count(*) AS n FROM doc_images').get()?.n).toBe(1);
  },
);

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
