import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AppProcessError, startApp } from '../e2e/app-process.ts';
import type { AppProcessEvidence, OwnedAppProcess } from '../e2e/app-process.ts';

// Playwright owns this wrapper; the wrapper owns exactly one application child.
// Ordinary scenario fixtures can inspect the same source-neutral process state
// as direct startApp callers. Primary timing projects keep their plain server.
async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--dev')) throw new Error('Unknown owned-server argument.');
  const port = Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error('The owned server requires a valid PORT.');
  if (!process.env.DATABASE_PATH) throw new Error('The owned server requires DATABASE_PATH.');
  const origin = process.env.APP_ORIGIN ?? `http://localhost:${port}`;
  const runId = randomUUID();
  const directory = resolve('playwright-report');
  const destination = resolve(directory, `server-${port}.json`);
  const temporary = resolve(directory, `.server-${port}-${runId}.tmp`);
  await mkdir(directory, { recursive: true });
  const controller = new AbortController();
  let app: OwnedAppProcess | undefined;
  let firstError: unknown;
  let stopping = false;
  let interval: NodeJS.Timeout | undefined;
  let writing: Promise<void> | undefined;
  let evidenceError: Error | undefined;
  let rejectEvidence!: (error: Error) => void;
  // Resolve failure rather than rejecting a promise before its consumer is ready.
  const evidenceFailure = new Promise<Error>((resolveFailure) => {
    rejectEvidence = resolveFailure;
  });
  const snapshot = (): AppProcessEvidence | undefined => {
    if (app) return app.evidence();
    if (firstError instanceof AppProcessError) return firstError.evidence;
    if (firstError instanceof AggregateError)
      return firstError.errors.find((error) => error instanceof AppProcessError)?.evidence;
    return undefined;
  };
  const persist = async () => {
    const evidence = snapshot();
    if (!evidence) return;
    try {
      await writeFile(
        temporary,
        JSON.stringify({ ownerPid: process.pid, runId, updatedAt: Date.now(), ...evidence }),
        { mode: 0o600 },
      );
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
  };
  const stop = () => {
    stopping = true;
    clearInterval(interval);
    controller.abort();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  try {
    app = await startApp({
      databasePath: process.env.DATABASE_PATH,
      origin,
      listenPort: port,
      development: args.includes('--dev'),
      backupConfigPath: process.env.BACKUP_CONFIG_PATH,
      signal: controller.signal,
    });
    await persist();
    if (!stopping) {
      console.log('Spinel fixture server ready');
      // At most one atomic write runs at a time. Slow storage cannot accumulate
      // a queue of stale snapshots; exit/cleanup always writes its final state.
      interval = setInterval(() => {
        if (writing) return;
        writing = persist()
          .catch(() => {
            evidenceError ??= new Error('Owned-server evidence could not be written.');
            rejectEvidence(evidenceError);
          })
          .finally(() => {
            writing = undefined;
          });
      }, 250);
    }
    const failure = await Promise.race([
      app.finished.then(() => undefined),
      app.failure,
      evidenceFailure,
    ]);
    if (failure) throw failure;
    if (!stopping) app.assertHealthy();
  } catch (error) {
    firstError = error;
  } finally {
    clearInterval(interval);
    try {
      await app?.close();
    } catch (cleanupError) {
      firstError = firstError
        ? new AggregateError([firstError, cleanupError], 'Owned-server cleanup also failed.', {
            cause: firstError,
          })
        : cleanupError;
    }
    await writing;
    firstError ??= evidenceError;
    try {
      await persist();
    } catch {
      firstError ??= new Error('Final owned-server evidence could not be written.');
    }
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
  }
  const cancelledStartup =
    stopping &&
    firstError instanceof AppProcessError &&
    firstError.message === 'App startup cancelled.';
  if (firstError && !cancelledStartup) {
    // No arbitrary exception message, environment, cookie or server output is
    // printed here. The snapshot retains the allowlisted first process cause.
    console.error(
      JSON.stringify({ kind: 'owned-server-failure', ownerPid: process.pid, runId, ...snapshot() }),
    );
    process.exitCode = 1;
  }
}

await main().catch(() => {
  console.error('Owned server configuration or evidence initialization failed.');
  process.exitCode = 1;
});
