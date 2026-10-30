import { createHash } from 'node:crypto';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { AuthError } from '../auth/store.ts';
import { AppearanceStore } from '../appearance/store.ts';
import { readAppearance } from '../appearance/data.ts';
import type { WorkspaceItem } from '../../shared/workspace.ts';
import {
  hasSpaceContext,
  resolveDocument,
  validateDocumentCredentials,
} from './document-access.ts';
import type { PortableFiles } from './portable.ts';
import type { WorkspaceStore } from './store.ts';
import { imageSources } from './imageSources.ts';
import { DOCUMENT_IMAGE_LIMIT, IMAGE_LIMIT } from './documents.ts';

const changed = () =>
  new AuthError(409, 'This document changed while the copy was being prepared. Try again.');
const defaultName = (name: string) =>
  `${name
    .slice(0, 113)
    .replace(/[\uD800-\uDBFF]$/, '')
    .trimEnd()} (copy)`;

/** Same-instance duplication keeps authored bindings, never the source's authority. */
export class CopyFiles {
  readonly workspace: WorkspaceStore;
  readonly files: PortableFiles;
  private readonly appearance: AppearanceStore;
  constructor(workspace: WorkspaceStore, files: PortableFiles) {
    this.workspace = workspace;
    this.files = files;
    this.appearance = new AppearanceStore(workspace);
  }

  private source(user: string, id: string, custom: Record<string, unknown>) {
    const family = validateDocumentCredentials(this.workspace, user, custom);
    if (family !== 'account' && family !== 'trusted')
      throw new AuthError(403, 'Use your everyday account to make a copy.');
    this.workspace.owner(user);
    const item = resolveDocument(this.workspace, user, id, 'read', custom);
    if (item.kind !== 'doc' && item.kind !== 'sheet')
      throw new AuthError(400, 'Only Sheets and Docs can be copied.');
    return item;
  }

  private parent(user: string, source: WorkspaceItem, custom: Record<string, unknown>) {
    if (hasSpaceContext(custom) || source.access !== 'owner' || !source.parentId) return null;
    // A source's personal filing never becomes a canonical creation destination.
    const folder = this.workspace.get(user, source.parentId, 'owner');
    return folder.kind === 'folder' ? folder.id : null;
  }

  options(user: string, id: string, custom: Record<string, unknown> = {}) {
    return this.workspace.auth.transaction(() => {
      const item = this.source(user, id, custom);
      const destinations = [...this.workspace.list(user), ...this.workspace.shared(user)].filter(
        (folder) => folder.kind === 'folder' && folder.access !== 'viewer',
      );
      return {
        name: defaultName(item.name),
        parentId: this.parent(user, item, custom),
        destinations,
      };
    });
  }

  /** The durable head, not a cached SDK snapshot, fences the asynchronous preparation. */
  private head(id: string, kind: 'doc' | 'sheet') {
    const db = this.workspace.auth.database;
    const collaboration = this.files.collaboration;
    const generation = collaboration?.generations.active(id);
    if (collaboration?.generations.restoring(id)) throw changed();
    const native = Boolean(
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspace_collaboration'",
        )
        .get() && db.prepare('SELECT 1 FROM workspace_collaboration WHERE item_id=?').get(id),
    );
    if (native && !collaboration)
      throw new AuthError(503, 'The live document is not available. Try again shortly.');
    const table = native
      ? 'spinel_sync_units'
      : kind === 'doc'
        ? 'doc_snapshots'
        : 'sheet_snapshots';
    const key = native ? 'unit_id' : 'item_id';
    const row = db
      .prepare(`SELECT revision FROM ${table} WHERE ${key}=?`)
      .get(native ? generation!.unitId : id);
    if (!row) throw new AuthError(409, 'Open this document once before making a copy.');
    return {
      unitId: generation?.unitId ?? id,
      revision: Number(row.revision) + (native ? generation!.offset : 0),
    };
  }

  async copy(
    user: string,
    id: string,
    input: unknown,
    verify: () => void,
    customData: Record<string, unknown> = {},
  ) {
    // Retain the ingress-selected credential through image decoding. A changed
    // caller object cannot replace a revoked session with a different one.
    validateDocumentCredentials(this.workspace, user, customData);
    const custom = Object.freeze({ ...customData });
    const access = () => {
      verify();
      return this.source(user, id, custom);
    };
    const source = access();
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some((key) => !['name', 'parentId'].includes(key))
    )
      throw new AuthError(400, 'Check the copy name and destination.');
    const body = input as { name?: unknown; parentId?: unknown };
    const name = this.workspace.name(
      body.name === undefined ? defaultName(source.name) : body.name,
    );
    const parentId =
      body.parentId === undefined ? this.parent(user, source, custom) : body.parentId;
    const destination = this.workspace.creationDestination(user, parentId);
    const collaboration = this.files.collaboration;
    let data: { snapshot: IDocumentData | IWorkbookData | null; revision: number };
    let unitId = id;
    if (collaboration) {
      if (collaboration.generations.restoring(id)) throw changed();
      await collaboration.prepare(user, id, custom);
      access();
      unitId = collaboration.generations.active(id).unitId;
      if (collaboration.generations.restoring(id)) throw changed();
      data = await collaboration.load(user, id, custom);
    } else {
      if (hasSpaceContext(custom)) throw new AuthError(404, 'This document is not available.');
      data = (source.kind === 'doc' ? this.files.docs : this.files.sheets).load(user, id);
    }
    access();
    const current = () => {
      const head = this.head(id, source.kind as 'doc' | 'sheet');
      if (head.unitId !== unitId || head.revision !== data.revision) throw changed();
    };
    current();
    if (!data.snapshot) throw new AuthError(409, 'Open this document once before making a copy.');
    if (Buffer.byteLength(JSON.stringify(data.snapshot)) > 10 * 1024 * 1024)
      throw new AuthError(413, 'The native content exceeds the 10 MiB save limit.');
    const appearance = readAppearance(this.workspace.auth.database, id);
    const covers = new Map<string, Buffer>();
    if (appearance.cover?.source === 'upload')
      for (const hash of Object.values(appearance.cover.images)) {
        const bytes = this.appearance.asset({ userId: user, customData: custom }, id, hash);
        if (createHash('sha256').update(bytes).digest('hex') !== hash)
          throw new AuthError(400, 'This cover could not be copied.');
        covers.set(hash, bytes);
      }
    const snapshot = structuredClone(data.snapshot);
    if ('sheets' in snapshot) snapshot.name = name;
    else snapshot.title = name;
    const prefix = `/api/items/${id}/images/`;
    const imageIds = new Set<string>();
    imageSources(snapshot, (imageSource) => {
      if (
        !imageSource.startsWith(prefix) ||
        !/^[a-f0-9]{64}$/.test(imageSource.slice(prefix.length))
      )
        throw new AuthError(400, 'This document contains an image that cannot be copied safely.');
      imageIds.add(imageSource.slice(prefix.length));
      return imageSource;
    });
    // Bound allocation before reading or decoding all source bytes. Preparation
    // applies the same limits again to normalized images before publication.
    let imageBytes = 0;
    for (const imageId of imageIds) {
      const row = this.workspace.auth.database
        .prepare('SELECT length(data) AS bytes FROM doc_images WHERE item_id=? AND id=?')
        .get(id, imageId);
      if (!row) throw new AuthError(404, 'An image could not be copied.');
      if (Number(row.bytes) > IMAGE_LIMIT)
        throw new AuthError(413, 'Each image must be at most 5 MiB.');
      imageBytes += Number(row.bytes);
      if (imageBytes > DOCUMENT_IMAGE_LIMIT)
        throw new AuthError(413, 'The document exceeds its 50 MiB image limit.');
    }
    const prepared = await this.files.prepare(
      { filename: 'copy.univer.json', snapshot },
      (sourceId) => sourceId,
      (imageSource) => {
        access();
        return this.files.docs.image(user, id, imageSource.slice(prefix.length), custom);
      },
    );
    if (prepared.kind !== source.kind)
      throw new AuthError(400, 'This document could not be copied.');
    prepared.name = name;
    return this.workspace.auth.transaction(() => {
      const latest = access();
      current();
      if (
        latest.name !== source.name ||
        latest.parentId !== source.parentId ||
        readAppearance(this.workspace.auth.database, id).revision !== appearance.revision
      )
        throw changed();
      if (this.workspace.creationDestination(user, parentId).ownerId !== destination.ownerId)
        throw new AuthError(409, 'The destination changed. Choose it again before making a copy.');
      const db = this.workspace.auth.database;
      const bytes = [...covers.values()].reduce((total, data) => total + data.length, 0);
      const used = Number(
        db
          .prepare(
            'SELECT coalesce(sum(length(a.data)),0) AS bytes FROM cover_assets a JOIN workspace_items i ON i.id=a.item_id WHERE i.owner_id=?',
          )
          .get(destination.ownerId)!.bytes,
      );
      if (bytes > 16 * 1024 * 1024 || (bytes > 0 && bytes + used > 100 * 1024 * 1024))
        throw new AuthError(
          413,
          'Cover storage is full. Remove an existing cover or choose a smaller image.',
        );
      const item = this.files.publish(user, prepared, parentId);
      const copiedAppearance = { ...appearance, revision: 1, accent: null };
      db.prepare('INSERT INTO item_appearance(item_id,revision,value) VALUES(?,1,?)').run(
        item.id,
        JSON.stringify(copiedAppearance),
      );
      for (const [hash, data] of covers)
        db.prepare('INSERT INTO cover_assets(item_id,id,data) VALUES(?,?,?)').run(
          item.id,
          hash,
          data,
        );
      return this.workspace.get(user, item.id);
    });
  }
}
