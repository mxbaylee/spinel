/** Test-only crash barrier around the real controller and real SQLite app child. */
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MaintenanceSupervisor } from './supervisor.ts';
import type { MaintenancePhase } from '../../shared/maintenance.ts';
if (!process.send || !process.env.SPINEL_MAINTENANCE_ROOT || !process.env.DATABASE_PATH)
  throw new Error('Private supervisor fixture required.');
let barrier: MaintenancePhase | null = null;
const supervisor = await MaintenanceSupervisor.open({
  root: process.env.SPINEL_MAINTENANCE_ROOT,
  databasePath: process.env.DATABASE_PATH,
  publicPort: 0,
  budgets: { drainMs: 2000, stopMs: 500, startMs: 5000, verifyMs: 5000 },
  createChild: (groupToken) =>
    fork(fileURLToPath(new URL('./app-fixture.ts', import.meta.url)), [], {
      env: { ...process.env, SPINEL_SUPERVISED: '1', SPINEL_PROCESS_GROUP_TOKEN: groupToken },
      execArgv: [],
      detached: true,
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    }),
  onTransition(status) {
    if (barrier === status.phase) {
      process.send!({ barrier: status.phase }, () => {
        // A real SIGKILL skips every controller cleanup path at the durable boundary.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      });
    }
  },
});
process.on('message', (value: unknown) => {
  if (value && typeof value === 'object' && 'barrier' in value) {
    barrier = value.barrier as MaintenancePhase;
    process.send!({ armed: barrier });
  }
});
process.send({ ready: true, port: supervisor.publicAddress().port });
process.on('SIGTERM', () => {
  void supervisor.close().then(() => process.disconnect?.());
});
