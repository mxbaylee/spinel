import { DatabaseSync } from '../../server/database.ts';
import { isClientDiagnosticEvent } from '@spinel/diagnostics';

const names = [
  'sync.client.connection',
  'sync.client.resync',
  'sync.client.refresh',
  'offline.recovery',
] as const;

/** Read existing, lossy diagnostics after the journey; never change collection or sync. */
export function desktopSyncObservation(path: string, itemIds: readonly string[]) {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(path, { readOnly: true });
    database.exec('PRAGMA busy_timeout = 0');
    const placeholders = names.map(() => '?').join(',');
    const total = Number(
      database
        .prepare(`SELECT count(*) AS count FROM events WHERE name IN (${placeholders})`)
        .get(...names)?.count,
    );
    const rows = database
      .prepare(
        `SELECT received_at, file_id, name, details FROM events WHERE name IN (${placeholders}) ORDER BY received_at, rowid LIMIT 256`,
      )
      .all(...names);
    let unreadable = 0;
    const records: { itemOrdinal: number; receivedAt: number; event: unknown }[] = [];
    for (const row of rows) {
      try {
        const itemOrdinal = itemIds.indexOf(String(row.file_id)) + 1;
        const event = { name: row.name, details: JSON.parse(String(row.details)) };
        if (!itemOrdinal || !isClientDiagnosticEvent(event)) {
          unreadable++;
          continue;
        }
        records.push({ itemOrdinal, receivedAt: Number(row.received_at), event });
      } catch {
        unreadable++;
      }
    }
    return {
      available: true as const,
      total,
      dropped: Math.max(0, total - rows.length),
      unreadable,
      records,
    };
  } catch {
    // A missing, locked or damaged diagnostics store cannot alter acceptance.
    return { available: false as const };
  } finally {
    try {
      database?.close();
    } catch {
      // Observation-only connection; never replace the journey's first result.
    }
  }
}
