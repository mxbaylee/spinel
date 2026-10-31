/** Acceptance-only native dataset. Run in a disposable bootstrap process that
 * exits before supervisor ownership. The caller owns its database; these phases
 * close their own native/history services and never create account sessions. */
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import {
  DrawingTypeEnum,
  ImageSourceType,
  JSONX,
  PositionedObjectLayoutType,
} from '@univerjs/core';
import type { IDocumentBody, IDocumentData, IWorkbookData } from '@univerjs/core';
import { RichTextEditingMutation } from '@univerjs/docs';
import type { IDocImage } from '@univerjs/docs-drawing';
import { SetRangeValuesMutation } from '@univerjs/sheets';
import type { AuthStore } from '../auth/store.ts';
import type { WorkspaceStore } from '../workspace/store.ts';
import { DocumentStore } from '../workspace/documents.ts';
import { SheetStore } from '../workspace/sheets.ts';
import { CollaborationStore } from '../collaboration/service.ts';
import { HistoryStore } from '../history/store.ts';
import { blankOfflineSnapshot } from '../../shared/offlineCreation.ts';

export interface RestoreRichCredential {
  id: string;
  publicKey: Uint8Array;
}
export interface RestoreRichMetadata {
  readonly ownerId: string;
  readonly readerId: string;
  readonly docId: string;
  readonly sheetId: string;
  readonly sheetTabId: string;
  readonly imageId: string;
  readonly imageUrl: string;
  readonly imageSha256: string;
  readonly imageBytes: number;
  readonly historyCheckpointId: string;
  readonly historyCheckpointName: string;
  readonly expectedDocText: string;
  readonly expectedDocBodySha256: string;
  readonly expectedSheetValue: string;
  readonly currentDocText: string;
  readonly currentSheetValue: string;
  readonly sourceDocUnitId: string;
  readonly sourceSheetUnitId: string;
  /** Private capability: never put this field in screenshots/public evidence. */
  readonly revokedGuestToken: string;
  readonly revokedGuestEpoch: number;
}
interface Context {
  auth: AuthStore;
  workspace: WorkspaceStore;
}
const digest = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
function context({ auth, workspace }: Context) {
  if (workspace.auth !== auth) throw new Error('Rich fixture stores must share current authority.');
  auth.database.assertQuiescent();
}
function body(text: string, previous: IDocumentBody): IDocumentBody {
  const paragraph = previous.paragraphs?.[0];
  const section = previous.sectionBreaks?.[0];
  if (!paragraph || !section)
    throw new Error('Rich fixture requires native paragraph and section identities.');
  return {
    ...previous,
    dataStream: text,
    paragraphs: [{ ...paragraph, startIndex: text.length - 2 }],
    sectionBreaks: [{ ...section, startIndex: text.length - 1 }],
    customBlocks: [{ startIndex: text.length - 3, blockId: 'restore-image' }],
  };
}

/** Archive only after this promise resolves, while the caller's DB is open.
 * Prepared native units, real uploaded PNG bytes and a named history version are
 * already durable; no periodic jobs or private SDK internals are involved. */
export async function seedRestoreRichFixture(
  input: Context & { ownerId: string },
): Promise<RestoreRichMetadata> {
  context(input);
  const { auth, workspace, ownerId } = input;
  const owner = auth.user(ownerId);
  if (!owner || owner.is_admin)
    throw new Error('Rich fixture requires an existing everyday Owner.');
  const reader = auth.createUser('Restore acceptance Reader');
  const doc = workspace.create(ownerId, {
    kind: 'doc',
    name: 'Archived native journal',
    parentId: null,
  });
  const sheet = workspace.create(ownerId, {
    kind: 'sheet',
    name: 'Archived native budget',
    parentId: null,
  });
  const documents = new DocumentStore(workspace),
    sheets = new SheetStore(workspace);
  const collaboration = new CollaborationStore(workspace, auth.database.path);
  let history: HistoryStore | undefined;
  try {
    history = new HistoryStore(workspace, collaboration);
    const png = await sharp({
      create: { width: 24, height: 16, channels: 4, background: '#7438ae' },
    })
      .png()
      .toBuffer();
    const image = await documents.upload(ownerId, doc.id, png, 'image/png');
    const savedImage = documents.image(ownerId, doc.id, image.id);
    const expectedDocText = 'Archived native document\b\r\n';
    const currentDocText = 'Current native document\b\r\n';
    const document = blankOfflineSnapshot({
      itemId: doc.id,
      kind: 'doc',
      name: doc.name,
    }) as IDocumentData;
    document.body = body(expectedDocText, document.body!);
    const drawing: IDocImage = {
      unitId: doc.id,
      subUnitId: doc.id,
      drawingId: 'restore-image',
      drawingType: DrawingTypeEnum.DRAWING_IMAGE,
      imageSourceType: ImageSourceType.URL,
      source: image.url,
      layoutType: PositionedObjectLayoutType.INLINE,
      docTransform: {
        size: { width: 120, height: 80 },
        positionH: { relativeFrom: 0, posOffset: 0 },
        positionV: { relativeFrom: 0, posOffset: 0 },
        angle: 0,
      },
    };
    document.drawings = { 'restore-image': drawing };
    document.drawingsOrder = ['restore-image'];
    documents.save(ownerId, doc.id, { revision: 0, writeId: randomUUID(), snapshot: document });
    const workbook = blankOfflineSnapshot({
      itemId: sheet.id,
      kind: 'sheet',
      name: sheet.name,
    }) as IWorkbookData;
    const sheetTabId = workbook.sheetOrder[0];
    workbook.sheets[sheetTabId].columnData = {
      ...workbook.sheets[sheetTabId].columnData,
      0: { w: 240 },
    };
    workbook.sheets[sheetTabId].cellData = {
      0: { 0: { v: 'Archived budget value' }, 1: { v: 42 } },
    };
    sheets.save(ownerId, sheet.id, { revision: 0, writeId: randomUUID(), snapshot: workbook });
    await collaboration.prepare(ownerId, doc.id);
    await collaboration.prepare(ownerId, sheet.id);
    const checkpoint = await history.nameCurrent(ownerId, doc.id, 'Archived rich checkpoint');
    workspace.share(ownerId, doc.id, reader.id, 'viewer');
    workspace.share(ownerId, sheet.id, reader.id, 'viewer');
    const guest = workspace.links.begin(doc.id, 'viewer');
    workspace.links.finish(doc.id, guest.epoch, true);
    if (!guest.token) throw new Error('Expected a real guest link capability.');
    const native = (await collaboration.load(ownerId, doc.id)).snapshot as IDocumentData;
    if (native.body?.dataStream !== expectedDocText)
      throw new Error('Native Doc materialization changed fixture content.');
    return Object.freeze({
      ownerId,
      readerId: reader.id,
      docId: doc.id,
      sheetId: sheet.id,
      sheetTabId,
      imageId: image.id,
      imageUrl: image.url,
      imageSha256: digest(savedImage.data),
      imageBytes: savedImage.data.length,
      historyCheckpointId: checkpoint.id,
      historyCheckpointName: checkpoint.name!,
      expectedDocText,
      expectedDocBodySha256: digest(JSON.stringify(native.body)),
      expectedSheetValue: 'Archived budget value',
      currentDocText,
      currentSheetValue: 'Current budget value',
      sourceDocUnitId: collaboration.generations.active(doc.id).unitId,
      sourceSheetUnitId: collaboration.generations.active(sheet.id).unitId,
      revokedGuestToken: guest.token,
      revokedGuestEpoch: guest.epoch,
    });
  } finally {
    try {
      await history?.close();
    } finally {
      await collaboration.close();
    }
  }
}

/** Call after makeArchive. Public keys exist only in frozen current authority;
 * actual login/reauthentication must use the production HTTP/WebAuthn routes. */
export async function mutateRestoreRichCurrent(
  input: Context & {
    metadata: RestoreRichMetadata;
    credentials: { owner: RestoreRichCredential; reader: RestoreRichCredential };
  },
): Promise<void> {
  context(input);
  const { auth, workspace, metadata: m, credentials } = input;
  const entries = [
    [m.ownerId, credentials.owner],
    [m.readerId, credentials.reader],
  ] as const;
  if (credentials.owner.id === credentials.reader.id)
    throw new Error('Fixture public credential IDs must be distinct.');
  for (const [actor, credential] of entries) {
    const user = auth.user(actor);
    if (
      !user ||
      user.is_admin ||
      !/^[A-Za-z0-9_-]{43}$/.test(credential.id) ||
      credential.publicKey.byteLength !== 77 ||
      auth.database.prepare('SELECT 1 FROM auth_passkeys WHERE id=?').get(credential.id)
    )
      throw new Error(
        'Fixture requires new public COSE credentials for its original everyday accounts.',
      );
  }
  const collaboration = new CollaborationStore(workspace, auth.database.path);
  let history: HistoryStore | undefined;
  try {
    history = new HistoryStore(workspace, collaboration);
    const doc = await collaboration.load(m.ownerId, m.docId);
    const snapshot = doc.snapshot as IDocumentData;
    const sheet = await collaboration.load(m.ownerId, m.sheetId);
    const workbook = sheet.snapshot as IWorkbookData;
    if (
      snapshot.body?.dataStream !== m.expectedDocText ||
      digest(JSON.stringify(snapshot.body)) !== m.expectedDocBodySha256 ||
      workbook.sheets[m.sheetTabId].cellData?.[0]?.[0]?.v !== m.expectedSheetValue ||
      collaboration.generations.active(m.docId).unitId !== m.sourceDocUnitId ||
      collaboration.generations.active(m.sheetId).unitId !== m.sourceSheetUnitId
    )
      throw new Error('Current mutation requires the exact once-seeded archived native state.');
    const docGeneration = collaboration.generations.active(m.docId);
    await collaboration.submitSync(
      {
        unitId: docGeneration.unitId,
        baseRevision: doc.revision - docGeneration.offset,
        mutationId: randomUUID(),
        mutations: [
          {
            id: RichTextEditingMutation.id,
            params: {
              unitId: docGeneration.unitId,
              actions: new JSONX().replaceOp(
                ['body'],
                snapshot.body,
                body(m.currentDocText, snapshot.body!),
              ),
              textRanges: [],
            },
          },
        ],
      },
      { userID: m.ownerId, customData: {} },
    );
    const sheetGeneration = collaboration.generations.active(m.sheetId);
    await collaboration.submitSync(
      {
        unitId: sheetGeneration.unitId,
        baseRevision: sheet.revision - sheetGeneration.offset,
        mutationId: randomUUID(),
        mutations: [
          {
            id: SetRangeValuesMutation.id,
            params: {
              unitId: sheetGeneration.unitId,
              subUnitId: m.sheetTabId,
              cellValue: { 0: { 0: { v: m.currentSheetValue } } },
            },
          },
        ],
      },
      { userID: m.ownerId, customData: {} },
    );
    auth.transaction(() => {
      workspace.share(m.ownerId, m.sheetId, m.readerId, null);
      const revoked = workspace.links.begin(m.docId, null);
      workspace.links.finish(m.docId, revoked.epoch, false);
      for (const [actor, credential] of entries)
        auth.database
          .prepare(
            `INSERT INTO auth_passkeys
          (id,user_id,public_key,counter,transports,name,provider,created_at,last_used_at,backed_up,device_type)
          VALUES(?,?,?,0,'[]','Rich restore fixture','Browser',?,NULL,0,'singleDevice')`,
          )
          .run(credential.id, actor, credential.publicKey, auth.now());
    });
    if (
      ((await collaboration.load(m.ownerId, m.docId)).snapshot as IDocumentData).body
        ?.dataStream !== m.currentDocText
    )
      throw new Error('Expected the real current Doc mutation to commit.');
    if (
      ((await collaboration.load(m.ownerId, m.sheetId)).snapshot as IWorkbookData).sheets[
        m.sheetTabId
      ]?.cellData?.[0]?.[0]?.v !== m.currentSheetValue
    )
      throw new Error('Expected the real current Sheet mutation to commit.');
  } finally {
    try {
      await history?.close();
    } finally {
      await collaboration.close();
    }
  }
}
