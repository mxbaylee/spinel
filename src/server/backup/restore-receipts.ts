import { statSync } from 'node:fs';
import type { DatabaseSync } from '../../../server/database.ts';
import { readRestoreRows, requireCompatibleRestoreSchema } from './restore-credentials.ts';

const incompatible = () => new Error('This backup has incompatible request receipts.');
// These records can outlive their document. Do not join to live items,
// discard missing-item receipts, or infer that an absent document permits replay.
const receiptTables = [
  {
    name: 'workspace_offline_creations',
    keys: ['item_id'],
    columns: ['item_id', 'unit_id', 'user_id', 'request_hash', 'owner_id'],
  },
  {
    name: 'workspace_offline_recoveries',
    keys: ['user_id', 'recovery_id'],
    columns: ['user_id', 'recovery_id', 'request_hash', 'item_id', 'possible_replay_crash'],
  },
  {
    name: 'mcp_writes',
    keys: ['actor_id', 'request_id'],
    columns: ['actor_id', 'request_id', 'payload_hash', 'created_at'],
  },
] as const;

/** Internal step on frozen disposable copies after current account reconciliation.
 * Retain both generations' request identity evidence, refusing ambiguity rather
 * than choosing one meaning for a reused identity. This does NOT fence native
 * edits or authorize restore: fresh epochs/units and restore-job reconciliation
 * are separate required steps before the candidate can serve traffic. Offline
 * receipts record acceptance; MCP fingerprints are written BEFORE submission
 * and neither prove acceptance nor prevent a matching retry from submitting.
 */
export function reconcileRestoreReceipts(current: DatabaseSync, candidate: DatabaseSync) {
  const source = statSync(current.path, { bigint: true });
  const target = statSync(candidate.path, { bigint: true });
  if (source.dev === target.dev && source.ino === target.ino) throw incompatible();
  const tables = requireCompatibleRestoreSchema(current, candidate);
  let copied = 0,
    matched = 0;
  candidate.exec('BEGIN IMMEDIATE');
  try {
    for (const table of receiptTables) {
      if (!tables.has(table.name)) continue;
      const columns = [...table.columns];
      const actual = current
        .prepare(`PRAGMA table_info(${table.name})`)
        .all()
        .map((row) => row.name)
        .sort();
      if (JSON.stringify(actual) !== JSON.stringify([...columns].sort())) throw incompatible();
      const sourceRows = readRestoreRows(current, table.name, 100_000, columns);
      // Check both input and union budgets. Inserting a small source must not
      // evade admission for an already oversized archived receipt table.
      const archivedRows = readRestoreRows(candidate, table.name, 100_000, columns);
      for (const row of [...sourceRows, ...archivedRows]) {
        for (const column of columns) {
          const value = row[column];
          if (column === 'created_at') {
            if (!Number.isSafeInteger(value) || Number(value) < 0) throw incompatible();
          } else if (column === 'possible_replay_crash') {
            if (value !== 0 && value !== 1) throw incompatible();
          } else if (!(column === 'owner_id' && value === null) && typeof value !== 'string') {
            throw incompatible();
          }
        }
      }
      const find = candidate.prepare(`SELECT ${columns.join(',')} FROM ${table.name}
        WHERE ${table.keys.map((key) => `${key}=?`).join(' AND ')}`);
      const insert = candidate.prepare(`INSERT INTO ${table.name} (${columns.join(',')})
        VALUES (${columns.map(() => '?').join(',')})`);
      for (const row of sourceRows) {
        const existing = find.get(...table.keys.map((key) => row[key]));
        if (existing) {
          for (const column of columns) {
            if (table.name === 'mcp_writes' && column === 'created_at') continue;
            if (existing[column] !== row[column]) throw incompatible();
          }
          if (table.name === 'mcp_writes') {
            if (!Number.isSafeInteger(row.created_at) || !Number.isSafeInteger(existing.created_at))
              throw incompatible();
            // Matching content may have a later fingerprint retention timestamp.
            candidate
              .prepare('UPDATE mcp_writes SET created_at=? WHERE actor_id=? AND request_id=?')
              .run(
                Math.max(Number(row.created_at), Number(existing.created_at)),
                row.actor_id,
                row.request_id,
              );
          }
          matched++;
        } else {
          insert.run(...columns.map((column) => row[column]));
          copied++;
        }
      }
      const merged = readRestoreRows(candidate, table.name, 100_000, columns);
      if (table.name === 'workspace_offline_creations') {
        const identities = new Set<string>();
        for (const row of merged)
          for (const field of ['item_id', 'unit_id']) {
            const identity = String(row[field]);
            if (identities.has(identity)) throw incompatible();
            identities.add(identity);
          }
      }
    }
    // SQLite uniqueness also rejects incompatible unit IDs. FK validation proves
    // current user receipts were not copied before their account identities.
    for (const row of candidate.iterate('PRAGMA foreign_key_check')) if (row) throw incompatible();
    candidate.exec('COMMIT');
  } catch (error) {
    candidate.exec('ROLLBACK');
    throw error;
  }
  return { copied, matched };
}
