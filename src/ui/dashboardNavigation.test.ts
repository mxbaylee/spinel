import { expect, test } from 'vitest';
import { emptySearch } from '../shared/search.ts';
import {
  clearDashboardNavigation,
  consumeDashboardReturn,
  dashboardReturnHref,
  dashboardSession,
  parseDashboardRetrieval,
  rememberDashboardRetrieval,
  restoreDashboardRetrieval,
  retrievalHref,
} from '../../web/dashboardNavigation.ts';
import type { DashboardRetrieval } from '../../web/dashboardNavigation.ts';

const folder = '12345678-1234-1234-1234-123456789abc';
const value: DashboardRetrieval = {
  folderId: folder,
  shared: false,
  query: { ...emptySearch, q: 'private trip', type: 'sheet' },
  draft: 'private trip type:sheet',
  allFiles: true,
  layout: 'grid',
  scroll: 1432,
};
function memory() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

test('history restoration binds exact folder, account, and current authenticated tab epoch', () => {
  const storage = memory();
  const envelope = rememberDashboardRetrieval('owner', value, storage);
  expect(envelope).not.toBeNull();
  expect(restoreDashboardRetrieval('owner', envelope, retrievalHref(value), storage)).toEqual(
    value,
  );
  expect(restoreDashboardRetrieval('owner', envelope, '/', storage)).toBeNull();
  expect(
    restoreDashboardRetrieval('collaborator', envelope, retrievalHref(value), storage),
  ).toBeNull();
  // An old browser history entry must not survive signing out and signing in as the same person.
  clearDashboardNavigation(storage);
  dashboardSession('owner', storage);
  expect(restoreDashboardRetrieval('owner', envelope, retrievalHref(value), storage)).toBeNull();
});

test('account switching invalidates the old epoch and removes its private query snapshot', () => {
  const storage = memory();
  const envelope = rememberDashboardRetrieval('owner', value, storage);
  dashboardSession('collaborator', storage);
  expect([...storage.values.values()].some((entry) => entry.includes('private trip'))).toBe(false);
  dashboardSession('owner', storage);
  expect(restoreDashboardRetrieval('owner', envelope, retrievalHref(value), storage)).toBeNull();
});

test('explicit Files return is exact-target and consumed once; a mistaken target discards it', () => {
  const storage = memory();
  rememberDashboardRetrieval('owner', value, storage);
  expect(dashboardReturnHref('owner', storage)).toBe(`/?item=${folder}&files-return=1`);
  expect(consumeDashboardReturn('owner', '/', storage)).toBeNull();
  expect(dashboardReturnHref('owner', storage)).toBeNull();
  const shared = { ...value, folderId: null, shared: true };
  rememberDashboardRetrieval('owner', shared, storage);
  expect(dashboardReturnHref('owner', storage)).toBe('/?shared=1&files-return=1');
  expect(consumeDashboardReturn('owner', '/?shared=1', storage)).toEqual(shared);
  expect(consumeDashboardReturn('owner', '/?shared=1', storage)).toBeNull();
});

test('invalid drafts are preserved without truncation but oversized persistence is rejected', () => {
  const storage = memory();
  const invalid = { ...value, draft: 'type:sheet type:doc "unfinished' };
  const envelope = rememberDashboardRetrieval('owner', invalid, storage);
  expect(restoreDashboardRetrieval('owner', envelope, retrievalHref(value), storage)).toEqual(
    invalid,
  );
  expect(parseDashboardRetrieval({ ...value, draft: 'x'.repeat(2049) })).toBeNull();
  expect(
    rememberDashboardRetrieval('owner', { ...value, draft: 'x'.repeat(2049) }, storage),
  ).toBeNull();
  expect(dashboardReturnHref('owner', storage)).toBeNull();
  expect(
    parseDashboardRetrieval({ ...value, query: { ...value.query, q: 'x'.repeat(201) } }),
  ).toBeNull();
  for (const patch of [
    { folderId: 'https://unrelated.invalid' },
    { folderId: '../private' },
    { shared: true },
    { layout: 'table' },
    { layout: { toString: () => 'grid' } },
    { scroll: NaN },
    { scroll: Infinity },
    { scroll: -1 },
    { scroll: 10_000_001 },
  ])
    expect(parseDashboardRetrieval({ ...value, ...patch })).toBeNull();
  expect(
    parseDashboardRetrieval({ ...value, paths: ['private metadata'], results: ['secret'] }),
  ).toEqual(value);
});

test('storage failures and a null/invalid epoch never authorize history restoration', () => {
  const unavailable = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {},
    removeItem: () => {},
  };
  for (const generation of [null, undefined, '', 'not-a-uuid']) {
    expect(
      restoreDashboardRetrieval(
        'owner',
        { version: 1, accountId: 'owner', generation, value },
        retrievalHref(value),
        unavailable,
      ),
    ).toBeNull();
  }
  expect(dashboardReturnHref('owner', unavailable)).toBeNull();
  expect(() => clearDashboardNavigation(unavailable)).not.toThrow();
  const storage = memory();
  dashboardSession('owner', storage);
  const key = [...storage.values.keys()][0]!;
  storage.setItem(key, '{broken');
  clearDashboardNavigation(storage);
  expect(storage.getItem(key)).toBeNull();
});
