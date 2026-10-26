import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

export const projectRoot = resolve(import.meta.dirname, '..');

// Keep the server SDK and Vite out of Playwright's collector/worker. Closing an
// in-process app does not unload its modules before subsequent editor tests.
export async function startApp(options: {
  databasePath: string;
  origin: string;
  development: boolean;
  spaceReview?: boolean;
}) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_PATH: options.databasePath,
    APP_ORIGIN: options.origin,
    PORT: new URL(options.origin).port,
    HOST: '127.0.0.1',
    // Exercise the normal enabled application unless a fixture explicitly
    // verifies disabled Space boundaries; ignore ambient developer overrides.
    SPINEL_SPACE_REVIEW: options.spaceReview === false ? '0' : '1',
  };
  delete env.BACKUP_CONFIG_PATH;
  const child = spawn(
    process.execPath,
    [
      `--max-old-space-size=${options.development ? 512 : 256}`,
      '--max-semi-space-size=8',
      'server/index.ts',
      ...(options.development ? ['--dev', '--no-open'] : []),
    ],
    { cwd: projectRoot, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  let startupError: Error | undefined;
  child.on('error', (error) => {
    startupError = error;
  });
  // Playwright can retire a failed worker while fixture cleanup is in flight.
  // Terminate only this worker's own server, including that final exit path.
  const stopOnExit = () => {
    child.kill('SIGKILL');
  };
  process.once('exit', stopOnExit);
  const exited = new Promise<void>((done) =>
    child.once('close', () => {
      process.off('exit', stopOnExit);
      done();
    }),
  );
  const close = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return exited;
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    try {
      await exited;
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    await new Promise<void>((ready, reject) => {
      const timer = setTimeout(
        () => finish(new Error(`App startup timed out.\n${output}`)),
        30_000,
      );
      const onClose = () =>
        finish(startupError ?? new Error(`App exited before ready.\n${output}`));
      const onData = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-16_384);
        if (output.includes(`Spinel is running at ${options.origin}`)) finish();
      };
      const finish = (error?: Error) => {
        clearTimeout(timer);
        child.off('close', onClose);
        child.stdout.off('data', onData);
        child.stderr.off('data', onData);
        // Continue draining pipes so a noisy child cannot block on output.
        child.stdout.resume();
        child.stderr.resume();
        if (error) reject(error);
        else ready();
      };
      child.once('close', onClose);
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
    });
    return { close };
  } catch (error) {
    await close();
    throw error;
  }
}
