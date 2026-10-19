import { expect, test } from 'vitest';
import { emptySearch, parseSearch, searchCatalog, searchItems } from './search.ts';
import type { WorkspaceItem } from './workspace.ts';
const now = Date.UTC(2026, 9, 18, 12);
const item = (id: string, changes: Partial<WorkspaceItem> = {}): WorkspaceItem => ({
  id,
  name: id,
  kind: 'doc',
  access: 'owner',
  parentId: null,
  createdAt: now - 100,
  updatedAt: now,
  tags: [],
  ...changes,
});

test('search combines title, caller tags, visible paths and all filters', () => {
  const catalog = searchCatalog([
    item('folder', { name: 'Annual work', kind: 'folder' }),
    item('a', { name: 'BUDGET', kind: 'sheet', parentId: 'folder', tags: ['planning'] }),
    item('b', {
      name: 'Budget',
      kind: 'sheet',
      parentId: 'folder',
      tags: ['planning'],
      access: 'viewer',
    }),
    item('c', { name: 'Budget', kind: 'doc', parentId: 'folder', tags: ['planning'] }),
    item('d', { name: 'Budget', kind: 'sheet', parentId: 'folder', tags: ['other'] }),
  ]);
  const query = parseSearch({
    q: 'budget annual PLAN',
    type: 'sheet',
    owner: 'mine',
    tag: 'PLANNING',
    modified: 'day',
  });
  expect(searchItems(catalog, query, now).map((entry) => entry.id)).toEqual(['a']);
  expect(searchItems(catalog, { ...query, owner: 'shared' }, now).map((entry) => entry.id)).toEqual(
    ['b'],
  );
  expect(
    searchItems(catalog, { ...emptySearch, q: 'nonexistent document body phrase' }, now),
  ).toEqual([]);
});

test('elapsed date boundaries are inclusive and matching results have a stable modified/ID order', () => {
  const catalog = searchCatalog([
    item('b', { updatedAt: now - 86400000 }),
    item('a', { updatedAt: now - 86400000 }),
    item('old', { updatedAt: now - 86400001 }),
    item('new', { updatedAt: now }),
  ]);
  expect(
    searchItems(catalog, { ...emptySearch, modified: 'day' }, now).map((entry) => entry.id),
  ).toEqual(['new', 'a', 'b']);
  expect(searchItems(catalog, { ...emptySearch, modified: 'week' }, now)).toHaveLength(4);
  expect(searchItems(catalog, { ...emptySearch, modified: 'month' }, now)).toHaveLength(4);
});

test('personal filing paths include shared folder descendants without duplicating source items', () => {
  const shared = item('shared', {
    name: 'Shared reports',
    kind: 'folder',
    access: 'viewer',
    placementParentId: 'mine',
  });
  const catalog = searchCatalog([
    item('mine', { name: 'My planning', kind: 'folder' }),
    shared,
    shared,
    item('child', { name: 'Totals', parentId: shared.id, access: 'viewer' }),
    item('direct', { name: 'Private-parent share', access: 'viewer', placementParentId: 'mine' }),
  ]);
  expect(catalog).toHaveLength(4);
  expect(catalog.find((entry) => entry.id === 'child')?.paths).toEqual([
    'Shared reports',
    'My planning / Shared reports',
  ]);
  expect(catalog.find((entry) => entry.id === 'direct')?.paths).toEqual(['My planning']);
  expect(
    searchItems(catalog, { ...emptySearch, q: 'my planning totals' }, now).map((entry) => entry.id),
  ).toEqual(['child']);
});

test('missing parents, foreign placement destinations and cycles do not invent path metadata', () => {
  const catalog = searchCatalog([
    item('direct', { access: 'viewer', parentId: 'not-loaded', placementParentId: 'foreign' }),
    item('foreign', { name: 'Someone else folder', kind: 'folder', access: 'viewer' }),
    item('cycle', { kind: 'folder', parentId: 'cycle' }),
  ]);
  expect(catalog.find((entry) => entry.id === 'direct')?.paths).toEqual([]);
  expect(catalog.find((entry) => entry.id === 'cycle')?.paths).toEqual(['cycle']);
});

test('invalid or repeated query fields cannot broaden a request', () => {
  for (const input of [
    { q: ['one', 'two'] },
    { owner: 'admin' },
    { type: 'sql' },
    { modified: 'forever' },
    { unexpected: 'x' },
    { q: 'x'.repeat(201) },
    { tag: null },
  ]) {
    // Null should be rejected as a supplied value, even though omitted keys default empty.
    expect(() => parseSearch(input)).toThrow('Invalid search filters.');
  }
  expect(parseSearch({ q: '  budget  ', type: 'sheet' })).toEqual({
    ...emptySearch,
    q: 'budget',
    type: 'sheet',
  });
});

test('displayed tag hashes and compatibility Unicode work in search and exact tag filters', () => {
  const catalog = searchCatalog([item('a', { name: 'ＢＵＤＧＥＴ', tags: ['planning'] })]);
  expect(
    searchItems(catalog, { ...emptySearch, q: 'budget #planning', tag: ' #PLANNING ' }, now),
  ).toHaveLength(1);
  expect(searchItems(catalog, { ...emptySearch, tag: '#' }, now)).toHaveLength(0);
});
