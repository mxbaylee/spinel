import { snapshotIdentity } from './snapshotIdentity.ts';
import type { OfflineBundle, OfflineBundleImage } from '../../shared/offlineBundle.ts';
import packageInfo from '../../../package.json' with { type: 'json' };
import { createHash } from 'node:crypto';
import type { RestoreJob } from './generations.ts';
import { CollaborationGenerations } from './generations.ts';
import { auditDeniedEdit } from './audit.ts';
import { realpathSync } from 'node:fs';
import { getDocsEmptySnapshot, LocaleType } from '@univerjs/core';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { UniverType } from '@univerjs/protocol';
import { SQLiteDatabaseAdapter } from '@univerjs-pro/collaboration-database-sqlite';
import {
  CollabError,
  UniverCollabService,
  UnitSnapshotMaterializer,
} from '@univerjs-pro/collaboration-service';
import type {
  MiddlewareNext,
  SubmitChangesetMiddlewareContext,
} from '@univerjs-pro/collaboration-service';
import {
  RevertRevisionMutation,
  transformSnapshotToDocumentData,
  transformSnapshotToWorkbookData,
} from '@univerjs-pro/collaboration';
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

function validateTargets(changeset: Readonly<IChangeset>) {
  const isIndex = (key: string) => /^\d+$/.test(key);
  const walk = (value: unknown, path: string[], allowedUnit = changeset.unitID) => {
    if (path.length > 64) throw new CollabError('INVALID_REQUEST', 'Change is nested too deeply.');
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
        throw new CollabError('PERMISSION_DENIED', 'Cross-document changes are not allowed.');
      walk(child, [...path, key], allowedUnit);
    }
  };
  for (const mutation of changeset.mutations) {
    if (mutation.id === RevertRevisionMutation.id)
      throw new CollabError(
        'PERMISSION_DENIED',
        'Restore versions through Spinel so the current state is kept.',
      );
    let data: unknown;
    try {
      data = JSON.parse(mutation.data);
    } catch {
      throw new CollabError('INVALID_REQUEST', 'Invalid mutation data.');
    }
    walk(data, []);
  }
}

/** Public SDK boundary. HTTP/WebSocket integration must supply trusted identities. */
export class CollaborationStore {
  readonly service: UniverCollabService;
  readonly generations: CollaborationGenerations;
  private readonly admitted = new Map<string, Set<Promise<void>>>();
  private readonly restores = new Map<string, Promise<RestoreJob>>();
  private readonly database: SQLiteDatabaseAdapter;
  private readonly workspace: WorkspaceStore;
  private readonly migration = Symbol('trusted snapshot migration');
  private readonly preparing = new Map<string, Promise<void>>();
  private readonly materializer: UnitSnapshotMaterializer;
  private readonly validator = new UnitSnapshotMaterializer(runtimeLimits);
  private readonly lifecycle = Symbol('trusted permanent deletion');
  private purging: Promise<void> | undefined;
  private readonly observePurge?: ObserveJob;
  private readonly prepareListeners = new Set<
    (user: string, id: string, custom: Record<string, unknown>) => Promise<void>
  >();

  constructor(
    workspace: WorkspaceStore,
    filename: string,
    options: { spaceReview?: boolean; observePurge?: ObserveJob } = {},
  ) {
    this.observePurge = options.observePurge;
    const main = workspace.auth.database
      .prepare('PRAGMA database_list')
      .all()
      .find((row) => row.name === 'main');
    if (!main?.file || realpathSync(String(main.file)) !== realpathSync(filename))
      throw new Error('Collaboration must use the application database file.');
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
    // One physical file keeps application and collaboration data in the same online backup.
    this.database = new SQLiteDatabaseAdapter({ filename, busyTimeoutMs: 5_000 });
    this.service = new UniverCollabService({ dbAdapter: this.database, runtime: runtimeLimits });
    this.materializer = new UnitSnapshotMaterializer(runtimeLimits);
    // Modification time is derived metadata; only durable SDK commits advance it.
    this.service.on('changesetCommitted', (event) => {
      const active = this.generations.resolve(event.changeset.unitID);
      if (!active) return;
      workspace.auth.database
        .prepare('UPDATE workspace_items SET updated_at=max(updated_at,?) WHERE id=?')
        .run(workspace.auth.now(), active.itemId);
    });
    this.service.use('readUnitData', async (context, next) => {
      this.session(context.userID, context.customData);
      this.readAccess(context.userID, context.request.unitID, context.customData);
      await next();
      this.session(context.userID, context.customData);
      this.readAccess(context.userID, context.request.unitID, context.customData);
    });
    for (const action of ['submitChangeset', 'applyChangeset', 'commitChangeset'] as const) {
      this.service.use(
        action,
        async (context: SubmitChangesetMiddlewareContext, next: MiddlewareNext) => {
          let release: (() => void) | undefined;
          let pending: Promise<void> | undefined;
          const unitId = context.request.changeset.unitID;
          try {
            const generation = this.generations.resolve(unitId);
            if (action === 'submitChangeset') {
              if (!generation || this.generations.restoring(generation.itemId))
                throw new CollabError(
                  'PERMISSION_DENIED',
                  'Restoring a version. Copy unsaved changes and reload.',
                );
              // Admission and the restore fence are synchronous. Existing submissions drain normally.
              pending = new Promise<void>((resolve) => {
                release = resolve;
              });
              const active = this.admitted.get(unitId) ?? new Set<Promise<void>>();
              active.add(pending);
              this.admitted.set(unitId, active);
            }
            this.access(context.userID, context.request.changeset.unitID, true, context.customData);
            this.session(context.userID, context.customData, true);
            validateTargets(context.request.changeset);
            await next();
          } catch (error) {
            if (
              action === 'submitChangeset' &&
              error instanceof CollabError &&
              error.code === 'PERMISSION_DENIED'
            )
              auditDeniedEdit(context.userID, context.request.changeset.unitID, action);
            throw error;
          } finally {
            if (pending) {
              this.admitted.get(unitId)?.delete(pending);
              if (!this.admitted.get(unitId)?.size) this.admitted.delete(unitId);
              release!();
            }
          }
        },
      );
    }
    this.service.use('commitChangeset', async (context, next) => {
      if (
        Object.hasOwn(context.customData, 'mcpTokenHash') &&
        context.expectedHeadRevision !== context.request.changeset.baseRev
      )
        throw new CollabError(
          'REVISION_MISMATCH',
          'The document changed. Read it again before editing.',
        );
      const id = context.changeset.unitID;
      validateTargets(context.changeset);
      if (context.requiredUnitPermissions.some((permission) => permission.unitID !== id))
        throw new CollabError('PERMISSION_DENIED', 'Cross-document changes are not allowed.');
      // Validate the aligned candidate with the public materializer before durable commit.
      const data = await this.service.getUnitLoadDataWithBlocks(
        { unitID: id, type: context.changeset.type, revision: 0 },
        { userID: context.userID, customData: context.customData },
      );
      const materialized = await this.validator.materializeSnapshot({
        ...data,
        changesets: [...data.changesets, context.changeset],
        targetRevision: context.expectedHeadRevision + 1,
      });
      const rendered =
        context.changeset.type === UniverType.UNIVER_DOC
          ? transformSnapshotToDocumentData(materialized.snapshot)
          : await transformSnapshotToWorkbookData(materialized.snapshot, materialized.sheetBlocks);
      const native = this.preservedResources(id, rendered);
      if (Buffer.byteLength(JSON.stringify(native)) > 10 * 1024 * 1024)
        throw new CollabError('PERMISSION_DENIED', 'This document is too large to save.');
      try {
        new DocumentStore(workspace).validateImages(this.itemForUnit(id), native);
      } catch (error) {
        if (error instanceof AuthError) throw new CollabError('INVALID_REQUEST', error.message);
        throw error;
      }
      this.session(context.userID, context.customData, true);
      this.access(context.userID, id, true, context.customData);
      await next();
    });
    this.service.use('createUnit', async (context, next) => {
      if (context.customData.migration !== this.migration)
        throw new CollabError('PERMISSION_DENIED', 'Create documents through Spinel.');
      const item = this.readAccess(
        context.userID,
        context.request.snapshot.unitID,
        context.customData,
      );
      const type = item.kind === 'sheet' ? UniverType.UNIVER_SHEET : UniverType.UNIVER_DOC;
      if (context.request.snapshot.type !== type)
        throw new CollabError('PERMISSION_DENIED', 'Document type does not match.');
      await next();
    });
    // Lifecycle changes need coordination with the workspace tree, never raw protocol calls.
    this.service.use('deleteUnits', async (context, next) => {
      if (context.customData.lifecycle !== this.lifecycle || !context.request.hardDelete)
        throw new CollabError('PERMISSION_DENIED', 'Manage documents through Spinel.');
      await next();
    });
    this.service.use('recoverUnits', () => {
      throw new CollabError('PERMISSION_DENIED', 'Manage documents through Spinel.');
    });
  }

  private session(user: string, custom: Record<string, unknown>, edit = false) {
    try {
      validateDocumentCredentials(this.workspace, user, custom, edit);
    } catch {
      throw new CollabError(
        'PERMISSION_DENIED',
        'This document credential is no longer available.',
      );
    }
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
        // Wait for it to settle before treating an absent SDK unit as purged.
        await this.preparing.get(row.item_id)?.catch(() => {});
        await this.restores.get(row.item_id)?.catch(() => {});
        if (
          this.generations.resolve(row.item_id)?.unitId === row.item_id &&
          this.workspace.auth.database
            .prepare('SELECT 1 FROM spinel_live_units WHERE unit_id=?')
            .get(row.item_id)
        )
          throw new Error('Refusing to purge an active generation.');
        const context = { userID: 'spinel-lifecycle', customData: { lifecycle: this.lifecycle } };
        // A crash can leave a preparing fence before the SDK has created any unit.
        if (await this.database.getUnit({ ...context, request: {} }, row.item_id))
          await this.service.deleteUnits({ unitIDs: [row.item_id], hardDelete: true }, context);
        db.prepare('DELETE FROM spinel_generation_resources WHERE unit_id=?').run(row.item_id);
        db.prepare('DELETE FROM collaboration_purge WHERE item_id=?').run(row.item_id);
      }
    })().then(() => { finish(true); }, (error) => {
      finish(false);
      throw error;
    }).finally(() => {
      this.purging = undefined;
    });
    return this.purging;
  }

  /** Native plugins omit unknown resources when serializing. Preserve only those names,
   * never a stale copy of resources managed by the live SDK. */
  private rememberResources(
    unitId: string,
    itemId: string,
    source: IWorkbookData | IDocumentData | null,
    rendered: IWorkbookData | IDocumentData,
  ) {
    const known = new Set((rendered.resources ?? []).map((resource) => resource.name));
    const opaque = (source?.resources ?? []).filter((resource) => !known.has(resource.name));
    this.workspace.auth.database
      .prepare('INSERT OR IGNORE INTO spinel_generation_resources VALUES(?,?,?)')
      .run(unitId, itemId, JSON.stringify(opaque));
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

  private preservedResources<T extends IWorkbookData | IDocumentData>(
    unitId: string,
    snapshot: T,
  ): T {
    const stored = this.storedResources(unitId) as NonNullable<T['resources']>;
    if (!stored.length) return snapshot;
    const known = new Set((snapshot.resources ?? []).map((resource) => resource.name));
    const missing = stored.filter((resource) => !known.has(resource.name));
    return missing.length
      ? { ...snapshot, resources: [...(snapshot.resources ?? []), ...missing] }
      : snapshot;
  }

  itemForUnit(unitId: string) {
    const active = this.generations.resolve(unitId);
    if (!active)
      throw new CollabError(
        'PERMISSION_DENIED',
        'This version is no longer live. Reload to continue.',
      );
    return active.itemId;
  }

  private readAccess(user: string, unitId: string, custom: Record<string, unknown>) {
    if (
      custom.migration === this.migration &&
      custom.stagedUnit === unitId &&
      typeof custom.itemId === 'string'
    )
      return this.workspaceAccess(user, custom.itemId, 'edit', custom);
    return this.access(user, unitId, false, custom);
  }

  access(user: string, id: string, edit = false, custom: Record<string, unknown> = {}) {
    try {
      return this.workspaceAccess(user, this.itemForUnit(id), edit ? 'edit' : 'read', custom);
    } catch {
      throw new CollabError('PERMISSION_DENIED', 'This document is not available.');
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
      throw new CollabError('PERMISSION_DENIED', 'This document is not available.');
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
    const type = item.kind === 'sheet' ? UniverType.UNIVER_SHEET : UniverType.UNIVER_DOC;
    const auth = this.workspace.auth;
    // Fence legacy saves before yielding. On interruption the next open retries this migration;
    // it must not clear the fence and allow an old tab to overwrite a collaboration unit.
    const snapshot = auth.transaction(() => {
      this.workspaceAccess(user, id, 'read', custom);
      auth.database
        .prepare("INSERT OR IGNORE INTO workspace_collaboration VALUES(?,'preparing')")
        .run(id);
      if (hasSpaceContext(custom)) {
        // The explicit scope was resolved inside this transaction. Read the same
        // native rows without admitting Space IDs to legacy document services.
        const table = item.kind === 'sheet' ? 'sheet_snapshots' : 'doc_snapshots';
        const row = auth.database.prepare(`SELECT snapshot FROM ${table} WHERE item_id=?`).get(id);
        const native = row
          ? (JSON.parse(String(row.snapshot)) as IWorkbookData | IDocumentData)
          : null;
        if (native) new DocumentStore(this.workspace).validateImages(id, native);
        return native;
      }
      return item.kind === 'sheet'
        ? new SheetStore(this.workspace).load(user, id).snapshot
        : new DocumentStore(this.workspace).load(user, id).snapshot;
    });
    try {
      await this.service.getUnitLoadData(
        { unitID: unitId, type, revision: 0 },
        { userID: user, customData: custom },
      );
    } catch (error) {
      if (!(error instanceof CollabError) || error.code !== 'UNIT_NOT_FOUND') throw error;
      const context = { userID: user, customData: { ...custom, migration: this.migration } };
      if (item.kind === 'sheet') {
        const initial: IWorkbookData = (snapshot as IWorkbookData | null) ?? {
          id,
          name: item.name,
          appVersion: '1.1.0',
          locale: LocaleType.EN_US,
          sheetOrder: ['first'],
          sheets: {
            first: {
              id: 'first',
              name: 'Sheet1',
              rowCount: 1000,
              columnCount: 26,
              cellData: {},
            },
          },
          styles: {},
        };
        await this.service.createUnitFromData(
          { type: UniverType.UNIVER_SHEET, data: { ...initial, id: unitId, rev: 1 } },
          context,
        );
      } else {
        const initial = (snapshot as IDocumentData | null) ?? {
          ...getDocsEmptySnapshot(id),
          title: item.name,
        };
        await this.service.createUnitFromData(
          { type: UniverType.UNIVER_DOC, data: { ...initial, id: unitId, rev: 1 } },
          context,
        );
      }
    }
    // Loading the public materializer is expensive on a cold process. Finish it
    // before the browser can edit so the first change pays no initialization
    // penalty. This validates only existing data; every candidate is still
    // checked independently by the commit middleware above.
    const current = await this.service.getUnitLoadDataWithBlocks(
      { unitID: unitId, type, revision: 0 },
      { userID: user, customData: custom },
    );
    const prepared = await this.validator.materializeSnapshot(current);
    const native =
      item.kind === 'sheet'
        ? await transformSnapshotToWorkbookData(prepared.snapshot, prepared.sheetBlocks)
        : transformSnapshotToDocumentData(prepared.snapshot);
    this.workspaceAccess(user, id, 'read', custom);
    if (this.generations.active(id).unitId !== unitId || this.generations.restoring(id))
      throw new AuthError(409, 'This document was restored. Reload to continue.');
    this.validateImages(id, unitId, native);
    this.rememberResources(unitId, id, snapshot, native);
    auth.database
      .prepare("UPDATE workspace_collaboration SET state='ready' WHERE item_id=?")
      .run(id);
  }

  async load(user: string, id: string, customData: Record<string, unknown> = {}) {
    validateDocumentCredentials(this.workspace, user, customData);
    const custom = Object.freeze({ ...customData });
    const item = this.workspaceAccess(user, id, 'read', custom);
    const unitId = this.generations.active(id).unitId;
    const type = item.kind === 'sheet' ? UniverType.UNIVER_SHEET : UniverType.UNIVER_DOC;
    const data = await this.service.getUnitLoadDataWithBlocks(
      { unitID: unitId, type, revision: 0 },
      { userID: user, customData: custom },
    );
    const materialized = await this.materializer.materializeSnapshot(data);
    const snapshot =
      item.kind === 'sheet'
        ? await transformSnapshotToWorkbookData(materialized.snapshot, materialized.sheetBlocks)
        : transformSnapshotToDocumentData(materialized.snapshot);
    this.validateImages(id, unitId, snapshot);
    const current = this.workspaceAccess(user, id, 'read', custom);
    const generation = this.generations.active(id);
    if (generation.unitId !== unitId)
      throw new AuthError(409, 'This document was restored. Reload to continue.');
    return {
      snapshot: snapshotIdentity(this.preservedResources(unitId, snapshot), id),
      revision: data.targetRevision + generation.offset,
      access: current.access,
    };
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
      const fields = {
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
      if (!(error instanceof CollabError) || error.code !== 'PERMISSION_DENIED') throw error;
      // The SDK also refuses a read of a unit that a restore replaced or is
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
        const type = item.kind === 'sheet' ? UniverType.UNIVER_SHEET : UniverType.UNIVER_DOC;
        const context = {
          userID: user,
          customData: {
            ...custom,
            migration: this.migration,
            itemId: id,
            stagedUnit: job.nextUnit,
          },
        };
        const replacement = { ...snapshotIdentity(snapshot, job.nextUnit), rev: 1 };
        await this.service.createUnitFromData(
          type === UniverType.UNIVER_SHEET
            ? { type, data: replacement as IWorkbookData }
            : { type, data: replacement as IDocumentData },
          context,
        );
        const staged = await this.service.getUnitLoadDataWithBlocks(
          { unitID: job.nextUnit, type, revision: 0 },
          context,
        );
        const checked = await this.validator.materializeSnapshot(staged);
        const native =
          type === UniverType.UNIVER_SHEET
            ? await transformSnapshotToWorkbookData(checked.snapshot, checked.sheetBlocks)
            : transformSnapshotToDocumentData(checked.snapshot);
        this.workspaceAccess(user, id, 'edit', custom);
        this.rememberResources(job.nextUnit, id, replacement, native);
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
    try {
      await this.purging;
      await this.validator.dispose();
      await this.materializer.dispose();
      await this.service.dispose();
    } finally {
      await this.database.dispose();
    }
  }
}
