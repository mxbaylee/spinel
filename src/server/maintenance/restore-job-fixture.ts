import { randomUUID } from 'node:crypto';
import type { RestoreJobIntent } from './restore-job-intent.ts';

export function restoreJobIntentFixture(now = Date.now()): RestoreJobIntent {
  const id = randomUUID();
  const origin = 'https://spinel.example';
  const image = 'sha256:' + 'a'.repeat(64);
  return {
    version: 1,
    id,
    target: {
      instanceId: randomUUID(),
      generationId: randomUUID(),
      epoch: randomUUID(),
      databasePath: '/srv/spinel/workspace.sqlite',
      identity: { device: '1', inode: '2' },
    },
    source: {
      version: 1,
      id,
      archive: { bytes: 100, sha256: 'b'.repeat(64) },
      candidate: { bytes: 4096, sha256: 'c'.repeat(64) },
      recovery: { createdAt: new Date(now - 1000).toISOString(), origin, image },
    },
    policy: {
      origin,
      image,
      spacesEnabled: true,
      staticDirectory: '/srv/spinel/dist',
      consequencesVersion: 1,
    },
    authority: {
      actorId: randomUUID(),
      sessionHash: 'd'.repeat(64),
      verifiedAt: now - 1000,
      verifiedPasskeyId: 'passkey',
      expiresAt: now + 60_000,
    },
    continuationHash: 'e'.repeat(64),
    confirmedAt: now,
    preview: {
      provisional: true,
      currentAccounts: 2,
      currentPasskeys: 3,
      sharingRemoved: 4,
      sharingDowngraded: 5,
      isolatedItems: 6,
      isolatedGroups: 7,
      detachedRoots: 8,
      heldTrashBatches: 9,
    },
    consequenceEnvelope: 1,
  };
}
