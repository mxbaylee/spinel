// Runs one local test workload at a time across agents, as docs/run-backlog.md
// asks on the 8 GiB development Mac: it waits for any other run, refuses to
// start under memory pressure, and kills a run that holds the lock too long.
// Usage, from the repo root:
//   node scripts/serial.ts npx vitest run lib/sync-transform/tests/cells.test.ts
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';

// A fixed path, not the per-user temp dir, so every agent and terminal shares it.
const lock = '/tmp/spinel-test.lock';
// Who holds the lock: this runner's pid, then its run's process group.
const owner = `${lock}/pid`;
// Held only while breaking a stale lock, so two waiters cannot both break it.
const breaker = `${lock}.break`;
// No run may hold the lock longer than CI's unit-test job would allow.
const limit = 8 * 60 * 1000;
// A lock older than this outlived any run, even one whose pid was reused.
const expired = limit + 60 * 1000;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const age = (path: string) => {
  try {
    return Date.now() - statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
};
const holder = () => {
  try {
    return readFileSync(owner, 'utf8').split(' ').map(Number);
  } catch {
    return undefined;
  }
};
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
};
// Only the runner that holds the lock removes it.
const release = () => {
  if (holder()?.[0] === process.pid) rmSync(lock, { recursive: true, force: true });
};

// A lock is stale once its runner is gone, so a crashed or killed runner
// cannot block every later run. A run its runner left behind still holds the
// lock until the limit, then is killed, since nothing else would stop it.
// Past `expired` its group id may name another process by now, so the lock is
// broken and nothing is killed.
const stale = () => {
  const held = age(lock);
  if (held === undefined) return false;
  if (held > expired) return true;
  const pids = holder();
  // No owner yet: a runner between taking the lock and naming itself.
  if (!pids) return false;
  const [runner, group] = pids;
  if (alive(runner)) return false;
  if (group && alive(-group)) {
    if (held <= limit) return false;
    try {
      process.kill(-group, 'SIGKILL');
    } catch {}
    // Signal delivery is asynchronous. Keep the lock until a later check
    // observes that the abandoned run has gone, including its workers.
    return false;
  }
  return true;
};

// Breaks a stale lock and takes it, under the breaker so that a second waiter
// re-checks after the first has re-taken the lock rather than removing it.
const takeStale = () => {
  try {
    mkdirSync(breaker);
  } catch {
    // A breaker that crashed mid-break leaves this behind; it takes milliseconds.
    if ((age(breaker) ?? 0) > 30 * 1000) rmSync(breaker, { recursive: true, force: true });
    return false;
  }
  try {
    if (!stale()) return false;
    console.error(`serial: breaking a stale lock (${lock}).`);
    rmSync(lock, { recursive: true, force: true });
    mkdirSync(lock);
    return true;
  } catch {
    return false;
  } finally {
    rmSync(breaker, { recursive: true, force: true });
  }
};

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('usage: node scripts/serial.ts <command> [args…]');
  process.exit(64);
}

for (let tries = 0; ; tries++) {
  let taken = false;
  try {
    mkdirSync(lock);
    taken = true;
  } catch {
    taken = takeStale();
  }
  if (taken) {
    writeFileSync(owner, `${process.pid}`);
    break;
  }
  if (tries % 15 === 0) console.error(`serial: waiting for another run (${lock})…`);
  await wait(2000);
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
if (child.pid) writeFileSync(owner, `${process.pid} ${child.pid}`);
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
// A command that cannot start, such as a mistyped one.
child.on('error', (error) => {
  clearTimeout(timer);
  release();
  console.error(`serial: ${error.message}`);
  process.exit(127);
});
child.on('exit', (code) => {
  clearTimeout(timer);
  release();
  process.exit(code ?? 1);
});
