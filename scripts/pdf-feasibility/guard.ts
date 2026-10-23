import { spawn, execFileSync } from 'node:child_process';
const pressure = () =>
  Number(
    execFileSync('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], {
      encoding: 'utf8',
    }).trim(),
  );
if (pressure() !== 1) {
  console.error('DEFERRED: macOS memory pressure is not normal.');
  process.exit(75);
}
const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error('Supply a command');
const child = spawn(command, args, { stdio: 'inherit', detached: true });
let peak = 0;
let aborted = false;
const timer = setInterval(() => {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,pgid='], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number));
  const pids = new Set([child.pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, parent] of rows)
      if (pids.has(parent) && !pids.has(pid)) {
        pids.add(pid);
        changed = true;
      }
  }
  const rss = rows.filter(([pid]) => pids.has(pid)).reduce((total, row) => total + row[2], 0);
  peak = Math.max(peak, rss);
  if (!aborted && (rss > 2 * 1024 * 1024 || pressure() !== 1)) {
    aborted = true;
    console.error(
      `RESOURCE ABORT: workload RSS ${(rss / 1024).toFixed(1)} MiB or elevated memory pressure`,
    );
    const groups = new Set([
      child.pid!,
      ...rows.filter(([pid, , , group]) => pids.has(pid) && pid === group).map((row) => row[3]),
    ]);
    for (const group of groups) {
      try {
        process.kill(-group, 'SIGTERM');
      } catch {}
    }
    setTimeout(() => {
      for (const group of groups) {
        try {
          process.kill(-group, 'SIGKILL');
        } catch {}
      }
    }, 1500);
  }
}, 300);
child.on('error', (error) => {
  clearInterval(timer);
  console.error(error);
  process.exitCode = 1;
});
child.on('close', (code) => {
  clearInterval(timer);
  console.error(
    `Guard: peak process-tree RSS ${(peak / 1024).toFixed(1)} MiB; ${aborted ? 'aborted' : 'completed'}`,
  );
  process.exitCode = aborted ? 75 : (code ?? 1);
});
