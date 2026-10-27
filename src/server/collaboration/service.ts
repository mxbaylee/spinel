import { readAppearance } from '../appearance/data.ts';
import { snapshotIdentity } from './snapshotIdentity.ts';
import type { OfflineBundle, OfflineBundleImage } from '../../shared/offlineBundle.ts';
import packageInfo from '../../../package.json' with { type: 'json' };
import { createHash } from 'node:crypto';
import { materialize, SyncError, SyncServer } from '@spinel/sync-server';
import type { SubmitRequest, SyncRevision } from '@spinel/sync-server';
import type { DiagnosticContext, DiagnosticEvent } from '@spinel/diagnostics';
import { SQLiteSyncStorage } from '../sync/store.ts';
import type { RestoreJob } from './generations.ts';
import { CollaborationGenerations } from './generations.ts';
import { auditDeniedEdit } from './audit.ts';
import { realpathSync } from 'node:fs';
import { getDocsEmptySnapshot, LocaleType } from '@univerjs/core';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { CollaborationError } from './errors.ts';
import { assertSyncTransitionReady, markNativeSyncActivated } from '../sync/transition.ts';
import { AuthError } from '../auth/store.ts';
import { AccessTokens } from '../auth/tokens.ts';
import type { WorkspaceStore } from '../workspace/store.ts';
import { SheetStore } from '../workspace/sheets.ts';
import { DocumentStore } from '../workspace/documents.ts';
import { imageSources } from '../workspace/imageSources.ts';
import {
  hasSpaceContext,
  resolveDocument,
  validateDocumentCredentials,
} from '../workspace/document-access.ts';
import type { WorkspaceItem } from '../../shared/workspace.ts';
import type { IChangeset } from '@univerjs/protocol';
import { observeJob } from '../health/jobs.ts';
import type { ObserveJob } from '../health/jobs.ts';
const runtimeLimits = { maxLoadedUnits: 8, idleTimeoutMs: 60_000 };

export interface SyncIdentity {
  userID: string;
  customData: Record<string, unknown>;
}
type CommittedChange = { unitID: string; revision: number; syncRevision?: SyncRevision };

function validateTargets(changeset: Readonly<IChangeset>) {
  const isIndex = (key: string) => /^\d+$/.test(key);
  const walk = (value: unknown, path: string[], allowedUnit = changeset.unitID) => {
    if (path.length > 64)
      throw new CollaborationError('INVALID_REQUEST', 'Change is nested too deeply.');
    if (!value || typeof value !== 'object') return;
    // Cell rich text (`<row>.<column>.p`) is an embedded Doc payload, not a mutation
    // target, wherever cell data travels: set values, move ranges, insert or duplicate
    // sheets, and their undo. Its drawing IDs must name that Doc and nothing else;
    // a payload without its own ID, and all outer targets, stay fenced to this unit.
    if (path.length >= 3 && path.at(-1) === 'p' && path.slice(-3, -1).every(isIndex)) {
      const id = (value as { id?: unknown }).id;
      if (typeof id === 'string' && id) allowedUnit = id;
    }
    for (const [key, child] of Object.entries(value)) {
      if ((key === 'unitId' || key === 'unitID') && child !== allowedUnit)
        throw new CollaborationError(
          'PERMISSION_DENIED',
          'Cross-document changes are not allowed.',
        );
      walk(child, [...path, key], allowedUnit);
    }
  };
  for (const mutation of changeset.mutations) {
    if (mutation.id === 'univer.mutation.revert-version')
      throw new CollaborationError(
        'PERMISSION_DENIED',
        'Restore versions through Spinel so the current state is kept.',
      );
    let data: unknown;
    try {
      data = JSON.parse(mutation.data);
    } catch {
      throw new CollaborationError('INVALID_REQUEST', 'Invalid mutation data.');
    }
    walk(data, []);
  }
}

/** Application boundary. HTTP/WebSocket integration supplies trusted identities. */
export class CollaborationStore {
  readonly generations: CollaborationGenerations;
  readonly sync: SyncServer<SyncIdentity>;
  private readonly syncStorage: SQLiteSyncStorage;
  private readonly submitListeners = new Set<
    (identity: SyncIdentity, unitId: string) => Promise<void>
  >();
  private readonly commitListeners = new Set<(change: CommittedChange) => void>();
  private readonly admitted = new Map<string, Set<Promise<void>>>();
  private readonly restores = new Map<string, Promise<RestoreJob>>();
  private readonly workspace: WorkspaceStore;
  private readonly preparing = new Map<string, Promise<void>>();
  private purging: Promise<void> | undefined;
  private readonly observePurge?: ObserveJob;
  private readonly prepareListeners = new Set<
    (user: string, id: string, custom: Record<string, unknown>) => Promise<void>
  >();

  constructor(
    workspace: WorkspaceStore,
    filename: string,
    options: {
      spaceReview?: boolean;
      observePurge?: ObserveJob;
      diagnostics?: (event: DiagnosticEvent, context: DiagnosticContext, actorId: string) => void;
    } = {},
  ) {
    this.observePurge = options.observePurge;
    const main = workspace.auth.database
      .prepare('PRAGMA database_list')
      .all()
      .find((row) => row.name === 'main');
    if (!main?.file || realpathSync(String(main.file)) !== realpathSync(filename))
      throw new Error('Collaboration must use the application database file.');
    assertSyncTransitionReady(workspace.auth.database);
    markNativeSyncActivated(workspace.auth.database);
    this.workspace = workspace;
    new AccessTokens(workspace.auth);
    this.generations = new CollaborationGenerations(workspace);
    this.generations.recoverBeforeServing();
    new SheetStore(workspace);
    new DocumentStore(workspace);
    workspace.auth.database.exec(`CREATE TABLE IF NOT EXISTS workspace_collaboration (
      item_id TEXT PRIMARY KEY REFERENCES workspace_items(id) ON DELETE CASCADE,
      state TEXT NOT NULL CHECK(state IN ('preparing','ready'))
    ) STRICT;
    CREATE TABLE IF NOT EXISTS spinel_generation_resources (
      unit_id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES workspace_items(id) ON DELETE CASCADE, resources TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS collaboration_purge (item_id TEXT PRIMARY KEY) STRICT;
    CREATE TRIGGER IF NOT EXISTS collaboration_deleted BEFORE DELETE ON workspace_items
    WHEN EXISTS(SELECT 1 FROM workspace_collaboration WHERE item_id=OLD.id)
    BEGIN INSERT OR IGNORE INTO collaboration_purge VALUES(OLD.id); END;`);
    this.syncStorage = new SQLiteSyncStorage(workspace.auth);
    this.sync = new SyncServer(this.syncStorage, {
      ...runtimeLimits,
      authorize: (unitId, identity, edit) => this.authorizeSync(unitId, identity, edit),
      beforeSubmit: async (unitId, identity) => {
        for (const listener of this.submitListeners) await listener(identity, unitId);
      },
      validateSnapshot: (unitId, snapshot) =>
        new DocumentStore(workspace).validateImages(this.itemForUnit(unitId), snapshot),
      diagnosticsFor: (identity) => (event, context) =>
        options.diagnostics?.(event, context, identity.userID),
      diagnosticContext: (unitId, identity) => ({
        component: 'server',
        fileId: this.itemForUnit(unitId),
        ...(typeof identity.customData.spaceId === 'string' && {
          spaceId: identity.customData.spaceId,
        }),
      }),
    });
  }

  private session(user: string, custom: Record<string, unknown>, edit = false) {
    try {
      validateDocumentCredentials(this.workspace, user, custom, edit);
    } catch {
      throw new CollaborationError(
        'PERMISSION_DENIED',
        'This document credential is no longer available.',
      );
    }
  }

  /** Reuses the same credential resolver at admission and inside the durable transaction. */
  private authorizeSync(unitId: string, identity: SyncIdentity, edit: boolean) {
    this.session(identity.userID, identity.customData, edit);
    const item = this.access(identity.userID, unitId, edit, identity.customData);
    const root =
      typeof identity.customData.spaceId === 'string' ? identity.customData.spaceId : item.id;
    if (Object.hasOwn(identity.customData, 'privacyEpoch'))
      this.workspace.links.assertEpoch(root, identity.customData.privacyEpoch);
    if (identity.customData.unitID !== undefined && identity.customData.unitID !== unitId)
      throw new CollaborationError('PERMISSION_DENIED', 'This document is not available.');
  }

  onSubmitting(listener: (identity: SyncIdentity, unitId: string) => Promise<void>) {
    this.submitListeners.add(listener);
    return {
      dispose: () => {
        this.submitListeners.delete(listener);
      },
    };
  }

  onCommitted(listener: (change: CommittedChange) => void) {
    this.commitListeners.add(listener);
    return {
      dispose: () => {
        this.commitListeners.delete(listener);
      },
    };
  }

  async headRevision(userID: string, unitId: string, customData: Record<string, unknown>) {
    this.authorizeSync(unitId, { userID, customData }, false);
    return this.syncStorage.load(unitId)?.revision;
  }

  /** Stable actor identity comes from authenticated ingress, never from the request body. */
  async submitSync(
    request: Omit<SubmitRequest, 'actorId' | 'exactRevision'>,
    identity: SyncIdentity,
  ) {
    let item: WorkspaceItem;
    try {
      item = this.access(identity.userID, request.unitId, true, identity.customData);
    } catch (error) {
      auditDeniedEdit(identity.userID, request.unitId, 'submitChangeset');
      throw error;
    }
    const root =
      typeof identity.customData.spaceId === 'string' ? identity.customData.spaceId : item.id;
    const custom: Readonly<Record<string, unknown>> = Object.freeze({
      privacyEpoch: this.workspace.links.epoch(root),
      ...identity.customData,
    });
    const context = { userID: identity.userID, customData: custom };
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const generation = this.generations.resolve(request.unitId);
    try {
      this.authorizeSync(request.unitId, context, true);
      if (!generation || this.generations.restoring(generation.itemId))
        throw new SyncError('stale');
      const active = this.admitted.get(request.unitId) ?? new Set<Promise<void>>();
      active.add(pending);
      this.admitted.set(request.unitId, active);
      const actorId =
        typeof custom.mcpTokenHash === 'string'
          ? `${identity.userID}:mcp:${String(custom.mcpConnectionId ?? custom.mcpTokenHash)}`
          : identity.userID;
      const result = await this.sync.submit(
        {
          ...request,
          actorId,
          exactRevision: Object.hasOwn(custom, 'mcpTokenHash'),
        },
        context,
      );
      if (!result.duplicate) {
        try {
          this.workspace.auth.database
            .prepare('UPDATE workspace_items SET updated_at=max(updated_at,?) WHERE id=?')
            .run(this.workspace.auth.now(), generation.itemId);
        } catch {
          console.error('A durable sync modification marker will need repair.');
        }
        for (const listener of this.commitListeners) {
          try {
            listener({
              unitID: request.unitId,
              revision: result.edit.revision,
              syncRevision: result.edit,
            });
          } catch {
            console.error('A durable sync change notification failed.');
          }
        }
      }
      return result;
    } catch (error) {
      if (error instanceof AuthError || error instanceof CollaborationError)
        auditDeniedEdit(identity.userID, request.unitId, 'submitChangeset');
      throw error;
    } finally {
      const active = this.admitted.get(request.unitId);
      active?.delete(pending);
      if (!active?.size) this.admitted.delete(request.unitId);
      release();
    }
  }

  /** Assistant ingress retains its public mutation and retry representation. */
  async submitChangeset(
    request: { changeset: IChangeset },
    context: { userID: string; memberID: string; customData?: Record<string, unknown> },
  ) {
    const changeset = request.changeset;
    validateTargets(changeset);
    let result;
    try {
      result = await this.submitSync(
        {
          unitId: changeset.unitID,
          baseRevision: changeset.baseRev,
          mutationId: `${changeset.sid}:${changeset.reqId}`,
          mutations: changeset.mutations.map((mutation) => ({
            id: mutation.id,
            params: JSON.parse(mutation.data),
          })),
        },
        { userID: context.userID, customData: context.customData ?? {} },
      );
    } catch (error) {
      if (error instanceof SyncError)
        throw new AuthError(
          409,
          'The document changed or the edit could not be applied. Read it again before editing.',
        );
      throw error;
    }
    return {
      status: result.duplicate ? ('already-committed' as const) : ('committed' as const),
      changeset: { ...changeset, revision: result.edit.revision },
    };
  }

  purgeDeleted() {
    if (this.purging) return this.purging;
    const finish = observeJob(this.observePurge);
    this.purging = (async () => {
      const db = this.workspace.auth.database;
      const rows = db.prepare('SELECT item_id FROM collaboration_purge').all() as {
        item_id: string;
      }[];
      for (const row of rows) {
        // Creation may have passed its access check before workspace deletion.
        // Wait for it to settle before treating an absent native unit as purged.
        await this.preparing.get(row.item_id)?.catch(() => {});
        await this.restores.get(row.item_id)?.catch(() => {});
        if (this.generations.resolve(row.item_id))
          throw new Error('Refusing to purge an active generation.');
        if (this.syncStorage.has(row.item_id)) {
          this.sync.invalidate(row.item_id);
          this.syncStorage.remove(row.item_id);
        }
        db.prepare('DELETE FROM spinel_generation_resources WHERE unit_id=?').run(row.item_id);
        db.prepare('DELETE FROM collaboration_purge WHERE item_id=?').run(row.item_id);
      }
    })()
      .then(
        () => {
          finish(true);
        },
        (error) => {
          finish(false);
          throw error;
        },
      )
      .finally(() => {
        this.purging = undefined;
      });
    return this.purging;
  }

  private storedResources(unitId: string): NonNullable<IWorkbookData['resources']> {
    const row = this.workspace.auth.database
      .prepare('SELECT resources FROM spinel_generation_resources WHERE unit_id=?')
      .get(unitId);
    return row ? JSON.parse(String(row.resources)) : [];
  }

  // A stored row that shares a name with a rendered resource is never served,
  // but an unsafe image anywhere in the generation's rows still fails closed.
  private validateImages(itemId: string, unitId: string, snapshot: IWorkbookData | IDocumentData) {
    new DocumentStore(this.workspace).validateImages(itemId, {
      ...snapshot,
      resources: [...(snapshot.resources ?? []), ...this.storedResources(unitId)],
    });
  }

  itemForUnit(unitId: string) {
    const active = this.generations.resolve(unitId);
    if (!active)
      throw new CollaborationError(
        'PERMISSION_DENIED',
        'This version is no longer live. Reload to continue.',
      );
    return active.itemId;
  }

  access(user: string, id: string, edit = false, custom: Record<string, unknown> = {}) {
    try {
      return this.workspaceAccess(user, this.itemForUnit(id), edit ? 'edit' : 'read', custom);
    } catch {
      throw new CollaborationError('PERMISSION_DENIED', 'This document is not available.');
    }
  }

  private workspaceAccess(
    user: string,
    id: string,
    mode: 'read' | 'edit' = 'read',
    custom: Record<string, unknown> = {},
  ): WorkspaceItem {
    try {
      const item = resolveDocument(this.workspace, user, id, mode, custom);
      if (item.kind !== 'sheet' && item.kind !== 'doc') throw new AuthError(404, 'Not a document.');
      return item;
    } catch {
      throw new CollaborationError('PERMISSION_DENIED', 'This document is not available.');
    }
  }

  onPrepared(
    listener: (user: string, id: string, custom: Record<string, unknown>) => Promise<void>,
  ) {
    this.prepareListeners.add(listener);
    return {
      dispose: () => {
        this.prepareListeners.delete(listener);
      },
    };
  }

  async prepare(user: string, id: string, customData: Record<string, unknown> = {}) {
    validateDocumentCredentials(this.workspace, user, customData);
    const custom = Object.freeze({ ...customData });
    await this.prepareCore(user, id, custom);
    for (const listener of this.prepareListeners) await listener(user, id, custom);
    this.workspaceAccess(user, id, 'read', custom);
  }

  private async prepareCore(user: string, id: string, custom: Record<string, unknown>) {
    this.workspaceAccess(user, id, 'read', custom);
    if (this.generations.restoring(id))
      throw new AuthError(409, 'A version is being restored. Try again shortly.');
    const existing = this.preparing.get(id);
    if (existing) {
      await existing;
      this.workspaceAccess(user, id, 'read', custom);
      return;
    }
    const pending = this.prepareUnit(user, id, custom);
    this.preparing.set(id, pending);
    try {
      await pending;
    } finally {
      this.preparing.delete(id);
    }
  }

  private async prepareUnit(user: string, id: string, custom: Record<string, unknown>) {
    const item = this.workspaceAccess(user, id, 'read', custom);
    const unitId = this.generations.active(id).unitId;
    const auth = this.workspace.auth;
    if (!this.syncStorage.has(unitId)) {
      if (auth.database.prepare('SELECT 1 FROM workspace_collaboration WHERE item_id=?').get(id))
        throw new AuthError(
          409,
          'This document needs the collaboration migration before using the new server.',
        );
      const table = item.kind === 'sheet' ? 'sheet_snapshots' : 'doc_snapshots';
      const row = auth.database.prepare(`SELECT snapshot FROM ${table} WHERE item_id=?`).get(id);
      const initial: IWorkbookData | IDocumentData = row
        ? JSON.parse(String(row.snapshot))
        : item.kind === 'sheet'
          ? {
              id: unitId,
              name: item.name,
              appVersion: '1.1.0',
              locale: LocaleType.EN_US,
              sheetOrder: ['first'],
              styles: {},
              sheets: {
                first: {
                  id: 'first',
                  name: 'Sheet1',
                  rowCount: 1000,
                  columnCount: 26,
                  cellData: {},
                },
              },
            }
          : { ...getDocsEmptySnapshot(unitId), title: item.name };
      const native = materialize(
        { ...snapshotIdentity(initial, unitId), rev: 1 },
        item.kind as 'sheet' | 'doc',
      );
      new DocumentStore(this.workspace).validateImages(id, native);
      this.syncStorage.create(
        {
          unitId,
          kind: item.kind as 'sheet' | 'doc',
          revision: 1,
          retainedFrom: 1,
          snapshot: native,
        },
        () => {
          this.workspaceAccess(user, id, 'read', custom);
          if (this.generations.active(id).unitId !== unitId || this.generations.restoring(id))
            throw new AuthError(409, 'This document was restored. Reload to continue.');
          if (
            auth.database.prepare('SELECT 1 FROM workspace_collaboration WHERE item_id=?').get(id)
          )
            throw new AuthError(
              409,
              'This document is already using another collaboration backend.',
            );
          // The preparation fence and initial unit are one transaction, so a
          // failed native materialization or create can be retried after restart.
          auth.database.prepare("INSERT INTO workspace_collaboration VALUES(?,'ready')").run(id);
        },
      );
    }
    this.validateImages(id, unitId, this.syncStorage.load(unitId)!.snapshot);
    this.authorizeSync(unitId, { userID: user, customData: custom }, false);
  }

  async load(user: string, id: string, customData: Record<string, unknown> = {}) {
    validateDocumentCredentials(this.workspace, user, customData);
    const custom = Object.freeze({ ...customData });
    this.workspaceAccess(user, id, 'read', custom);
    const unitId = this.generations.active(id).unitId;
    const data = await this.sync.load(unitId, { userID: user, customData: custom });
    const generation = this.generations.active(id);
    const current = this.workspaceAccess(user, id, 'read', custom);
    if (generation.unitId !== unitId)
      throw new AuthError(409, 'This document was restored. Reload to continue.');
    this.validateImages(id, unitId, data.snapshot);
    return {
      snapshot: snapshotIdentity(data.snapshot, id),
      revision: data.revision + generation.offset,
      access: current.access,
    };
  }

  /**
   * Bounded committed Doc read for an account's sharing transaction. It neither
   * prepares a native unit nor awaits work: grant confirmation can inspect the
   * current durable source bindings under the same SQLite writer lock.
   */
  committedDocumentSnapshot(
    user: string,
    id: string,
    customData: Record<string, unknown>,
    maxBytes: number,
  ): { snapshot: IDocumentData | null; unitId: string; byteLength: number } {
    return this.workspace.auth.transaction(() => {
      const item = resolveDocument(this.workspace, user, id, 'read', customData);
      if (item.kind !== 'doc') throw new AuthError(400, 'Choose a Doc to review formula sources.');
      if (this.generations.restoring(id))
        throw new AuthError(409, 'A version is being restored. Try again shortly.');
      const generation = this.generations.active(id);
      const db = this.workspace.auth.database;
      const native = Boolean(
        db.prepare('SELECT 1 FROM workspace_collaboration WHERE item_id=?').get(id),
      );
      const table = native ? 'spinel_sync_units' : 'doc_snapshots';
      const key = native ? 'unit_id' : 'item_id';
      const storedId = native ? generation.unitId : id;
      const size = db
        .prepare(`SELECT length(CAST(snapshot AS BLOB)) AS bytes FROM ${table} WHERE ${key}=?`)
        .get(storedId);
      if (!size && native)
        throw new AuthError(
          409,
          'This document is not ready for source review. Try again shortly.',
        );
      const byteLength = Number(size?.bytes ?? 0);
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || byteLength > maxBytes)
        throw new AuthError(413, 'Formula source review is too large. Share the report alone.');
      const row = size
        ? db.prepare(`SELECT snapshot FROM ${table} WHERE ${key}=?`).get(storedId)
        : undefined;
      return {
        snapshot: row ? (JSON.parse(String(row.snapshot)) as IDocumentData) : null,
        unitId: generation.unitId,
        byteLength,
      };
    });
  }

  /**
   * One authorized read of the live generation for a device to keep offline
   * (docs/offline.md). Nothing partial is returned: a change of session, access
   * or generation while the read is in flight fails the whole bundle.
   */
  async offlineBundle(
    user: string,
    id: string,
    verify: () => void,
    customData: Record<string, unknown> = {},
  ): Promise<OfflineBundle> {
    const changed = () =>
      new AuthError(409, 'Access or the document version changed. Retry the download.');
    const unavailable = () => new AuthError(404, 'This document is not available.');
    // Link guests use their link while it lasts; an offline copy would outlive it.
    if (user.startsWith('guest:')) throw unavailable();
    const family = validateDocumentCredentials(this.workspace, user, customData);
    if (family !== 'account' && family !== 'trusted') throw unavailable();
    const custom = Object.freeze({ ...customData });
    let initialUnit: string | undefined;
    try {
      this.workspaceAccess(user, id, 'read', custom);
      initialUnit = this.generations.active(id).unitId;
      await this.prepare(user, id, custom);
      verify();
      const item = this.workspaceAccess(user, id, 'read', custom);
      const generation = this.generations.active(id);
      if (this.generations.restoring(id)) throw changed();
      const data = await this.load(user, id, custom);
      verify();
      const current = this.workspaceAccess(user, id, 'read', custom);
      const after = this.generations.active(id);
      if (
        after.unitId !== generation.unitId ||
        after.offset !== generation.offset ||
        this.generations.restoring(id) ||
        current.access !== item.access ||
        data.access !== item.access
      )
        throw changed();
      const documents = new DocumentStore(this.workspace);
      const images = new Map<string, OfflineBundleImage>();
      const prefix = `/api/items/${id}/images/`;
      imageSources(data.snapshot, (source) => {
        if (images.has(source)) return source;
        const sha256 = source.slice(prefix.length);
        // Defence in depth: load()'s validateImages already rejects every source
        // that is not a stored image of this item, so no test can reach this guard.
        if (!source.startsWith(prefix) || !/^[a-f0-9]{64}$/.test(sha256))
          throw new AuthError(
            400,
            'Insert images from a file so they are saved with this document.',
          );
        const image = documents.image(user, id, sha256, custom);
        // Stored IDs are content hashes; a mismatch must never reach a device as verified.
        if (createHash('sha256').update(image.data).digest('hex') !== sha256) {
          // IDs only: never the image bytes or the document's name.
          console.error(
            JSON.stringify({
              event: 'offline_bundle.image_damaged',
              at: new Date().toISOString(),
              itemId: id,
              imageId: sha256,
            }),
          );
          throw new AuthError(500, 'A stored image is damaged. Nothing was downloaded.');
        }
        images.set(source, { source, sha256, mime: image.mime, byteLength: image.data.byteLength });
        return source;
      });
      const appearance = readAppearance(this.workspace.auth.database, id);
      const coverAssets: Record<string, string> = {};
      if (appearance.cover?.source === 'upload')
        for (const hash of Object.values(appearance.cover.images)) {
          const asset = this.workspace.auth.database
            .prepare('SELECT data FROM cover_assets WHERE item_id=? AND id=?')
            .get(id, hash);
          if (
            !asset ||
            createHash('sha256')
              .update(asset.data as Uint8Array)
              .digest('hex') !== hash
          )
            throw new AuthError(500, 'A cover image is damaged. Nothing was downloaded.');
          coverAssets[hash] = Buffer.from(asset.data as Uint8Array).toString('base64');
        }
      const fields = {
        appearance,
        coverAssets,
        version: 1 as const,
        accountId: user,
        itemId: id,
        ...(hasSpaceContext(custom) ? { spaceId: custom.spaceId as string } : {}),
        name: current.name,
        unitId: generation.unitId,
        revision: data.revision,
        revisionOffset: generation.offset,
        access: current.access,
        readOnly: current.access === 'viewer',
        sdkVersion: packageInfo.dependencies['@univerjs/core'],
        images: [...images.values()].sort((a, b) => a.source.localeCompare(b.source)),
      };
      return item.kind === 'sheet'
        ? { ...fields, kind: 'sheet', snapshot: data.snapshot as IWorkbookData }
        : { ...fields, kind: 'doc', snapshot: data.snapshot as IDocumentData };
    } catch (error) {
      // Preserve the route's signed-out response even when a deeper read
      // discovers the expired session before returning to this boundary.
      verify();
      if (!(error instanceof CollaborationError) || error.code !== 'PERMISSION_DENIED') throw error;
      // The native server also refuses a read of a unit that a restore replaced or is
      // replacing. With access intact that is a version change the device can
      // retry; any other denial stays indistinguishable from no access.
      let readable = true;
      try {
        this.workspaceAccess(user, id, 'read', custom);
      } catch {
        readable = false;
      }
      if (
        readable &&
        initialUnit !== undefined &&
        (this.generations.restoring(id) || this.generations.active(id).unitId !== initialUnit)
      )
        throw changed();
      throw unavailable();
    }
  }

  restore(
    user: string,
    id: string,
    expectedUnit: string,
    requestId: string,
    checkpointId: string,
    snapshot: IWorkbookData | IDocumentData,
    prepareBefore: (data: Awaited<ReturnType<CollaborationStore['load']>>) => Promise<() => void>,
    checkSession: () => void,
    customData: Record<string, unknown> = {},
  ) {
    checkSession();
    validateDocumentCredentials(this.workspace, user, customData, true);
    const custom = Object.freeze({ ...customData });
    const job = this.generations.begin(user, id, expectedUnit, requestId, checkpointId, custom);
    const finishWaiter = async (promise: Promise<RestoreJob>) => {
      const result = await promise;
      checkSession();
      this.workspaceAccess(user, id, 'edit', custom);
      // Every coalesced caller proves its own actor, checkpoint and request again.
      return this.generations.completed(user, id, requestId, checkpointId, custom) ?? result;
    };
    const pending = this.restores.get(job.nextUnit);
    if (pending) return finishWaiter(pending);
    if (job.status === 'complete') return finishWaiter(Promise.resolve(job));
    if (job.status !== 'staging')
      throw new AuthError(409, 'Restore was interrupted. Start a new restore.');
    const run = (async () => {
      try {
        await Promise.all(this.admitted.get(job.previousUnit) ?? []);
        checkSession();
        const item = this.workspaceAccess(user, id, 'edit', custom);
        const before = await this.load(user, id, custom);
        const preserve = await prepareBefore(before);
        checkSession();
        this.workspaceAccess(user, id, 'edit', custom);
        new DocumentStore(this.workspace).validateImages(id, snapshot);
        const replacement = { ...snapshotIdentity(snapshot, job.nextUnit), rev: 1 };
        const native = materialize(replacement, item.kind as 'sheet' | 'doc');
        new DocumentStore(this.workspace).validateImages(id, native);
        this.syncStorage.create(
          {
            unitId: job.nextUnit,
            kind: item.kind as 'sheet' | 'doc',
            revision: 1,
            retainedFrom: 1,
            snapshot: native,
          },
          () => {
            checkSession();
            this.workspaceAccess(user, id, 'edit', custom);
          },
        );
        return this.generations.finish(job.id, before.revision, preserve, checkSession, custom);
      } catch (error) {
        // All awaited creation work has settled; cancellation cannot race a late create.
        this.generations.cancel(job.id);
        throw error;
      }
    })().finally(() => {
      this.restores.delete(job.nextUnit);
    });
    this.restores.set(job.nextUnit, run);
    return finishWaiter(run);
  }

  async close() {
    await Promise.allSettled([...this.preparing.values(), ...this.restores.values()]);
    await this.purging;
    await this.sync.close();
  }
}
