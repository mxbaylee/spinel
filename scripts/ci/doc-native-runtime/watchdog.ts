import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export interface ProcessIdentity {
  pid: number;
  parent: number;
  start: string;
  rssKiB: number;
}
export function owned(rows: ProcessIdentity[], root: number, known: Map<number, ProcessIdentity>) {
  const selected = new Set(
    rows
      .filter((row) => row.pid === root || known.get(row.pid)?.start === row.start)
      .map((row) => row.pid),
  );
  for (let size = -1; size !== selected.size;) {
    size = selected.size;
    for (const row of rows) if (selected.has(row.parent)) selected.add(row.pid);
  }
  const result = rows.filter((row) => selected.has(row.pid));
  for (const row of result) known.set(row.pid, row);
  return result;
}
export function resourceFailure(
  state: { elapsedMs: number; rssKiB: number; availableKiB: number },
  mode: 'component' | 'application-window' = 'component',
) {
  if (mode !== 'component' && mode !== 'application-window') return 'Unknown resource mode';
  if (![state.elapsedMs, state.rssKiB, state.availableKiB].every(Number.isFinite))
    return 'Missing resource observation';
  const deadline = mode === 'component' ? 60_000 : 450_000;
  if (state.elapsedMs >= deadline) return `Total phase exceeded${deadline / 1000}seconds`;
  if (state.rssKiB > 2 * 1024 ** 2) return 'Owned RSS exceeded2GiB';
  if (state.availableKiB < 1024 ** 2) return 'Host MemAvailable below1GiB';
  return null;
}
function inventory() {
  const rows: ProcessIdentity[] = [];
  for (const directory of readdirSync('/proc'))
    if (/^\d+$/.test(directory)) {
      try {
        const raw = readFileSync(`/proc/${directory}/stat`, 'utf8'),
          fields = raw.slice(raw.lastIndexOf(')') + 2).split(' ');
        const status = readFileSync(`/proc/${directory}/status`, 'utf8');
        rows.push({
          pid: Number(directory),
          parent: Number(fields[1]),
          start: fields[19]!,
          rssKiB: Number(status.match(/^VmRSS:\s+(\d+) kB$/m)?.[1] ?? 0),
        });
      } catch (error) {
        if (!['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      }
    }
  return rows;
}
async function run() {
  if (process.platform !== 'linux')
    throw new Error('This watchdog is for the declared Linux lane only.');
  const argv = process.argv.slice(2);
  const mode = argv[0] === '--application-window' ? 'application-window' : 'component';
  if (mode === 'application-window') argv.shift();
  const [destination, command, ...args] = argv;
  if (!destination || !command) throw new Error('Receipt and command required');
  const start = performance.now(),
    known = new Map<number, ProcessIdentity>();
  let peakKiB = 0,
    failure: string | null = null;
  const snapshot = (outcome: string) => {
    const live = owned(inventory(), process.pid, known),
      rssKiB = live.reduce((sum, row) => sum + row.rssKiB, 0);
    peakKiB = Math.max(peakKiB, rssKiB);
    const availableKiB = Number(
      readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+) kB$/m)?.[1],
    );
    const receipt = {
      mode,
      outcome,
      elapsedMs: performance.now() - start,
      rssKiB,
      peakKiB,
      availableKiB,
      known: [...known.values()],
      live,
      failure,
    };
    writeFileSync(destination + '.tmp', JSON.stringify(receipt, null, 2) + '\n');
    renameSync(destination + '.tmp', destination);
    return receipt;
  };
  const initial = snapshot('ready');
  failure = resourceFailure(initial, mode);
  if (failure) {
    snapshot('preflight-failed');
    throw new Error(failure);
  }
  const child = spawn(command, args, { stdio: 'inherit' });
  const signalOwned = () => {
    const live = owned(inventory(), process.pid, known).filter((row) => row.pid !== process.pid);
    for (const row of live.toReversed()) {
      if (inventory().some((current) => current.pid === row.pid && current.start === row.start))
        try {
          process.kill(row.pid, 'SIGKILL');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
        }
    }
  };
  const monitor = setInterval(() => {
    try {
      const state = snapshot('running');
      const violation = resourceFailure(state, mode);
      if (violation) {
        failure ??= violation;
        snapshot('resource-aborted');
        signalOwned();
      }
    } catch (error) {
      failure ??= String(error);
      signalOwned();
    }
  }, 100);
  const result = await new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.once('error', (error) => {
      failure ??= String(error);
    });
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  clearInterval(monitor);
  const live = owned(inventory(), process.pid, known).filter((row) => row.pid !== process.pid);
  if (live.length) {
    failure ??= 'Owned processes remained after child close';
    signalOwned();
  }
  const final = snapshot('checking-final');
  failure ??= resourceFailure(final, mode);
  // Final disposition uses exactly the resource observation just checked.
  writeFileSync(
    destination + '.tmp',
    JSON.stringify(
      {
        ...final,
        outcome: failure || result.code !== 0 || result.signal ? 'failed' : 'passed',
        failure,
      },
      null,
      2,
    ) + '\n',
  );
  renameSync(destination + '.tmp', destination);
  // One short reap check after signals, never a renewed execution allowance.
  if (failure) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    snapshot('failed');
  }
  console.log(JSON.stringify({ result, failure, elapsedMs: final.elapsedMs, peakKiB }));
  if (failure || result.code !== 0 || result.signal) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
