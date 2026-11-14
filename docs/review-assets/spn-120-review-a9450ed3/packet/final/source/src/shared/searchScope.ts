import { searchItems } from './search.ts';
import type { SearchItem, SearchQuery } from './search.ts';
import type { FileItem } from './workspace.ts';

export type SearchScope = { kind: 'all' } | { kind: 'shared' } | { kind: 'folder'; id: string };

/** Use the complete, fresh, authorized outer-file catalog, never results or Space children. */
export function searchWithinScope<T extends FileItem>(
  catalog: SearchItem<T>[],
  query: SearchQuery,
  scope: SearchScope,
  now: number,
): SearchItem<T>[] {
  const byId = new Map(catalog.map((item) => [item.id, item]));
  const unique = [...byId.values()];
  if (scope.kind === 'all') return searchItems(unique, query, now);
  if (scope.kind === 'shared')
    return searchItems(
      unique.filter((item) => item.access !== 'owner'),
      query,
      now,
    );
  if (byId.get(scope.id)?.kind !== 'folder') return [];

  const children = new Map<string, Set<string>>();
  const add = (parentId: string | null | undefined, childId: string, personal: boolean) => {
    if (!parentId) return;
    const parent = byId.get(parentId);
    if (!parent || parent.kind !== 'folder' || (personal && parent.access !== 'owner')) return;
    let ids = children.get(parentId);
    if (!ids) children.set(parentId, (ids = new Set()));
    ids.add(childId);
  };
  for (const item of unique) {
    add(item.parentId, item.id, false);
    add(item.placementParentId, item.id, true);
  }
  const reachable = new Set([scope.id]);
  const pending = [scope.id];
  for (let index = 0; index < pending.length; index++) {
    for (const id of children.get(pending[index]) ?? []) {
      if (reachable.has(id)) continue;
      reachable.add(id);
      // A Space is an outer file; its internal tree is never dashboard search scope.
      if (byId.get(id)?.kind === 'folder') pending.push(id);
    }
  }
  reachable.delete(scope.id);
  return searchItems(
    unique.filter((item) => reachable.has(item.id)),
    query,
    now,
  );
}
