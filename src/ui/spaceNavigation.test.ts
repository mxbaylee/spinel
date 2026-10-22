import { expect, test, vi } from 'vitest';
import type { SpaceNode, SpaceTreeData } from '../shared/spaces.ts';
import {
  createSpaceNavigation,
  readSpaceLocation,
  rememberSpacePage,
  rememberedSpacePage,
  rememberSpaceRoot,
  rememberedSpaceRoot,
  selectedSpacePage,
  spaceAncestors,
  spaceChildren,
  spaceHref,
  spaceSubtree,
  visibleSpaceRows,
} from '../../web/spaceNavigation.ts';

const id = (value: number) => value.toString(16).padStart(8, '0') + '-0000-4000-8000-000000000000';
const root = id(1);
const node = (
  value: number,
  parentId = root,
  position = 0,
  kind: SpaceNode['kind'] = 'doc',
): SpaceNode => ({
  id: id(value),
  parentId,
  position,
  kind,
  spaceId: root,
  name: 'Same name',
  createdAt: 1,
  updatedAt: 1,
});
const tree = (items: SpaceNode[]): SpaceTreeData => ({
  space: {
    id: root,
    name: 'Space',
    kind: 'space',
    parentId: null,
    spaceId: null,
    position: null,
    createdAt: 1,
    updatedAt: 1,
  },
  access: 'owner',
  items,
});

test('stable routes distinguish an explicit page, Trash and the index without using names', () => {
  expect(readSpaceLocation(new URL('https://spinel.test' + spaceHref()))).toEqual({
    kind: 'index',
  });
  expect(readSpaceLocation(new URL('https://spinel.test' + spaceHref(root)))).toEqual({
    kind: 'space',
    spaceId: root,
    selection: { kind: 'default' },
  });
  expect(
    readSpaceLocation(
      new URL(
        'https://spinel.test' +
          spaceHref(root.toUpperCase(), { kind: 'page', id: id(10).toUpperCase() }),
      ),
    ),
  ).toEqual({
    kind: 'space',
    spaceId: root,
    selection: { kind: 'page', id: id(10) },
  });
  expect(
    readSpaceLocation(new URL('https://spinel.test' + spaceHref(root, { kind: 'trash' }))),
  ).toEqual({
    kind: 'space',
    spaceId: root,
    selection: { kind: 'trash' },
  });
});

test.each([
  '/review/spaces/not-an-id',
  '/review/spaces/' + root + '/another-item',
  '/review/spaces/' + root + '?item=',
  '/review/spaces/' + root + '?item=Planning',
  '/review/spaces/' + root + '?item=' + id(2) + '&item=' + id(3),
  '/review/spaces/' + root + '?trash=0',
  '/review/spaces/' + root + '?trash=1&trash=1',
  '/review/spaces/' + root + '?trash=1&item=' + id(2),
])('malformed or contradictory deep link %s never selects a fallback page', (href) => {
  expect(readSpaceLocation(new URL(href, 'https://spinel.test'))).toEqual({ kind: 'unavailable' });
});

test('explicit selection wins over memory, while missing or folder links remain unavailable', () => {
  const first = node(2);
  const second = node(3, root, 1);
  const folder = node(4, root, 2, 'folder');
  const value = tree([first, second, folder]);
  expect(selectedSpacePage(value, { kind: 'page', id: first.id }, second.id).item).toBe(first);
  expect(selectedSpacePage(value, { kind: 'page', id: id(90) }, first.id)).toEqual({
    item: null,
    missing: true,
  });
  expect(selectedSpacePage(value, { kind: 'page', id: folder.id }, first.id)).toEqual({
    item: null,
    missing: true,
  });
  expect(selectedSpacePage(value, { kind: 'trash' }, first.id)).toEqual({
    item: null,
    missing: false,
  });
});

test('default selection validates memory and uses persisted tree order, not response-array order', () => {
  const folder = node(2, root, 0, 'folder');
  const child = node(3, folder.id, 0);
  const last = node(4, root, 1, 'sheet');
  const value = tree([last, child, folder]);
  expect(selectedSpacePage(value, { kind: 'default' }, last.id).item).toBe(last);
  expect(selectedSpacePage(value, { kind: 'default' }, id(90)).item).toBe(child);
  expect(selectedSpacePage(value, { kind: 'default' }, folder.id).item).toBe(child);
  expect(selectedSpacePage(tree([folder]), { kind: 'default' }, child.id).item).toBe(null);
});

test('selection and recent root memory are independent across accounts and Spaces', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  rememberSpaceRoot('owner', root, storage);
  rememberSpacePage('owner', root, id(2), storage);
  rememberSpacePage('owner', id(9), id(10), storage);
  rememberSpacePage('collaborator', root, id(3), storage);
  expect(rememberedSpaceRoot('owner', storage)).toBe(root);
  expect(rememberedSpaceRoot('collaborator', storage)).toBe(null);
  expect(rememberedSpacePage('owner', root, storage)).toBe(id(2));
  expect(rememberedSpacePage('owner', id(9), storage)).toBe(id(10));
  expect(rememberedSpacePage('collaborator', root, storage)).toBe(id(3));
  expect(rememberedSpacePage('different-account', root, storage)).toBe(null);
  expect(readSpaceLocation(new URL('https://spinel.test/review/spaces'))).toEqual({
    kind: 'index',
  });
  rememberSpacePage('owner', root, 'A renamed page', storage);
  rememberSpaceRoot('owner', 'https://unrelated.invalid', storage);
  expect(rememberedSpacePage('owner', root, storage)).toBe(id(2));
  expect(rememberedSpaceRoot('owner', storage)).toBe(root);
});

test('unavailable or malformed browser storage cannot block navigation', () => {
  const unavailable = {
    getItem: (): string => {
      throw new Error('Unavailable');
    },
    setItem: () => {
      throw new Error('Unavailable');
    },
  };
  expect(() => rememberSpaceRoot('owner', root, unavailable)).not.toThrow();
  expect(() => rememberSpacePage('owner', root, id(2), unavailable)).not.toThrow();
  expect(rememberedSpaceRoot('owner', unavailable)).toBe(null);
  expect(rememberedSpacePage('owner', root, unavailable)).toBe(null);
  const malformed = { getItem: () => '{"access":"owner"}', setItem: () => {} };
  expect(rememberedSpaceRoot('owner', malformed)).toBe(null);
  expect(rememberedSpacePage('owner', root, malformed)).toBe(null);
});

test('opening and expansion are separate and retain duplicate-name identity and sibling order', () => {
  const parent = node(2, root, 0);
  const child = node(3, parent.id, 0, 'sheet');
  const sibling = node(4, root, 1);
  const items = [sibling, child, parent];
  expect(
    spaceChildren(items)
      .get(root)
      ?.map((item) => item.id),
  ).toEqual([parent.id, sibling.id]);
  expect(visibleSpaceRows(root, items, new Set()).map(({ item }) => item.id)).toEqual([
    parent.id,
    sibling.id,
  ]);
  expect(
    visibleSpaceRows(root, items, new Set([parent.id])).map(({ item, depth }) => [item.id, depth]),
  ).toEqual([
    [parent.id, 0],
    [child.id, 1],
    [sibling.id, 0],
  ]);
  expect(spaceSubtree(items, parent.id)).toEqual(new Set([parent.id, child.id]));
  expect(items[0]).toBe(sibling);
});

test('deep parent chains remain navigable and malformed cycles cannot loop', () => {
  const items = Array.from({ length: 128 }, (_, index) =>
    node(index + 2, index ? id(index + 1) : root),
  );
  const expanded = new Set(items.map((item) => item.id));
  expect(visibleSpaceRows(root, items, expanded).at(-1)?.depth).toBe(127);
  expect(spaceAncestors(items, items.at(-1)!.id)).toEqual(items.slice(0, -1));
  const cyclic = [node(200, id(201)), node(201, id(200))];
  expect(spaceAncestors(cyclic, id(200)).map((item) => item.id)).toEqual([id(201)]);
  expect(spaceSubtree(cyclic, id(200))).toEqual(new Set([id(200), id(201)]));
});

function historyFixture(initial: string) {
  type StoredEntry = { href: string; state: Record<string, unknown> };
  const entries: StoredEntry[] = [{ href: initial, state: { unrelated: 'preserved' } }];
  let index = 0;
  const listeners = new Set<() => void>();
  const pending: number[] = [];
  const port = {
    get location() {
      return new URL(entries[index].href, 'https://spinel.test');
    },
    history: {
      get state() {
        return entries[index].state;
      },
      replaceState(state: Record<string, unknown>, _title: string, href?: string | URL | null) {
        entries[index] = { state, href: href == null ? entries[index].href : String(href) };
      },
      pushState(state: Record<string, unknown>, _title: string, href?: string | URL | null) {
        entries.splice(index + 1, entries.length, { state, href: String(href) });
        index++;
      },
      go(delta = 0) {
        pending.push(delta);
      },
    },
    addEventListener(_type: 'popstate', listener: () => void) {
      listeners.add(listener);
    },
    removeEventListener(_type: 'popstate', listener: () => void) {
      listeners.delete(listener);
    },
  };
  const travel = (delta: number) => {
    const destination = index + delta;
    if (destination < 0 || destination >= entries.length) return;
    index = destination;
    for (const listener of listeners) listener();
  };
  return {
    port,
    entries,
    travel,
    flush: () => {
      while (pending.length) travel(pending.shift()!);
    },
  };
}

test('cancelled Back and Forward restore the current entry without growing or destroying history', () => {
  const first = spaceHref(root, { kind: 'page', id: id(2) });
  const second = spaceHref(root, { kind: 'page', id: id(3) });
  const f = historyFixture(first);
  const allow = vi.fn(() => true);
  const changed = vi.fn();
  const navigation = createSpaceNavigation(f.port, allow, changed);
  expect(navigation.navigate(second)).toBe(true);
  allow.mockReturnValue(false);
  f.travel(-1);
  f.flush();
  expect(f.port.location.pathname + f.port.location.search).toBe(second);
  expect(f.entries).toHaveLength(2);
  expect(allow).toHaveBeenCalledTimes(2);
  expect(changed).toHaveBeenCalledTimes(1);
  allow.mockReturnValue(true);
  f.travel(-1);
  expect(f.port.location.pathname + f.port.location.search).toBe(first);
  allow.mockReturnValue(false);
  f.travel(1);
  f.flush();
  expect(f.port.location.pathname + f.port.location.search).toBe(first);
  expect(f.entries).toHaveLength(2);
  expect(allow).toHaveBeenCalledTimes(4);
  expect(changed).toHaveBeenCalledTimes(2);
  allow.mockReturnValue(true);
  f.travel(1);
  expect(changed).toHaveBeenLastCalledWith({
    kind: 'space',
    spaceId: root,
    selection: { kind: 'page', id: id(3) },
  });
  navigation.dispose();
});

test('cancelled selection, canonical replacement and disposal do not add unexpected history entries', () => {
  const f = historyFixture(spaceHref(root));
  const allow = vi.fn(() => false);
  const changed = vi.fn();
  const navigation = createSpaceNavigation(f.port, allow, changed);
  const selected = spaceHref(root, { kind: 'page', id: id(2) });
  expect(navigation.navigate(selected)).toBe(false);
  expect(f.entries).toHaveLength(1);
  expect(changed).not.toHaveBeenCalled();
  expect(navigation.navigate(selected, { replace: true, checked: true })).toBe(true);
  expect(f.entries).toHaveLength(1);
  expect(f.port.history.state.unrelated).toBe('preserved');
  expect(allow).toHaveBeenCalledTimes(1);
  expect(navigation.navigate(selected)).toBe(true);
  expect(allow).toHaveBeenCalledTimes(1);
  allow.mockReturnValue(true);
  navigation.navigate(spaceHref(root, { kind: 'trash' }));
  navigation.dispose();
  f.travel(-1);
  expect(changed).toHaveBeenCalledTimes(2);
});
