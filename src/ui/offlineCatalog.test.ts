import { expect, test } from 'vitest';
import type { SpaceFile, WorkspaceItem } from '../shared/workspace.ts';
import { isOfflineCatalog, spaceOfflineCatalog } from '../../web/offline/offlineStore.ts';

const root: SpaceFile = {
  id: 'project',
  parentId: 'private-folder',
  name: 'Project',
  kind: 'space',
  access: 'owner',
  tags: [],
  createdAt: 1,
  updatedAt: 2,
};
const ordinary: WorkspaceItem = {
  id: 'ordinary',
  parentId: null,
  name: 'Other notes',
  kind: 'doc',
  access: 'owner',
  tags: [],
  createdAt: 1,
  updatedAt: 2,
};

test('a first Space preparation has a valid root-only catalog without inventing its outer location', () => {
  const catalog = spaceOfflineCatalog(root);
  expect(isOfflineCatalog(catalog)).toBe(true);
  expect(catalog.items).toEqual([root]);
  expect(catalog.items[0].parentId).toBe('private-folder');
  expect(catalog.shared).toEqual([]);
  expect(catalog.views).toEqual({ project: [root] });
});

test('adding a Space root preserves existing ordinary files, views and their last-synced timestamp', () => {
  const previous = {
    syncedAt: 100,
    items: [ordinary],
    shared: [],
    views: { ordinary: [ordinary] },
  };
  const catalog = spaceOfflineCatalog(root, previous);
  expect(catalog).toEqual({
    syncedAt: 100,
    items: [ordinary, root],
    shared: [],
    views: { ordinary: [ordinary], project: [root] },
  });
  expect(previous.items).toEqual([ordinary]);
  expect(isOfflineCatalog(catalog)).toBe(true);
  const shared = spaceOfflineCatalog({ ...root, access: 'viewer', parentId: null }, catalog);
  expect(shared.items).toEqual([ordinary]);
  expect(shared.shared).toEqual([{ ...root, access: 'viewer', parentId: null }]);
});

test.each([
  null,
  [],
  { syncedAt: Number.NaN, items: [], shared: [], views: {} },
  { syncedAt: 0, items: [{ ...root, kind: 'unsupported' }], shared: [], views: {} },
  { syncedAt: 0, items: [root], shared: [], views: [] },
  { syncedAt: 0, items: [root], shared: [], views: { project: [{ ...root, tags: null }] } },
])('an incomplete or unsupported local catalog is refused', (catalog) => {
  expect(isOfflineCatalog(catalog)).toBe(false);
});
