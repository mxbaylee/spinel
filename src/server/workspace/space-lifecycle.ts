import { createHash, randomUUID } from 'node:crypto';
import { AuthError } from '../auth/store.ts';
import { resolveSpaceScope } from './space-scope.ts';
import type { SpaceScopeItem } from './space-scope.ts';
import { deleteSpaceItems, readSpaceStructure } from './space-structure.ts';
import type { SpaceStructure } from './space-structure.ts';
import type { WorkspaceStore } from './store.ts';
import { TRASH_RETENTION_MS } from './trash-retention.ts';
import { cleanRecoveryHolds, recoveryProtected } from './recovery-holds.ts';

interface DeletedSpace {
  space: SpaceScopeItem;
  trashedAt: number;
  trashBatch: string;
  structure: SpaceStructure;
}

export interface SpaceDeletionPreview {
  readonly space: { id: string; name: string };
  readonly items: { id: string; name: string; kind: SpaceScopeItem['kind'] }[];
  readonly counts: { total: number; docs: number; sheets: number; folders: number; spaces: 1 };
  readonly version: string;
}

const unavailable = () => new AuthError(404, 'This Space is not in your trash.');

/**
 * Explicit owner-only outer lifecycle. Whole-Space trash marks only the root,
 * leaving native content, internal order and earlier recovery batches intact.
 * Recovery uses the same 30-day window as internal and ordinary Trash. Scheduled
 * deletion uses the same validated cascade without impersonating an account.
 */
export class SpaceLifecycleStore {
  private readonly workspace: WorkspaceStore;
  constructor(workspace: WorkspaceStore) {
    this.workspace = workspace;
  }

  trash(actorId: string, spaceId: string): { id: string; count: number; trashedAt: number } {
    const { auth } = this.workspace;
    return auth.transaction(() => {
      const scope = resolveSpaceScope(auth, actorId, spaceId, spaceId, 'admin');
      const structure = readSpaceStructure(auth.database, spaceId, scope.ownerId);
      const now = auth.now();
      const changed = auth.database
        .prepare(
          `
        UPDATE workspace_items SET trashed_at=?,trash_batch=?,updated_at=?
        WHERE id=? AND owner_id=? AND kind='space' AND trashed_at IS NULL AND trash_batch IS NULL
      `,
        )
        .run(now, randomUUID(), now, spaceId, scope.ownerId);
      if (changed.changes !== 1) throw unavailable();
      return { id: spaceId, count: structure.items.length + 1, trashedAt: now };
    });
  }

  restore(
    actorId: string,
    spaceId: string,
  ): {
    space: SpaceScopeItem;
    destination: 'original' | 'my-files-root';
    reason?: 'original-location-unavailable';
  } {
    const { auth } = this.workspace;
    return auth.transaction(() => {
      const view = this.deleted(actorId, spaceId);
      if (
        view.trashedAt + TRASH_RETENTION_MS <= auth.now() &&
        !recoveryProtected(auth.database, spaceId)
      )
        throw new AuthError(409, 'The 30-day recovery period has ended.');
      let parentId = view.space.parentId;
      let original = true;
      if (parentId !== null) {
        try {
          const parent = this.workspace.get(actorId, parentId, 'owner');
          if (parent.kind !== 'folder') original = false;
        } catch (error) {
          if (!(error instanceof AuthError)) throw error;
          // The owner is already authenticated; an inaccessible, trashed or
          // malformed original location cannot disclose its ID/name on fallback.
          if (![403, 404, 410].includes(error.status)) throw error;
          original = false;
        }
        if (!original) parentId = null;
      }
      const changed = auth.database
        .prepare(
          `
        UPDATE workspace_items SET parent_id=?,trashed_at=NULL,trash_batch=NULL,updated_at=?
        WHERE id=? AND owner_id=? AND trash_batch=? AND trashed_at=?
      `,
        )
        .run(parentId, auth.now(), spaceId, actorId, view.trashBatch, view.trashedAt);
      if (changed.changes !== 1) throw unavailable();
      const restored = resolveSpaceScope(auth, actorId, spaceId, spaceId, 'owner');
      cleanRecoveryHolds(auth.database);
      return {
        space: restored.space,
        destination: original ? 'original' : 'my-files-root',
        ...(original ? {} : { reason: 'original-location-unavailable' as const }),
      };
    });
  }

  previewDelete(actorId: string, spaceId: string): SpaceDeletionPreview {
    return this.workspace.auth.transaction(() => this.confirmation(this.deleted(actorId, spaceId)));
  }

  delete(actorId: string, spaceId: string, version: unknown): { count: number } {
    const { auth } = this.workspace;
    return auth.transaction(() => {
      const view = this.deleted(actorId, spaceId);
      const preview = this.confirmation(view);
      if (typeof version !== 'string' || version !== preview.version)
        throw new AuthError(409, 'This deleted Space changed. Review it again before deleting.');
      // The complete validated graph includes live children and every internal
      // deletion batch. Reverse DFS is leaf-first, so restrictive parent/scope
      // FKs and native cleanup triggers are retained rather than disabled.
      deleteSpaceItems(auth.database, spaceId, actorId, view.structure.items);
      const root = auth.database
        .prepare(
          `
        DELETE FROM workspace_items WHERE id=? AND owner_id=? AND kind='space'
          AND trash_batch=? AND trashed_at=?
      `,
        )
        .run(spaceId, actorId, view.trashBatch, view.trashedAt);
      if (root.changes !== 1) throw unavailable();
      cleanRecoveryHolds(auth.database);
      return { count: preview.counts.total };
    });
  }

  /** Deliberately owner-only; no reusable includeTrashed access capability. */
  private deleted(actorId: string, spaceId: string): DeletedSpace {
    this.workspace.owner(actorId);
    const row = this.workspace.auth.database
      .prepare(
        `
      SELECT id,parent_id AS parentId,space_id AS spaceId,space_position AS position,
        kind,name,created_at AS createdAt,updated_at AS updatedAt,
        trashed_at AS trashedAt,trash_batch AS trashBatch
      FROM workspace_items WHERE id=? AND owner_id=? AND kind='space'
        AND space_id IS NULL AND space_position IS NULL
    `,
      )
      .get(spaceId, actorId) as unknown as
      | (SpaceScopeItem & {
          trashedAt: number | null;
          trashBatch: string | null;
        })
      | undefined;
    if (
      !row ||
      typeof row.trashedAt !== 'number' ||
      !Number.isSafeInteger(row.trashedAt) ||
      row.trashedAt < 0 ||
      typeof row.trashBatch !== 'string' ||
      !row.trashBatch
    )
      throw unavailable();
    const { trashedAt, trashBatch, ...space } = row;
    return {
      space,
      trashedAt,
      trashBatch,
      structure: readSpaceStructure(this.workspace.auth.database, spaceId, actorId),
    };
  }

  private confirmation(view: DeletedSpace): SpaceDeletionPreview {
    const items = [view.space, ...view.structure.items].map(({ id, name, kind }) => ({
      id,
      name,
      kind,
    }));
    const counts = { total: items.length, docs: 0, sheets: 0, folders: 0, spaces: 1 as const };
    for (const item of view.structure.items) {
      if (item.kind === 'doc') counts.docs++;
      else if (item.kind === 'sheet') counts.sheets++;
      else counts.folders++;
    }
    const recovery = [...view.structure.recovery.values()].sort((a, b) =>
      a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0,
    );
    return {
      space: { id: view.space.id, name: view.space.name },
      items,
      counts,
      version: createHash('sha256')
        .update(
          JSON.stringify({
            space: view.space,
            trashedAt: view.trashedAt,
            trashBatch: view.trashBatch,
            items: view.structure.items,
            recovery,
          }),
        )
        .digest('hex'),
    };
  }
}
