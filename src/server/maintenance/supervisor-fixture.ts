/** Test-only crash barrier around the real controller and real SQLite app child. */
import { fork } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MaintenanceSupervisor } from './supervisor.ts';
import type { MaintenancePhase } from '../../shared/maintenance.ts';
if (!process.send || !process.env.SPINEL_MAINTENANCE_ROOT || !process.env.DATABASE_PATH)
  throw new Error('Private supervisor fixture required.');
let barrier: MaintenancePhase | null = null;
let restoreBarrier: 'requested' | 'persisted' | null = null;
const supervisor: MaintenanceSupervisor = await MaintenanceSupervisor.open({
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
    if (
      restoreBarrier &&
      status.phase === 'stopping' &&
      supervisor.journal.state.restoreStop &&
      !!supervisor.journal.state.restoreStop.fingerprint === (restoreBarrier === 'persisted')
    ) {
      const reached = restoreBarrier;
      restoreBarrier = null;
      if (!process.env.SPINEL_TEST_RESTORE_BARRIER_FILE) throw new Error('Missing crash marker.');
      writeFileSync(process.env.SPINEL_TEST_RESTORE_BARRIER_FILE, reached, {
        flag: 'wx',
        mode: 0o600,
      });
      // No return or exception crosses production control flow before SIGKILL:
      // the persisted stopping state cannot advance, ACK or enter cleanup.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    }
    if (barrier === status.phase) {
      process.send!({ barrier: status.phase }, () => {
        // A real SIGKILL skips every controller cleanup path at the durable boundary.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      });
    }
  },
});
process.on('message', (value: unknown) => {
  if (value && typeof value === 'object' && 'restoreBarrier' in value) {
    restoreBarrier = value.restoreBarrier as 'requested' | 'persisted';
    process.send!({ restoreArmed: restoreBarrier });
  } else if (value && typeof value === 'object' && 'restore' in value) {
    void supervisor.stopForRestore(String(value.restore)).then(
      () => process.send?.({ restoreFinished: true }),
      () => process.send?.({ restoreFinished: false }),
    );
  }
  if (value && typeof value === 'object' && 'barrier' in value) {
    barrier = value.barrier as MaintenancePhase;
    process.send!({ armed: barrier });
  }
});
process.send({ ready: true, port: supervisor.publicAddress().port });
process.on('SIGTERM', () => {
  void supervisor.close().then(() => process.disconnect?.());
});
