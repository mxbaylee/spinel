import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  open,
  rename,
  rm,
  statfs,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { backup, DatabaseSync } from '../../../server/database.ts';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createGzip, createGunzip } from 'node:zlib';
import { verifyInventory, writeInventory } from './inventory.ts';

const MAGIC = Buffer.from('SPINEL01');
const HEADER_SIZE = 20;
export interface Recovery {
  format: 1;
  createdAt: string;
  origin: string;
  image: string;
  runtimeEnvironment: string;
  keyId?: string;
}
export function validateRecovery(value: unknown): asserts value is Recovery {
  const r = value as Recovery;
  if (
    !r ||
    r.format !== 1 ||
    !Number.isFinite(Date.parse(r.createdAt)) ||
    typeof r.origin !== 'string' ||
    new URL(r.origin).origin !== r.origin ||
    typeof r.image !== 'string' ||
    !/^(sha256:[a-f0-9]{64}|\S+@sha256:[a-f0-9]{64})$/.test(r.image) ||
    typeof r.runtimeEnvironment !== 'string' ||
    (r.keyId !== undefined &&
      (typeof r.keyId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(r.keyId)))
  )
    throw new Error('Invalid recovery metadata.');
}
export async function privateFile(path: string) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || (info.mode & 0o077) !== 0)
      throw new Error('Secret file must be private (0600).');
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}
export async function readKey(path: string) {
  const bytes = await privateFile(path);
  if (bytes.length !== 32) throw new Error('Backup key must contain exactly 32 random bytes.');
  return bytes;
}
export function checkDatabase(db: DatabaseSync) {
  const checks = db.prepare('PRAGMA integrity_check').all();
  if (
    checks.length !== 1 ||
    checks[0].integrity_check !== 'ok' ||
    db.prepare('PRAGMA foreign_key_check').all().length
  )
    throw new Error('Backup database integrity check failed.');
}
export async function digest(path: string) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}
// stagingRoot must be on the same encrypted volume as the live database.
export async function makeArchive(
  db: DatabaseSync,
  stagingRoot: string,
  key: Buffer,
  recovery: Recovery,
) {
  validateRecovery(recovery);
  const pages = Number(db.prepare('PRAGMA page_count').get()!.page_count);
  const pageSize = Number(db.prepare('PRAGMA page_size').get()!.page_size);
  const space = await statfs(stagingRoot);
  if (space.bavail * space.bsize < pages * pageSize * 2.1 + 256 * 1024 ** 2)
    throw new Error('Insufficient staging space for backup and encrypted output.');
  const directory = await mkdtemp(join(stagingRoot, '.backup-'));
  await chmod(directory, 0o700);
  try {
    const copy = join(directory, 'snapshot.sqlite');
    await backup(db, copy);
    await chmod(copy, 0o600);
    const snapshot = new DatabaseSync(copy);
    try {
      snapshot.exec(
        'PRAGMA journal_mode=DELETE; CREATE TABLE IF NOT EXISTS spinel_recovery (id INTEGER PRIMARY KEY CHECK(id=1), metadata TEXT NOT NULL) STRICT',
      );
      snapshot
        .prepare('INSERT OR REPLACE INTO spinel_recovery (id,metadata) VALUES (1, ?)')
        .run(JSON.stringify(recovery));
      checkDatabase(snapshot);
      writeInventory(snapshot);
    } finally {
      snapshot.close();
    }
    const header = Buffer.concat([MAGIC, randomBytes(12)]);
    const cipher = createCipheriv('aes-256-gcm', key, header.subarray(8));
    cipher.setAAD(header);
    const archive = join(directory, 'backup.spinel');
    await writeFile(archive, header, { mode: 0o600, flag: 'wx' });
    await pipeline(
      createReadStream(copy),
      createGzip(),
      cipher,
      createWriteStream(archive, { flags: 'a' }),
    );
    await appendFile(archive, cipher.getAuthTag());
    await rm(copy);
    return {
      archive,
      sha256: await digest(archive),
      dispose: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
// Fully authenticate and validate in private staging before creating the destination.
export async function restoreArchive(
  archive: string,
  key: Buffer,
  stagingRoot: string,
  destination: string,
  options: {
    requireInventory?: boolean;
    maxDatabaseBytes?: number;
    signal?: AbortSignal;
    preserveJobState?: boolean;
  } = {},
) {
  options.signal?.throwIfAborted();
  const maximum = options.maxDatabaseBytes ?? 8 * 1024 ** 3;
  if (!Number.isSafeInteger(maximum) || maximum < 4096 || maximum > 64 * 1024 ** 3)
    throw new Error('Invalid recovery size limit.');
  const space = await statfs(stagingRoot);
  const available = space.bavail * space.bsize - 256 * 1024 ** 2;
  if (available < 4096) throw new Error('Insufficient recovery staging space.');
  const limit = Math.min(maximum, available);
  const directory = await mkdtemp(join(stagingRoot, '.restore-'));
  await chmod(directory, 0o700);
  let created = false;
  try {
    const handle = await open(archive, 'r');
    let header: Buffer, tag: Buffer, size: number;
    try {
      size = (await handle.stat()).size;
      if (size < HEADER_SIZE + 17) throw new Error('Truncated backup.');
      header = Buffer.alloc(HEADER_SIZE);
      tag = Buffer.alloc(16);
      await handle.read(header, 0, header.length, 0);
      await handle.read(tag, 0, tag.length, size - 16);
    } finally {
      await handle.close();
    }
    if (!header.subarray(0, 8).equals(MAGIC)) throw new Error('Unsupported backup format.');
    const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(8));
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    const copy = join(directory, 'spinel.sqlite');
    let expanded = 0;
    let nextSpaceCheck = 0;
    const bounded = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        expanded += chunk.length;
        if (expanded > limit) {
          callback(new Error('Recovery exceeds the database size or free-space limit.'));
          return;
        }
        // Other jobs can consume the same volume after the initial budget. Check
        // again while streaming, retaining a reserve larger than queued writes.
        if (expanded >= nextSpaceCheck) {
          nextSpaceCheck = expanded + 4 * 1024 ** 2;
          statfs(directory).then(
            (current) =>
              callback(
                current.bavail * current.bsize < 256 * 1024 ** 2 + 4 * 1024 ** 2
                  ? new Error('Insufficient recovery staging space.')
                  : null,
                chunk,
              ),
            (error: Error) => callback(error),
          );
        } else callback(null, chunk);
      },
    });
    await pipeline(
      createReadStream(archive, { start: HEADER_SIZE, end: size - 17 }),
      decipher,
      createGunzip(),
      bounded,
      createWriteStream(copy, { flags: 'wx', mode: 0o600 }),
      { signal: options.signal },
    );
    const db = new DatabaseSync(copy);
    let recovery: Recovery;
    try {
      db.exec('PRAGMA trusted_schema=OFF');
      checkDatabase(db);
      verifyInventory(db, options.requireInventory === true);
      recovery = JSON.parse(
        String(db.prepare('SELECT metadata FROM spinel_recovery WHERE id=1').get()?.metadata),
      );
      validateRecovery(recovery);
      if (!options.preserveJobState)
        for (const table of ['backup_state', 'verification_state'])
          if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) {
            db.exec(`UPDATE ${table} SET lease=0, owner=NULL, last_attempt=NULL, error=NULL`);
            if (
              table === 'backup_state' &&
              db
                .prepare('PRAGMA table_info(backup_state)')
                .all()
                .some((field) => field.name === 'job')
            )
              db.exec('UPDATE backup_state SET job=NULL');
          }
    } finally {
      db.close();
    }
    await writeFile(join(directory, 'recovery.json'), JSON.stringify(recovery, null, 2) + '\n', {
      mode: 0o600,
      flag: 'wx',
    });
    await mkdir(destination, { mode: 0o700 }); // EEXIST prevents overwriting any existing restore.
    created = true;
    await rename(copy, join(destination, 'spinel.sqlite'));
    await rename(join(directory, 'recovery.json'), join(destination, 'recovery.json'));
    return recovery;
  } catch (error) {
    if (created) await rm(destination, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
