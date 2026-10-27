import { fork } from 'node:child_process';
import { chmod, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecoveryResourceCode, RecoveryResourceError } from './resource-error.ts';

export interface VerificationResult {
  tables: number;
  rows: number;
  snapshots: number;
  images: number;
  keyId?: string;
}
export interface VerificationOptions {
  archive: string;
  keyFile: string;
  stagingRoot: string;
  expectedOrigin: string;
  expectedImage?: string;
  maxDatabaseBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** A child heap cap alone cannot protect a smaller application cgroup. Linux
 * probes are best-effort; missing cgroup files still leave the host check, child
 * RSS watchdog and V8/time bounds in force. Tests supply the kernel file reader. */
export async function checkVerificationHeadroom(
  phase: 'start' | 'running',
  read: (path: string) => Promise<string> = (path) => readFile(path, 'utf8'),
  platform: string = process.platform,
) {
  if (platform !== 'linux') return;
  const probes = await Promise.allSettled([
    read('/sys/fs/cgroup/memory.max'),
    read('/sys/fs/cgroup/memory.current'),
    read('/proc/meminfo'),
  ]);
  const values = probes.map((probe) => (probe.status === 'fulfilled' ? probe.value.trim() : ''));
  const bytes = (text: string) => {
    const value = /^\d+$/.test(text) ? Number(text) : NaN;
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  };
  const maximum = bytes(values[0]),
    used = bytes(values[1]);
  const availableKiB = bytes(/^MemAvailable:\s+(\d+)\s+kB\s*$/m.exec(values[2])?.[1] ?? '');
  const MiB = 1024 ** 2;
  if (
    (maximum !== undefined &&
      used !== undefined &&
      maximum - used < (phase === 'start' ? 640 : 128) * MiB) ||
    (availableKiB !== undefined && availableKiB * 1024 < (phase === 'start' ? 768 : 256) * MiB)
  )
    throw new RecoveryResourceError('memory-headroom');
}

/** The parent owns cleanup even if the worker is killed. The worker receives
 * paths by IPC, never secret bytes or user content on the command line. */
export async function verifyArchive(options: VerificationOptions): Promise<VerificationResult> {
  options.signal?.throwIfAborted();
  await checkVerificationHeadroom('start');
  const directory = await mkdtemp(join(options.stagingRoot, '.verify-'));
  try {
    await chmod(directory, 0o700);
    const archive = await realpath(options.archive);
    // Keep the configured final component so readKey's O_NOFOLLOW boundary is
    // still effective; canonicalization here must not turn a symlink into a key.
    const keyFile = resolve(options.keyFile);
    const archiveInfo = await stat(archive);
    if (!archiveInfo.isFile()) throw new Error('Recovery archive must be a regular file.');
    if (archiveInfo.size > 5 * 1024 ** 3) throw new RecoveryResourceError('archive-size');
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const reads = new Set([
      join(root, 'server'),
      join(root, 'src'),
      join(root, 'lib'),
      join(root, 'package.json'),
      join(root, 'node_modules'),
      await realpath(join(root, 'node_modules')),
      directory,
      archive,
      keyFile,
      await realpath(keyFile),
    ]);
    for (const name of [
      '@spinel/sync-server',
      '@spinel/sync-transform',
      '@spinel/doc-formulas',
      '@spinel/diagnostics',
    ])
      reads.add(dirname(fileURLToPath(import.meta.resolve(name))));
    const timeoutMs = options.timeoutMs ?? 120_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10 * 60_000)
      throw new Error('Invalid recovery verification time limit.');
    return await new Promise<VerificationResult>((resolveResult, reject) => {
      let result: VerificationResult | undefined;
      let failure: Error | undefined;
      const deadline = Date.now() + timeoutMs;
      const child = fork(new URL('./verification-worker.ts', import.meta.url), [], {
        cwd: directory,
        env: { TZ: 'Etc/UTC', TMPDIR: directory },
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
          result?: VerificationResult;
          resourceCode?: unknown;
        };
        if (value?.ok === false && isRecoveryResourceCode(value.resourceCode)) {
          stop(new RecoveryResourceError(value.resourceCode));
          return;
        }
        if (
          value?.ok !== true ||
          !value.result ||
          !['tables', 'rows', 'snapshots', 'images'].every((key) => {
            const count = value.result![key as keyof VerificationResult];
            return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0;
          }) ||
          (value.result.keyId !== undefined && !/^[a-zA-Z0-9_-]{1,80}$/.test(value.result.keyId))
        ) {
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
          archive,
          keyFile,
          directory: resolve(directory),
          expectedOrigin: options.expectedOrigin,
          expectedImage: options.expectedImage,
          maxDatabaseBytes: options.maxDatabaseBytes,
        },
        (error) => {
          if (error) stop(new Error('Recovery verification could not start.'));
        },
      );
      if (options.signal?.aborted) abort();
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
