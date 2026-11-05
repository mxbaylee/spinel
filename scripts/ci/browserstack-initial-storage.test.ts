import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  initialChromeStorageScript,
  verifyInitialChromeStorage,
} from './browserstack-initial-storage.ts';

function fixture(overrides: Record<string, unknown> = {}) {
  const noWrite = () =>
    assert.fail('Initial storage observation must never write or open storage.');
  const document = {
    getElementById: () => ({ textContent: JSON.stringify({ version: '0123456789abcdef' }) }),
    get cookie() {
      return '';
    },
    set cookie(_value: string) {
      noWrite();
    },
  };
  return {
    document,
    localStorage: { getItem: () => null, setItem: noWrite, removeItem: noWrite },
    indexedDB: {
      databases: async () => [{ name: 'spinel-offline-runtime' }],
      open: noWrite,
      deleteDatabase: noWrite,
    },
    caches: { keys: async () => ['spinel-shell-0123456789abcdef'], open: noWrite, delete: noWrite },
    ...overrides,
  };
}
const read = async (context: ReturnType<typeof fixture>) =>
  JSON.parse(
    JSON.stringify(
      await runInNewContext(`(async()=>{${initialChromeStorageScript}})()`, context, {
        timeout: 1000,
      }),
    ),
  );
test('anonymous runtime storage is allowed without account/cache/cookie writes', async () => {
  const result = await read(fixture());
  assert.deepEqual(verifyInitialChromeStorage(result), {
    markerAbsent: true,
    boundaryAbsent: true,
    accountDatabases: 0,
    runtimeDatabases: 1,
    currentShellCaches: 1,
    unexpectedCaches: 0,
  });
});
test('prior account, boundary cookie, other retained shell and unknown caches fail closed', async () => {
  for (const overrides of [
    { localStorage: { getItem: () => 'previous-account' } },
    {
      document: {
        getElementById: () => ({ textContent: '{"version":"0123456789abcdef"}' }),
        cookie: 'other=1; spinel-capability-boundary=private',
      },
    },
    { indexedDB: { databases: async () => [{ name: 'spinel-offline-account' }] } },
    { caches: { keys: async () => ['spinel-shell-fedcba9876543210'] } },
    { caches: { keys: async () => ['unexpected-cache'] } },
  ]) {
    const observed = await read(fixture(overrides));
    assert.throws(() => verifyInitialChromeStorage(observed), /unverified/);
  }
});

test('unavailable or malformed APIs never become a clean observation', async () => {
  for (const overrides of [
    { indexedDB: {} },
    {
      indexedDB: {
        databases: async () => {
          throw Error('denied');
        },
      },
    },
    { indexedDB: { databases: async () => [{ name: null }] } },
    { caches: { keys: async () => null } },
    { document: { getElementById: () => null } },
  ])
    await assert.rejects(() => read(fixture(overrides)));
  for (const value of [
    null,
    {},
    [],
    { markerAbsent: true, boundaryAbsent: true, accountDatabases: 0, unexpectedCaches: 0 },
    {
      markerAbsent: true,
      boundaryAbsent: true,
      accountDatabases: 0,
      unexpectedCaches: 0,
      runtimeDatabases: '0',
      currentShellCaches: 0,
    },
  ])
    assert.throws(() => verifyInitialChromeStorage(value), /unverified/);
});
