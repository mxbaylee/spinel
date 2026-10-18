import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { AuthError } from '../auth/store.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import { snapshotIdentity } from '../collaboration/snapshotIdentity.ts';
import type { WorkspaceStore } from './store.ts';
import { DocumentStore, IMAGE_LIMIT, DOCUMENT_IMAGE_LIMIT } from './documents.ts';
import { SheetStore } from './sheets.ts';
import { validatePortableLayout } from './portableValidation.ts';

import { PORTABLE_LIMIT } from '../../shared/portable.ts';
export { PORTABLE_LIMIT };
type Snapshot = IDocumentData | IWorkbookData;
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
const invalid = () => new AuthError(400, 'Only valid Univer JSON files can be imported.');

function bounded(value: unknown, depth = 0, count = { nodes: 0 }) {
  if (depth > 64 || ++count.nodes > 200_000) throw invalid();
  if (value && typeof value === 'object')
    for (const [key, child] of Object.entries(value)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw invalid();
      bounded(child, depth + 1, count);
    }
}

/** Only supported native drawing locations are interpreted; ordinary text stays literal. */
function imageSources(snapshot: Snapshot, map: (source: string) => string) {
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (object(value) && Object.hasOwn(value, 'source')) {
      if (typeof value.source !== 'string') throw invalid();
      value.source = map(value.source);
      value.imageSourceType = 'URL';
    }
    for (const child of Object.values(value)) walk(child);
  };
  const doc = snapshot as IDocumentData & { notes?: unknown };
  for (const value of [
    doc.drawings,
    doc.headers,
    doc.footers,
    doc.footnotes,
    doc.endnotes,
    doc.notes,
  ])
    walk(value);
  for (const resource of snapshot.resources ?? []) {
    if (['DOC_DRAWING_PLUGIN', 'SHEET_DRAWING_PLUGIN'].includes(resource.name)) {
      let data: unknown;
      try {
        data = JSON.parse(resource.data);
      } catch {
        throw invalid();
      }
      bounded(data);
      walk(data);
      resource.data = JSON.stringify(data);
    }
  }
}

async function embeddedImage(source: string) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(source);
  if (!match)
    throw new AuthError(
      400,
      'Images must be embedded in the Univer file; remote images are not fetched.',
    );
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > IMAGE_LIMIT || bytes.toString('base64') !== match[2])
    throw new AuthError(413, 'Each embedded image must be at most 5 MiB.');
  let safe = bytes;
  try {
    const image = sharp(bytes, { limitInputPixels: 16_000_000, failOn: 'error' });
    const metadata = await image.metadata();
    if (`image/${metadata.format}` !== match[1] || (metadata.pages ?? 1) > 1) throw invalid();
    // Fully decode, but preserve already-sanitized exported bytes (especially JPEG).
    await image.clone().raw().toBuffer();
    if (metadata.exif || metadata.icc || metadata.iptc || metadata.xmp || metadata.orientation)
      safe = await image.rotate().toBuffer();
  } catch {
    throw new AuthError(400, 'Choose valid static PNG, JPEG or WebP images up to 16 megapixels.');
  }
  if (safe.length > IMAGE_LIMIT) throw new AuthError(413, 'An embedded image exceeds 5 MiB.');
  return { id: createHash('sha256').update(safe).digest('hex'), mime: match[1], data: safe };
}

export class PortableFiles {
  readonly docs: DocumentStore;
  readonly sheets: SheetStore;
  readonly workspace: WorkspaceStore;
  readonly collaboration?: CollaborationStore;
  constructor(workspace: WorkspaceStore, collaboration?: CollaborationStore) {
    this.workspace = workspace;
    this.collaboration = collaboration;
    this.docs = new DocumentStore(workspace);
    this.sheets = new SheetStore(workspace);
  }
  async import(
    user: string,
    input: { filename?: unknown; parentId?: unknown; snapshot?: unknown },
    verify: () => void,
  ) {
    this.workspace.owner(user);
    this.workspace.parent(user, input.parentId);
    if (typeof input.filename !== 'string' || !/\.(?:json|univer)$/i.test(input.filename))
      throw invalid();
    if (Buffer.byteLength(JSON.stringify(input.snapshot) ?? '') > PORTABLE_LIMIT)
      throw new AuthError(413, 'Univer files must be at most 20 MiB.');
    bounded(input.snapshot);
    if (
      !object(input.snapshot) ||
      typeof input.snapshot.id !== 'string' ||
      !input.snapshot.id ||
      input.snapshot.id.length > 256
    )
      throw invalid();
    const kind =
      object(input.snapshot.sheets) && Array.isArray(input.snapshot.sheetOrder)
        ? 'sheet'
        : object(input.snapshot.body) && typeof input.snapshot.body.dataStream === 'string'
          ? 'doc'
          : null;
    if (!kind) throw invalid();
    validatePortableLayout(input.snapshot, kind);
    const resources = input.snapshot.resources;
    if (
      resources !== undefined &&
      (!Array.isArray(resources) ||
        resources.some(
          (resource) =>
            !object(resource) ||
            typeof resource.name !== 'string' ||
            typeof resource.data !== 'string',
        ))
    )
      throw invalid();
    const name = this.workspace.name(
      input.snapshot.name ??
        input.snapshot.title ??
        input.filename.replace(/\.(?:univer\.)?json$|\.univer$/i, ''),
    );
    const snapshot = structuredClone(input.snapshot) as unknown as Snapshot;
    const sources = new Set<string>();
    imageSources(snapshot, (source) => {
      sources.add(source);
      return source;
    });
    // Sheet images are not enabled in Spinel yet; never silently lose their data.
    if (kind === 'sheet' && sources.size)
      throw new AuthError(400, 'Spreadsheet image import is not supported yet.');
    const images = new Map<string, Awaited<ReturnType<typeof embeddedImage>>>();
    let total = 0;
    for (const source of sources) {
      const image = await embeddedImage(source);
      total += image.data.length;
      if (total > DOCUMENT_IMAGE_LIMIT)
        throw new AuthError(413, 'The document exceeds its 50 MiB image limit.');
      images.set(source, image);
    }
    return this.workspace.auth.transaction(() => {
      verify();
      const item = this.workspace.create(user, { name, kind, parentId: input.parentId });
      imageSources(snapshot, (source) => `/api/items/${item.id}/images/${images.get(source)!.id}`);
      const native = snapshotIdentity(snapshot, item.id);
      for (const image of images.values())
        this.workspace.auth.database
          .prepare('INSERT OR IGNORE INTO doc_images VALUES(?,?,?,?)')
          .run(item.id, image.id, image.mime, image.data);
      const store = kind === 'doc' ? this.docs : this.sheets;
      store.save(user, item.id, { snapshot: native, revision: 0, writeId: randomUUID() });
      return item;
    });
  }
  async export(user: string, id: string, verify: () => void) {
    const item = this.workspace.get(user, id);
    if (item.kind !== 'doc' && item.kind !== 'sheet')
      throw new AuthError(400, 'Only Sheets and Docs can be exported.');
    let data: { snapshot: Snapshot | null };
    if (this.collaboration) {
      await this.collaboration.prepare(user, id);
      data = await this.collaboration.load(user, id);
    } else data = (item.kind === 'doc' ? this.docs : this.sheets).load(user, id);
    verify();
    this.workspace.get(user, id);
    if (!data.snapshot) throw new AuthError(409, 'Open this document once before exporting it.');
    const snapshot = structuredClone(data.snapshot);
    bounded(snapshot);
    imageSources(snapshot, (source) => {
      const prefix = `/api/items/${id}/images/`;
      if (!source.startsWith(prefix) || !/^[a-f0-9]{64}$/.test(source.slice(prefix.length)))
        throw new AuthError(400, 'This document contains an image that cannot be exported safely.');
      const image = this.docs.image(user, id, source.slice(prefix.length));
      return `data:${image.mime};base64,${Buffer.from(image.data).toString('base64')}`;
    });
    const text = JSON.stringify(snapshot);
    if (Buffer.byteLength(text) > PORTABLE_LIMIT)
      throw new AuthError(413, 'This Univer file exceeds 20 MiB. No partial file was exported.');
    return { text, filename: `${item.name}.univer.json` };
  }
}
