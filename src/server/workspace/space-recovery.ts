import { createHash, randomUUID } from 'node:crypto';
import type { ItemKind } from '../../shared/workspace.ts';
import { AuthError } from '../auth/store.ts';
import { resolveSpaceScope } from './space-scope.ts';
import type { SpaceScope, SpaceScopeItem } from './space-scope.ts';
import { readSpaceStructure } from './space-structure.ts';
import type { SpaceRecoveryRecord, SpaceStructureItem } from './space-structure.ts';
import type { WorkspaceStore } from './store.ts';

export interface SpaceRecoveryItem {
  readonly id: string;
  readonly kind: ItemKind;
  readonly name: string;
  readonly trashedAt: number;
  readonly descendantCount: number;
  /** A current readable location, never a stored historical name or unchecked ID. */
  readonly originalLocation: { id: string; name: string } | null;
}

export interface SpaceDeletePreview {
  readonly root: { id: string; name: string; kind: ItemKind };
  readonly counts: { total: number; docs: number; sheets: number; folders: number };
  readonly items: { id: string; name: string; kind: ItemKind }[];
  readonly version: string;
}

interface RecoveryView {
  scope: SpaceScope;
  structure: ReturnType<typeof readSpaceStructure>;
}

const unavailable = () => new AuthError(404, "This item is not in this Space's trash.");

/**
 * Internal account recovery for a live Space. No routes, expiry policy or whole-
 * Space lifecycle are enabled here. Editors may recover; permanent deletion is
 * reserved for the current Owner and a freshly confirmed exact subtree.
 */
export class SpaceRecoveryStore {
  private readonly workspace: WorkspaceStore;
  constructor(workspace: WorkspaceStore) {
    this.workspace = workspace;
  }

  list(
    actorId: string,
    spaceId: string,
  ): { access: 'owner' | 'editor'; items: SpaceRecoveryItem[] } {
    this.workspace.owner(actorId);
    return this.workspace.auth.transaction(() => {
      const view = this.view(actorId, spaceId, 'edit');
      const records = [...view.structure.recovery.values()].sort(
        (a, b) =>
          b.trashedAt - a.trashedAt || (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0),
      );
      const access: 'owner' | 'editor' = view.scope.access === 'owner' ? 'owner' : 'editor';
      return {
        access,
        items: records.map((record) => this.project(view, record)),
      };
    });
  }

  trash(
    actorId: string,
    spaceId: string,
    itemId: string,
  ): { item: SpaceRecoveryItem; count: number } {
    const { auth } = this.workspace;
    return auth.transaction(() => {
      const view = this.view(actorId, spaceId, 'edit');
      resolveSpaceScope(auth, actorId, spaceId, itemId, 'edit');
      const item = view.structure.byId.get(itemId);
      if (!item || item.trashedAt !== null) throw unavailable();
      const subtree = this.subtree(view, itemId);
      const siblings = this.liveSiblings(view, item.parentId);
      const originalPosition = siblings.indexOf(itemId);
      if (originalPosition < 0) throw unavailable();
      const now = auth.now();
      const record: SpaceRecoveryRecord = {
        itemId,
        spaceId,
        originalParentId: item.parentId,
        originalPosition,
        trashedAt: now,
        trashedBy: actorId,
        trashBatch: randomUUID(),
      };
      auth.database
        .prepare(
          `
        INSERT INTO workspace_space_trash
        (item_id,space_id,original_parent_id,original_position,trashed_at,trashed_by,trash_batch)
        VALUES(?,?,?,?,?,?,?)
      `,
        )
        .run(
          itemId,
          spaceId,
          record.originalParentId,
          originalPosition,
          now,
          actorId,
          record.trashBatch,
        );
      const mark = auth.database.prepare(`
        UPDATE workspace_items SET trashed_at=?,trash_batch=?
        WHERE id=? AND space_id=? AND trashed_at IS NULL AND trash_batch IS NULL
      `);
      for (const child of subtree)
        if (mark.run(now, record.trashBatch, child.id, spaceId).changes !== 1) throw unavailable();
      // Earlier independent tombstones are already separate roots at the Space.
      // Detach only this deletion root; native IDs, descendant edges and positions stay intact.
      auth.database
        .prepare(
          `
        UPDATE workspace_items SET parent_id=?,space_position=?,updated_at=? WHERE id=? AND space_id=?
      `,
        )
        .run(spaceId, originalPosition, now, itemId, spaceId);
      this.order(
        spaceId,
        item.parentId,
        siblings.filter((id) => id !== itemId),
        now,
      );
      resolveSpaceScope(auth, actorId, spaceId, spaceId, 'edit');
      return { item: this.project(view, record), count: subtree.length };
    });
  }

  restore(
    actorId: string,
    spaceId: string,
    itemId: string,
  ): {
    item: SpaceScopeItem;
    restoredCount: number;
    destination: 'original' | 'space-root';
    reason?: 'original-location-unavailable';
  } {
    this.workspace.owner(actorId);
    const { auth } = this.workspace;
    return auth.transaction(() => {
      const view = this.view(actorId, spaceId, 'edit');
      const record = this.record(view, itemId);
      const subtree = this.subtree(view, itemId);
      let original = this.location(view, record);
      if (original) {
        try {
          // Resolve the destination again inside this mutation transaction; saved
          // metadata is never an authorization grant or permission to disclose it.
          resolveSpaceScope(auth, actorId, spaceId, original.id, 'edit');
        } catch (error) {
          if (!(error instanceof AuthError) || error.status !== 404) throw error;
          original = null;
        }
      }
      const parentId = original?.id ?? spaceId;
      const siblings = this.liveSiblings(view, parentId);
      const position = original
        ? Math.min(record.originalPosition, siblings.length)
        : siblings.length;
      siblings.splice(position, 0, itemId);
      const now = auth.now();
      auth.database
        .prepare('UPDATE workspace_items SET parent_id=?,updated_at=? WHERE id=? AND space_id=?')
        .run(parentId, now, itemId, spaceId);
      const restore = auth.database.prepare(`
        UPDATE workspace_items SET trashed_at=NULL,trash_batch=NULL
        WHERE id=? AND space_id=? AND trash_batch=? AND trashed_at=?
      `);
      for (const child of subtree)
        if (restore.run(child.id, spaceId, record.trashBatch, record.trashedAt).changes !== 1)
          throw unavailable();
      auth.database
        .prepare('DELETE FROM workspace_space_trash WHERE item_id=? AND space_id=?')
        .run(itemId, spaceId);
      this.order(spaceId, parentId, siblings, now);
      const restored = resolveSpaceScope(auth, actorId, spaceId, itemId, 'edit');
      const destination: 'original' | 'space-root' = original ? 'original' : 'space-root';
      return {
        item: restored.item,
        restoredCount: subtree.length,
        destination,
        ...(original ? {} : { reason: 'original-location-unavailable' as const }),
      };
    });
  }

  previewDelete(actorId: string, spaceId: string, itemId: string): SpaceDeletePreview {
    return this.workspace.auth.transaction(() =>
      this.confirmation(this.view(actorId, spaceId, 'owner'), itemId),
    );
  }

  delete(actorId: string, spaceId: string, itemId: string, version: unknown): { count: number } {
    const { auth } = this.workspace;
    return auth.transaction(() => {
      const view = this.view(actorId, spaceId, 'owner');
      const preview = this.confirmation(view, itemId);
      if (typeof version !== 'string' || version !== preview.version)
        throw new AuthError(409, 'This deleted subtree changed. Review it again before deleting.');
      const record = this.record(view, itemId);
      const remove = auth.database.prepare(`
        DELETE FROM workspace_items WHERE id=? AND space_id=? AND trash_batch=? AND trashed_at=?
      `);
      // The validated DFS reversed is leaf-first. Native FKs and existing cleanup
      // triggers run normally; independent recovery roots are not in this subtree.
      for (const item of [...this.subtree(view, itemId)].reverse())
        if (remove.run(item.id, spaceId, record.trashBatch, record.trashedAt).changes !== 1)
          throw unavailable();
      resolveSpaceScope(auth, actorId, spaceId, spaceId, 'owner');
      return { count: preview.counts.total };
    });
  }

  private view(actorId: string, spaceId: string, capability: 'edit' | 'owner'): RecoveryView {
    if (actorId.startsWith('guest:') && !this.workspace.spacesEnabled) throw unavailable();
    const scope = resolveSpaceScope(this.workspace.auth, actorId, spaceId, spaceId, capability);
    return {
      scope,
      structure: readSpaceStructure(this.workspace.auth.database, spaceId, scope.ownerId),
    };
  }

  private record(view: RecoveryView, itemId: string): SpaceRecoveryRecord {
    const record = view.structure.recovery.get(itemId);
    if (!record) throw unavailable();
    return record;
  }

  private subtree(view: RecoveryView, itemId: string): SpaceStructureItem[] {
    const root = view.structure.byId.get(itemId);
    if (!root) throw unavailable();
    const items: SpaceStructureItem[] = [];
    const pending = [root];
    // readSpaceStructure bounded and validated the complete acyclic closure once.
    while (pending.length) {
      const item = pending.pop()!;
      items.push(item);
      const children = view.structure.children.get(item.id) ?? [];
      for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]);
    }
    return items;
  }

  private liveSiblings(view: RecoveryView, parentId: string): string[] {
    return (view.structure.children.get(parentId) ?? [])
      .filter((item) => item.trashedAt === null)
      .map((item) => item.id);
  }

  private location(
    view: RecoveryView,
    record: SpaceRecoveryRecord,
  ): { id: string; name: string } | null {
    if (record.originalParentId === view.scope.space.id)
      return { id: view.scope.space.id, name: view.scope.space.name };
    const parent = view.structure.byId.get(record.originalParentId);
    // Fresh root Edit authorization plus validated live same-Space ancestry gives
    // this parent the identical inherited role. No per-record ancestor SQL loop.
    return parent && parent.trashedAt === null ? { id: parent.id, name: parent.name } : null;
  }

  private project(view: RecoveryView, record: SpaceRecoveryRecord): SpaceRecoveryItem {
    const subtree = this.subtree(view, record.itemId);
    const root = subtree[0];
    return {
      id: root.id,
      kind: root.kind,
      name: root.name,
      trashedAt: record.trashedAt,
      descendantCount: subtree.length - 1,
      originalLocation: this.location(view, record),
    };
  }

  private confirmation(view: RecoveryView, itemId: string): SpaceDeletePreview {
    const record = this.record(view, itemId);
    const subtree = this.subtree(view, itemId);
    const items = subtree.map(({ id, name, kind }) => ({ id, name, kind }));
    const counts = { total: items.length, docs: 0, sheets: 0, folders: 0 };
    for (const item of items) {
      if (item.kind === 'doc') counts.docs++;
      else if (item.kind === 'sheet') counts.sheets++;
      else counts.folders++;
    }
    return {
      root: items[0],
      counts,
      items,
      // Bind identity, batch, exact members, names and structural metadata. All
      // live writes are closed for tombstones; listing never loads native content.
      version: createHash('sha256')
        .update(
          JSON.stringify({
            spaceId: view.scope.space.id,
            ownerId: view.scope.ownerId,
            record,
            items: subtree,
          }),
        )
        .digest('hex'),
    };
  }

  private order(spaceId: string, parentId: string, ids: string[], now: number) {
    const update = this.workspace.auth.database.prepare(`
      UPDATE workspace_items SET space_position=?,updated_at=?
      WHERE id=? AND space_id=? AND parent_id=? AND trashed_at IS NULL AND trash_batch IS NULL
        AND space_position<>?
    `);
    ids.forEach((id, position) => update.run(position, now, id, spaceId, parentId, position));
  }
}
