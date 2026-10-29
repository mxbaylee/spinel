import { constants } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from '../../../server/database.ts';
import { digest } from './archive.ts';
import { restoreSnapshotFingerprint } from './inventory.ts';
import { reconcileRestoreRollback } from './restore-candidate.ts';
import { MAX_RESTORE_EVIDENCE_INPUTS } from './restore-evidence.ts';
import { assertSelfContained } from './restore-input.ts';
import { RecoveryResourceError } from './resource-error.ts';
import type { RollbackWorkerInput } from './restore-rollback.ts';

/** Only disposable copies within this worker's directory are opened. Physical
 * closure still requires worker exit; libsql close alone is not that evidence. */
export async function prepareWorkingRollback(input: RollbackWorkerInput) {
  const output = join(input.directory, 'rollback.sqlite');
  if (
    input.current.databasePath !== join(input.directory, 'current.sqlite') ||
    !Array.isArray(input.additional) ||
    input.additional.length > MAX_RESTORE_EVIDENCE_INPUTS ||
    input.additional.some(
      (value, index) => value.databasePath !== join(input.directory, `attempt-${index}.sqlite`),
    )
  )
    throw new Error('Invalid rollback input.');
  for (const value of [
    input.current,
    ...input.additional,
    { ...input.current, databasePath: output },
  ]) {
    await assertSelfContained(value.databasePath);
    if (
      (await stat(value.databasePath)).size !== value.databaseBytes ||
      (await digest(value.databasePath)) !== value.databaseSha256
    )
      throw new Error('Changed rollback input.');
  }
  const connections: DatabaseSync[] = [];
  const connect = (path: string) => {
    const db = new DatabaseSync(path);
    connections.push(db);
    db.exec('PRAGMA cache_size=-2048; PRAGMA temp_store=FILE');
    return db;
  };
  try {
    const current = connect(input.current.databasePath);
    if (restoreSnapshotFingerprint(current) !== input.current.fingerprint)
      throw new Error('Rollback original differs from its independent witness.');
    const additional = input.additional.map((value) => connect(value.databasePath));
    const candidate = connect(output);
    candidate.exec('PRAGMA journal_mode=DELETE');
    const pageSize = Number(candidate.prepare('PRAGMA page_size').get()!.page_size);
    candidate.exec(`PRAGMA max_page_count=${Math.floor(input.maxDatabaseBytes / pageSize)}`);
    const { inventory, semantics, ...reconciliation } = await reconcileRestoreRollback(
      current,
      candidate,
      additional,
      input,
    );
    const logicalFingerprint = restoreSnapshotFingerprint(candidate);
    for (const db of connections.splice(0)) db.close();
    await assertSelfContained(output);
    const bytes = (await stat(output)).size;
    if (bytes < 4096 || bytes > input.maxDatabaseBytes)
      throw new RecoveryResourceError('database-size');
    const file = await open(output, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      await file.sync();
    } finally {
      await file.close();
    }
    const directory = await open(
      input.directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    return {
      ...inventory,
      ...semantics,
      reconciliation,
      logicalFingerprint,
      databaseSha256: await digest(output),
      databaseBytes: bytes,
      originalFingerprint: input.current.fingerprint,
    };
  } finally {
    for (const db of connections) db.close();
  }
}
