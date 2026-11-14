// Test-only observer for synthetic native/application fixtures, never proprietary
// SDK storage. A separate process exits before the preservation action so no
// observer statement or connection can hide the last-close lifecycle under test.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from '../../server/database.ts';

const [path, output] = process.argv.slice(2);
if (!path || !output) throw new Error('Provide the synthetic fixture and output paths.');
const location = pathToFileURL(path);
location.searchParams.set('mode', 'ro');
// Enforce read-only independently of the adapter option being regression-tested.
const db = new DatabaseSync(location.href);
try {
  const schema = db
    .prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name')
    .all();
  const tables = Object.fromEntries(
    schema
      .filter((row) => row.type === 'table')
      .map((row) => [
        row.name,
        db
          .prepare(`SELECT * FROM "${String(row.name).replaceAll('"', '""')}"`)
          .all()
          .map((record) =>
            JSON.stringify(record, (_, value) =>
              typeof value === 'bigint' ? { bigint: String(value) } : value,
            ),
          )
          .sort(),
      ]),
  );
  writeFileSync(output, JSON.stringify({ schema, tables }), { mode: 0o600 });
} finally {
  db.close();
}
