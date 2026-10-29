import { resolve } from 'node:path';
import { MaintenanceSupervisor } from '../src/server/maintenance/supervisor.ts';

const root = process.env.SPINEL_MAINTENANCE_ROOT;
if (!root)
  throw new Error(
    'Set SPINEL_MAINTENANCE_ROOT to an existing private directory outside workspace and diagnostics storage.',
  );
const publicPort = Number(process.env.SPINEL_MAINTENANCE_PORT ?? 3002);
if (!Number.isInteger(publicPort) || publicPort < 0 || publicPort > 65535)
  throw new Error('SPINEL_MAINTENANCE_PORT must be a valid loopback port.');
const supervisor = await MaintenanceSupervisor.open({
  root,
  databasePath: resolve(process.env.DATABASE_PATH ?? 'data/spinel.sqlite'),
  publicPort,
  development: process.argv.includes('--dev'),
});
console.log(
  `Spinel recovery control is available on 127.0.0.1:${supervisor.publicAddress().port}.`,
);
console.log('Use the recovery CLI to verify, start under maintenance, and resume the workspace.');
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  try {
    await supervisor.close();
  } catch {
    console.error(
      'Recovery control could not prove complete shutdown. Maintenance remains required.',
    );
    process.exitCode = 1;
  }
}
process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
