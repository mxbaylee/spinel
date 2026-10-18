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
  transformSnapshotToDocumentData,
  transformSnapshotToWorkbookData,
} from '@univerjs-pro/collaboration';
import { AuthError } from '../auth/store.ts';
import type { WorkspaceStore } from '../workspace/store.ts';
import { SheetStore } from '../workspace/sheets.ts';
import { DocumentStore } from '../workspace/documents.ts';
import type { IChangeset } from '@univerjs/protocol';
const runtimeLimits = { maxLoadedUnits: 8, idleTimeoutMs: 60_000 };

function validateTargets(changeset: Readonly<IChangeset>) {
  const walk = (value: unknown, depth = 0) => {
    if (depth > 64) throw new CollabError('INVALID_REQUEST', 'Change is nested too deeply.');
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if ((key === 'unitId' || key === 'unitID') && child !== changeset.unitID)
        throw new CollabError('PERMISSION_DENIED', 'Cross-document changes are not allowed.');
      walk(child, depth + 1);
    }
  };
  for (const mutation of changeset.mutations) {
    let data: unknown;
    try {
      data = JSON.parse(mutation.data);
    } catch {
      throw new CollabError('INVALID_REQUEST', 'Invalid mutation data.');
    }
    walk(data);
  }
}

/** Public SDK boundary. HTTP/WebSocket integration must supply trusted identities. */
export class CollaborationStore {
  readonly service: UniverCollabService;
  private readonly database: SQLiteDatabaseAdapter;
  private readonly workspace: WorkspaceStore;
  private readonly migration = Symbol('trusted snapshot migration');
  private readonly preparing = new Map<string, Promise<void>>();
  private readonly materializer: UnitSnapshotMaterializer;
  private readonly validator = new UnitSnapshotMaterializer(runtimeLimits);
  private readonly lifecycle = Symbol('trusted permanent deletion');
  private purging: Promise<void> | undefined;

  constructor(workspace: WorkspaceStore, filename: string) {
    const main = workspace.auth.database
      .prepare('PRAGMA database_list')
      .all()
      .find((row) => row.name === 'main');
    if (!main?.file || realpathSync(String(main.file)) !== realpathSync(filename))
      throw new Error('Collaboration must use the application database file.');
    this.workspace = workspace;
    new SheetStore(workspace);
    new DocumentStore(workspace);
    workspace.auth.database.exec(`CREATE TABLE IF NOT EXISTS workspace_collaboration (
      item_id TEXT PRIMARY KEY REFERENCES workspace_items(id) ON DELETE CASCADE,
      state TEXT NOT NULL CHECK(state IN ('preparing','ready'))
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
      workspace.auth.database
        .prepare('UPDATE workspace_items SET updated_at=max(updated_at,?) WHERE id=?')
        .run(workspace.auth.now(), event.changeset.unitID);
    });
    this.service.use('readUnitData', async (context, next) => {
      this.session(context.userID, context.customData);
      this.access(context.userID, context.request.unitID);
      await next();
      this.session(context.userID, context.customData);
      this.access(context.userID, context.request.unitID);
    });
    for (const action of ['submitChangeset', 'applyChangeset', 'commitChangeset'] as const) {
      this.service.use(
        action,
        async (context: SubmitChangesetMiddlewareContext, next: MiddlewareNext) => {
          this.access(context.userID, context.request.changeset.unitID, true);
          this.session(context.userID, context.customData);
          validateTargets(context.request.changeset);
          await next();
        },
      );
    }
    this.service.use('commitChangeset', async (context, next) => {
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
      const native =
        context.changeset.type === UniverType.UNIVER_DOC
          ? transformSnapshotToDocumentData(materialized.snapshot)
          : await transformSnapshotToWorkbookData(materialized.snapshot, materialized.sheetBlocks);
      if (Buffer.byteLength(JSON.stringify(native)) > 10 * 1024 * 1024)
        throw new CollabError('PERMISSION_DENIED', 'This document is too large to save.');
      if (context.changeset.type === UniverType.UNIVER_DOC) {
        try {
          new DocumentStore(workspace).validateImages(id, native as IDocumentData);
        } catch (error) {
          if (error instanceof AuthError) throw new CollabError('INVALID_REQUEST', error.message);
          throw error;
        }
      }
      this.session(context.userID, context.customData);
      this.access(context.userID, id, true);
      await next();
    });
    this.service.use('createUnit', async (context, next) => {
      if (context.customData.migration !== this.migration)
        throw new CollabError('PERMISSION_DENIED', 'Create documents through Spinel.');
      const item = this.access(context.userID, context.request.snapshot.unitID);
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

  private session(user: string, custom: Record<string, unknown>) {
    // Internal jobs use trusted user identities; network calls additionally bind the live session.
    if (
      Object.hasOwn(custom, 'sessionHash') &&
      (typeof custom.sessionHash !== 'string' ||
        this.workspace.auth.sessionByHash(custom.sessionHash)?.user_id !== user)
    )
      throw new CollabError('PERMISSION_DENIED', 'Your session expired.');
  }

  purgeDeleted() {
    if (this.purging) return this.purging;
    this.purging = (async () => {
      const db = this.workspace.auth.database;
      const rows = db.prepare('SELECT item_id FROM collaboration_purge').all() as {
        item_id: string;
      }[];
      for (const row of rows) {
        // Creation may have passed its access check before workspace deletion.
        // Wait for it to settle before treating an absent SDK unit as purged.
        await this.preparing.get(row.item_id)?.catch(() => {});
        const context = { userID: 'spinel-lifecycle', customData: { lifecycle: this.lifecycle } };
        // A crash can leave a preparing fence before the SDK has created any unit.
        if (await this.database.getUnit({ ...context, request: {} }, row.item_id))
          await this.service.deleteUnits({ unitIDs: [row.item_id], hardDelete: true }, context);
        db.prepare('DELETE FROM collaboration_purge WHERE item_id=?').run(row.item_id);
      }
    })().finally(() => {
      this.purging = undefined;
    });
    return this.purging;
  }

  private access(user: string, id: string, edit = false) {
    try {
      const item = this.workspace.get(user, id, edit ? 'edit' : 'read');
      if (item.kind !== 'sheet' && item.kind !== 'doc') throw new AuthError(404, 'Not a document.');
      return item;
    } catch {
      throw new CollabError('PERMISSION_DENIED', 'This document is not available.');
    }
  }

  async prepare(user: string, id: string) {
    this.access(user, id);
    const existing = this.preparing.get(id);
    if (existing) {
      await existing;
      this.access(user, id);
      return;
    }
    const pending = this.prepareUnit(user, id);
    this.preparing.set(id, pending);
    try {
      await pending;
    } finally {
      this.preparing.delete(id);
    }
  }

  private async prepareUnit(user: string, id: string) {
    const item = this.access(user, id);
    const type = item.kind === 'sheet' ? UniverType.UNIVER_SHEET : UniverType.UNIVER_DOC;
    const auth = this.workspace.auth;
    // Fence legacy saves before yielding. On interruption the next open retries this migration;
    // it must not clear the fence and allow an old tab to overwrite a collaboration unit.
    const snapshot = auth.transaction(() => {
      auth.database
        .prepare("INSERT OR IGNORE INTO workspace_collaboration VALUES(?,'preparing')")
        .run(id);
      return item.kind === 'sheet'
        ? new SheetStore(this.workspace).load(user, id).snapshot
        : new DocumentStore(this.workspace).load(user, id).snapshot;
    });
    try {
      await this.service.getUnitLoadData({ unitID: id, type, revision: 0 }, { userID: user });
    } catch (error) {
      if (!(error instanceof CollabError) || error.code !== 'UNIT_NOT_FOUND') throw error;
      const context = { userID: user, customData: { migration: this.migration } };
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
          { type: UniverType.UNIVER_SHEET, data: { ...initial, rev: 1 } },
          context,
        );
      } else {
        const initial = (snapshot as IDocumentData | null) ?? {
          ...getDocsEmptySnapshot(id),
          title: item.name,
        };
        await this.service.createUnitFromData(
          { type: UniverType.UNIVER_DOC, data: { ...initial, rev: 1 } },
          context,
        );
      }
    }
    // Loading the public materializer is expensive on a cold process. Finish it
    // before the browser can edit so the first change pays no initialization
    // penalty. This validates only existing data; every candidate is still
    // checked independently by the commit middleware above.
    const current = await this.service.getUnitLoadDataWithBlocks(
      { unitID: id, type, revision: 0 },
      { userID: user },
    );
    await this.validator.materializeSnapshot(current);
    this.access(user, id);
    auth.database
      .prepare("UPDATE workspace_collaboration SET state='ready' WHERE item_id=?")
      .run(id);
  }

  async load(user: string, id: string) {
    const item = this.access(user, id);
    const type = item.kind === 'sheet' ? UniverType.UNIVER_SHEET : UniverType.UNIVER_DOC;
    const data = await this.service.getUnitLoadDataWithBlocks(
      { unitID: id, type, revision: 0 },
      { userID: user },
    );
    const materialized = await this.materializer.materializeSnapshot(data);
    const snapshot =
      item.kind === 'sheet'
        ? await transformSnapshotToWorkbookData(materialized.snapshot, materialized.sheetBlocks)
        : transformSnapshotToDocumentData(materialized.snapshot);
    const current = this.access(user, id);
    return { snapshot, revision: data.targetRevision, access: current.access };
  }

  async close() {
    await Promise.allSettled(this.preparing.values());
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
