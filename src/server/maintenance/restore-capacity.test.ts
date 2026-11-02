import { randomUUID } from 'node:crypto';
import {
  lstatSync,
  realpathSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  truncateSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { validRestoreResources } from '../../shared/restore.ts';
import { estimateRestoreCapacity } from './restore-capacity.ts';
import type { RestoreCapacityInput, RestoreCapacityVolume } from './restore-capacity.ts';
import { fileIdentity } from './journal.ts';
import { TRANSFER_DISK_RESERVE } from '../backup/transfer.ts';

vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>();
  return { ...actual, lstatSync: vi.fn(actual.lstatSync) };
});
const directories: string[] = [];
afterEach(() => {
  vi.clearAllMocks();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'spinel-capacity-')));
  directories.push(root);
  const application = join(root, 'application'),
    recoveryRoot = join(root, 'recovery');
  mkdirSync(application, { mode: 0o700 });
  mkdirSync(recoveryRoot, { mode: 0o700 });
  const databasePath = join(application, 'spinel.sqlite');
  writeFileSync(databasePath, Buffer.alloc(4096), { mode: 0o600 });
  writeFileSync(databasePath + '-wal', Buffer.alloc(8192), { mode: 0o600 });
  writeFileSync(databasePath + '-shm', Buffer.alloc(4096), { mode: 0o600 });
  const input: RestoreCapacityInput = {
    databasePath,
    recoveryRoot,
    identity: fileIdentity(databasePath),
    archiveBytes: 100,
    databaseBytes: 8192,
    previewDatabaseBytes: 32768,
    checkedAt: 1_800_000_000_000,
    sourceRetained: false,
  };
  const separate: RestoreCapacityVolume = (path) => ({
    device: path === recoveryRoot ? '2' : '1',
    availableBytes: 10n ** 12n,
  });
  return { input, separate, root };
}

test('phase maximum includes retained failed trial evidence and one active freeze, not cumulative rehearsal scratch', () => {
  const { input, separate } = fixture();
  const result = estimateRestoreCapacity(input, separate);
  const F = 4096 + 8192,
    S = 4096,
    D = input.previewDatabaseBytes,
    T = F + S;
  const source = input.archiveBytes + input.databaseBytes;
  // Retained original T + frozen F + prepared2D + stagedD + failed raw3D+S;
  // active failed freeze requires9D under the existing3x(main+2xWAL) guard.
  const failedFreeze = source + T + F + 15 * D + S;
  const recovery = result.filesystems.find((entry) => entry.purposes.includes('recovery'))!;
  expect(recovery.requiredAdditionalBytes).toBe(failedFreeze + TRANSFER_DISK_RESERVE);
  expect(recovery.requiredAdditionalBytes).toBeLessThan(
    source + 7 * F + 2 * S + 38 * D + TRANSFER_DISK_RESERVE,
  );
  expect(result.availableBytes).toBe(2 * 10 ** 12);
  expect(result.sufficient).toBe(true);
  expect(validRestoreResources(result)).toBe(true);
  expect(JSON.stringify(result)).not.toContain(input.databasePath);
  expect(JSON.stringify(result)).not.toContain(input.recoveryRoot);
  expect(
    estimateRestoreCapacity({ ...input, sourceRetained: true }, separate).requiredAdditionalBytes,
  ).toBe(result.requiredAdditionalBytes - source);
});

test('groups application/preparation/recovery before taking phase maximum and counts shared free space once', () => {
  const { input, separate } = fixture();
  const individual = estimateRestoreCapacity(input, separate);
  const demands = individual.filesystems.map(
    (item) => item.requiredAdditionalBytes - TRANSFER_DISK_RESERVE,
  );
  const sharedNeed = demands.reduce((sum, n) => sum + n, 2 * TRANSFER_DISK_RESERVE);
  const shared = estimateRestoreCapacity(input, () => ({
    device: '1',
    availableBytes: BigInt(sharedNeed - 1),
  }));
  expect(shared.filesystems).toHaveLength(1);
  expect(shared.filesystems[0].purposes).toEqual(['application', 'preparation', 'recovery']);
  expect(shared.requiredAdditionalBytes).toBe(sharedNeed);
  // Existing shared-volume staging requires both role reserves. A tiny fixture
  // must never admit merely because one256MiB reserve fits before pause.
  expect(shared.requiredAdditionalBytes).toBeGreaterThan(2 * TRANSFER_DISK_RESERVE);
  expect(
    estimateRestoreCapacity(input, () => ({
      device: '1',
      availableBytes: BigInt(TRANSFER_DISK_RESERVE + 10 * 1024 ** 2),
    })).sufficient,
  ).toBe(false);
  expect(shared.availableBytes).toBe(sharedNeed - 1);
  expect(shared.sufficient).toBe(false);
  expect(
    estimateRestoreCapacity(input, () => ({ device: '1', availableBytes: BigInt(sharedNeed) }))
      .sufficient,
  ).toBe(true);
});

test('a full application volume cannot conceal an insufficient separate recovery volume', () => {
  const { input, separate } = fixture();
  const full = estimateRestoreCapacity(input, separate);
  const recovery = full.filesystems.find((item) => item.purposes.includes('recovery'))!;
  const result = estimateRestoreCapacity(input, (path) => ({
    device: path === input.recoveryRoot ? '2' : '1',
    availableBytes:
      path === input.recoveryRoot ? BigInt(recovery.requiredAdditionalBytes - 1) : 10n ** 12n,
  }));
  expect(result.availableBytes).toBeGreaterThan(result.requiredAdditionalBytes);
  expect(result.sufficient).toBe(false);
  expect(result.filesystems[0].sufficient).toBe(true);
  expect(result.filesystems[1].sufficient).toBe(false);
});

test('uses the smaller shared-volume observation and bounds public huge numbers', () => {
  const { input } = fixture();
  const result = estimateRestoreCapacity(input, (path) => ({
    device: '1',
    availableBytes: path === input.recoveryRoot ? 1n : 10n ** 30n,
  }));
  expect(result.availableBytes).toBe(1);
  expect(result.sufficient).toBe(false);
  const huge = estimateRestoreCapacity(input, () => ({ device: '1', availableBytes: 10n ** 30n }));
  expect(huge.availableBytes).toBe(Number.MAX_SAFE_INTEGER);
  const separateHuge = estimateRestoreCapacity(input, (path) => ({
    device: path === input.recoveryRoot ? '2' : '1',
    availableBytes: 10n ** 30n,
  }));
  expect(validRestoreResources(separateHuge)).toBe(true);
});

test('current growth and observed native preview expansion increase the next estimate without renewing any bound', () => {
  const { input, separate } = fixture();
  const initial = estimateRestoreCapacity(input, separate);
  const expanded = estimateRestoreCapacity({ ...input, previewDatabaseBytes: 1024 ** 2 }, separate);
  expect(expanded.requiredAdditionalBytes).toBeGreaterThan(initial.requiredAdditionalBytes);
  truncateSync(input.databasePath + '-wal', 2 * 1024 ** 2);
  expect(estimateRestoreCapacity(input, separate).requiredAdditionalBytes).toBeGreaterThan(
    expanded.requiredAdditionalBytes,
  );
});

test('refuses changed inode, unsafe tuple, unknown capacity and malformed verified size', () => {
  const { input, separate, root } = fixture();
  expect(() =>
    estimateRestoreCapacity({ ...input, identity: { ...input.identity, inode: '0' } }, separate),
  ).toThrow();
  for (const value of [0, 4095, 8 * 1024 ** 3 + 1, NaN])
    expect(() =>
      estimateRestoreCapacity({ ...input, previewDatabaseBytes: value }, separate),
    ).toThrow();
  expect(() =>
    estimateRestoreCapacity(input, () => ({ device: randomUUID(), availableBytes: 1n })),
  ).toThrow();
  expect(() =>
    estimateRestoreCapacity(input, () => ({ device: '1', availableBytes: -1n })),
  ).toThrow();
  writeFileSync(input.databasePath + '-journal', 'pending', { mode: 0o600 });
  expect(() => estimateRestoreCapacity(input, separate)).toThrow();
  rmSync(input.databasePath + '-journal');
  rmSync(input.databasePath + '-wal');
  symlinkSync(join(root, 'not-a-wal'), input.databasePath + '-wal');
  expect(() => estimateRestoreCapacity(input, separate)).toThrow();
});

test.each(['main', 'wal', 'shm'] as const)(
  'refuses an individually mounted %s instead of misreporting its volume',
  (part) => {
    const { input, separate } = fixture();
    const main = lstatSync(input.databasePath, { bigint: true });
    const wal = lstatSync(input.databasePath + '-wal', { bigint: true });
    const shm = lstatSync(input.databasePath + '-shm', { bigint: true });
    const altered = (info: typeof main) =>
      Object.assign(Object.create(info), { dev: info.dev + 1n });
    vi.mocked(lstatSync)
      .mockReturnValueOnce(part === 'main' ? altered(main) : main)
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('No rollback journal'), { code: 'ENOENT' });
      })
      .mockReturnValueOnce(part === 'wal' ? altered(wal) : wal)
      .mockReturnValueOnce(part === 'shm' ? altered(shm) : shm);
    const identity =
      part === 'main' ? { ...input.identity, device: String(main.dev + 1n) } : input.identity;
    expect(() => estimateRestoreCapacity({ ...input, identity }, separate)).toThrow(
      'capacity could not be established',
    );
  },
);
