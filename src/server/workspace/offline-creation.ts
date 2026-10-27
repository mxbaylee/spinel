import { createHash } from 'node:crypto';
import { initialIcon } from '../appearance/data.ts';
import { materialize } from '@spinel/sync-server';
import type { OfflineCreationResponse } from '../../shared/offlineCreation.ts';
import { blankOfflineSnapshot, isOfflineCreationRequest } from '../../shared/offlineCreation.ts';
import { snapshotIdentity } from '../../shared/snapshotIdentity.ts';
import { AuthError } from '../auth/store.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import { SQLiteSyncStorage } from '../sync/store.ts';
import type { WorkspaceStore } from './store.ts';

export class OfflineCreationError extends AuthError {
  readonly code: 'folder-unavailable' | 'creation-conflict';
  constructor(code: 'folder-unavailable' | 'creation-conflict', message: string) {
    super(code === 'folder-unavailable' ? 403 : 409, message);
    this.code = code;
  }
}

const conflict = () =>
  new OfflineCreationError(
    'creation-conflict',
    'This creation request no longer matches its document. Keep the saved work on this device.',
  );

/** Atomic empty-document admission, with a receipt independent of the item's lifetime. */
export class OfflineCreations {
  private readonly workspace: WorkspaceStore;
  private readonly collaboration: CollaborationStore;
  private readonly storage: SQLiteSyncStorage;

  constructor(workspace: WorkspaceStore, collaboration: CollaborationStore) {
    this.workspace = workspace;
    this.collaboration = collaboration;
    this.storage = new SQLiteSyncStorage(workspace.auth);
    // Do not attach an item foreign key: deleting a document must not let an
    // old lost-acknowledgement retry recreate it or reuse its native generation.
    workspace.auth.database.exec(`
      CREATE TABLE IF NOT EXISTS workspace_offline_creations (
        item_id TEXT PRIMARY KEY,
        unit_id TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        request_hash TEXT NOT NULL
      ) STRICT;
    `);
  }

  create(user: string, input: unknown, verify: () => void): OfflineCreationResponse {
    verify();
    this.workspace.owner(user);
    if (!isOfflineCreationRequest(input))
      throw new AuthError(400, 'Use the saved offline creation request.');
    // Explicit field order makes the receipt independent of JSON property order.
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify([
          input.version,
          input.itemId,
          input.unitId,
          input.kind,
          input.name,
          input.parentId,
          // Preserve receipts made before optional identity fields existed.
          ...(input.icon != null || input.iconColor != null
            ? [input.icon ?? null, input.iconColor ?? null]
            : []),
        ]),
      )
      .digest('hex');
    return this.workspace.auth.transaction(() => {
      verify();
      this.workspace.owner(user);
      const database = this.workspace.auth.database;
      const result = (): OfflineCreationResponse => ({
        item: this.workspace.get(user, input.itemId, 'owner'),
        unitId: input.unitId,
        revision: 1,
        revisionOffset: 0,
        syncVersion: 1,
      });
      const receipt = database
        .prepare('SELECT * FROM workspace_offline_creations WHERE item_id=?')
        .get(input.itemId);
      if (receipt) {
        if (
          receipt.user_id !== user ||
          receipt.unit_id !== input.unitId ||
          receipt.request_hash !== requestHash
        )
          throw conflict();
        // Never reseed, move or resurrect an accepted creation. Later remote
        // edits remain intact; the usual native resume gate decides replay.
        const generation = this.collaboration.generations.active(input.itemId);
        if (
          generation.unitId !== input.unitId ||
          generation.offset !== 0 ||
          this.collaboration.generations.restoring(input.itemId) ||
          !this.storage.has(input.unitId)
        )
          throw conflict();
        try {
          return result();
        } catch {
          throw conflict();
        }
      }
      // Both identities are client-generated. Reject every active or retired
      // identity namespace, rather than letting sync.create's retry no-op alias
      // another document or a generation that is awaiting purge.
      for (const id of [input.itemId, input.unitId]) {
        if (
          database.prepare('SELECT 1 FROM workspace_items WHERE id=?').get(id) ||
          database.prepare('SELECT 1 FROM spinel_sync_units WHERE unit_id=?').get(id) ||
          database
            .prepare('SELECT 1 FROM spinel_live_units WHERE item_id=? OR unit_id=?')
            .get(id, id) ||
          database
            .prepare('SELECT 1 FROM spinel_restore_jobs WHERE previous_unit=? OR next_unit=?')
            .get(id, id) ||
          database.prepare('SELECT 1 FROM collaboration_purge WHERE item_id=?').get(id) ||
          database
            .prepare('SELECT 1 FROM workspace_offline_creations WHERE item_id=? OR unit_id=?')
            .get(id, id)
        )
          throw conflict();
      }
      let parentId: string | null;
      try {
        parentId = this.workspace.parent(user, input.parentId);
      } catch (error) {
        if (!(error instanceof AuthError) || ![400, 403, 404, 409].includes(error.status))
          throw error;
        // This code is returned only before any receipt exists. A client may
        // explicitly choose a different folder and retry these same identities.
        throw new OfflineCreationError(
          'folder-unavailable',
          'The chosen folder is no longer available. Choose another folder for this device copy.',
        );
      }
      const snapshot = materialize(
        snapshotIdentity(blankOfflineSnapshot(input), input.unitId),
        input.kind,
      );
      verify();
      const now = this.workspace.auth.now();
      database
        .prepare(
          'INSERT INTO workspace_items(id,owner_id,parent_id,kind,name,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
        )
        .run(input.itemId, user, parentId, input.kind, input.name, now, now);
      initialIcon(database, input.itemId, input.icon, input.iconColor);
      database
        .prepare('INSERT INTO spinel_live_units VALUES(?,?,0)')
        .run(input.itemId, input.unitId);
      this.storage.create(
        { unitId: input.unitId, kind: input.kind, revision: 1, retainedFrom: 1, snapshot },
        verify,
      );
      database.prepare("INSERT INTO workspace_collaboration VALUES(?,'ready')").run(input.itemId);
      database
        .prepare('INSERT INTO workspace_offline_creations VALUES(?,?,?,?)')
        .run(input.itemId, input.unitId, user, requestHash);
      return result();
    });
  }
}
