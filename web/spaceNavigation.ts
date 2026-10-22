import type { SpaceNode, SpaceTreeData } from '../src/shared/spaces.ts';

const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export type SpaceSelection = { kind: 'default' } | { kind: 'page'; id: string } | { kind: 'trash' };
export type SpaceLocation =
  | { kind: 'index' }
  | { kind: 'space'; spaceId: string; selection: SpaceSelection }
  | { kind: 'unavailable' };

export function readSpaceLocation(location: Pick<Location, 'pathname' | 'search'>): SpaceLocation {
  if (/^\/review\/spaces\/?$/.test(location.pathname)) return { kind: 'index' };
  const match = /^\/review\/spaces\/([^/]+)\/?$/.exec(location.pathname);
  if (!match || !uuid.test(match[1])) return { kind: 'unavailable' };
  const query = new URLSearchParams(location.search);
  const id = query.get('item');
  if (
    query.getAll('item').length > 1 ||
    query.getAll('trash').length > 1 ||
    (query.has('item') && (!id || !uuid.test(id))) ||
    (query.has('trash') && (query.get('trash') !== '1' || query.has('item')))
  )
    return { kind: 'unavailable' };
  return {
    kind: 'space',
    spaceId: match[1].toLowerCase(),
    selection: query.has('trash')
      ? { kind: 'trash' }
      : id
        ? { kind: 'page', id: id.toLowerCase() }
        : { kind: 'default' },
  };
}

export function spaceHref(spaceId?: string, selection: SpaceSelection = { kind: 'default' }) {
  if (!spaceId) return '/review/spaces';
  const base = '/review/spaces/' + encodeURIComponent(spaceId);
  return selection.kind === 'page'
    ? base + '?item=' + encodeURIComponent(selection.id)
    : selection.kind === 'trash'
      ? base + '?trash=1'
      : base;
}

type SelectionStorage = Pick<Storage, 'getItem' | 'setItem'>;
const selectionKey = (accountId: string, spaceId: string) =>
  'spinel:space-selection:' + encodeURIComponent(accountId) + ':' + spaceId;

export function rememberedSpaceRoot(accountId: string, storage?: SelectionStorage) {
  try {
    const id = (storage ?? window.localStorage).getItem(
      'spinel:recent-space:' + encodeURIComponent(accountId),
    );
    return id && uuid.test(id) ? id.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function rememberSpaceRoot(accountId: string, spaceId: string, storage?: SelectionStorage) {
  if (!uuid.test(spaceId)) return;
  try {
    (storage ?? window.localStorage).setItem(
      'spinel:recent-space:' + encodeURIComponent(accountId),
      spaceId.toLowerCase(),
    );
  } catch {
    /* Storage is only a navigation hint. */
  }
}

export function rememberedSpacePage(
  accountId: string,
  spaceId: string,
  storage?: SelectionStorage,
) {
  try {
    const id = (storage ?? window.localStorage).getItem(selectionKey(accountId, spaceId));
    return id && uuid.test(id) ? id.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function rememberSpacePage(
  accountId: string,
  spaceId: string,
  itemId: string,
  storage?: SelectionStorage,
) {
  if (!uuid.test(itemId)) return;
  try {
    (storage ?? window.localStorage).setItem(
      selectionKey(accountId, spaceId),
      itemId.toLowerCase(),
    );
  } catch {
    // Navigation still works when this browser cannot remember the selection.
  }
}

/** An unavailable explicit link must not silently open an unrelated page. */
export function selectedSpacePage(
  tree: SpaceTreeData,
  selection: SpaceSelection,
  remembered: string | null,
) {
  if (selection.kind === 'trash') return { item: null, missing: false };
  const pages = tree.items.filter((item) => item.kind !== 'folder');
  if (selection.kind === 'page') {
    const item = pages.find((item) => item.id === selection.id) ?? null;
    return { item, missing: item === null };
  }
  const saved = pages.find((item) => item.id === remembered);
  const first =
    saved ??
    visibleSpaceRows(tree.space.id, tree.items, new Set(tree.items.map((item) => item.id))).find(
      ({ item }) => item.kind !== 'folder',
    )?.item ??
    null;
  return { item: first, missing: false };
}

export function spaceAncestors(items: SpaceNode[], itemId: string) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ancestors: SpaceNode[] = [];
  const seen = new Set([itemId]);
  let parent = byId.get(itemId)?.parentId;
  while (parent && byId.has(parent) && !seen.has(parent)) {
    seen.add(parent);
    const item = byId.get(parent)!;
    ancestors.push(item);
    parent = item.parentId;
  }
  return ancestors.reverse();
}

export function spaceChildren(items: SpaceNode[]) {
  const children = new Map<string, SpaceNode[]>();
  for (const item of items) {
    const siblings = children.get(item.parentId) ?? [];
    siblings.push(item);
    children.set(item.parentId, siblings);
  }
  for (const siblings of children.values())
    siblings.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  return children;
}

/** Iterative traversal: the eight-level design fixture is not a depth limit. */
export function visibleSpaceRows(
  spaceId: string,
  items: SpaceNode[],
  expanded: ReadonlySet<string>,
) {
  const children = spaceChildren(items);
  const pending = [...(children.get(spaceId) ?? [])].reverse().map((item) => ({ item, depth: 0 }));
  const seen = new Set<string>();
  const rows: { item: SpaceNode; depth: number; childCount: number }[] = [];
  while (pending.length) {
    const entry = pending.pop()!;
    if (seen.has(entry.item.id)) continue;
    seen.add(entry.item.id);
    const descendants = children.get(entry.item.id) ?? [];
    rows.push({ ...entry, childCount: descendants.length });
    if (expanded.has(entry.item.id))
      for (let i = descendants.length - 1; i >= 0; i--)
        pending.push({ item: descendants[i], depth: entry.depth + 1 });
  }
  return rows;
}

export function spaceSubtree(items: SpaceNode[], itemId: string) {
  const children = spaceChildren(items);
  const pending = [itemId];
  const ids = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (ids.has(id)) continue;
    ids.add(id);
    for (const child of children.get(id) ?? []) pending.push(child.id);
  }
  return ids;
}

type Entry = { session: string; index: number; href: string };
const stateKey = 'spinelSpaceNavigation';
type NavigationPort = {
  location: Pick<Location, 'pathname' | 'search'>;
  history: Pick<History, 'state' | 'replaceState' | 'pushState' | 'go'>;
  addEventListener(type: 'popstate', listener: () => void): void;
  removeEventListener(type: 'popstate', listener: () => void): void;
};

/** This controller owns only review-route entries, not the application's router. */
export function createSpaceNavigation(
  port: NavigationPort,
  allow: () => boolean,
  changed: (location: SpaceLocation) => void,
) {
  const href = () => port.location.pathname + port.location.search;
  const entry = (): Entry | null => {
    const value = port.history.state?.[stateKey] as Entry | undefined;
    return value &&
      typeof value.session === 'string' &&
      Number.isSafeInteger(value.index) &&
      typeof value.href === 'string' &&
      value.href === href()
      ? value
      : null;
  };
  let current = entry() ?? { session: crypto.randomUUID(), index: 0, href: href() };
  let returning = false;
  const state = (value: Entry) => ({ ...port.history.state, [stateKey]: value });
  port.history.replaceState(state(current), '', href());
  const pop = () => {
    const next = entry();
    if (returning && href() === current.href) {
      returning = false;
      return;
    }
    returning = false;
    if (href() === current.href) return;
    if (!allow()) {
      // All in-screen entries carry an index. Crossing the initial entry goes
      // back to its predecessor; a full-document exit uses beforeunload instead.
      const delta = next?.session === current.session ? current.index - next.index : 1;
      if (delta === 0) port.history.replaceState(state(current), '', current.href);
      else {
        returning = true;
        port.history.go(delta);
      }
      return;
    }
    current =
      next?.session === current.session
        ? next
        : { session: crypto.randomUUID(), index: 0, href: href() };
    port.history.replaceState(state(current), '', href());
    changed(readSpaceLocation(port.location));
  };
  port.addEventListener('popstate', pop);
  return {
    navigate(next: string, options: { replace?: boolean; checked?: boolean } = {}) {
      if (returning) return false;
      if (next === href()) return true;
      if (!options.checked && !allow()) return false;
      current = { ...current, index: current.index + (options.replace ? 0 : 1), href: next };
      if (options.replace) port.history.replaceState(state(current), '', next);
      else port.history.pushState(state(current), '', next);
      changed(readSpaceLocation(port.location));
      return true;
    },
    dispose() {
      port.removeEventListener('popstate', pop);
    },
  };
}
