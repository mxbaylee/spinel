import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { IDocumentData } from '@univerjs/core';
import { AuthError } from '../auth/store.ts';
import type { WorkspaceStore } from './store.ts';
import { commitSnapshot } from './snapshots.ts';

export const IMAGE_LIMIT = 5 * 1024 * 1024;
export const DOCUMENT_IMAGE_LIMIT = 50 * 1024 * 1024;
let decoding = 0;

export class DocumentStore {
  workspace: WorkspaceStore;
  constructor(workspace: WorkspaceStore) {
    this.workspace = workspace;
    workspace.auth.database.exec(`
      CREATE TABLE IF NOT EXISTS doc_snapshots (
        item_id TEXT PRIMARY KEY REFERENCES workspace_items(id) ON DELETE CASCADE,
        snapshot TEXT NOT NULL, revision INTEGER NOT NULL, write_id TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS doc_images (
        item_id TEXT NOT NULL REFERENCES workspace_items(id) ON DELETE CASCADE,
        id TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL,
        PRIMARY KEY(item_id,id)
      ) STRICT;
    `);
  }
  document(owner: string, id: string, edit = false) {
    const item = this.workspace.get(owner, id, edit ? 'edit' : 'read');
    if (item.kind !== 'doc') throw new AuthError(400, 'This item is not a document.');
    return item;
  }
  load(owner: string, id: string) {
    const item = this.document(owner, id);
    const row = this.workspace.auth.database
      .prepare('SELECT snapshot,revision FROM doc_snapshots WHERE item_id=?')
      .get(id) as { snapshot: string; revision: number } | undefined;
    return {
      access: item.access,
      snapshot: row ? (JSON.parse(row.snapshot) as IDocumentData) : null,
      revision: row?.revision ?? 0,
    };
  }
  save(
    owner: string,
    id: string,
    input: { snapshot?: unknown; revision?: unknown; writeId?: unknown },
  ) {
    this.document(owner, id, true);
    const { snapshot, revision, writeId } = input;
    const data = snapshot as IDocumentData | null;
    if (
      !Number.isSafeInteger(revision) ||
      (revision as number) < 0 ||
      typeof writeId !== 'string' ||
      !/^[\da-f-]{36}$/i.test(writeId)
    )
      throw new AuthError(400, 'Invalid save request. Changes have not been saved.');
    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      data.id !== id ||
      typeof data.body?.dataStream !== 'string' ||
      !data.body.dataStream.endsWith('\r\n')
    )
      throw new AuthError(400, 'Invalid document data. Changes have not been saved.');
    const text = JSON.stringify(data);
    if (Buffer.byteLength(text) > 10 * 1024 * 1024)
      throw new AuthError(413, 'This document is too large to save. Changes have not been saved.');
    this.validateImages(id, data);
    return commitSnapshot(this.workspace, 'doc_snapshots', id, text, revision as number, writeId);
  }
  validateImages(id: string, data: IDocumentData) {
    const checkImages = (value: unknown, depth = 0) => {
      if (depth > 64) throw new AuthError(400, 'Document data is nested too deeply.');
      if (!value || typeof value !== 'object') return;
      const drawing = value as Record<string, unknown>;
      if (Object.hasOwn(drawing, 'source')) {
        const prefix = `/api/items/${id}/images/`;
        const source = drawing.source;
        if (
          typeof source !== 'string' ||
          !source.startsWith(prefix) ||
          !/^[a-f0-9]{64}$/.test(source.slice(prefix.length)) ||
          !this.workspace.auth.database
            .prepare('SELECT 1 FROM doc_images WHERE item_id=? AND id=?')
            .get(id, source.slice(prefix.length))
        )
          throw new AuthError(
            400,
            'Insert images from a file so they are saved with this document.',
          );
      }
      for (const child of Object.values(value)) checkImages(child, depth + 1);
    };
    checkImages(data.drawings);
    checkImages(data.headers);
    checkImages(data.footers);
    checkImages(data.footnotes);
    checkImages(data.endnotes);
    checkImages((data as IDocumentData & { notes?: unknown }).notes);
    for (const resource of data.resources ?? []) {
      if (resource.name === 'DOC_DRAWING_PLUGIN') {
        try {
          checkImages(JSON.parse(resource.data));
        } catch (error) {
          if (error instanceof AuthError) throw error;
          throw new AuthError(400, 'Invalid document images.');
        }
      }
    }
  }
  async upload(owner: string, id: string, input: unknown, mime: string) {
    this.document(owner, id, true);
    if (!Buffer.isBuffer(input) || !input.length || input.length > IMAGE_LIMIT)
      throw new AuthError(413, 'Choose an image no larger than 5 MiB.');
    const formats: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpeg',
      'image/webp': 'webp',
    };
    if (!formats[mime]) throw new AuthError(400, 'Choose a PNG, JPEG or WebP image.');
    if (decoding >= 2) throw new AuthError(429, 'Images are still uploading. Try again shortly.');
    decoding++;
    let bytes: Buffer;
    try {
      const image = sharp(input, { limitInputPixels: 16_000_000, failOn: 'error' });
      const metadata = await image.metadata();
      if (metadata.format !== formats[mime] || (metadata.pages ?? 1) > 1)
        throw new Error('Unsupported image');
      // Decode fully and strip metadata; header sniffing alone accepts broken image data.
      bytes = await image.rotate().toBuffer();
    } catch {
      throw new AuthError(
        400,
        'Choose a valid static PNG, JPEG or WebP image up to 16 megapixels.',
      );
    } finally {
      decoding--;
    }
    if (bytes.length > IMAGE_LIMIT)
      throw new AuthError(413, 'The processed image exceeds 5 MiB. Choose a smaller image.');
    const imageId = createHash('sha256').update(bytes).digest('hex');
    return this.workspace.auth.transaction(() => {
      // Recheck access after asynchronous decoding, including disabled/deleted accounts.
      this.document(owner, id, true);
      const db = this.workspace.auth.database;
      if (!db.prepare('SELECT 1 FROM doc_images WHERE item_id=? AND id=?').get(id, imageId)) {
        const used = db
          .prepare('SELECT coalesce(sum(length(data)),0) AS bytes FROM doc_images WHERE item_id=?')
          .get(id) as { bytes: number };
        if (used.bytes + bytes.length > DOCUMENT_IMAGE_LIMIT)
          throw new AuthError(413, 'This document has reached its 50 MiB image limit.');
        db.prepare('INSERT INTO doc_images VALUES(?,?,?,?)').run(id, imageId, mime, bytes);
      }
      return { id: imageId, url: `/api/items/${id}/images/${imageId}` };
    });
  }
  image(owner: string, id: string, imageId: string) {
    this.document(owner, id);
    const image = this.workspace.auth.database
      .prepare('SELECT mime,data FROM doc_images WHERE item_id=? AND id=?')
      .get(id, imageId) as { mime: string; data: Uint8Array } | undefined;
    if (!image) throw new AuthError(404, 'Image not found.');
    return image;
  }
}
