import type { WorkspaceItem } from '../../shared/workspace.ts';
import { AuthError } from '../auth/store.ts';
import { resolveDocument, validateDocumentCredentials } from './document-access.ts';
import { WorkspaceSearch } from './search.ts';
import { resolveSpaceScope } from './space-scope.ts';
import { MAX_SPACE_ITEMS, readSpaceStructure } from './space-structure.ts';
import { SpaceStore } from './spaces.ts';
import type { WorkspaceStore } from './store.ts';

export interface DocumentCatalogItem extends WorkspaceItem {
  /** The actual root needed to authorize this child; ordinary items omit it. */
  readonly spaceId?: string;
}

/**
 * Native discovery for Formula and MCP. Ordinary dashboard search stays closed
 * to Space children. This synchronous transaction lends no reusable permission:
 * callers must resolve every selected document again before reading its content.
 */
export function documentCatalog(
  workspace: WorkspaceStore,
  userId: string,
  customData: Record<string, unknown> = {},
): DocumentCatalogItem[] {
  return workspace.auth.transaction(() => {
    const credential = validateDocumentCredentials(workspace, userId, customData);
    // A history capture capability is one exact read, never a discovery grant.
    if (credential === 'history')
      throw new AuthError(403, 'This document context does not allow discovery.');
    const scoped = Object.hasOwn(customData, 'spaceId') || Object.hasOwn(customData, 'spaceItem');
    if (scoped) {
      if (typeof customData.spaceId !== 'string' || typeof customData.spaceItem !== 'string')
        throw new AuthError(404, 'This Space is not available.');
      resolveDocument(workspace, userId, customData.spaceItem, 'read', customData);
    }
    // Ordinary guest links expose no source catalog. A Space guest stays inside
    // its root even if the HTTP request also carries an account cookie.
    if (credential === 'guest' && !scoped) return [];
    const ordinary = credential === 'guest' ? [] : new WorkspaceSearch(workspace).find(userId, {});
    // Legacy trusted service calls remain ordinary-only. Space discovery needs
    // a live account, MCP or root guest credential and the runtime-owned gate.
    if (!workspace.spacesEnabled || credential === 'trusted') return ordinary;
    const roots =
      credential === 'guest'
        ? [
            resolveSpaceScope(
              workspace.auth,
              userId,
              customData.spaceId as string,
              customData.spaceItem as string,
            ),
          ]
        : new SpaceStore(workspace).roots(userId);

    // Spend one shared budget before expanding any graph. Counting only live
    // projected children would let many roots each hide a full tombstone scan.
    // Recovery metadata is retained work too, including malformed extra rows.
    let work = roots.length;
    const spend = (count: number) => {
      work += count;
      if (work > MAX_SPACE_ITEMS)
        throw new AuthError(413, 'This document list is too large to process at once.');
    };
    spend(0);
    const members = workspace.auth.database.prepare(
      'SELECT id FROM workspace_items WHERE space_id=? LIMIT ?',
    );
    const recovery = workspace.auth.database.prepare(
      'SELECT item_id FROM workspace_space_trash WHERE space_id=? LIMIT ?',
    );
    for (const { space } of roots) {
      spend(members.all(space.id, MAX_SPACE_ITEMS - work + 1).length);
      spend(recovery.all(space.id, MAX_SPACE_ITEMS - work + 1).length);
    }
    const result: DocumentCatalogItem[] = [...ordinary];
    for (const { space, ownerId, access } of roots) {
      const structure = readSpaceStructure(workspace.auth.database, space.id, ownerId);
      // Complete structural validation proves uniform live ancestry once for
      // the root. Rewalking each child's entire ancestry would be quadratic.
      for (const item of structure.items)
        if (item.trashedAt === null)
          result.push({
            id: item.id,
            parentId: item.parentId,
            spaceId: space.id,
            kind: item.kind,
            name: item.name,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            access,
            tags: [],
          });
    }
    return result;
  });
}
