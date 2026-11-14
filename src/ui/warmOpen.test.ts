import { expect, test } from 'vitest';
import type { FileItem } from '../shared/workspace.ts';
import {
  hasUsableCopy,
  isRequestTimeout,
  viewAfterNetworkFailure,
} from '../../web/offline/warmOpen.ts';

const account = '11111111-1111-4111-8111-111111111111';
const row = (id: string, kind: 'doc' | 'sheet' | 'folder') =>
  ({ id, kind, name: id, access: 'owner' }) as unknown as FileItem;
const doc = row('doc-1', 'doc');
const folder = row('folder-1', 'folder');
const base = {
  networkFailure: true,
  accountId: account,
  preparedAccountId: account,
  saved: undefined,
  views: [] as FileItem[][],
  rows: [doc, folder],
  downloaded: true,
};

// Regression contract (SPN-090 own-phone run, item 4): a Dashboard that was online when
// it listed a downloaded Doc must open that device copy when the network then drops.
test('a downloaded Doc or Sheet opens from the device after a network failure', () => {
  expect(viewAfterNetworkFailure({ ...base, currentId: 'doc-1' })).toEqual({
    kind: 'device',
    rows: [doc],
  });
  const sheet = row('sheet-1', 'sheet');
  expect(viewAfterNetworkFailure({ ...base, currentId: 'sheet-1', rows: [sheet] })).toEqual({
    kind: 'device',
    rows: [sheet],
  });
});

test('the saved view that lists the Doc keeps its ancestors for the offline frame', () => {
  const view = [folder, doc];
  expect(viewAfterNetworkFailure({ ...base, currentId: 'doc-1', views: [view], rows: [] })).toEqual(
    {
      kind: 'device',
      rows: view,
    },
  );
});

test('a saved folder listing is still reused', () => {
  const saved = [folder, doc];
  expect(viewAfterNetworkFailure({ ...base, currentId: 'folder-1', saved })).toEqual({
    kind: 'folder',
    rows: saved,
  });
});

test('nothing is substituted unless it is a real network outage for the prepared account', () => {
  expect(
    viewAfterNetworkFailure({ ...base, currentId: 'doc-1', networkFailure: false }),
  ).toBeNull();
  expect(
    viewAfterNetworkFailure({ ...base, currentId: 'doc-1', preparedAccountId: null }),
  ).toBeNull();
  expect(
    viewAfterNetworkFailure({ ...base, currentId: 'doc-1', preparedAccountId: 'another-account' }),
  ).toBeNull();
});

test('an item with no usable device copy, or unknown to this Dashboard, stays unavailable', () => {
  expect(viewAfterNetworkFailure({ ...base, currentId: 'doc-1', downloaded: false })).toBeNull();
  expect(viewAfterNetworkFailure({ ...base, currentId: 'doc-9' })).toBeNull();
  // A folder with no saved listing is not a downloadable item.
  expect(viewAfterNetworkFailure({ ...base, currentId: 'folder-1' })).toBeNull();
});

test('a saved folder listing wins over a downloaded copy of the same id', () => {
  const saved = [folder];
  expect(
    viewAfterNetworkFailure({ ...base, currentId: 'folder-1', saved, rows: [folder] }),
  ).toEqual({ kind: 'folder', rows: saved });
});

test('only a download not marked unavailable is usable', () => {
  expect(hasUsableCopy(undefined)).toBe(false);
  expect(hasUsableCopy({ available: false })).toBe(false);
  expect(hasUsableCopy({})).toBe(true);
  expect(hasUsableCopy({ available: true })).toBe(true);
});

test('only a request that hit its own deadline counts as a timeout', () => {
  expect(isRequestTimeout(new DOMException('timed out', 'TimeoutError'))).toBe(true);
  expect(isRequestTimeout(new DOMException('cancelled', 'AbortError'))).toBe(false);
  expect(isRequestTimeout(new Error('Could not load your items.'))).toBe(false);
});
