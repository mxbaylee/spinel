import { workerData } from 'node:worker_threads';
import { chmodSync } from 'node:fs';
import { DatabaseSync, backup } from '../../../server/database.ts';

// Only the parent creates these paths, below its protected diagnostics directory.
const { source, destination } = workerData as { source: string; destination: string };
const database = new DatabaseSync(source);
try {
  database.exec('PRAGMA cache_size = -1024; PRAGMA temp_store = FILE;');
  await backup(database, destination);
  chmodSync(destination, 0o600);
} finally {
  database.close();
}
