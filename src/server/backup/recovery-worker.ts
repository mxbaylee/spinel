import { fork } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecoveryResourceCode, RecoveryResourceError } from './resource-error.ts';

export const RECOVERY_HEADROOM_PREFIX = 'spinel:recovery-memory-headroom ';

/** A child heap cap alone cannot protect a smaller application cgroup. Linux
 * probes are best-effort; missing cgroup files still leave the host check, child
 * RSS watchdog and V8/time bounds in force. Tests supply the kernel file reader. */
export async function checkVerificationHeadroom(
  phase: 'start' | 'running',
  read: (path: string) => Promise<string> = (path) => readFile(path, 'utf8'),
  platform: string = process.platform,
  report: (line: string) => void = (line) => console.error(line),
) {
  if (platform !== 'linux') return;
  const probes = await Promise.allSettled([
    read('/sys/fs/cgroup/memory.max'),
    read('/sys/fs/cgroup/memory.current'),
    read('/proc/meminfo'),
    read('/sys/fs/cgroup/memory.stat'),
  ]);
  const values = probes.map((probe) => (probe.status === 'fulfilled' ? probe.value.trim() : ''));
  const bytes = (text: string) => {
    const value = /^\d+$/.test(text) ? Number(text) : NaN;
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  };
  const maximum = bytes(values[0]),
    used = bytes(values[1]);
  const counters = values[3].split('\n').map((line) => line.trim().split(/\s+/));
  const counter = (name: string) => {
    const matches = counters.filter((fields) => fields[0] === name);
    return matches.length === 1 && matches[0].length === 2 ? bytes(matches[0][1]) : undefined;
  };
  const [file, shared, inactive, dirty, writeback] = [
    'file',
    'shmem',
    'inactive_file',
    'file_dirty',
    'file_writeback',
  ].map(counter);
  let charged = used;
  let reclaimable = 0;
  let cacheCountersValid = false;
  if (
    used !== undefined &&
    file !== undefined &&
    shared !== undefined &&
    inactive !== undefined &&
    dirty !== undefined &&
    writeback !== undefined &&
    file <= used &&
    shared <= file &&
    inactive <= file &&
    dirty <= file &&
    writeback <= file
  ) {
    // memory.current includes the synced upload's disk cache. Credit only clean
    // inactive disk-file pages, never active cache, shared/tmpfs, dirty pages or
    // writeback. Missing, malformed or inconsistent counters retain raw usage.
    // Subtract dirty/writeback conservatively even when those categories overlap.
    cacheCountersValid = true;
    reclaimable = Math.max(0, Math.min(inactive, file - shared) - dirty - writeback);
    charged = used - reclaimable;
  }
  const availableKiB = bytes(/^MemAvailable:\s+(\d+)\s+kB\s*$/m.exec(values[2])?.[1] ?? '');
  const MiB = 1024 ** 2;
  const cgroupRequiredBytes = (phase === 'start' ? 640 : 128) * MiB;
  const hostRequiredKiB = (phase === 'start' ? 768 : 256) * 1024;
  const cgroupRefused =
    maximum !== undefined && charged !== undefined && maximum - charged < cgroupRequiredBytes;
  const hostRefused = availableKiB !== undefined && availableKiB < hostRequiredKiB;
  if (cgroupRefused || hostRefused) {
    // Record the actual decision inputs, never raw kernel text or private paths.
    // Diagnostics cannot change this refusal or the public resource error.
    try {
      report(
        RECOVERY_HEADROOM_PREFIX +
          JSON.stringify({
            version: 1,
            observedAtMs: Date.now(),
            phase,
            probes: probes.map((probe) => probe.status),
            maximumBytes: maximum ?? null,
            usedBytes: used ?? null,
            chargedBytes: charged ?? null,
            fileBytes: file ?? null,
            sharedBytes: shared ?? null,
            inactiveBytes: inactive ?? null,
            dirtyBytes: dirty ?? null,
            writebackBytes: writeback ?? null,
            reclaimableBytes: reclaimable,
            cacheCountersValid,
            availableKiB: availableKiB ?? null,
            cgroupRequiredBytes,
            hostRequiredKiB,
            cgroupRefused,
            hostRefused,
          }),
      );
    } catch {
      // A failed diagnostic sink must not replace or suppress the memory guard.
    }
    throw new RecoveryResourceError('memory-headroom');
  }
}

/** Shared isolated runner. Only internal callers supply the fixed protocol and
 * result validator; no request controls code, module paths or process arguments. */
export async function runRecoveryWorker<T>(options: {
  directory: string;
  reads?: string[];
  input: Record<string, unknown>;
  timeoutMs: number;
  signal?: AbortSignal;
  validate(value: unknown): value is T;
}): Promise<T> {
  const deadline = Date.now() + options.timeoutMs;
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const directory = options.directory;
  const reads = new Set([
    join(root, 'server'),
    join(root, 'src'),
    join(root, 'lib'),
    join(root, 'package.json'),
    join(root, 'node_modules'),
    await realpath(join(root, 'node_modules')),
    directory,
    ...(options.reads ?? []),
  ]);
  for (const name of [
    '@spinel/sync-server',
    '@spinel/sync-transform',
    '@spinel/doc-formulas',
    '@spinel/diagnostics',
  ])
    reads.add(dirname(fileURLToPath(import.meta.resolve(name))));
  options.signal?.throwIfAborted();
  const timeoutMs = Math.max(1, deadline - Date.now());
  return new Promise<T>((resolveResult, reject) => {
    let result: T | undefined;
    let failure: Error | undefined;
    const deadline = Date.now() + timeoutMs;
    const child = fork(new URL('./verification-worker.ts', import.meta.url), [], {
      cwd: directory,
      env: {
        TZ: 'Etc/UTC',
        TMPDIR: directory,
        ...(process.env.SPINEL_PROCESS_GROUP_TOKEN && {
          SPINEL_PROCESS_GROUP_TOKEN: process.env.SPINEL_PROCESS_GROUP_TOKEN,
        }),
      },
      // Native SQLite/sharp require trusted addons. Archive data never supplies
      // code, module paths, output paths or process commands. Network is denied.
      execArgv: [
        '--max-old-space-size=256',
        '--max-semi-space-size=8',
        `--process-timeout=${Math.max(1, Math.ceil(timeoutMs / 1000))}s`,
        '--permission',
        '--allow-addons',
        ...[...reads].map((path) => `--allow-fs-read=${path}`),
        `--allow-fs-write=${directory}`,
      ],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    const stop = (error: Error) => {
      failure ??= error;
      child.kill('SIGKILL');
    };
    const abort = () => stop(new Error('Recovery verification was cancelled.'));
    options.signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => stop(new RecoveryResourceError('time-limit')), timeoutMs);
    let sampling = false;
    const memory = setInterval(async () => {
      if (sampling || !child.pid || process.platform !== 'linux') return;
      sampling = true;
      try {
        const [usage, headroom] = await Promise.allSettled([
          readFile(`/proc/${child.pid}/status`, 'utf8'),
          checkVerificationHeadroom('running'),
        ]);
        if (usage.status === 'fulfilled') {
          const rss = Number(/^VmRSS:\s+(\d+)/m.exec(usage.value)?.[1] ?? 0);
          if (rss > 512 * 1024) stop(new RecoveryResourceError('memory-limit'));
        } // A missing PID can race normal exit; success still requires its IPC result.
        if (headroom.status === 'rejected') stop(new RecoveryResourceError('memory-headroom'));
      } finally {
        sampling = false;
      }
    }, 100);
    child.on('message', (message: unknown) => {
      const value = message as {
        ok?: unknown;
        result?: unknown;
        resourceCode?: unknown;
      };
      if (value?.ok === false && isRecoveryResourceCode(value.resourceCode)) {
        stop(new RecoveryResourceError(value.resourceCode));
        return;
      }
      if (value?.ok !== true || !options.validate(value.result)) {
        stop(
          new Error(
            'Recovery verification failed. Check the backup, recovery key and compatible application version.',
          ),
        );
      } else result = value.result;
    });
    child.once('error', () => stop(new Error('Recovery verification could not start.')));
    child.once('close', (code) => {
      clearInterval(memory);
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
      if (!failure && code === 0 && result) resolveResult(result);
      else
        reject(
          failure ??
            (Date.now() >= deadline
              ? new RecoveryResourceError('time-limit')
              : new Error('Recovery verification was interrupted or failed.')),
        );
    });
    child.send(
      {
        ...options.input,
        directory: resolve(directory),
      },
      (error) => {
        if (error) stop(new Error('Recovery verification could not start.'));
      },
    );
    if (options.signal?.aborted) abort();
  });
}
