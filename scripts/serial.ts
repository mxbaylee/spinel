// Runs one local test workload at a time across agents, as docs/run-backlog.md
// asks on the 8 GiB development Mac: it waits for any other run, refuses to
// start under memory pressure, and kills a run that holds the lock too long.
// Usage, from the repo root:
//   node scripts/serial.ts npx vitest run lib/sync-transform/tests/cells.test.ts
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, rmdirSync } from 'node:fs';

// A fixed path, not the per-user temp dir, so every agent and terminal shares it.
const lock = '/tmp/spinel-test.lock';
// No run may hold the lock longer than CI's unit-test job would allow.
const limit = 8 * 60 * 1000;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const release = () => {
  try {
    rmdirSync(lock);
  } catch {}
};

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('usage: node scripts/serial.ts <command> [args…]');
  process.exit(64);
}

for (let tries = 0; ; tries++) {
  try {
    mkdirSync(lock);
    break;
  } catch {
    if (tries % 15 === 0) console.error(`serial: waiting for another run (${lock})…`);
    await wait(2000);
  }
}

// macOS reports 1 when memory pressure is normal. Elsewhere there is no such
// level, so the check is skipped.
if (process.platform === 'darwin') {
  const pressure = execFileSync('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'])
    .toString()
    .trim();
  if (pressure !== '1') {
    release();
    console.error(`serial: memory pressure level ${pressure} (not normal); not running.`);
    process.exit(75);
  }
}

// Its own process group, so a kill reaches vitest's workers, not just npx.
const child = spawn(command, args, { stdio: 'inherit', detached: true });
const stop = (reason: string) => {
  console.error(`serial: ${reason}; killing the run.`);
  try {
    process.kill(-child.pid!, 'SIGKILL');
  } catch {}
};
const timer = setTimeout(() => stop('over the 8 min limit'), limit);
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
  process.on(signal, () => stop(signal));
}
child.on('exit', (code) => {
  clearTimeout(timer);
  release();
  process.exit(code ?? 1);
});
