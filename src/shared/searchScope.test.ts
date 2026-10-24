import { expect, test } from 'vitest';
import { emptySearch, searchCatalog } from './search.ts';
import { searchWithinScope } from './searchScope.ts';
import type { FileItem } from './workspace.ts';

const file = (id: string, changes: Partial<FileItem> = {}): FileItem => ({
  id,
  name: id,
  kind: 'doc',
  parentId: null,
  access: 'owner',
  tags: [],
  createdAt: 1,
  updatedAt: 1,
  ...changes,
});
const ids = (items: FileItem[]) => items.map((item) => item.id).sort();

test('folder membership uses complete metadata even when ancestors do not match the query', () => {
  const catalog = searchCatalog([
    file('root', { kind: 'folder' }),
    file('nested', { kind: 'folder', parentId: 'root' }),
    file('budget', { parentId: 'nested', kind: 'sheet' }),
    file('outside-budget', { kind: 'sheet' }),
  ]);
  expect(
    ids(
      searchWithinScope(
        catalog,
        { ...emptySearch, q: 'budget', type: 'sheet' },
        { kind: 'folder', id: 'root' },
        1,
      ),
    ),
  ).toEqual(['budget']);
});

test('a personally filed shared folder includes descendants once without moving canonical parents', () => {
  const catalog = searchCatalog([
    file('mine', { kind: 'folder' }),
    file('shared', { kind: 'folder', access: 'viewer', placementParentId: 'mine' }),
    file('child', { parentId: 'shared', access: 'viewer', placementParentId: 'mine' }),
    file('unfiled', { access: 'viewer' }),
  ]);
  expect(ids(searchWithinScope(catalog, emptySearch, { kind: 'folder', id: 'mine' }, 1))).toEqual([
    'child',
    'shared',
  ]);
  expect(catalog.find((item) => item.id === 'child')?.parentId).toBe('shared');
  // My files search remains global, including shares that have never been personally filed.
  expect(ids(searchWithinScope(catalog, emptySearch, { kind: 'all' }, 1))).toEqual([
    'child',
    'mine',
    'shared',
    'unfiled',
  ]);
});

test('unavailable folders, inaccessible ancestry and invalid personal destinations never broaden scope', () => {
  const catalog = searchCatalog([
    file('shared', { kind: 'folder', access: 'viewer' }),
    file('own', { kind: 'folder' }),
    file('bad-placement', { placementParentId: 'shared' }),
    file('hidden-parent', { parentId: 'not-readable' }),
    file('bad-own-placement', { placementParentId: 'not-readable' }),
    file('doc-destination'),
    file('bad-doc-placement', { placementParentId: 'doc-destination' }),
  ]);
  for (const id of ['shared', 'own', 'not-readable', 'doc-destination'])
    expect(searchWithinScope(catalog, emptySearch, { kind: 'folder', id }, 1)).toEqual([]);
});

test('cycles terminate and the scope folder itself and Space internals stay out', () => {
  const catalog = searchCatalog([
    file('a', { kind: 'folder', parentId: 'b' }),
    file('b', { kind: 'folder', parentId: 'a' }),
    file('space', { kind: 'space', parentId: 'b' }),
    file('space-child', { parentId: 'space' }),
    file('leaf', { parentId: 'b' }),
    file('leaf', { parentId: 'b' }),
  ]);
  expect(ids(searchWithinScope(catalog, emptySearch, { kind: 'folder', id: 'a' }, 1))).toEqual([
    'b',
    'leaf',
    'space',
  ]);
  expect(searchWithinScope(catalog, emptySearch, { kind: 'folder', id: 'space' }, 1)).toEqual([]);
});

test('shared scope includes File admin and intersects the existing ownership filter', () => {
  const catalog = searchCatalog([
    file('own'),
    file('viewer', { access: 'viewer' }),
    file('editor', { access: 'editor' }),
    file('admin', { access: 'admin' }),
  ]);
  expect(ids(searchWithinScope(catalog, emptySearch, { kind: 'shared' }, 1))).toEqual([
    'admin',
    'editor',
    'viewer',
  ]);
  expect(
    searchWithinScope(catalog, { ...emptySearch, owner: 'mine' }, { kind: 'shared' }, 1),
  ).toEqual([]);
});
