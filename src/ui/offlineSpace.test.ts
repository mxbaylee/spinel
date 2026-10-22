import { expect, test } from 'vitest';
import type { SpaceFile } from '../shared/workspace.ts';
import type { LocalStart } from '../../web/offline/localStart.ts';
import type { OfflineDownload } from '../../web/offline/offlineStore.ts';
import { selectOfflineSpace, spaceCopies } from '../../web/offline/spaceCopies.ts';
import { readSpaceLocation } from '../../web/spaceNavigation.ts';

const id = (value: number) => value.toString(16).padStart(8, '0') + '-0000-4000-8000-000000000000';
const root: SpaceFile = {
  id: id(1),
  name: 'Project',
  kind: 'space',
  parentId: id(90),
  access: 'owner',
  tags: [],
  createdAt: 1,
  updatedAt: 2,
};
const copy = (value: number, name: string, spaceId?: string): OfflineDownload => ({
  itemId: id(value),
  name,
  kind: 'doc',
  readOnly: false,
  revision: 3,
  downloadedAt: 100,
  ...(spaceId === undefined ? {} : { spaceId }),
});
const budget = { ...copy(3, 'Budget', root.id), kind: 'sheet' as const };
const notes = copy(2, 'Notes', root.id);
const foreign = copy(4, 'Another Space', id(10));
const ordinary = copy(5, 'Ordinary document');
const local: LocalStart = {
  user: { id: 'account', name: 'Owner' },
  catalog: { syncedAt: 100, items: [root], shared: [], views: { [root.id]: [root] } },
  downloads: [notes, ordinary, foreign, budget],
};
const route = (path: string) => readSpaceLocation(new URL(path, 'https://spinel.test'));

test('a root-only launch selects only a prepared native child of that exact Space', () => {
  const selected = selectOfflineSpace(local, 'account', route('/spaces/' + root.id));
  expect(selected).toEqual({
    spaceId: root.id,
    root,
    copies: [budget, notes],
    selected: budget,
    problem: null,
  });
  expect(selected.root?.parentId).toBe(id(90));
  expect(local.downloads).toEqual([notes, ordinary, foreign, budget]);
});

test('an explicit prepared child wins over the default and keeps its exact root', () => {
  expect(
    selectOfflineSpace(local, 'account', route('/spaces/' + root.id + '?item=' + notes.itemId)),
  ).toMatchObject({ selected: notes, spaceId: root.id, problem: null });
});

test.each([id(99), ordinary.itemId, foreign.itemId, root.id])(
  'an explicit unprepared, ordinary, foreign-Space or root item %s never falls back',
  (itemId) => {
    const selected = selectOfflineSpace(
      local,
      'account',
      route('/spaces/' + root.id + '?item=' + itemId),
    );
    expect(selected).toMatchObject({ selected: null, problem: 'missing', copies: [budget, notes] });
  },
);

test('a Space with no own copies never chooses a document from another Space', () => {
  expect(selectOfflineSpace(local, 'account', route('/spaces/' + id(20)))).toEqual({
    spaceId: id(20),
    root: null,
    copies: [],
    selected: null,
    problem: 'empty',
  });
});

test.each([
  ['/spaces', 'index'],
  ['/spaces/not-an-id', 'route'],
  ['/spaces/' + root.id + '?item=', 'route'],
  ['/spaces/' + root.id + '?item=' + notes.itemId + '&item=' + budget.itemId, 'route'],
  ['/spaces/' + root.id + '?trash=1', 'trash'],
  ['/spaces/' + root.id + '?trash=1&item=' + notes.itemId, 'route'],
])(
  'index, invalid or Trash route %s requires a connection without selecting a copy',
  (path, problem) => {
    expect(selectOfflineSpace(local, 'account', route(path))).toMatchObject({
      selected: null,
      problem,
    });
  },
);

test('another account cannot see catalog metadata, prepared names or a native selection', () => {
  expect(
    selectOfflineSpace(
      local,
      'another-account',
      route('/spaces/' + root.id + '?item=' + notes.itemId),
    ),
  ).toEqual({ spaceId: null, root: null, copies: [], selected: null, problem: 'account' });
});

test('root metadata may come from a shared catalog without inventing an outer parent or tree', () => {
  const sharedRoot = { ...root, access: 'viewer' as const, parentId: null };
  const shared: LocalStart = {
    ...local,
    catalog: { syncedAt: 100, items: [], shared: [sharedRoot], views: {} },
  };
  expect(selectOfflineSpace(shared, 'account', route('/spaces/' + root.id)).root).toBe(sharedRoot);
  const absent: LocalStart = {
    ...local,
    catalog: { syncedAt: 100, items: [], shared: [], views: {} },
  };
  expect(selectOfflineSpace(absent, 'account', route('/spaces/' + root.id))).toMatchObject({
    root: null,
    selected: budget,
    copies: [budget, notes],
  });
});

test('prepared-page navigation excludes unsupported kinds and the Space root itself', () => {
  const unsupported = {
    ...copy(6, 'Folder', root.id),
    kind: 'folder',
  } as unknown as OfflineDownload;
  const rootCopy = { ...notes, itemId: root.id };
  expect(spaceCopies([foreign, unsupported, rootCopy, ordinary, notes, budget], root.id)).toEqual([
    budget,
    notes,
  ]);
});
