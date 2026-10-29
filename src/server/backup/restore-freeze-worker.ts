import { chmod, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { backup, DatabaseSync } from '../../../server/database.ts';
import { checkDatabase, digest } from './archive.ts';
import { restoreSnapshotFingerprint } from './inventory.ts';
import { RecoveryResourceError } from './resource-error.ts';
import { assertSelfContained } from './restore-input.ts';

export interface FreezeWorkerInput {
  kind: 'freeze';
  directory: string;
  maxDatabaseBytes: number;
  /** Supervisor-held witness from the authoritative pre-shutdown view. */
  fingerprint: string;
  database: { bytes: number; sha256: string };
  wal?: { bytes: number; sha256: string };
}

/** Operates exclusively on disposable, parent-authenticated copies. SQLite may
 * ignore damaged WAL tails; only equality to the independent drain witness
 * establishes that this recovered view still contains the acknowledged state. */
export async function freezeWorkingRestore(input: FreezeWorkerInput) {
  const source = join(input.directory, 'source.sqlite');
  const output = join(input.directory, 'frozen.sqlite');
  for (const [path, evidence] of [
    [source, input.database],
    [source + '-wal', input.wal],
  ] as const) {
    if (evidence) {
      if ((await stat(path)).size !== evidence.bytes || (await digest(path)) !== evidence.sha256)
        throw new Error('Changed frozen input.');
    } else {
      try {
        await stat(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      throw new Error('Unexpected WAL input.');
    }
  }
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(source);
    db.exec('PRAGMA cache_size=-8192; PRAGMA temp_store=FILE');
    const pageSize = Number(db.prepare('PRAGMA page_size').get()!.page_size);
    const pages = Number(db.prepare('PRAGMA page_count').get()!.page_count);
    if (!Number.isSafeInteger(pageSize * pages) || pageSize * pages > input.maxDatabaseBytes)
      throw new RecoveryResourceError('database-size');
    checkDatabase(db);
    if (restoreSnapshotFingerprint(db) !== input.fingerprint)
      throw new Error('Recovered current state differs from the drain witness.');
    await backup(db, output);
    db.close();
    db = undefined;
    await chmod(output, 0o600);
    db = new DatabaseSync(output);
    db.exec('PRAGMA journal_mode=DELETE');
    checkDatabase(db);
    if (restoreSnapshotFingerprint(db) !== input.fingerprint)
      throw new Error('Frozen current state differs from the drain witness.');
    db.close();
    db = undefined;
    await assertSelfContained(output);
    const bytes = (await stat(output)).size;
    if (bytes < 4096 || bytes > input.maxDatabaseBytes)
      throw new RecoveryResourceError('database-size');
    for (const suffix of ['', '-wal', '-shm', '-journal'])
      await rm(source + suffix, { force: true });
    return {
      databaseBytes: bytes,
      databaseSha256: await digest(output),
      fingerprint: input.fingerprint,
    };
  } finally {
    db?.close();
  }
}
