import { statSync } from 'node:fs';
import type { DatabaseSync } from '../../../server/database.ts';
import { readRestoreRows, requireCompatibleRestoreSchema } from './restore-credentials.ts';

const incompatible = () =>
  new Error('This backup needs compatible recovery history reconciliation.');

/** Current deployment history is evidence about external artifacts, not proof
 * that the newly reconciled generation has been backed up. Never import archived
 * job ownership, success, destination identity or retention pins. Configuration
 * itself remains in current deployment files and is not applied here.
 */
export function reconcileRestoreOperations(current: DatabaseSync, candidate: DatabaseSync) {
  const a = statSync(current.path, { bigint: true }),
    b = statSync(candidate.path, { bigint: true });
  if (a.dev === b.dev && a.ino === b.ino) throw incompatible();
  const tables = requireCompatibleRestoreSchema(current, candidate);
  let copied = 0,
    defaulted = 0;
  candidate.exec('SAVEPOINT restore_operations');
  try {
    for (const table of ['backup_state', 'verification_state']) {
      if (!tables.has(table)) continue;
      const fields = current
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => String(row.name));
      const expected = [
        'id',
        'last_attempt',
        'last_good',
        'error',
        'lease',
        'owner',
        ...(table === 'backup_state'
          ? ['job', 'publication_identity', 'publication_destination', 'publication_key_id']
          : ['backup_key', 'key_id', 'identity']),
      ];
      if (JSON.stringify([...fields].sort()) !== JSON.stringify(expected.sort()))
        throw incompatible();
      const rows = readRestoreRows(current, table, 1);
      for (const row of rows) {
        if (
          row.id !== 1 ||
          ['last_attempt', 'last_good'].some(
            (field) =>
              row[field] !== null && (!Number.isSafeInteger(row[field]) || Number(row[field]) < 0),
          )
        )
          throw incompatible();
        for (const field of fields.filter(
          (field) => !['id', 'last_attempt', 'last_good', 'lease', 'owner', 'job'].includes(field),
        ))
          if (
            row[field] !== null &&
            (typeof row[field] !== 'string' || Buffer.byteLength(String(row[field])) > 4096)
          )
            throw incompatible();
      }
      candidate.exec(`DELETE FROM ${table}`);
      if (!rows.length) {
        candidate.prepare(`INSERT INTO ${table}(id) VALUES(1)`).run();
        defaulted++;
        continue;
      }
      const row: (typeof rows)[number] = {
        ...rows[0],
        lease: 0,
        owner: null,
        ...(table === 'backup_state' && { job: null }),
      };
      candidate
        .prepare(
          `INSERT INTO ${table}(${fields.join(',')}) VALUES(${fields.map(() => '?').join(',')})`,
        )
        .run(...fields.map((field) => row[field]));
      copied++;
    }
    candidate.exec('RELEASE restore_operations');
    return { copied, defaulted };
  } catch (error) {
    candidate.exec('ROLLBACK TO restore_operations');
    candidate.exec('RELEASE restore_operations');
    throw error;
  }
}
