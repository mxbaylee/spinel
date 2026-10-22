import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  OFFLINE_SDK_VERSION,
  OfflineAccess,
  offlineScope,
} from '../../web/offline/OfflineAccess.ts';
import type { OfflineScope } from '../../web/offline/OfflineAccess.ts';
import type { OfflineBundle } from '../shared/offlineBundle.ts';

const scope: OfflineScope = {
  origin: 'https://spinel.example',
  accountId: 'owner',
  itemId: 'item',
  unitId: 'generation',
  kind: 'doc',
  access: 'owner',
  sdkVersion: '1.1.0',
  schema: 1,
  revisionOffset: 4,
};

test('the offline SDK version is the pinned @univerjs/core version', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  expect(pkg.dependencies['@univerjs/core']).toBe(OFFLINE_SDK_VERSION);
});

test('the scope is copied and frozen, and local reads end for good', () => {
  const input = { ...scope };
  const access = new OfflineAccess(input);
  input.accountId = 'another person';
  expect(access.scope.accountId).toBe('owner');
  expect(Object.isFrozen(access.scope)).toBe(true);
  expect(access.mayReadLocal).toBe(true);
  access.needsAttention('An image is missing.');
  expect(access.state).toMatchObject({ phase: 'attention', epoch: 1 });
  expect(access.mayReadLocal).toBe(false);
  access.needsAttention('Again');
  expect(access.state.epoch).toBe(1);
  access.lock('Signed out.');
  expect(access.state).toMatchObject({ phase: 'locked', reason: 'Signed out.' });
  access.dispose();
  expect(access.state.phase).toBe('disposed');
  access.lock('After dispose');
  expect(access.state.phase).toBe('disposed');
});

test('a listener that locks stops later listeners seeing the superseded state', () => {
  const access = new OfflineAccess(scope);
  const seen: string[] = [];
  access.subscribe((state) => {
    seen.push(`first:${state.phase}`);
    if (state.phase === 'attention') access.lock('Account changed.');
  });
  access.subscribe((state) => seen.push(`second:${state.phase}`));
  access.needsAttention('Missing image');
  expect(seen).toEqual(['first:attention', 'first:locked', 'second:locked']);
});

test.each([
  ['origin', { origin: 'https://spinel.example/path' }],
  ['account', { accountId: '' }],
  ['item', { itemId: '' }],
  ['empty Space root', { spaceId: '' }],
  ['Space root equal to its child', { spaceId: 'item' }],
  ['malformed Space root', { spaceId: null }],
  ['unit', { unitId: '' }],
  ['access', { access: 'admin' }],
  ['kind', { kind: 'slide' }],
  ['sdk', { sdkVersion: '1.2.0' }],
  ['schema', { schema: 2 }],
  ['offset', { revisionOffset: -1 }],
])('rejects an invalid %s', (_name, change) => {
  expect(() => new OfflineAccess({ ...scope, ...change } as OfflineScope)).toThrow(/Invalid/);
});

test('Space identity remains bound to the frozen native account, child and generation scope', () => {
  const input = { ...scope, spaceId: 'project' };
  const access = new OfflineAccess(input);
  input.spaceId = 'another-project';
  expect(access.scope).toEqual({ ...scope, spaceId: 'project' });
  expect(Object.isFrozen(access.scope)).toBe(true);
});

test('a bundle from another SDK version is not opened', () => {
  const bundle = {
    version: 1,
    accountId: 'owner',
    itemId: 'item',
    name: 'Budget',
    unitId: 'generation',
    revision: 3,
    revisionOffset: 4,
    access: 'viewer',
    readOnly: true,
    sdkVersion: OFFLINE_SDK_VERSION,
    images: [],
    kind: 'doc',
    snapshot: { id: 'item' },
  } as unknown as OfflineBundle;
  expect(offlineScope(bundle, scope.origin)).toEqual({ ...scope, access: 'viewer' });
  expect(() => offlineScope({ ...bundle, sdkVersion: '1.0.0' }, scope.origin)).toThrow(
    /another version/,
  );
});
