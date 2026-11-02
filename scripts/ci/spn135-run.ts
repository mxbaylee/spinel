// One declared hosted attempt, with process inventory restricted to our runtime cwd.
import { readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

if (process.platform !== 'linux') throw new Error('This diagnostic wrapper requires hosted Linux');
const root = resolve(process.argv[2]);
function ownedProcesses() {
  return readdirSync('/proc')
    .filter((name) => /^\d+$/.test(name))
    .flatMap((name) => {
      try {
        const cwd = readlinkSync(`/proc/${name}/cwd`);
        if (cwd !== root && !cwd.startsWith(root + '/')) return [];
        return [
          {
            pid: Number(name),
            cwd,
            command: readFileSync(`/proc/${name}/cmdline`, 'utf8').replaceAll('\0', ' '),
          },
        ];
      } catch {
        return [];
      }
    });
}
const before = ownedProcesses();
if (before.length) throw new Error('Unexpected runtime-owned processes before diagnostic');
const startedAt = new Date().toISOString();
const child = spawn(
  'npx',
  [
    'playwright',
    'test',
    '--project=doc-responsiveness',
    'e2e/doc-responsiveness.spec.ts',
    '--grep',
    'desktop sustained native typing profile$',
    '--workers=1',
    '--retries=0',
  ],
  { cwd: root, stdio: 'inherit', detached: true },
);
let timedOut = false;
let killTimer: ReturnType<typeof setTimeout> | undefined;
const terminate = (signal: NodeJS.Signals) => {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {}
};
const timer = setTimeout(() => {
  timedOut = true;
  terminate('SIGTERM');
  killTimer = setTimeout(() => terminate('SIGKILL'), 5000);
}, 360000);
const result = await new Promise<{ code?: number | null; signal?: string | null; error?: string }>(
  (done) => {
    child.once('error', (error) => done({ error: String(error) }));
    child.once('close', (code, signal) => done({ code, signal }));
  },
);
clearTimeout(timer);
clearTimeout(killTimer);
const after = ownedProcesses();
// A leftover is a diagnostic failure even if bounded cleanup succeeds.
for (const entry of after) {
  try {
    process.kill(entry.pid, 'SIGTERM');
  } catch {}
}
if (after.length) await delay(5000);
const remaining = ownedProcesses();
for (const entry of remaining) {
  try {
    process.kill(entry.pid, 'SIGKILL');
  } catch {}
}
if (remaining.length) await delay(250);
const final = ownedProcesses();
writeFileSync(
  resolve(root, 'spn135-process-cleanup.json'),
  JSON.stringify(
    {
      startedAt,
      finishedAt: new Date().toISOString(),
      before,
      result,
      timedOut,
      after,
      remaining,
      final,
      scope:
        'Processes whose cwd is the exact owned runtime checkout or a descendant; not system-wide absence',
    },
    null,
    2,
  ),
);
process.exitCode =
  result.code === 0 && !timedOut && after.length === 0 && final.length === 0 ? 0 : 1;
