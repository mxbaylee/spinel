import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { Sharp } from 'sharp';
import { afterEach, expect, test, vi } from 'vitest';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { LocaleType } from '@univerjs/core';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { AccessTokens } from '../auth/tokens.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import { CollaborationGenerations } from '../collaboration/generations.ts';
import { createHistoryReadContext } from './document-access.ts';
import { DocumentStore } from './documents.ts';
import { guestCookieName } from './links.ts';
import { PortableFiles } from './portable.ts';
import { SpaceLifecycleStore } from './space-lifecycle.ts';
import { SpaceRecoveryStore } from './space-recovery.ts';
import { migrateSpaceSchema } from './space-schema.ts';
import { SpaceStore } from './spaces.ts';
import { WorkspaceStore } from './store.ts';

const databases: DatabaseSync[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) db.close();
});

function fixture(spacesEnabled = true) {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth, { spacesEnabled });
  migrateSpaceSchema(db);
  const owner = auth.createUser('Owner');
  const editor = auth.createUser('Editor');
  const viewer = auth.createUser('Viewer');
  const outsider = auth.createUser('Outsider');
  const operator = auth.createUser('Operator', true);
  const sessions = new Map(
    [owner, editor, viewer, outsider, operator].map((user) => [
      user.id,
      auth.createSession(user.id).session.token_hash,
    ]),
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
  const sheet = spaces.createChild(owner.id, space.id, {
    name: 'Budget',
    kind: 'sheet',
    parentId: space.id,
  }).item;
  const otherSpace = spaces.createRoot(owner.id, { name: 'Another project', parentId: null }).space;
  spaces.share(owner.id, space.id, editor.id, 'editor');
  spaces.share(owner.id, space.id, viewer.id, 'viewer');
  const context = (user = owner.id, item = doc.id) => ({
    sessionHash: sessions.get(user)!,
    spaceId: space.id,
    spaceItem: item,
  });
  const guest = (role: 'viewer' | 'editor', root = space.id) => {
    const link = workspace.links.begin(root, role);
    workspace.links.finish(root, link.epoch, true);
    const session = workspace.links.exchange(root, link.token!);
    const principal = workspace.links.principal(
      { cookie: `${guestCookieName(root)}=${session.token}` },
      root,
    );
    return {
      user: principal.userId,
      context: {
        guestHash: principal.guestHash,
        guestItem: root,
        spaceId: root,
        spaceItem: doc.id,
      },
    };
  };
  const docs = new DocumentStore(workspace);
  const tokens = new AccessTokens(auth);
  const token = tokens.create(editor.id, 'Space assistant');
  const mcp = {
    mcpTokenHash: tokens.authenticate(token.token).hash,
    spaceId: space.id,
    spaceItem: doc.id,
  };
  const generations = new CollaborationGenerations(workspace);
  const snapshots = new Map<string, IDocumentData | IWorkbookData>([
    [doc.id, { id: doc.id, documentStyle: {}, body: { dataStream: 'Current native notes\r\n' } }],
    [
      sibling.id,
      { id: sibling.id, documentStyle: {}, body: { dataStream: 'Other native notes\r\n' } },
    ],
    [
      sheet.id,
      {
        id: sheet.id,
        name: 'Budget',
        appVersion: '1.1.0',
        locale: LocaleType.EN_US,
        styles: {},
        sheetOrder: ['tab'],
        sheets: {
          tab: {
            id: 'tab',
            name: 'Summary',
            rowCount: 100,
            columnCount: 26,
            cellData: { 0: { 0: { v: 42 } } },
          },
        },
      },
    ],
  ]);
  // Keep the real authorization, image decoder and generation records. Hold only
  // native materialization so each revocation window is deterministic and small.
  const prepare = vi.fn(async (_user: string, _id: string, _custom: Record<string, unknown>) => {});
  const load = vi.fn(async (_user: string, id: string, _custom: Record<string, unknown>) => ({
    snapshot: snapshots.get(id)!,
  }));
  const collaboration = { prepare, load, generations } as unknown as CollaborationStore;
  const files = new PortableFiles(workspace, collaboration);
  return {
    db,
    auth,
    workspace,
    owner,
    editor,
    viewer,
    outsider,
    operator,
    sessions,
    spaces,
    space,
    folder,
    doc,
    sibling,
    sheet,
    otherSpace,
    context,
    guest,
    docs,
    tokens,
    token,
    mcp,
    generations,
    snapshots,
    prepare,
    load,
    files,
    recovery: new SpaceRecoveryStore(workspace),
    lifecycle: new SpaceLifecycleStore(workspace),
  };
}

const png = (background = '#c733aa') =>
  sharp({ create: { width: 3, height: 2, channels: 4, background } })
    .png()
    .toBuffer();
const imageRows = (db: DatabaseSync) =>
  db.prepare('SELECT * FROM doc_images ORDER BY item_id,id').all();

test.each(['editor', 'admin'] as const)(
  'Space %s image reads and Doc uploads use the current role and leave ordinary snapshots closed',
  async (role) => {
    const f = fixture();
    f.spaces.share(f.owner.id, f.space.id, f.editor.id, role);
    const bytes = await png();
    const uploaded = await f.docs.upload(
      f.editor.id,
      f.doc.id,
      bytes,
      'image/png',
      f.context(f.editor.id),
    );
    expect(uploaded.url).toBe(`/api/items/${f.doc.id}/images/${uploaded.id}`);
    expect(await f.docs.upload(f.owner.id, f.doc.id, bytes, 'image/png', f.context())).toEqual(
      uploaded,
    );
    expect(
      Buffer.from(f.docs.image(f.viewer.id, f.doc.id, uploaded.id, f.context(f.viewer.id)).data),
    ).toEqual(bytes);
    await expect(
      f.docs.upload(f.viewer.id, f.doc.id, bytes, 'image/png', f.context(f.viewer.id)),
    ).rejects.toThrow();
    for (const user of [f.outsider, f.operator])
      expect(() => f.docs.image(user.id, f.doc.id, uploaded.id, f.context(user.id))).toThrow();
    expect(() => f.docs.image(f.owner.id, f.doc.id, uploaded.id)).toThrow();
    expect(() => f.docs.load(f.owner.id, f.doc.id)).toThrow();
    expect(() =>
      f.docs.save(f.owner.id, f.doc.id, {
        snapshot: f.snapshots.get(f.doc.id),
        revision: 0,
        writeId: randomUUID(),
      }),
    ).toThrow();
    expect(() => f.workspace.get(f.owner.id, f.doc.id)).toThrow();
    await expect(
      f.docs.upload(f.owner.id, f.sheet.id, bytes, 'image/png', f.context(f.owner.id, f.sheet.id)),
    ).rejects.toThrow();
    f.db
      .prepare('INSERT INTO doc_images SELECT ?,id,mime,data FROM doc_images WHERE item_id=?')
      .run(f.sheet.id, f.doc.id);
    expect(
      Buffer.from(
        f.docs.image(f.viewer.id, f.sheet.id, uploaded.id, f.context(f.viewer.id, f.sheet.id)).data,
      ),
    ).toEqual(bytes);
  },
);

test('Space images require the exact root, child and credential without borrowing an accessible sibling image', async () => {
  const f = fixture();
  const uploaded = await f.docs.upload(f.owner.id, f.doc.id, await png(), 'image/png', f.context());
  for (const custom of [
    {},
    { sessionHash: f.sessions.get(f.owner.id) },
    { spaceId: f.space.id, spaceItem: f.doc.id },
    { ...f.context(), spaceId: f.otherSpace.id },
    { ...f.context(), spaceItem: f.sibling.id },
    { ...f.context(), sessionHash: f.sessions.get(f.editor.id) },
    { ...f.context(), guestHash: 'forged', guestItem: f.space.id },
    { ...f.context(), mcpTokenHash: f.mcp.mcpTokenHash },
  ])
    expect(() => f.docs.image(f.owner.id, f.doc.id, uploaded.id, custom)).toThrow();
  expect(() =>
    f.docs.image(f.owner.id, f.sibling.id, uploaded.id, f.context(f.owner.id, f.sibling.id)),
  ).toThrow('not found');
  expect(() =>
    f.docs.validateImages(f.sibling.id, {
      id: f.sibling.id,
      documentStyle: {},
      body: { dataStream: 'Borrowed\r\n' },
      drawings: { image: { source: uploaded.url } } as unknown as IDocumentData['drawings'],
    }),
  ).toThrow();
  f.docs.validateImages(f.doc.id, {
    id: f.doc.id,
    documentStyle: {},
    body: { dataStream: 'Owned\r\n' },
    drawings: { image: { source: uploaded.url } } as unknown as IDocumentData['drawings'],
  });
});

test('the runtime gate keeps scoped images and exports unavailable before ordinary Space activation', async () => {
  const f = fixture(false);
  await expect(
    f.docs.upload(f.owner.id, f.doc.id, await png(), 'image/png', f.context()),
  ).rejects.toThrow();
  expect(() => f.docs.image(f.owner.id, f.doc.id, 'a'.repeat(64), f.context())).toThrow();
  await expect(f.files.export(f.owner.id, f.doc.id, () => {}, f.context())).rejects.toThrow();
  expect(f.prepare).not.toHaveBeenCalled();
  expect(imageRows(f.db)).toEqual([]);
});

test('exact root guests inherit image View/Edit for future children and lose access when their link rotates', async () => {
  const f = fixture();
  const bytes = await png();
  const uploaded = await f.docs.upload(f.owner.id, f.doc.id, bytes, 'image/png', f.context());
  const viewer = f.guest('viewer');
  expect(
    Buffer.from(f.docs.image(viewer.user, f.doc.id, uploaded.id, viewer.context).data),
  ).toEqual(bytes);
  await expect(
    f.docs.upload(viewer.user, f.doc.id, bytes, 'image/png', viewer.context),
  ).rejects.toThrow();
  const editor = f.guest('editor');
  expect(() => f.docs.image(viewer.user, f.doc.id, uploaded.id, viewer.context)).toThrow();
  const future = f.spaces.createChild(f.owner.id, f.space.id, {
    name: 'Added later',
    kind: 'doc',
    parentId: f.space.id,
  }).item;
  const custom = { ...editor.context, spaceItem: future.id };
  expect(await f.docs.upload(editor.user, future.id, bytes, 'image/png', custom)).toMatchObject({
    id: uploaded.id,
  });
  expect(Buffer.from(f.docs.image(editor.user, future.id, uploaded.id, custom).data)).toEqual(
    bytes,
  );
  const wrongRoot = f.guest('editor', f.otherSpace.id);
  expect(() =>
    f.docs.image(wrongRoot.user, f.doc.id, uploaded.id, {
      ...wrongRoot.context,
      spaceId: f.space.id,
    }),
  ).toThrow();
  expect(() =>
    f.docs.image(editor.user, f.doc.id, uploaded.id, {
      ...editor.context,
      guestItem: f.otherSpace.id,
    }),
  ).toThrow();
});

test('MCP image access remains tied to its own current credential', async () => {
  const f = fixture();
  const bytes = await png();
  const uploaded = await f.docs.upload(f.editor.id, f.doc.id, bytes, 'image/png', f.mcp);
  expect(Buffer.from(f.docs.image(f.editor.id, f.doc.id, uploaded.id, f.mcp).data)).toEqual(bytes);
  f.tokens.revoke(f.editor.id, f.token.id);
  expect(() => f.docs.image(f.editor.id, f.doc.id, uploaded.id, f.mcp)).toThrow();
  await expect(f.docs.upload(f.editor.id, f.doc.id, bytes, 'image/png', f.mcp)).rejects.toThrow();
});

const accessChanges = [
  [
    'session revoked',
    (f: ReturnType<typeof fixture>) => f.auth.revokeSession(f.sessions.get(f.editor.id)!),
  ],
  [
    'grant removed',
    (f: ReturnType<typeof fixture>) => f.spaces.share(f.owner.id, f.space.id, f.editor.id, null),
  ],
  [
    'ancestor trashed',
    (f: ReturnType<typeof fixture>) => f.recovery.trash(f.owner.id, f.space.id, f.folder.id),
  ],
  ['Space trashed', (f: ReturnType<typeof fixture>) => f.lifecycle.trash(f.owner.id, f.space.id)],
  [
    'owner disabled',
    (f: ReturnType<typeof fixture>) =>
      f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id),
  ],
  [
    'ancestry changed',
    (f: ReturnType<typeof fixture>) =>
      f.db
        .prepare('UPDATE workspace_items SET parent_id=? WHERE id=?')
        .run(f.otherSpace.id, f.folder.id),
  ],
] as const;

test.each(accessChanges)(
  'image decode refuses a late %s without inserting or deleting image bytes',
  async (_name, change) => {
    const f = fixture();
    const bytes = await png();
    f.db
      .prepare('INSERT INTO doc_images VALUES(?,?,?,?)')
      .run(f.doc.id, 'a'.repeat(64), 'image/png', Buffer.from('retained bytes'));
    const before = imageRows(f.db);
    const pending = f.docs.upload(
      f.editor.id,
      f.doc.id,
      bytes,
      'image/png',
      f.context(f.editor.id),
    );
    change(f);
    await expect(pending).rejects.toThrow();
    expect(imageRows(f.db)).toEqual(before);
  },
);

test('the final image transaction checks a downgrade after full decoding', async () => {
  const f = fixture();
  const bytes = await png();
  const decode = sharp.prototype.toBuffer;
  vi.spyOn(sharp.prototype, 'toBuffer').mockImplementationOnce(async function (this: Sharp) {
    const decoded = await decode.call(this);
    f.spaces.share(f.owner.id, f.space.id, f.editor.id, 'viewer');
    return decoded;
  });
  await expect(
    f.docs.upload(f.editor.id, f.doc.id, bytes, 'image/png', f.context(f.editor.id)),
  ).rejects.toThrow();
  expect(imageRows(f.db)).toEqual([]);
});

test('an in-flight upload cannot replace its revoked credential with a fresh session', async () => {
  const f = fixture();
  const bytes = await png();
  const custom = f.context(f.editor.id);
  const pending = f.docs.upload(f.editor.id, f.doc.id, bytes, 'image/png', custom);
  f.auth.revokeSession(custom.sessionHash);
  custom.sessionHash = f.auth.createSession(f.editor.id).session.token_hash;
  await expect(pending).rejects.toThrow();
  expect(imageRows(f.db)).toEqual([]);
});

test.each(['rotate', 'downgrade', 'expire'] as const)(
  'guest image decode refuses a link %s',
  async (change) => {
    const f = fixture();
    const guest = f.guest('editor');
    const bytes = await png();
    const pending = f.docs.upload(guest.user, f.doc.id, bytes, 'image/png', guest.context);
    if (change === 'expire') f.db.prepare('UPDATE workspace_guest_sessions SET expires_at=0').run();
    else f.guest(change === 'downgrade' ? 'viewer' : 'editor');
    await expect(pending).rejects.toThrow();
    expect(imageRows(f.db)).toEqual([]);
  },
);

test('an MCP token revoked during image decode cannot publish bytes', async () => {
  const f = fixture();
  const bytes = await png();
  const pending = f.docs.upload(f.editor.id, f.doc.id, bytes, 'image/png', f.mcp);
  f.tokens.revoke(f.editor.id, f.token.id);
  await expect(pending).rejects.toThrow();
  expect(imageRows(f.db)).toEqual([]);
});

test.each(['viewer', 'admin'] as const)(
  'scoped native exports preserve current Docs, Sheets and exact-child embedded images for account %s',
  async (role) => {
    const f = fixture();
    f.spaces.share(f.owner.id, f.space.id, f.viewer.id, role);
    const bytes = await png();
    const image = await f.docs.upload(f.owner.id, f.doc.id, bytes, 'image/png', f.context());
    const snapshot = f.snapshots.get(f.doc.id) as IDocumentData;
    snapshot.drawings = {
      picture: { source: image.url, imageSourceType: 'URL' },
    } as unknown as IDocumentData['drawings'];
    const before = structuredClone(snapshot);
    const custom = f.context(f.viewer.id);
    const exported = await f.files.export(f.viewer.id, f.doc.id, () => {}, custom);
    expect(exported.filename).toBe('Notes.univer.json');
    expect(JSON.parse(exported.text).drawings.picture.source).toBe(
      `data:image/png;base64,${bytes.toString('base64')}`,
    );
    expect(snapshot).toEqual(before);
    expect(f.prepare).toHaveBeenCalledWith(f.viewer.id, f.doc.id, custom);
    expect(f.load).toHaveBeenCalledWith(f.viewer.id, f.doc.id, custom);
    expect(
      JSON.parse(
        (
          await f.files.export(
            f.viewer.id,
            f.sheet.id,
            () => {},
            f.context(f.viewer.id, f.sheet.id),
          )
        ).text,
      ),
    ).toEqual(f.snapshots.get(f.sheet.id));
    f.spaces.share(f.owner.id, f.space.id, f.editor.id, 'viewer');
    expect(
      JSON.parse(
        (await f.files.export(f.editor.id, f.doc.id, () => {}, f.context(f.editor.id))).text,
      ).body,
    ).toEqual(snapshot.body);
  },
);

test('native export rejects guests, implicit or mismatched scope, and Space legacy fallback before materializing', async () => {
  const f = fixture();
  const guest = f.guest('editor');
  await expect(f.files.export(guest.user, f.doc.id, () => {}, guest.context)).rejects.toThrow();
  await expect(f.files.export(f.editor.id, f.doc.id, () => {}, f.mcp)).rejects.toThrow();
  for (const user of [f.outsider, f.operator])
    await expect(f.files.export(user.id, f.doc.id, () => {}, f.context(user.id))).rejects.toThrow();
  for (const custom of [
    {},
    { ...f.context(), spaceId: f.otherSpace.id },
    { ...f.context(), spaceItem: f.sibling.id },
    { ...f.context(), sessionHash: f.sessions.get(f.editor.id) },
  ])
    await expect(f.files.export(f.owner.id, f.doc.id, () => {}, custom)).rejects.toThrow();
  await expect(
    new PortableFiles(f.workspace).export(f.owner.id, f.doc.id, () => {}, f.context()),
  ).rejects.toThrow();
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.load).not.toHaveBeenCalled();
});

test('a private history read cannot become an image write or native export when its context is copied', async () => {
  const f = fixture();
  const bytes = await png();
  const image = await f.docs.upload(f.owner.id, f.doc.id, bytes, 'image/png', f.context());
  const custom = createHistoryReadContext(f.workspace, f.owner.id, f.space.id, f.doc.id);
  expect(Buffer.from(f.docs.image(f.owner.id, f.doc.id, image.id, custom).data)).toEqual(bytes);
  await expect(f.docs.upload(f.owner.id, f.doc.id, bytes, 'image/png', custom)).rejects.toThrow();
  await expect(f.files.export(f.owner.id, f.doc.id, () => {}, custom)).rejects.toThrow();
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.load).not.toHaveBeenCalled();
});

test.each(accessChanges)(
  'native export refuses a late %s at each materialization boundary',
  async (_name, change) => {
    for (const stage of ['prepare', 'load'] as const) {
      const f = fixture();
      if (stage === 'prepare')
        f.prepare.mockImplementationOnce(async () => {
          change(f);
        });
      else
        f.load.mockImplementationOnce(async (_user, id) => {
          change(f);
          return { snapshot: f.snapshots.get(id)! };
        });
      await expect(
        f.files.export(f.editor.id, f.doc.id, () => {}, f.context(f.editor.id)),
      ).rejects.toThrow();
      if (stage === 'prepare') expect(f.load).not.toHaveBeenCalled();
    }
  },
);

test.each(['changed', 'restoring'] as const)(
  'native export refuses a generation %s during its read',
  async (change) => {
    const f = fixture();
    f.load.mockImplementationOnce(async (_user, id) => {
      if (change === 'changed')
        f.db.prepare('INSERT INTO spinel_live_units VALUES(?,?,?)').run(id, randomUUID(), 10);
      else
        f.db
          .prepare("INSERT INTO spinel_restore_jobs VALUES(?,?,?,?,?,?,'staging',NULL)")
          .run(randomUUID(), id, f.owner.id, randomUUID(), id, randomUUID());
      return { snapshot: f.snapshots.get(id)! };
    });
    await expect(f.files.export(f.owner.id, f.doc.id, () => {}, f.context())).rejects.toThrow(
      'restored',
    );
  },
);

test('native export refuses a readable sibling image and rechecks authority after embedding', async () => {
  const f = fixture();
  const bytes = await png();
  const foreign = await f.docs.upload(
    f.owner.id,
    f.sibling.id,
    bytes,
    'image/png',
    f.context(f.owner.id, f.sibling.id),
  );
  const snapshot = f.snapshots.get(f.doc.id) as IDocumentData;
  snapshot.drawings = { picture: { source: foreign.url } } as unknown as IDocumentData['drawings'];
  await expect(f.files.export(f.owner.id, f.doc.id, () => {}, f.context())).rejects.toThrow(
    'safely',
  );
  const image = await f.docs.upload(f.owner.id, f.doc.id, bytes, 'image/png', f.context());
  snapshot.drawings = { picture: { source: image.url } } as unknown as IDocumentData['drawings'];
  const read = f.files.docs.image.bind(f.files.docs);
  vi.spyOn(f.files.docs, 'image').mockImplementationOnce((...args) => {
    const result = read(...args);
    f.spaces.share(f.owner.id, f.space.id, f.viewer.id, null);
    return result;
  });
  await expect(
    f.files.export(f.viewer.id, f.doc.id, () => {}, f.context(f.viewer.id)),
  ).rejects.toThrow();
});

test('native export preserves the admitted session even if its context is changed during loading', async () => {
  const f = fixture();
  const custom = f.context(f.editor.id);
  f.load.mockImplementationOnce(async (_user, id) => {
    f.auth.revokeSession(custom.sessionHash);
    custom.sessionHash = f.auth.createSession(f.editor.id).session.token_hash;
    return { snapshot: f.snapshots.get(id)! };
  });
  await expect(f.files.export(f.editor.id, f.doc.id, () => {}, custom)).rejects.toThrow();
});
