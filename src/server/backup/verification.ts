import { fork } from 'node:child_process';
import { chmod, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** The parent owns cleanup even if the worker is killed. The worker receives
 * paths by IPC, never secret bytes or user content on the command line. */
export async function verifyArchive(options: VerificationOptions): Promise<VerificationResult> {
  options.signal?.throwIfAborted();
  const directory = await mkdtemp(join(options.stagingRoot, '.verify-'));
  await chmod(directory, 0o700);
  try {
    const archive = await realpath(options.archive);
    const keyFile = await realpath(options.keyFile);
    const archiveInfo = await stat(archive);
    if (!archiveInfo.isFile() || archiveInfo.size > 5 * 1024 ** 3)
      throw new Error('Backup exceeds the verification archive limit.');
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
      const stop = (message: string) => {
        failure ??= new Error(message);
        child.kill('SIGKILL');
      };
      const abort = () => stop('Recovery verification was cancelled.');
      options.signal?.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(
        () => stop('Recovery verification exceeded its time limit.'),
        timeoutMs,
      );
      let sampling = false;
      const memory = setInterval(async () => {
        if (sampling || !child.pid || process.platform !== 'linux') return;
        sampling = true;
        try {
          const status = await readFile(`/proc/${child.pid}/status`, 'utf8');
          const rss = Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0);
          if (rss > 512 * 1024) stop('Recovery verification exceeded its memory limit.');
        } catch {
          // Exit may race the sample; the exit handler still requires success.
        } finally {
          sampling = false;
        }
      }, 100);
      child.on('message', (message: unknown) => {
        const value = message as { ok?: unknown; result?: VerificationResult };
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
            'Recovery verification failed. Check the backup, recovery key and compatible application version.',
          );
        } else result = value.result;
      });
      child.once('error', () => stop('Recovery verification could not start.'));
      child.once('close', (code) => {
        clearInterval(memory);
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort', abort);
        if (!failure && code === 0 && result) resolveResult(result);
        else reject(failure ?? new Error('Recovery verification was interrupted or failed.'));
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
          if (error) stop('Recovery verification could not start.');
        },
      );
      if (options.signal?.aborted) abort();
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
