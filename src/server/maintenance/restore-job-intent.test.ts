import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { restoreIntentHash, validRestoreJobIntent } from './restore-job-intent.ts';
import type { RestoreJobIntent } from './restore-job-intent.ts';
import { restoreJobIntentFixture } from './restore-job-fixture.ts';

function reordered(value: unknown): unknown {
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, item]) => [key, reordered(item)]),
    );
  return value;
}

test('intent identity includes every binding and ignores only object property order', () => {
  const intent = restoreJobIntentFixture();
  expect(validRestoreJobIntent(intent)).toBe(true);
  const hash = restoreIntentHash(intent);
  expect(restoreIntentHash(reordered(intent) as RestoreJobIntent)).toBe(hash);
  for (const changed of [
    { ...intent, target: { ...intent.target, epoch: randomUUID() } },
    { ...intent, target: { ...intent.target, identity: { device: '1', inode: '3' } } },
    { ...intent, source: { ...intent.source, archive: { bytes: 101, sha256: 'f'.repeat(64) } } },
    { ...intent, authority: { ...intent.authority, expiresAt: intent.authority.expiresAt - 1 } },
    { ...intent, authority: { ...intent.authority, verifiedPasskeyId: 'other' } },
    { ...intent, policy: { ...intent.policy, spacesEnabled: false } },
    { ...intent, policy: { ...intent.policy, staticDirectory: '/srv/spinel/other-assets' } },
    { ...intent, continuationHash: 'f'.repeat(64) },
  ])
    expect(restoreIntentHash(changed)).not.toBe(hash);
});

test('intent validation rejects incomplete, inconsistent and unbounded bindings', () => {
  const intent = restoreJobIntentFixture();
  for (const invalid of [
    {},
    null,
    { ...intent, extra: true },
    { ...intent, source: { ...intent.source, id: randomUUID() } },
    { ...intent, target: { ...intent.target, databasePath: '/srv/../workspace.sqlite' } },
    { ...intent, target: { ...intent.target, databasePath: '/srv/\0workspace.sqlite' } },
    { ...intent, target: { ...intent.target, databasePath: 'workspace.sqlite' } },
    { ...intent, target: { ...intent.target, identity: { device: '1', inode: '-1' } } },
    { ...intent, policy: { ...intent.policy, image: 'different' } },
    { ...intent, policy: { ...intent.policy, staticDirectory: 'relative-assets' } },
    { ...intent, policy: { ...intent.policy, consequencesVersion: 2 } },
    { ...intent, confirmedAt: intent.authority.expiresAt },
    { ...intent, confirmedAt: intent.authority.verifiedAt - 1 },
  ])
    expect(validRestoreJobIntent(invalid)).toBe(false);
  // JSON escaping/UTF-8 bytes, not string length, determine the storage bound.
  const origin = '\u0001'.repeat(4096);
  const huge = {
    ...intent,
    policy: { ...intent.policy, origin },
    source: { ...intent.source, recovery: { ...intent.source.recovery, origin } },
  };
  expect(validRestoreJobIntent(huge)).toBe(false);
  expect(() => restoreIntentHash(huge)).toThrow('Invalid restore job intent');
});
