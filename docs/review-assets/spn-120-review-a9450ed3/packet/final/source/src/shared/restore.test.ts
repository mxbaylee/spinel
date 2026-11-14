import { expect, test } from 'vitest';
import { validRestoreResources, validRestoreVerification } from './restore.ts';
import type { RestoreResources } from './restore.ts';

function resources(): RestoreResources {
  return {
    provisional: true,
    checkedAt: Date.now(),
    requiredAdditionalBytes: 1000,
    availableBytes: 2000,
    sufficient: false,
    filesystems: [
      {
        purposes: ['application', 'preparation'],
        requiredAdditionalBytes: 600,
        availableBytes: 1800,
        sufficient: true,
      },
      {
        purposes: ['recovery'],
        requiredAdditionalBytes: 400,
        availableBytes: 200,
        sufficient: false,
      },
    ],
  };
}

test('resource projection preserves a recovery-volume shortage despite enough aggregate space', () => {
  expect(validRestoreResources(resources())).toBe(true);
  expect(validRestoreResources({ ...resources(), sufficient: true })).toBe(false);
});

test('resource projection refuses private fields, double-counted volumes and contradictory totals', () => {
  expect(validRestoreResources({ ...resources(), device: '/private/recovery' })).toBe(false);
  for (const mutate of [
    (r: RestoreResources) => {
      r.filesystems[1].purposes = ['application'];
    },
    (r: RestoreResources) => {
      r.filesystems[1].availableBytes = 1000;
    },
    (r: RestoreResources) => {
      r.requiredAdditionalBytes++;
    },
    (r: RestoreResources) => {
      r.checkedAt = Infinity;
    },
    (r: RestoreResources) => {
      r.filesystems[0].requiredAdditionalBytes = -1;
    },
    (r: RestoreResources) => {
      r.filesystems[1].sufficient = true;
    },
  ]) {
    const value = resources();
    mutate(value);
    expect(validRestoreResources(value)).toBe(false);
  }
  const extra = resources();
  Object.assign(extra.filesystems[0], { path: '/private/application' });
  expect(validRestoreResources(extra)).toBe(false);
});

test('verification projection accepts only checked compatibility and bounded counts', () => {
  const verified = {
    applicationCompatible: true,
    sourceCompatible: true,
    databaseVerified: true,
    tables: 33,
    rows: 140,
    snapshots: 12,
    images: 3,
  };
  expect(validRestoreVerification(verified)).toBe(true);
  expect(validRestoreVerification({ ...verified, sourceCompatible: false })).toBe(false);
  expect(validRestoreVerification({ ...verified, images: Number.MAX_SAFE_INTEGER + 1 })).toBe(
    false,
  );
  expect(validRestoreVerification({ ...verified, databasePath: '/private/candidate' })).toBe(false);
});
