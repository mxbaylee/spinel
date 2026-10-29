import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { recoveryInventory, restoreSnapshotFingerprint } from './inventory.ts';
import { freezeCurrentRestore } from './restore-freeze.ts';
import { AuthStore } from '../auth/store.ts';
import { captureRestoreAuthority } from '../maintenance/restore-authority.ts';
import type { RestoreAuthority } from '../maintenance/restore-authority.ts';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const evidence = (path: string, bytes: Buffer) => ({
  path,
  bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
});
async function fixture(
  checkpoint = false,
  configure?: (database: DatabaseSync) => RestoreAuthority,
) {
  const root = await mkdtemp(join(tmpdir(), 'spinel-freeze-'));
  roots.push(root);
  const live = join(root, 'live.sqlite');
  const database = new DatabaseSync(live);
  let authority: RestoreAuthority | undefined;
  let original: Buffer, wal: Buffer | undefined, priorWal: Buffer, fingerprint: string;
  try {
    database.exec(`PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
      CREATE TABLE users(id TEXT PRIMARY KEY, enabled INTEGER NOT NULL);
      CREATE TABLE spinel_recovery(id INTEGER PRIMARY KEY, inventory TEXT);
      INSERT INTO users VALUES('operator',1);
      INSERT INTO spinel_recovery VALUES(1,'current recovery evidence');
      PRAGMA user_version=7;`);
    authority = configure?.(database);
    priorWal = await readFile(live + '-wal');
    database.prepare('UPDATE users SET enabled=0 WHERE id=?').run('operator');
    database.exec('BEGIN');
    fingerprint = restoreSnapshotFingerprint(database);
    database.exec('COMMIT');
    // No writer is active. Capture the exact tuple while the live connection
    // still has its WAL, then close it before exercising recovery copies.
    if (checkpoint) database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    original = await readFile(live);
    if (!checkpoint) wal = await readFile(live + '-wal');
  } finally {
    database.close();
  }
  const custody = join(root, 'original');
  const stagingRoot = join(root, 'staging');
  await mkdir(custody, { mode: 0o700 });
  await mkdir(stagingRoot, { mode: 0o700 });
  const path = join(custody, 'spinel.sqlite');
  await writeFile(path, original!, { mode: 0o600 });
  if (wal!) await writeFile(path + '-wal', wal!, { mode: 0o600 });
  return {
    original: original!,
    wal: wal!,
    priorWal: priorWal!,
    custody,
    options: {
      database: evidence(path, original!),
      ...(wal! && { wal: evidence(path + '-wal', wal!) }),
      fingerprint: fingerprint!,
      stagingRoot,
      ...(authority && { authority }),
    },
  };
}

test('isolated freeze preserves WAL-only authority changes and never modifies original custody', async () => {
  const f = await fixture();
  const frozen = await freezeCurrentRestore(f.options);
  try {
    const db = new DatabaseSync(frozen.databasePath, { readOnly: true });
    try {
      expect(db.prepare('SELECT enabled FROM users WHERE id=?').get('operator')!.enabled).toBe(0);
      expect(restoreSnapshotFingerprint(db)).toBe(f.options.fingerprint);
    } finally {
      db.close();
    }
    expect(await readFile(f.options.database.path)).toEqual(f.original);
    expect(await readFile(f.options.database.path + '-wal')).toEqual(f.wal);
    expect(await readdir(f.custody)).toEqual(
      expect.arrayContaining(['spinel.sqlite', 'spinel.sqlite-wal']),
    );
    expect(await readdir(join(frozen.databasePath, '..'))).toEqual(['frozen.sqlite']);
  } finally {
    await frozen.dispose();
  }
  expect(await readdir(f.options.stagingRoot)).toEqual([]);
});

test('a clean earlier WAL commit cannot replace the independent current-state witness', async () => {
  const f = await fixture();
  const walPath = f.options.database.path + '-wal';
  await writeFile(walPath, f.priorWal);
  const before = await readFile(walPath);
  await expect(
    freezeCurrentRestore({ ...f.options, wal: evidence(walPath, before) }),
  ).rejects.toThrow('Recovery verification');
  expect(await readFile(f.options.database.path)).toEqual(f.original);
  expect(await readFile(walPath)).toEqual(before);
  expect(await readdir(f.options.stagingRoot)).toEqual([]);
});

test.each([false, true])(
  'freezes a checkpointed main with an explicitly %s empty WAL',
  async (empty) => {
    const f = await fixture(true);
    const walPath = f.options.database.path + '-wal';
    if (empty) await writeFile(walPath, '', { mode: 0o600 });
    const frozen = await freezeCurrentRestore({
      ...f.options,
      ...(empty && { wal: evidence(walPath, Buffer.alloc(0)) }),
    });
    expect(frozen.fingerprint).toBe(f.options.fingerprint);
    await frozen.dispose();
    expect(await readFile(f.options.database.path)).toEqual(f.original);
  },
);

test('refuses omitted WAL, unexpected journal, unsafe original modes and cancellation', async () => {
  const f = await fixture();
  await expect(freezeCurrentRestore({ ...f.options, wal: undefined })).rejects.toThrow('tuple');
  await writeFile(f.options.database.path + '-journal', '', { mode: 0o600 });
  await expect(freezeCurrentRestore(f.options)).rejects.toThrow('tuple');
  await rm(f.options.database.path + '-journal');
  await chmod(f.options.database.path, 0o644);
  await expect(freezeCurrentRestore(f.options)).rejects.toThrow('changed');
  await chmod(f.options.database.path, 0o600);
  const controller = new AbortController();
  controller.abort();
  await expect(freezeCurrentRestore({ ...f.options, signal: controller.signal })).rejects.toThrow();
  expect(await readdir(f.options.stagingRoot)).toEqual([]);
});

test('drain fingerprints include recovery metadata and migration version', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(
      "CREATE TABLE spinel_recovery(id INTEGER PRIMARY KEY, inventory TEXT); INSERT INTO spinel_recovery VALUES(1,'first')",
    );
    const ordinary = recoveryInventory(db),
      first = restoreSnapshotFingerprint(db);
    db.exec("UPDATE spinel_recovery SET inventory='second'");
    expect(recoveryInventory(db)).toEqual(ordinary);
    expect(restoreSnapshotFingerprint(db)).not.toBe(first);
    const second = restoreSnapshotFingerprint(db);
    db.exec('PRAGMA user_version=8');
    expect(restoreSnapshotFingerprint(db)).not.toBe(second);
  } finally {
    db.close();
  }
});

test.each([false, true])(
  'freeze rechecks the original passkey proof against witnessed current data (revoked=%s)',
  async (revoked) => {
    const f = await fixture(false, (database) => {
      const auth = new AuthStore(database),
        operator = auth.createUser('Operator', true),
        now = Date.now();
      database
        .prepare('INSERT INTO auth_passkeys VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(
          'first',
          operator.id,
          Buffer.from([1]),
          0,
          '[]',
          'first',
          'Browser',
          now,
          null,
          0,
          'singleDevice',
        );
      const session = auth.createSession(operator.id, undefined, 'first').session;
      auth.markVerified(session, 'first');
      const proof = captureRestoreAuthority(database, {
        actorId: operator.id,
        sessionHash: session.token_hash,
        expiresAt: now + 60_000,
      });
      if (revoked) database.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(operator.id);
      return proof;
    });
    if (revoked) await expect(freezeCurrentRestore(f.options)).rejects.toThrow();
    else {
      const frozen = await freezeCurrentRestore(f.options);
      expect(frozen.fingerprint).toBe(f.options.fingerprint);
      await frozen.dispose();
    }
    expect(await readFile(f.options.database.path)).toEqual(f.original);
    expect(await readFile(f.options.database.path + '-wal')).toEqual(f.wal);
  },
  30_000,
);
