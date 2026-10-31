import type { DatabaseSync } from '../../../server/database.ts';
import { readRestoreRows } from './restore-credentials.ts';
import { restoreEvidenceSources } from './restore-evidence.ts';

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
export function reconcileRestoreReceipts(
  current: DatabaseSync,
  candidate: DatabaseSync,
  additional: readonly DatabaseSync[] = [],
) {
  const { sources, tables } = restoreEvidenceSources(current, candidate, additional);
  const accounts = new Set(
    readRestoreRows(candidate, 'auth_users', 1024, ['id']).map((row) => row.id),
  );
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
      const validate = (rows: ReturnType<typeof readRestoreRows>) => {
        for (const row of rows) {
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
      };
      validate(readRestoreRows(candidate, table.name, 100_000, columns));
      const find = candidate.prepare(`SELECT ${columns.join(',')} FROM ${table.name}
        WHERE ${table.keys.map((key) => `${key}=?`).join(' AND ')}`);
      const insert = candidate.prepare(`INSERT INTO ${table.name} (${columns.join(',')})
        VALUES (${columns.map(() => '?').join(',')})`);
      for (const source of sources) {
        const sourceRows = readRestoreRows(source, table.name, 100_000, columns);
        validate(sourceRows);
        for (const row of sourceRows) {
          // Only the offline user_id columns reference auth_users. MCP actors
          // are opaque token/connection identities; owner_id is receipt data.
          // Never change an existing account or import attempted authority.
          if (source !== current && table.name !== 'mcp_writes' && !accounts.has(row.user_id)) {
            if (
              typeof row.user_id !== 'string' ||
              !row.user_id ||
              row.user_id.includes('\0') ||
              Buffer.byteLength(row.user_id) > 256 ||
              !source.prepare('SELECT 1 FROM auth_users WHERE id=?').get(row.user_id) ||
              accounts.size >= 1024
            )
              throw incompatible();
            candidate
              .prepare('INSERT INTO auth_users(id,name,is_admin,disabled) VALUES(?,?,0,1)')
              .run(row.user_id, 'Retained request identity');
            accounts.add(row.user_id);
          }
          const existing = find.get(...table.keys.map((key) => row[key]));
          if (existing) {
            for (const column of columns) {
              if (table.name === 'mcp_writes' && column === 'created_at') continue;
              if (existing[column] !== row[column]) throw incompatible();
            }
            if (table.name === 'mcp_writes') {
              if (
                !Number.isSafeInteger(row.created_at) ||
                !Number.isSafeInteger(existing.created_at)
              )
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
        // Check each growing union, including byte limits, while the complete
        // multi-input operation and all tombstones remain one transaction.
        readRestoreRows(candidate, table.name, 100_000, columns);
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
    // A successful union must still fit the next credential overlay's complete
    // account budget, including names and the last synthetic row's bytes.
    readRestoreRows(candidate, 'auth_users', 1024);
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
