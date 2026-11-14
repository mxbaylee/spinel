// Disposable native-process regression for the production recovery RSS ceiling.
import { join } from 'node:path';
import { DatabaseSync } from '../../../server/database.ts';
import { recoveryInventory } from './inventory.ts';
const db = new DatabaseSync(join(process.argv[2], 'payload.sqlite'));
try {
  db.exec('CREATE TABLE payload (id INTEGER PRIMARY KEY, data BLOB)');
  const insert = db.prepare('INSERT INTO payload VALUES(?,zeroblob(4194304))');
  for (let id = 0; id < 128; id++) insert.run(id);
  const inventory = recoveryInventory(db);
  console.log(
    JSON.stringify({ rows: inventory.tables[0].rows, peakKiB: process.resourceUsage().maxRSS }),
  );
} finally {
  db.close();
}
