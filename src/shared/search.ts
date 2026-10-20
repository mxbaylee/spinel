import type { WorkspaceItem, ItemKind } from './workspace.ts';
export type SearchQuery = {
  q: string;
  type: ItemKind | '';
  owner: '' | 'mine' | 'shared';
  tag: string;
  modified: '' | 'day' | 'week' | 'month';
};
export type SearchItem = WorkspaceItem & { paths: string[] };
export const emptySearch: SearchQuery = { q: '', type: '', owner: '', tag: '', modified: '' };
const fold = (value: string) => value.normalize('NFKC').toLowerCase();
export function parseSearch(input: Record<string, unknown>): SearchQuery {
  const allowed = Object.keys(emptySearch);
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new Error('Invalid search filters.');
  const query = { ...emptySearch };
  for (const key of allowed as (keyof SearchQuery)[]) {
    const value = Object.hasOwn(input, key) ? input[key] : '';
    if (typeof value !== 'string' || value.length > (key === 'q' ? 200 : 100))
      throw new Error('Invalid search filters.');
    Object.assign(query, { [key]: value.trim() });
  }
  if (
    !['', 'folder', 'sheet', 'doc'].includes(query.type) ||
    !['', 'mine', 'shared'].includes(query.owner) ||
    !['', 'day', 'week', 'month'].includes(query.modified)
  )
    throw new Error('Invalid search filters.');
  return query;
}
export function hasSearch(query: SearchQuery) {
  return Object.values(query).some((value) => value.trim().length > 0);
}
export function searchItems(items: SearchItem[], query: SearchQuery, now: number) {
  const words = fold(query.q).split(/\s+/).filter(Boolean);
  const days = query.modified === 'day' ? 1 : query.modified === 'week' ? 7 : 30;
  return items
    .filter((item) => {
      if (query.type && item.kind !== query.type) return false;
      if (query.owner === 'mine' && item.access !== 'owner') return false;
      if (query.owner === 'shared' && item.access === 'owner') return false;
      if (query.modified && item.updatedAt < now - days * 86400000) return false;
      if (
        query.tag &&
        !item.tags.some((tag) => fold(tag) === fold(query.tag.trim().replace(/^#/, '')))
      )
        return false;
      const haystack = fold(
        [item.name, ...item.paths, ...item.tags.map((tag) => `#${tag}`)].join('\n'),
      );
      return words.every((word) => haystack.includes(word));
    })
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}
/** Input must already be caller-authorized; hidden parent metadata is never fetched here. */
export function searchCatalog(items: WorkspaceItem[]): SearchItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  function ancestors(parentId: string | null): WorkspaceItem[] {
    const parents: WorkspaceItem[] = [],
      seen = new Set<string>();
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent || parent.kind !== 'folder') break;
      parents.unshift(parent);
      parentId = parent.parentId;
    }
    return parents;
  }
  return [...byId.values()].map((item) => {
    const parents = ancestors(item.parentId),
      paths = new Set<string>();
    if (parents.length) paths.add(parents.map((parent) => parent.name).join(' / '));
    for (const [index, anchor] of [...parents, item].entries()) {
      if (anchor.placementParentId === undefined) continue;
      const destination = anchor.placementParentId ? byId.get(anchor.placementParentId) : undefined;
      if (
        anchor.placementParentId &&
        (!destination || destination.access !== 'owner' || destination.kind !== 'folder')
      )
        continue;
      const ownPath = destination ? [...ancestors(destination.parentId), destination] : [];
      const suffix = index < parents.length ? parents.slice(index) : [];
      const path = [...ownPath, ...suffix].map((parent) => parent.name).join(' / ');
      if (path) paths.add(path);
    }
    return { ...item, paths: [...paths] };
  });
}
