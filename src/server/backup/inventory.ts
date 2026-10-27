import { createHash } from 'node:crypto';
import type { DatabaseSync } from '../../../server/database.ts';

const MAX_TABLES = 256;
const MAX_ROW_BYTES = 32 * 1024 * 1024;
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
export interface RecoveryInventory {
  format: 1;
  schema: string;
  tables: { name: string; rows: number; sha256: string }[];
}

/** Hash the immutable snapshot, never the live connection. SQL text conversion
 * preserves INTEGER values outside JavaScript's safe range; blobs remain bytes.
 * Length framing and SQLite types distinguish null, text, numbers and blobs. */
export function recoveryInventory(db: DatabaseSync): RecoveryInventory {
  const definitions = db
    .prepare(
      `SELECT type,name,tbl_name,sql FROM sqlite_schema
       WHERE name<>'spinel_recovery' AND tbl_name<>'spinel_recovery' ORDER BY type,name`,
    )
    .all();
  const names = definitions.filter((row) => row.type === 'table').map((row) => String(row.name));
  if (names.length > MAX_TABLES) throw new Error('Recovery inventory exceeds the table limit.');
  const schema = createHash('sha256').update(JSON.stringify(definitions)).digest('hex');
  const tables = names.map((name) => {
    const columns = db.prepare(`PRAGMA table_info(${quote(name)})`).all();
    if (!columns.length || columns.length > 256)
      throw new Error('Recovery inventory has an unsupported table.');
    const identifiers = columns.map((column) => quote(String(column.name)));
    const bytes = identifiers.map((column) => `coalesce(length(CAST(${column} AS BLOB)),0)`);
    if (
      Number(
        db.prepare(`SELECT coalesce(max(${bytes.join('+')}),0) AS n FROM ${quote(name)}`).get()!.n,
      ) > MAX_ROW_BYTES
    )
      throw new Error('Recovery inventory exceeds the per-row memory limit.');
    const primary = columns
      .filter((column) => Number(column.pk) > 0)
      .sort((a, b) => Number(a.pk) - Number(b.pk))
      .map((column) => quote(String(column.name)));
    const selection = identifiers.flatMap((column, i) => [
      `typeof(${column}) AS t${i}`,
      `CASE WHEN typeof(${column})='real' THEN ${column} ELSE CAST(${column} AS BLOB) END AS v${i}`,
    ]);
    const hash = createHash('sha256');
    let rows = 0;
    for (const row of db.iterate(
      `SELECT ${selection.join(',')} FROM ${quote(name)} ORDER BY ${primary.length ? primary.join(',') : 'rowid'}`,
    )) {
      hash.update('row:');
      for (let i = 0; i < columns.length; i++) {
        const value = row[`v${i}`];
        // Preserve all IEEE-754 bits too: SQLite's default REAL-to-text cast can
        // round distinct floating-point values to the same decimal string.
        const data =
          typeof value === 'number'
            ? Buffer.alloc(8)
            : value === null
              ? Buffer.alloc(0)
              : Buffer.from(value as Uint8Array);
        if (typeof value === 'number') data.writeDoubleBE(value);
        hash.update(`${String(row[`t${i}`])}:${data.length}:`);
        hash.update(data);
      }
      rows++;
    }
    return { name, rows, sha256: hash.digest('hex') };
  });
  return { format: 1, schema, tables };
}

export function writeInventory(db: DatabaseSync) {
  if (
    !db
      .prepare('PRAGMA table_info(spinel_recovery)')
      .all()
      .some((field) => field.name === 'inventory')
  )
    db.exec('ALTER TABLE spinel_recovery ADD COLUMN inventory TEXT');
  const inventory = recoveryInventory(db);
  db.prepare('UPDATE spinel_recovery SET inventory=? WHERE id=1').run(JSON.stringify(inventory));
  return inventory;
}

export function verifyInventory(db: DatabaseSync, required = true) {
  const has = db
    .prepare('PRAGMA table_info(spinel_recovery)')
    .all()
    .some((field) => field.name === 'inventory');
  const text = has
    ? db.prepare('SELECT inventory FROM spinel_recovery WHERE id=1').get()?.inventory
    : null;
  if (typeof text !== 'string') {
    if (required) throw new Error('This backup predates complete recovery inventory.');
    return undefined;
  }
  if (Buffer.byteLength(text) > 256 * 1024) throw new Error('Recovery inventory is too large.');
  const expected = JSON.parse(text) as RecoveryInventory;
  if (
    !expected ||
    expected.format !== 1 ||
    !/^[a-f0-9]{64}$/.test(expected.schema) ||
    !Array.isArray(expected.tables) ||
    expected.tables.length > MAX_TABLES ||
    expected.tables.some(
      (table) =>
        !table ||
        typeof table.name !== 'string' ||
        !Number.isSafeInteger(table.rows) ||
        table.rows < 0 ||
        !/^[a-f0-9]{64}$/.test(table.sha256),
    )
  )
    throw new Error('Invalid recovery inventory.');
  const actual = recoveryInventory(db);
  if (JSON.stringify(expected) !== JSON.stringify(actual))
    throw new Error('Recovery inventory does not match the restored dataset.');
  return {
    tables: actual.tables.length,
    rows: actual.tables.reduce((sum, table) => sum + table.rows, 0),
  };
}
