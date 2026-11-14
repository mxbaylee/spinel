import type { ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';

const tailLimit = 16_384;
const readyBudget = 30_000;
const closeBudget = 5_000;

export type AppProcessEvidence = {
  pid: number | null;
  ready: boolean;
  expectedClose: boolean;
  exited: boolean;
  unexpectedExit: boolean;
  closed: boolean;
  firstFailure: string | null;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: { bytes: number; tail: string };
  stderr: { bytes: number; tail: string };
};

export class AppProcessError extends Error {
  private readonly snapshot: () => AppProcessEvidence;

  constructor(message: string, snapshot: () => AppProcessEvidence, cause?: unknown) {
    super(message, { cause });
    this.name = 'AppProcessError';
    this.snapshot = snapshot;
  }

  // Startup rejection may be inspected after cleanup. Include that final state,
  // rather than freezing a misleading still-running snapshot in the error.
  get evidence() {
    return this.snapshot();
  }
}

export type OwnedAppProcess = {
  close: () => Promise<void>;
  assertHealthy: () => void;
  evidence: () => AppProcessEvidence;
  finished: Promise<void>;
  /** Resolves, never rejects unattended, on the first unexpected process failure. */
  failure: Promise<AppProcessError>;
};

const safeCodes = [
  'EADDRINUSE',
  'EADDRNOTAVAIL',
  'EACCES',
  'EPERM',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ENOMEM',
  'ENOENT',
  'EIO',
  'ETIMEDOUT',
  'ERR_SERVER_NOT_RUNNING',
  'ERR_STREAM_PREMATURE_CLOSE',
  'ERR_HTTP_HEADERS_SENT',
  'ERR_WORKER_OUT_OF_MEMORY',
  'ERR_INVALID_ARG_TYPE',
  'ERR_ASSERTION',
  'ERR_MODULE_NOT_FOUND',
  'SQLITE_BUSY',
  'SQLITE_LOCKED',
  'SQLITE_CORRUPT',
  'SQLITE_IOERR',
] as const;
const safeHeadlines = [
  'Lazy deopt after a fast API call with return value is unsupported',
  'JavaScript heap out of memory',
  'Reached heap limit',
  'Allocation failed',
] as const;
const safeNodeFrames = new Set([
  'node:buffer',
  'node:net',
  'node:events',
  'node:_http_outgoing',
  'node:_http_server',
  'node:internal/streams/writable',
  'node:internal/streams/readable',
  'node:internal/process/task_queues',
  'node:internal/process/execution',
  'node:internal/child_process',
  'node:internal/errors',
]);

function publicTail(buffer: Buffer, readinessBanner: string) {
  // A raw server line can contain cookies, request bodies or document text.
  // Publish only known diagnostic tokens and Node's own source locations. The
  // bounded private tail is still drained after readiness; arbitrary text is
  // never copied into an exception or an artifact.
  return buffer
    .toString('utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const diagnostics: string[] = [];
      if (line === readinessBanner) diagnostics.push('[ready]');
      for (const headline of safeHeadlines) if (line.includes(headline)) diagnostics.push(headline);
      for (const code of safeCodes)
        if (new RegExp(`\\b${code}\\b`).test(line)) diagnostics.push(code);
      const errorName = line.match(/^\s*(Error|TypeError|RangeError|SyntaxError|AssertionError)\b/);
      if (errorName) diagnostics.push(errorName[1]);
      if (/^\s*at /.test(line)) {
        const frame = line.match(/\b(node:[a-z0-9_/-]+):(\d+):(\d+)\b/);
        diagnostics.push(
          frame && safeNodeFrames.has(frame[1])
            ? `${frame[1]}:${frame[2]}:${frame[3]}`
            : '[stack frame]',
        );
      }
      return diagnostics.length ? diagnostics.join(' ') : '[output redacted]';
    })
    .join('\n')
    .slice(-tailLimit);
}

/** Preserve the feature failure even when its required cleanup also rejects. */
export async function withFixtureCleanup<T>(
  work: () => Promise<T>,
  cleanup: () => Promise<void>,
): Promise<T> {
  let value: T;
  try {
    value = await work();
  } catch (original) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError([original, cleanupError], 'Fixture work and cleanup both failed.', {
        cause: original,
      });
    }
    throw original;
  }
  await cleanup();
  return value;
}

/** Monitor only the child this fixture owns; never reuse or signal another server. */
export async function observeAppProcess(
  child: ChildProcess & { stdout: Readable; stderr: Readable },
  readinessBanner: string,
  // Tiny-child negative controls shorten the production budgets, never extend them.
  budgets: { readyTimeoutMs?: number; closeTimeoutMs?: number; signal?: AbortSignal } = {},
): Promise<OwnedAppProcess> {
  const readyTimeoutMs = Math.min(readyBudget, budgets.readyTimeoutMs ?? readyBudget);
  const closeTimeoutMs = Math.min(closeBudget, budgets.closeTimeoutMs ?? closeBudget);
  let ready = false;
  let expectedClose = false;
  let exited = false;
  let unexpectedExit = false;
  let closed = false;
  let firstFailure: AppProcessError | undefined;
  let exitCode: number | null = null;
  let signal: NodeJS.Signals | null = null;
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let stdoutBytes = 0;
  let stderrBytes = 0;
  const evidence = (): AppProcessEvidence => ({
    pid: child.pid ?? null,
    ready,
    expectedClose,
    exited,
    unexpectedExit,
    closed,
    firstFailure: firstFailure?.message ?? null,
    exitCode,
    signal,
    stdout: { bytes: stdoutBytes, tail: publicTail(stdout, readinessBanner) },
    stderr: { bytes: stderrBytes, tail: publicTail(stderr, readinessBanner) },
  });
  let resolveReady!: () => void;
  let rejectReady!: (error: AppProcessError) => void;
  const readiness = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  let resolveFinished!: () => void;
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });
  let resolveFailure!: (error: AppProcessError) => void;
  const failure = new Promise<AppProcessError>((resolve) => {
    resolveFailure = resolve;
  });
  const fail = (message: string, cause?: unknown) => {
    if (firstFailure) return firstFailure;
    firstFailure = new AppProcessError(message, evidence, cause);
    rejectReady(firstFailure);
    resolveFailure(firstFailure);
    return firstFailure;
  };
  const onData = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
    if (stream === 'stdout') {
      stdoutBytes += chunk.length;
      stdout = Buffer.from(
        Buffer.concat([stdout, chunk.subarray(-tailLimit)]).subarray(-tailLimit),
      );
    } else {
      stderrBytes += chunk.length;
      stderr = Buffer.from(
        Buffer.concat([stderr, chunk.subarray(-tailLimit)]).subarray(-tailLimit),
      );
    }
    const tail = stream === 'stdout' ? stdout : stderr;
    if (
      !ready &&
      !firstFailure &&
      tail.toString('utf8').split(/\r?\n/).slice(0, -1).includes(readinessBanner)
    ) {
      ready = true;
      resolveReady();
    }
  };
  const onStdout = (chunk: Buffer) => onData('stdout', chunk);
  const onStderr = (chunk: Buffer) => onData('stderr', chunk);
  child.stdout.on('data', onStdout);
  child.stderr.on('data', onStderr);
  child.on('error', (error) => fail('App process failed.', error));
  child.once('exit', (code, exitSignal) => {
    exited = true;
    exitCode = code;
    signal = exitSignal;
    unexpectedExit = !expectedClose;
    if (unexpectedExit)
      fail(
        `${ready ? 'App exited unexpectedly' : 'App exited before ready'} (code ${code}, signal ${exitSignal ?? 'none'}).`,
      );
  });
  // Playwright may retire its worker during cleanup. The final exit handler
  // still terminates exactly this worker's child, including startup failures.
  const stopOnExit = () => {
    child.kill('SIGKILL');
  };
  process.once('exit', stopOnExit);
  child.once('close', () => {
    closed = true;
    process.off('exit', stopOnExit);
    budgets.signal?.removeEventListener('abort', onAbort);
    child.stdout.off('data', onStdout);
    child.stderr.off('data', onStderr);
    if (!ready && !firstFailure) fail('App closed before ready.');
    resolveFinished();
  });
  const assertHealthy = () => {
    if (firstFailure) throw firstFailure;
    if (exited || closed || child.exitCode !== null || child.signalCode !== null)
      throw fail('App is no longer running.');
    if (!ready || expectedClose)
      throw new AppProcessError(ready ? 'App is closing.' : 'App is not ready.', evidence);
  };
  let closing: Promise<void> | undefined;
  const close = () => {
    if (closing) return closing;
    expectedClose = true;
    closing = (async () => {
      if (closed) return;
      // Keep the original five-second total budget. Reserve its last second
      // for forced termination and stream closure instead of awaiting forever.
      const force = setTimeout(() => child.kill('SIGKILL'), closeTimeoutMs * 0.8);
      let timer: NodeJS.Timeout | undefined;
      try {
        if (!exited) child.kill('SIGTERM');
        await Promise.race([
          finished,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              const error = firstFailure
                ? new AppProcessError('App cleanup timed out.', evidence)
                : fail('App cleanup timed out.');
              // A descendant can inherit a pipe after the owned process has
              // exited. Do not let that descriptor make the wrapper hang
              // after its hard cleanup failure; no unrelated PID is signaled.
              child.kill('SIGKILL');
              child.stdout.destroy();
              child.stderr.destroy();
              child.unref();
              reject(error);
            }, closeTimeoutMs);
          }),
        ]);
      } finally {
        clearTimeout(force);
        clearTimeout(timer);
      }
    })();
    return closing;
  };
  const onAbort = () => {
    if (!ready) fail('App startup cancelled.');
    void close().catch((error: unknown) => fail('App cleanup failed.', error));
  };
  budgets.signal?.addEventListener('abort', onAbort, { once: true });
  if (budgets.signal?.aborted) onAbort();
  const startupTimer = setTimeout(() => fail('App startup timed out.'), readyTimeoutMs);
  try {
    await readiness;
    assertHealthy();
    return { close, assertHealthy, evidence, finished, failure };
  } catch (original) {
    return await withFixtureCleanup(async () => {
      throw original;
    }, close);
  } finally {
    clearTimeout(startupTimer);
  }
}
