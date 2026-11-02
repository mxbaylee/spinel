import type { DatabaseSync } from '../../../server/database.ts';

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** Recovery scans run on a stable snapshot. libsql prefetches 100 iterator rows,
 * so iterate only small row locators and fetch one payload at a time. Projection
 * is internal SQL supplied by recovery code, never by an archive or request. */
export function* recoveryRows(db: DatabaseSync, table: string, projection = '*') {
  const columns = db.prepare(`PRAGMA table_info(${quote(table)})`).all();
  const primary = columns
    .filter((column) => Number(column.pk) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk))
    .map((column) => quote(String(column.name)));
  const order = primary.length ? primary.join(',') : 'rowid';
  const rowid = ['rowid', '_rowid_', 'oid'].find(
    (alias) => !columns.some((column) => String(column.name).toLowerCase() === alias),
  );
  const withoutRowid =
    db.prepare("SELECT wr FROM pragma_table_list WHERE schema='main' AND name=?").get(table)?.wr ===
    1;
  const query = `SELECT ${projection} FROM ${quote(table)}`;
  if (rowid && !withoutRowid) {
    const read = db.prepare(`${query} WHERE ${rowid}=CAST(? AS INTEGER)`);
    for (const locator of db.iterate(
      `SELECT CAST(${rowid} AS TEXT) AS locator FROM ${quote(table)} ORDER BY ${order}`,
    ))
      yield read.get(locator.locator)!;
  } else {
    // Unusual imported schemas may hide every rowid alias or omit rowid.
    // Preserve exact ordering/types (including large or nullable keys) without
    // prefetching their potentially large keys or assuming a unique locator.
    const read = db.prepare(`${query} ORDER BY ${order} LIMIT 1 OFFSET ?`);
    for (let offset = 0; ; offset++) {
      const row = read.get(offset);
      if (!row) return;
      yield row;
    }
  }
}
