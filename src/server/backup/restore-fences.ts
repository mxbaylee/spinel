import type { DatabaseSync } from '../../../server/database.ts';
import { readRestoreRows } from './restore-credentials.ts';
import { restoreEvidenceSources } from './restore-evidence.ts';

const incompatible = () => new Error('This backup has incompatible retired request identities.');
const identitySources = [
  ['workspace_items', ['id']],
  ['spinel_live_units', ['item_id', 'unit_id']],
  ['spinel_sync_units', ['unit_id']],
  ['spinel_restore_jobs', ['item_id', 'previous_unit', 'next_unit']],
  ['collaboration_purge', ['item_id']],
  ['workspace_offline_creations', ['item_id', 'unit_id']],
  ['workspace_offline_recoveries', ['item_id']],
  ['spinel_sync_transition_units', ['unit_id']],
  ['spinel_generation_resources', ['item_id', 'unit_id']],
] as const;
const bindingFields = ['item_id', 'user_id', 'checkpoint_id', 'previous_unit', 'next_unit'];
const validId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  !value.includes('\0') &&
  Buffer.byteLength(value) <= 256;

/** Frozen-copy preparation only. Permanent fences survive absent documents and
 * normal generation purge. This step does not itself rotate active units or the
 * independent maintenance epoch: both are required before serving the candidate.
 */
export function reconcileRestoreFences(
  current: DatabaseSync,
  candidate: DatabaseSync,
  additional: readonly DatabaseSync[] = [],
) {
  const { sources, tables } = restoreEvidenceSources(current, candidate, additional);
  if (!tables.has('spinel_restore_fences')) throw incompatible();
  const identities = new Set<string>(),
    requests = new Set<string>(),
    bindings = new Map<string, string>();
  let bytes = 0;
  const add = (kind: 'identity' | 'request', value: unknown) => {
    if (!validId(value)) throw incompatible();
    const set = kind === 'identity' ? identities : requests;
    if (set.has(value)) return;
    bytes += Buffer.byteLength(value);
    set.add(value);
    if (identities.size + requests.size > 100_000 || bytes > 8 * 1024 ** 2) throw incompatible();
  };
  for (const db of [...sources, candidate]) {
    for (const row of readRestoreRows(db, 'spinel_restore_fences', 100_000)) {
      if (row.kind !== 'identity' && row.kind !== 'request') throw incompatible();
      add(row.kind, row.id);
    }
    for (const [table, columns] of identitySources) {
      if (!tables.has(table)) continue;
      for (const row of readRestoreRows(db, table, 100_000, [...columns]))
        for (const column of columns) add('identity', row[column]);
    }
    if (tables.has('spinel_restore_jobs'))
      for (const row of readRestoreRows(db, 'spinel_restore_jobs', 100_000, [
        'id',
        ...bindingFields,
      ])) {
        add('request', row.id);
        if (!bindingFields.every((field) => validId(row[field]))) throw incompatible();
        const binding = JSON.stringify(bindingFields.map((field) => row[field]));
        const id = String(row.id),
          previous = bindings.get(id);
        if (previous !== undefined && previous !== binding) throw incompatible();
        bindings.set(id, binding);
      }
  }
  candidate.exec('SAVEPOINT restore_fence_union');
  try {
    const insert = candidate.prepare('INSERT OR IGNORE INTO spinel_restore_fences VALUES(?,?)');
    for (const id of identities) insert.run('identity', id);
    for (const id of requests) insert.run('request', id);
    candidate.exec('RELEASE restore_fence_union');
  } catch (error) {
    candidate.exec('ROLLBACK TO restore_fence_union');
    candidate.exec('RELEASE restore_fence_union');
    throw error;
  }
  return { identities: identities.size, requests: requests.size };
}
