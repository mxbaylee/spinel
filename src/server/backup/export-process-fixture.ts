// Real process fixture for SIGKILL/restart acceptance. Never loaded by the server.
import { setTimeout } from 'node:timers/promises';
import { openDatabase } from '../../../server/database.ts';
import { BackupService } from './service.ts';

const [databasePath, configPath] = process.argv.slice(2);
if (!databasePath || !configPath || !process.send)
  throw new Error('Fixture arguments are required.');
const db = openDatabase(databasePath);
const service = new BackupService(db, {
  databasePath,
  configPath,
  origin: 'https://spinel.example',
  image: `sha256:${'a'.repeat(64)}`,
});
await service.exports.create('fixture-session');
let job = await service.exports.current('fixture-session');
while (job?.state === 'preparing') {
  await setTimeout(10);
  job = await service.exports.current('fixture-session');
}
process.send({ state: job?.state });
// The test deliberately kills this process without running any finally cleanup.
setInterval(() => {}, 1_000);
