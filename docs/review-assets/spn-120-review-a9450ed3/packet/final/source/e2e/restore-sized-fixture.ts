/** Fixed realistic restore workload, created only by the exited acceptance
 * bootstrap. Every image passes the production upload service and is referenced
 * by an ordinary saved document. No padding tables or oversized rows are used. */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { DrawingTypeEnum, ImageSourceType, PositionedObjectLayoutType } from '@univerjs/core';
import type { IDocumentData } from '@univerjs/core';
import type { IDocImage } from '@univerjs/docs-drawing';
import type { DatabaseSync } from '../server/database.ts';
import { blankOfflineSnapshot } from '../src/shared/offlineCreation.ts';
import { DocumentStore } from '../src/server/workspace/documents.ts';
import type { WorkspaceStore } from '../src/server/workspace/store.ts';

export const RESTORE_SIZED_PROFILE = 'images-256m';
const DOCUMENTS = 8;
const IMAGES_PER_DOCUMENT = 8;
const IMAGE_PIXELS = 1024;

export interface RestoreSizedFixture {
  profile: typeof RESTORE_SIZED_PROFILE;
  documentIds: string[];
  documents: number;
  images: number;
  imageBytes: number;
  contentSha256: string;
}

/** Stream one bounded image row at a time; the final digest covers actual bytes,
 * identities, MIME types and all image-bearing saved snapshots. */
export function inspectRestoreSizedFixture(db: DatabaseSync, documentIds: readonly string[]) {
  assert.equal(documentIds.length, DOCUMENTS);
  assert.equal(new Set(documentIds).size, DOCUMENTS);
  const placeholders = documentIds.map(() => '?').join(',');
  const digest = createHash('sha256');
  let documents = 0,
    images = 0,
    imageBytes = 0;
  for (const row of db.iterate(
    `SELECT item_id,snapshot FROM doc_snapshots WHERE item_id IN (${placeholders}) ORDER BY item_id`,
    ...documentIds,
  )) {
    const snapshot = String(row.snapshot);
    digest.update(JSON.stringify([String(row.item_id), snapshot]));
    documents++;
  }
  const readImage = db.prepare(
    'SELECT item_id,id,mime,data FROM doc_images WHERE item_id=? AND id=?',
  );
  for (const key of db.iterate(
    `SELECT item_id,id FROM doc_images WHERE item_id IN (${placeholders}) ORDER BY item_id,id`,
    ...documentIds,
  )) {
    const row = readImage.get(key.item_id, key.id)!;
    assert.ok(row.data instanceof Uint8Array);
    assert.equal(row.mime, 'image/png');
    const bytes = Buffer.from(row.data);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), row.id);
    digest.update(JSON.stringify([row.item_id, row.id, row.mime, bytes.length]));
    digest.update(bytes);
    images++;
    imageBytes += bytes.length;
  }
  assert.equal(documents, DOCUMENTS);
  assert.equal(images, DOCUMENTS * IMAGES_PER_DOCUMENT);
  // Random valid pixels keep the encrypted archive close to the database size.
  // The bound is the workload definition, not an application limit or speed gate.
  assert.ok(imageBytes >= 256 * 1024 ** 2 && imageBytes < 320 * 1024 ** 2);
  return { documents, images, imageBytes, contentSha256: digest.digest('hex') };
}

export async function seedRestoreSizedFixture(
  workspace: WorkspaceStore,
  ownerId: string,
): Promise<RestoreSizedFixture> {
  const documents = new DocumentStore(workspace);
  const documentIds: string[] = [];
  for (let documentIndex = 0; documentIndex < DOCUMENTS; documentIndex++) {
    const item = workspace.create(ownerId, {
      kind: 'doc',
      name: `Restore timing image journal ${documentIndex + 1}`,
      parentId: null,
    });
    documentIds.push(item.id);
    const snapshot = blankOfflineSnapshot({
      itemId: item.id,
      kind: 'doc',
      name: item.name,
    }) as IDocumentData;
    const initialBody = snapshot.body!;
    const paragraph = initialBody.paragraphs![0];
    const section = initialBody.sectionBreaks![0];
    let dataStream = '';
    const paragraphs = [];
    const customBlocks = [];
    const drawings: Record<string, IDocImage> = {};
    for (let imageIndex = 0; imageIndex < IMAGES_PER_DOCUMENT; imageIndex++) {
      const png = await sharp(randomBytes(IMAGE_PIXELS * IMAGE_PIXELS * 4), {
        raw: { width: IMAGE_PIXELS, height: IMAGE_PIXELS, channels: 4 },
      })
        .png({ compressionLevel: 0 })
        .toBuffer();
      const image = await documents.upload(ownerId, item.id, png, 'image/png');
      const drawingId = `timing-image-${imageIndex}`;
      dataStream += `Synthetic image ${imageIndex + 1}`;
      customBlocks.push({ startIndex: dataStream.length, blockId: drawingId });
      dataStream += '\b\r';
      paragraphs.push({ ...paragraph, startIndex: dataStream.length - 1 });
      drawings[drawingId] = {
        unitId: item.id,
        subUnitId: item.id,
        drawingId,
        drawingType: DrawingTypeEnum.DRAWING_IMAGE,
        imageSourceType: ImageSourceType.URL,
        source: image.url,
        layoutType: PositionedObjectLayoutType.INLINE,
        docTransform: {
          size: { width: 256, height: 256 },
          positionH: { relativeFrom: 0, posOffset: 0 },
          positionV: { relativeFrom: 0, posOffset: 0 },
          angle: 0,
        },
      };
    }
    dataStream += '\n';
    snapshot.body = {
      ...initialBody,
      dataStream,
      paragraphs,
      customBlocks,
      sectionBreaks: [{ ...section, startIndex: dataStream.length - 1 }],
    };
    snapshot.drawings = drawings;
    snapshot.drawingsOrder = Object.keys(drawings);
    documents.save(ownerId, item.id, { revision: 0, writeId: randomUUID(), snapshot });
  }
  return {
    profile: RESTORE_SIZED_PROFILE,
    documentIds,
    ...inspectRestoreSizedFixture(workspace.auth.database, documentIds),
  };
}
