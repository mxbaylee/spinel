import { imageSources } from './imageSources.ts';
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
import { removeImportedSourceBindings } from '../formulas/import.ts';
import { resolveDocument, validateDocumentCredentials } from './document-access.ts';
import { mapArchiveFormulaSources } from './archive-formulas.ts';

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

function validateNative(snapshot: ObjectValue, kind: 'sheet' | 'doc') {
  if (typeof snapshot.id !== 'string' || !snapshot.id || snapshot.id.length > 256) throw invalid();
  // Archive publication bypasses the ordinary save methods, so their native
  // shape requirements are enforced before either importer can publish a row.
  if (kind === 'sheet' && typeof snapshot.name !== 'string')
    throw new AuthError(400, 'Invalid spreadsheet data. Changes have not been saved.');
  validatePortableLayout(snapshot, kind);
  const resources = snapshot.resources;
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

export interface PreparedPortableFile {
  kind: 'sheet' | 'doc';
  name: string;
  snapshot: Snapshot;
  images: Map<string, Awaited<ReturnType<typeof embeddedImage>>>;
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
    const prepared = await this.prepare(input);
    return this.workspace.auth.transaction(() => {
      verify();
      const item = this.workspace.create(user, {
        name: prepared.name,
        kind: prepared.kind,
        parentId: input.parentId,
      });
      const native = this.materialize(prepared, item.id);
      for (const image of prepared.images.values())
        this.workspace.auth.database
          .prepare('INSERT OR IGNORE INTO doc_images VALUES(?,?,?,?)')
          .run(item.id, image.id, image.mime, image.data);
      const store = prepared.kind === 'doc' ? this.docs : this.sheets;
      store.save(user, item.id, { snapshot: native, revision: 0, writeId: randomUUID() });
      return item;
    });
  }
  /** Decode one bounded native member before either import publishes anything. */
  async prepare(
    input: { filename?: unknown; snapshot?: unknown },
    mapFormulaSource?: (sourceId: string) => string,
  ): Promise<PreparedPortableFile> {
    if (typeof input.filename !== 'string' || !/\.(?:json|univer)$/i.test(input.filename))
      throw invalid();
    bounded(input.snapshot);
    if (Buffer.byteLength(JSON.stringify(input.snapshot) ?? '') > PORTABLE_LIMIT)
      throw new AuthError(413, 'Univer files must be at most 20 MiB.');
    if (!object(input.snapshot)) throw invalid();
    const kind =
      object(input.snapshot.sheets) && Array.isArray(input.snapshot.sheetOrder)
        ? 'sheet'
        : object(input.snapshot.body) && typeof input.snapshot.body.dataStream === 'string'
          ? 'doc'
          : null;
    if (!kind) throw invalid();
    validateNative(input.snapshot, kind);
    const name = this.workspace.name(
      input.snapshot.name ??
        input.snapshot.title ??
        input.filename.replace(/\.(?:univer\.)?json$|\.univer$/i, ''),
    );
    const snapshot = structuredClone(input.snapshot) as unknown as Snapshot;
    if (mapFormulaSource) mapArchiveFormulaSources(snapshot, mapFormulaSource);
    else if (kind === 'doc') removeImportedSourceBindings(snapshot);
    const sources = new Set<string>();
    imageSources(snapshot, (source) => {
      sources.add(source);
      return source;
    });
    const images = new Map<string, Awaited<ReturnType<typeof embeddedImage>>>();
    let total = 0;
    for (const source of sources) {
      const image = await embeddedImage(source);
      total += image.data.length;
      if (total > DOCUMENT_IMAGE_LIMIT)
        throw new AuthError(413, 'The document exceeds its 50 MiB image limit.');
      images.set(source, image);
    }
    return { kind, name, snapshot, images };
  }
  /** Rebase only after all archive identities are allocated; never writes live data. */
  materialize(prepared: PreparedPortableFile, id: string): Snapshot {
    const snapshot = snapshotIdentity(prepared.snapshot, id);
    imageSources(
      snapshot,
      (source) => `/api/items/${id}/images/${prepared.images.get(source)!.id}`,
    );
    if (Buffer.byteLength(JSON.stringify(snapshot)) > 10 * 1024 * 1024)
      throw new AuthError(413, 'The native content exceeds the 10 MiB save limit.');
    return snapshot;
  }
  async export(
    user: string,
    id: string,
    verify: () => void,
    customData: Record<string, unknown> = {},
  ) {
    const account = (custom: Record<string, unknown>) => {
      const family = validateDocumentCredentials(this.workspace, user, custom);
      if (family !== 'account' && family !== 'trusted')
        throw new AuthError(403, 'Use your everyday account to export documents.');
    };
    // Check before copying: a private history capability must retain its read-only
    // identity, and cannot become an ordinary trusted call by losing that identity.
    account(customData);
    const custom = Object.freeze({ ...customData });
    const access = () => {
      verify();
      account(custom);
      return resolveDocument(this.workspace, user, id, 'read', custom);
    };
    const item = access();
    if (item.kind !== 'doc' && item.kind !== 'sheet')
      throw new AuthError(400, 'Only Sheets and Docs can be exported.');
    const collaboration = this.collaboration;
    let generation: string | undefined;
    const current = () => {
      if (
        collaboration &&
        (collaboration.generations.restoring(id) ||
          (generation !== undefined && collaboration.generations.active(id).unitId !== generation))
      )
        throw new AuthError(409, 'This document was restored. Open it again before exporting.');
    };
    let data: { snapshot: Snapshot | null };
    if (collaboration) {
      current();
      await collaboration.prepare(user, id, custom);
      access();
      generation = collaboration.generations.active(id).unitId;
      current();
      data = await collaboration.load(user, id, custom);
    } else {
      // Space documents are native collaboration units. The ordinary snapshot
      // fallback must never reopen their guarded legacy load endpoints.
      if ('spaceId' in custom || 'spaceItem' in custom)
        throw new AuthError(404, 'This document is not available.');
      data = (item.kind === 'doc' ? this.docs : this.sheets).load(user, id);
    }
    access();
    current();
    if (!data.snapshot) throw new AuthError(409, 'Open this document once before exporting it.');
    const snapshot = structuredClone(data.snapshot);
    bounded(snapshot);
    // Definition validation also refuses persisted calculated results in a Formula.
    mapArchiveFormulaSources(snapshot, (sourceId) => sourceId);
    // A successful native download must remain importable under the same budgets.
    validateNative(snapshot as unknown as ObjectValue, item.kind);
    const names = snapshot as unknown as ObjectValue;
    this.workspace.name(names.name ?? names.title ?? item.name);
    if (Buffer.byteLength(JSON.stringify(snapshot)) > 10 * 1024 * 1024)
      throw new AuthError(413, 'The native content exceeds the 10 MiB save limit.');
    imageSources(snapshot, (source) => {
      const prefix = `/api/items/${id}/images/`;
      if (!source.startsWith(prefix) || !/^[a-f0-9]{64}$/.test(source.slice(prefix.length)))
        throw new AuthError(400, 'This document contains an image that cannot be exported safely.');
      const image = this.docs.image(user, id, source.slice(prefix.length), custom);
      return `data:${image.mime};base64,${Buffer.from(image.data).toString('base64')}`;
    });
    const text = JSON.stringify(snapshot);
    if (Buffer.byteLength(text) > PORTABLE_LIMIT)
      throw new AuthError(413, 'This Univer file exceeds 20 MiB. No partial file was exported.');
    access();
    current();
    return { text, filename: `${item.name}.univer.json` };
  }
}
