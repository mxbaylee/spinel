import { lstatSync, realpathSync, statfsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { RestoreResources } from '../../shared/restore.ts';
import { MAX_ARCHIVE_BYTES, TRANSFER_DISK_RESERVE } from '../backup/transfer.ts';
import type { FileIdentity } from './journal.ts';

const DATABASE_LIMIT = 8 * 1024 ** 3;
const unavailable = () => new Error('Restore capacity could not be established.');
export function validRestorePreviewBytes(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 4096 && Number(value) <= DATABASE_LIMIT;
}
export interface RestoreCapacityInput {
  databasePath: string;
  identity: FileIdentity;
  recoveryRoot: string;
  archiveBytes: number;
  databaseBytes: number;
  previewDatabaseBytes: number;
  sourceRetained: boolean;
  checkedAt: number;
}
/** Test-only filesystem observations; never selectable over private IPC or HTTP. */
export type RestoreCapacityVolume = (path: string) => { device: string; availableBytes: bigint };
function volume(path: string) {
  const info = lstatSync(path, { bigint: true });
  if (!info.isDirectory() || realpathSync(path) !== path) throw unavailable();
  const space = statfsSync(path, { bigint: true });
  if (space.bavail < 0n || space.bsize <= 0n) throw unavailable();
  return { device: String(info.dev), availableBytes: space.bavail * space.bsize };
}
function file(path: string, optional: boolean) {
  try {
    const info = lstatSync(path, { bigint: true });
    if (
      !info.isFile() ||
      info.nlink !== 1n ||
      info.uid !== BigInt(process.getuid!()) ||
      info.size < 0n ||
      info.size > BigInt(DATABASE_LIMIT) ||
      realpathSync(path) !== path
    )
      throw unavailable();
    return info;
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** A provisional sequential disk model, not a reservation or a certified maximum.
 * P is the observed, fully reconciled preview (including native duplication).
 * C+F allows for current authority/negative evidence not present in the archive.
 * Output expansion and concurrent writes still face the unchanged worker limits
 * and the exact per-stage free-space checks. No database is opened here.
 */
export function estimateRestoreCapacity(
  input: RestoreCapacityInput,
  probe: RestoreCapacityVolume = volume,
): RestoreResources {
  if (
    !validRestorePreviewBytes(input.databaseBytes) ||
    !validRestorePreviewBytes(input.previewDatabaseBytes) ||
    !Number.isSafeInteger(input.archiveBytes) ||
    input.archiveBytes <= 0 ||
    input.archiveBytes > MAX_ARCHIVE_BYTES ||
    !Number.isSafeInteger(input.checkedAt) ||
    input.checkedAt < 0 ||
    input.checkedAt > 8.64e15 ||
    typeof input.sourceRetained !== 'boolean' ||
    [input.databasePath, input.recoveryRoot].some(
      (path) => resolve(path) !== path || path.includes('\0'),
    )
  )
    throw unavailable();
  const main = file(input.databasePath, false)!;
  if (
    String(main.dev) !== input.identity.device ||
    String(main.ino) !== input.identity.inode ||
    main.size < 4096n
  )
    throw unavailable();
  if (file(input.databasePath + '-journal', true)) throw unavailable();
  const walFile = file(input.databasePath + '-wal', true);
  const shmFile = file(input.databasePath + '-shm', true);
  // The supported deployment mounts the directory containing the SQLite tuple.
  // Single-file mounts could put main/WAL/SHM on unmodeled volumes. Refuse that
  // layout, independently of the test-only free-space observation seam.
  const parent = lstatSync(dirname(input.databasePath), { bigint: true });
  if (
    !parent.isDirectory() ||
    [main, walFile, shmFile].some((info) => info && info.dev !== parent.dev)
  )
    throw unavailable();
  const wal = walFile?.size ?? 0n;
  const shm = shmFile?.size ?? 0n;
  const current = main.size + wal;
  const candidate = BigInt(input.databaseBytes),
    preview = BigInt(input.previewDatabaseBytes);
  const modeled = candidate + current > preview ? candidate + current : preview;
  const output = modeled < BigInt(DATABASE_LIMIT) ? modeled : BigInt(DATABASE_LIMIT);
  const raw = current + shm;
  const source = input.sourceRetained ? 0n : BigInt(input.archiveBytes) + candidate;
  const growth = output > main.size ? output - main.size : 0n;
  const workspace = growth + (2n * output > wal ? 2n * output : wal);
  // Each row includes all retained predecessor outputs plus only the active
  // phase's scratch. Successful workers/rehearsals remove their private inputs;
  // cleanup failure stops progression, so scratch from later rows cannot coexist.
  const phases = [
    ['source-custody', 0n, source],
    ['original-custody', 0n, source + raw],
    ['original-freeze', 0n, source + raw + 3n * current],
    ['candidate-reconcile', 0n, source + raw + 2n * current + 3n * output],
    ['initial-rollback', 0n, source + raw + 2n * current + 5n * output],
    ['startup-rehearsals', 0n, source + raw + current + 5n * output],
    ['candidate-stage', workspace, source + raw + current + 3n * output],
    ['failed-custody', workspace, source + raw + current + 6n * output + shm],
    // The existing freeze admission reserves 3x the failed main+2x-WAL tuple.
    ['failed-freeze', workspace, source + raw + current + 15n * output + shm],
    ['refreshed-rollback', workspace, source + raw + 2n * current + 13n * output + shm],
    ['original-rehearsal', workspace, source + raw + current + 11n * output + shm],
    ['original-stage', workspace, source + raw + current + 9n * output + shm],
  ] as const;
  const app = probe(dirname(input.databasePath)),
    recovery = probe(input.recoveryRoot);
  const grouped = new Map<
    string,
    {
      purposes: RestoreResources['filesystems'][number]['purposes'];
      available: bigint;
      required: bigint;
    }
  >();
  for (const [sample, purposes] of [
    [app, ['application', 'preparation']],
    [recovery, ['recovery']],
  ] as const) {
    if (!/^(0|[1-9][0-9]{0,19})$/.test(sample.device) || sample.availableBytes < 0n)
      throw unavailable();
    const previous = grouped.get(sample.device);
    if (previous) {
      previous.purposes.push(...purposes);
      if (sample.availableBytes < previous.available) previous.available = sample.availableBytes;
    } else
      grouped.set(sample.device, {
        purposes: [...purposes],
        available: sample.availableBytes,
        required: 0n,
      });
  }
  for (const [, appBytes, recoveryBytes] of phases) {
    for (const [device, group] of grouped) {
      // stageRestoreCandidate/admitMutation budget separate application and
      // recovery reserves even when they share a volume. Match those guards;
      // only available capacity is deduplicated, never the required reserves.
      const required =
        (app.device === device ? appBytes + BigInt(TRANSFER_DISK_RESERVE) : 0n) +
        (recovery.device === device ? recoveryBytes + BigInt(TRANSFER_DISK_RESERVE) : 0n);
      if (required > group.required) group.required = required;
    }
  }
  // Saturate each availability to a fair share of the JSON-safe total. Real
  // modeled needs are bounded well below this; no positive admission is invented.
  const availableLimit = BigInt(Number.MAX_SAFE_INTEGER) / BigInt(grouped.size);
  const boundedAvailable = (bytes: bigint) =>
    Number(bytes > availableLimit ? availableLimit : bytes);
  const filesystems = [...grouped.values()].map((group) => ({
    purposes: group.purposes,
    requiredAdditionalBytes: Number(group.required),
    availableBytes: boundedAvailable(group.available),
    sufficient: group.available >= group.required,
  }));
  const after = file(input.databasePath, false)!;
  if (after.dev !== main.dev || after.ino !== main.ino) throw unavailable();
  return {
    provisional: true,
    checkedAt: input.checkedAt,
    requiredAdditionalBytes: filesystems.reduce(
      (sum, group) => sum + group.requiredAdditionalBytes,
      0,
    ),
    availableBytes: filesystems.reduce((sum, group) => sum + group.availableBytes, 0),
    sufficient: filesystems.every((item) => item.sufficient),
    filesystems,
  };
}
