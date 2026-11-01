import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, opendir, realpath, statfs } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  authenticateRestoreInputFile,
  copyRestoreInputFile,
  syncRestoreDirectory,
} from '../backup/restore-input.ts';
import type { RestoreInputFile } from '../backup/restore-input.ts';
import type { FileIdentity } from './journal.ts';
import { validRestoreOriginals } from './restore-files.ts';
import type { RestoreOriginals } from './restore-files.ts';
import { assertRestoreTrialEvidenceTarget, validRestoreTrialPermit } from './restore-trial.ts';
import type { RestoreTrialPermit } from './restore-trial.ts';
import { matchesRestoreTrialStop, validRestoreTrialStopRequest } from './restore-trial-stop.ts';
import type { RestoreTrialStopRequest } from './restore-trial-stop.ts';
import { validRestoreFingerprint } from './restore-stop.ts';

const names = ['spinel.sqlite', 'spinel.sqlite-wal', 'spinel.sqlite-shm'] as const;
const maximum = 8 * 1024 ** 3;
const refused = () => new Error('Failed restore attempt evidence is unavailable or changed.');
const shape = (v: unknown, keys: string[]): v is Record<string, unknown> =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((key) => Object.hasOwn(v, key));

/** Negative evidence only. Never an original-authority snapshot or an opening
 * permit; its fingerprint comes from the failed child's independent final stop. */
export interface FailedRestoreCustody {
  version: 1;
  captureId: string;
  stop: RestoreTrialStopRequest;
  witness: { fingerprint: string; acceptedAt: number };
  identity: FileIdentity;
  files: RestoreOriginals['original'];
}
export function validFailedRestoreCustody(value: unknown): value is FailedRestoreCustody {
  return (
    shape(value, ['version', 'captureId', 'stop', 'witness', 'identity', 'files']) &&
    value.version === 1 &&
    validRestoreTrialStopRequest(value.stop) &&
    shape(value.witness, ['fingerprint', 'acceptedAt']) &&
    validRestoreFingerprint(value.witness.fingerprint) &&
    Number.isSafeInteger(value.witness.acceptedAt) &&
    Number(value.witness.acceptedAt) > 0 &&
    Number(value.witness.acceptedAt) < value.stop.request.deadline &&
    validRestoreOriginals({ id: value.captureId, identity: value.identity, original: value.files })
  );
}
export interface FailedRestoreCustodyOptions {
  root: string;
  databasePath: string;
  permit: RestoreTrialPermit;
  stop: RestoreTrialStopRequest;
  witness: FailedRestoreCustody['witness'];
  captureId: string;
  now(): number;
  deadline: number;
  signal?: AbortSignal;
  /** Must prove process-group exit and closure of every workspace descriptor. */
  assertClosed(): void;
}
function controls(options: FailedRestoreCustodyOptions) {
  const permit = structuredClone(options.permit),
    stop = structuredClone(options.stop),
    witness = structuredClone(options.witness);
  if (
    !validRestoreTrialPermit(permit) ||
    !matchesRestoreTrialStop(stop, permit) ||
    !shape(witness, ['fingerprint', 'acceptedAt']) ||
    !validRestoreFingerprint(witness.fingerprint) ||
    !Number.isSafeInteger(witness.acceptedAt) ||
    witness.acceptedAt <= 0 ||
    witness.acceptedAt >= stop.request.deadline ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      options.captureId,
    ) ||
    !Number.isSafeInteger(options.deadline)
  )
    throw refused();
  let previous = witness.acceptedAt;
  const active = () => {
    options.signal?.throwIfAborted();
    const now = options.now();
    if (
      !Number.isSafeInteger(now) ||
      now < previous ||
      now >= options.deadline ||
      Date.now() >= options.deadline ||
      options.deadline - now > 600_000
    )
      throw refused();
    previous = now;
  };
  const closed = () => {
    active();
    options.assertClosed();
    assertRestoreTrialEvidenceTarget(permit, options.databasePath, permit.identity);
    active();
  };
  closed();
  return { active, closed, permit, stop, witness };
}
async function privateDirectory(path: string) {
  const stat = await lstat(path);
  if (
    !stat.isDirectory() ||
    stat.uid !== process.getuid?.() ||
    stat.mode & 0o077 ||
    (await realpath(path)) !== resolve(path)
  )
    throw refused();
}
async function absent(path: string) {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw refused();
}
async function inspect(path: string, active: () => void) {
  active();
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.nlink !== 1n ||
      before.uid !== BigInt(process.getuid!()) ||
      before.mode & 0o077n ||
      before.size < 0n ||
      before.size > BigInt(maximum)
    )
      throw refused();
    const hash = createHash('sha256'),
      buffer = Buffer.alloc(64 * 1024);
    const size = Number(before.size);
    let offset = 0;
    for (;;) {
      active();
      const { bytesRead } = await file.read(
        buffer,
        0,
        Math.min(buffer.length, size + 1 - offset),
        offset,
      );
      if (!bytesRead) break;
      offset += bytesRead;
      if (offset > size) throw refused();
      hash.update(buffer.subarray(0, bytesRead));
    }
    for (const after of [await file.stat({ bigint: true }), await lstat(path, { bigint: true })]) {
      if (
        !after.isFile() ||
        ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode', 'uid', 'nlink'].some(
          (key) => before[key as keyof typeof before] !== after[key as keyof typeof after],
        )
      )
        throw refused();
    }
    active();
    if (offset !== size) throw refused();
    return { bytes: size, sha256: hash.digest('hex') };
  } finally {
    await file.close();
  }
}
function paths(root: string, manifest: FailedRestoreCustody) {
  const job = join(root, `restore-${manifest.stop.request.jobId}`);
  const capture = join(job, `failed-${manifest.captureId}`);
  return { job, capture, raw: join(capture, 'raw') };
}
/** Read-only. The controller must reserve captureId and persist this entire
 * manifest before preserveFailedRestoreCustody can mutate the evidence tree. */
export async function captureFailedRestoreCustody(
  options: FailedRestoreCustodyOptions,
): Promise<FailedRestoreCustody> {
  const control = controls(options);
  await privateDirectory(options.root);
  control.closed();
  await absent(options.databasePath + '-journal');
  const files = {} as FailedRestoreCustody['files'];
  for (const name of names) {
    control.closed();
    try {
      files[name] = await inspect(
        options.databasePath + name.slice('spinel.sqlite'.length),
        control.active,
      );
    } catch (error) {
      if (name === 'spinel.sqlite' || (error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error;
      files[name] = null;
    }
    control.closed();
  }
  const result: FailedRestoreCustody = {
    version: 1,
    captureId: options.captureId,
    stop: control.stop,
    witness: control.witness,
    identity: control.permit.identity,
    files,
  };
  if (!validFailedRestoreCustody(result)) throw refused();
  await verifyTuple(options, result, control);
  return result;
}
async function verifyTuple(
  options: FailedRestoreCustodyOptions,
  manifest: FailedRestoreCustody,
  control: ReturnType<typeof controls>,
) {
  control.closed();
  await absent(options.databasePath + '-journal');
  for (const name of names) {
    const path = options.databasePath + name.slice('spinel.sqlite'.length),
      file = manifest.files[name];
    if (file)
      await authenticateRestoreInputFile({ path, ...file }, false, options.signal, control.active);
    else await absent(path);
    control.closed();
  }
  await absent(options.databasePath + '-journal');
  control.closed();
}
/** Copies only the persisted manifest into its one reserved slot. Successful
 * bytes survive publication failure; partial or mismatched files are never
 * overwritten and require explicit recovery, not an automatically new slot. */
export async function preserveFailedRestoreCustody(
  options: FailedRestoreCustodyOptions,
  expected: FailedRestoreCustody,
): Promise<FailedRestoreCustody> {
  if (!validFailedRestoreCustody(expected)) throw refused();
  const manifest = structuredClone(expected),
    control = controls(options);
  const current = await captureFailedRestoreCustody(options);
  if (!isDeepStrictEqual(current, manifest)) throw refused();
  const location = paths(options.root, manifest);
  await privateDirectory(location.job);
  for (const path of [location.capture, location.raw]) {
    control.closed();
    try {
      await mkdir(path, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    await privateDirectory(path);
  }
  for await (const entry of await opendir(location.capture, { bufferSize: 2 }))
    if (entry.name !== 'raw') throw refused();
  const present = new Set<string>();
  for await (const entry of await opendir(location.raw, { bufferSize: 4 })) {
    if (
      !names.includes(entry.name as (typeof names)[number]) ||
      !manifest.files[entry.name as (typeof names)[number]]
    )
      throw refused();
    present.add(entry.name);
  }
  let missingBytes = 0;
  for (const name of names) {
    const file = manifest.files[name];
    if (!file) continue;
    control.closed();
    if (present.has(name))
      await authenticateRestoreInputFile(
        { path: join(location.raw, name), ...file },
        true,
        options.signal,
        control.active,
      );
    else missingBytes += file.bytes;
  }
  const space = await statfs(options.root, { bigint: true });
  if (space.bavail * space.bsize < BigInt(missingBytes + 256 * 1024 ** 2)) throw refused();
  for (const name of names) {
    const file = manifest.files[name];
    if (!file || present.has(name)) continue;
    control.closed();
    await copyRestoreInputFile(
      { path: options.databasePath + name.slice('spinel.sqlite'.length), ...file },
      join(location.raw, name),
      options.signal,
      control.active,
    );
    control.closed();
  }
  for (const path of [location.raw, location.capture, location.job, options.root]) {
    control.closed();
    await syncRestoreDirectory(path, options.signal);
    control.closed();
  }
  await verifyTuple(options, manifest, control);
  return manifest;
}
/** Derived immutable raw inputs only. The caller must first complete preservation
 * and use manifest.witness.fingerprint when freezing; never readiness/output fp. */
export function failedRestoreCustodyInputs(
  root: string,
  manifest: FailedRestoreCustody,
): {
  database: RestoreInputFile;
  wal?: RestoreInputFile;
  fingerprint: string;
} {
  if (!validFailedRestoreCustody(manifest)) throw refused();
  const raw = paths(root, manifest).raw;
  return {
    database: { path: join(raw, 'spinel.sqlite'), ...manifest.files['spinel.sqlite']! },
    ...(manifest.files['spinel.sqlite-wal'] && {
      wal: { path: join(raw, 'spinel.sqlite-wal'), ...manifest.files['spinel.sqlite-wal'] },
    }),
    fingerprint: manifest.witness.fingerprint,
  };
}
