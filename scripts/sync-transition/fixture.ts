import { createHash, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { ImageSourceType, LocaleType } from '@univerjs/core';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import type { IDocImage } from '@univerjs/docs-drawing';
import { formulaBody } from '@spinel/doc-formulas';
import { materialize } from '@spinel/sync-server';
import type { NativeSnapshot, DocumentKind } from '@spinel/sync-server';
import { openDatabase } from '../../server/database.ts';
import { AuthStore, hashToken } from '../../src/server/auth/store.ts';
import { AccessTokens } from '../../src/server/auth/tokens.ts';
import { CollaborationGenerations } from '../../src/server/collaboration/generations.ts';
import { WorkspaceStore } from '../../src/server/workspace/store.ts';
import { DocumentStore } from '../../src/server/workspace/documents.ts';
import { SheetStore } from '../../src/server/workspace/sheets.ts';
import { migrateSpaceSchema } from '../../src/server/workspace/space-schema.ts';
import { SpaceStore } from '../../src/server/workspace/spaces.ts';
import { SpaceRecoveryStore } from '../../src/server/workspace/space-recovery.ts';
import { SQLiteSyncStorage } from '../../src/server/sync/store.ts';

export type TransitionFixtureUnit = {
  itemId: string;
  unitId: string;
  kind: DocumentKind;
  revision: number;
  snapshot: NativeSnapshot;
};

/** Synthetic private-data fixture, never an operator database. Shared by unit and
 * actual public-SDK conversion proofs so the latter cannot use a narrower corpus. */
export function transitionFixture(path: string) {
  const db = openDatabase(path);
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  migrateSpaceSchema(db);
  new SheetStore(workspace);
  const documents = new DocumentStore(workspace);
  new CollaborationGenerations(workspace);
  db.exec(`CREATE TABLE workspace_collaboration (
    item_id TEXT PRIMARY KEY REFERENCES workspace_items(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK(state IN ('preparing','ready'))) STRICT;
    CREATE TABLE spinel_generation_resources (
      unit_id TEXT PRIMARY KEY,item_id TEXT NOT NULL REFERENCES workspace_items(id) ON DELETE CASCADE,resources TEXT NOT NULL) STRICT;
    CREATE TABLE history_checkpoints (
      id TEXT PRIMARY KEY,item_id TEXT NOT NULL REFERENCES workspace_items(id) ON DELETE CASCADE,
      source TEXT NOT NULL CHECK(source IN ('native','collaboration')),revision INTEGER NOT NULL,
      captured_at INTEGER NOT NULL,name TEXT,snapshot BLOB NOT NULL,UNIQUE(item_id,source,revision)) STRICT;
    CREATE TABLE history_restore_labels (
      checkpoint_id TEXT PRIMARY KEY REFERENCES history_checkpoints(id) ON DELETE CASCADE) STRICT;
    CREATE TABLE history_progress (
      item_id TEXT NOT NULL REFERENCES workspace_items(id) ON DELETE CASCADE,
      source TEXT NOT NULL CHECK(source IN ('native','collaboration')),revision INTEGER NOT NULL,
      edited_at INTEGER NOT NULL,captured_at INTEGER NOT NULL,PRIMARY KEY(item_id,source)) STRICT;`);
  const owner = auth.createUser('Retained Owner');
  const editor = auth.createUser('Retained Editor');
  const viewer = auth.createUser('Retained Viewer');
  const outsider = auth.createUser('Unrelated');
  const operator = auth.createUser('Content-blind Operator', true);
  const disabled = auth.createUser('Disabled owner awaiting handover');
  const sessions = new Map(
    [owner, editor, viewer, outsider, operator].map((user) => [
      user.id,
      auth.createSession(user.id),
    ]),
  );
  const sheet = workspace.create(owner.id, {
    name: 'Retained budget',
    kind: 'sheet',
    parentId: null,
  });
  const doc = workspace.create(owner.id, { name: 'Retained journal', kind: 'doc', parentId: null });
  const disabledDoc = workspace.create(disabled.id, {
    name: 'Handover journal',
    kind: 'doc',
    parentId: null,
  });
  const native = workspace.create(owner.id, {
    name: 'Already native',
    kind: 'doc',
    parentId: null,
  });
  const unopened = workspace.create(owner.id, {
    name: 'Native save only',
    kind: 'doc',
    parentId: null,
  });
  const spaces = new SpaceStore(workspace);
  const root = spaces.createRoot(owner.id, { name: 'Retained project', parentId: null }).space;
  const folder = spaces.createChild(owner.id, root.id, {
    name: 'Section',
    kind: 'folder',
    parentId: root.id,
  }).item;
  const child = spaces.createChild(owner.id, root.id, {
    name: 'Page',
    kind: 'doc',
    parentId: folder.id,
  }).item;
  const deleted = spaces.createChild(owner.id, root.id, {
    name: 'Recoverable sheet',
    kind: 'sheet',
    parentId: folder.id,
  }).item;
  for (const [user, role] of [
    [editor, 'editor'],
    [viewer, 'viewer'],
  ] as const) {
    workspace.share(owner.id, sheet.id, user.id, role);
    workspace.share(owner.id, doc.id, user.id, role);
    spaces.share(owner.id, root.id, user.id, role);
  }
  const generation = randomUUID();
  const named = randomUUID();
  const beforeRestore = randomUUID();
  const restoreId = randomUUID();
  db.prepare('INSERT INTO spinel_live_units VALUES(?,?,7)').run(doc.id, generation);
  db.prepare("INSERT INTO spinel_restore_jobs VALUES(?,?,?,?,?,?,'complete',8)").run(
    restoreId,
    doc.id,
    owner.id,
    named,
    doc.id,
    generation,
  );
  const formula = { version: 1 as const, expression: '={1,2;3,4}', references: [] };
  const body = {
    ...formulaBody('retained-formula', formula),
    dataStream: formula.expression + '\r\n',
  };
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMd0AAAAASUVORK5CYII=',
    'base64',
  );
  const imageId = createHash('sha256').update(image).digest('hex');
  db.prepare('INSERT INTO doc_images VALUES(?,?,?,?)').run(child.id, imageId, 'image/png', image);
  const book = (id: string): IWorkbookData => ({
    id,
    name: 'Retained budget',
    appVersion: '1.1.0',
    locale: LocaleType.EN_US,
    sheetOrder: ['first'],
    styles: {},
    sheets: {
      first: {
        id: 'first',
        name: 'Sheet1',
        rowCount: 100,
        columnCount: 10,
        cellData: { 0: { 0: { v: 'Retained private cell' }, 1: { f: '=1+2' } } },
      },
    },
  });
  const document = (id: string): IDocumentData => ({
    id,
    documentStyle: {},
    body: structuredClone(body),
  });
  const photo: IDocImage = {
    unitId: child.id,
    subUnitId: child.id,
    drawingId: 'photo',
    drawingType: 0,
    imageSourceType: ImageSourceType.URL,
    source: `/api/items/${child.id}/images/${imageId}`,
    layoutType: 0,
    docTransform: {
      size: { width: 3, height: 2 },
      positionH: { relativeFrom: 0, posOffset: 0 },
      positionV: { relativeFrom: 0, posOffset: 0 },
      angle: 0,
    },
  };
  const childSnapshot: IDocumentData = {
    ...document(child.id),
    drawings: { photo },
    drawingsOrder: ['photo'],
  };
  const units: TransitionFixtureUnit[] = [
    { itemId: sheet.id, unitId: sheet.id, kind: 'sheet', revision: 1, snapshot: book(sheet.id) },
    {
      itemId: doc.id,
      unitId: generation,
      kind: 'doc',
      revision: 1,
      snapshot: document(generation),
    },
    { itemId: child.id, unitId: child.id, kind: 'doc', revision: 1, snapshot: childSnapshot },
    {
      itemId: deleted.id,
      unitId: deleted.id,
      kind: 'sheet',
      revision: 1,
      snapshot: book(deleted.id),
    },
    {
      itemId: disabledDoc.id,
      unitId: disabledDoc.id,
      kind: 'doc',
      revision: 1,
      snapshot: document(disabledDoc.id),
    },
  ];
  for (const unit of units)
    db.prepare("INSERT INTO workspace_collaboration VALUES(?,'ready')").run(unit.itemId);
  const opaque = [
    { name: 'SPINEL_TRANSITION_FIXTURE', data: JSON.stringify({ retained: 'opaque metadata' }) },
  ];
  db.prepare('INSERT INTO spinel_generation_resources VALUES(?,?,?)').run(
    generation,
    doc.id,
    JSON.stringify(opaque),
  );
  const point = (text: string) =>
    gzipSync(
      JSON.stringify({ id: doc.id, documentStyle: {}, body: { dataStream: text + '\r\n' } }),
    );
  db.prepare(
    "INSERT INTO history_checkpoints VALUES(?,?,'collaboration',5,100,'Named retained version',?)",
  ).run(named, doc.id, point('Earlier named content'));
  db.prepare("INSERT INTO history_checkpoints VALUES(?,?,'collaboration',7,200,NULL,?)").run(
    beforeRestore,
    doc.id,
    point('Before retained restore'),
  );
  db.prepare('INSERT INTO history_restore_labels VALUES(?)').run(beforeRestore);
  db.prepare("INSERT INTO history_progress VALUES(?,'collaboration',8,300,200)").run(doc.id);
  const sync = new SQLiteSyncStorage(auth);
  sync.create(
    {
      unitId: native.id,
      kind: 'doc',
      revision: 1,
      retainedFrom: 1,
      snapshot: materialize(
        { id: native.id, documentStyle: {}, body: { dataStream: 'Existing native\r\n' } },
        'doc',
      ),
    },
    () => {},
  );
  db.prepare("INSERT INTO workspace_collaboration VALUES(?,'ready')").run(native.id);
  documents.save(owner.id, unopened.id, {
    revision: 0,
    writeId: randomUUID(),
    snapshot: {
      id: unopened.id,
      documentStyle: {},
      body: { dataStream: 'Unopened native save\r\n' },
    },
  });
  const token = new AccessTokens(auth).create(editor.id, 'Retained MCP token');
  const link = workspace.links.begin(root.id, 'editor');
  workspace.links.finish(root.id, link.epoch, true);
  const guest = workspace.links.exchange(root.id, link.token);
  const recovery = new SpaceRecoveryStore(workspace);
  recovery.trash(owner.id, root.id, deleted.id);
  db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(disabled.id);
  return {
    db,
    auth,
    workspace,
    owner,
    editor,
    viewer,
    outsider,
    operator,
    disabled,
    sheet,
    doc,
    root,
    folder,
    child,
    deleted,
    disabledDoc,
    native,
    unopened,
    generation,
    named,
    beforeRestore,
    restoreId,
    formula,
    imageId,
    image,
    units,
    sessions,
    token,
    guest,
    custom(userId = owner.id, itemId?: string) {
      return {
        sessionHash: sessions.get(userId)!.session.token_hash,
        ...(itemId && { spaceId: root.id, spaceItem: itemId }),
      };
    },
    guestCustom(itemId: string) {
      return {
        guestHash: hashToken(guest.token),
        guestItem: root.id,
        spaceId: root.id,
        spaceItem: itemId,
      };
    },
  };
}
