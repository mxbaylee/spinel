import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { observeAppProcess } from './owned-process.ts';

export { AppProcessError, withFixtureCleanup } from './owned-process.ts';
export type { AppProcessEvidence, OwnedAppProcess } from './owned-process.ts';

export const projectRoot = resolve(import.meta.dirname, '..');

// Keep the server SDK and Vite out of Playwright's collector/worker. Closing an
// in-process app does not unload its modules before subsequent editor tests.
export async function startApp(options: {
  databasePath: string;
  origin: string;
  development: boolean;
  staticDirectory?: string;
  /** Immutable historical backend for real offline SDK transition evidence. */
  sourceRoot?: string;
  /** Upgrade acceptance keeps one public origin while swapping its fixture backend. */
  listenPort?: number;
  spaceReview?: boolean;
  /** Recovery tests opt in with a disposable private destination and key. */
  backupConfigPath?: string;
  image?: string;
  /** A fixture wrapper can stop startup as well as an already-ready child. */
  signal?: AbortSignal;
}) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_PATH: options.databasePath,
    APP_ORIGIN: options.origin,
    PORT: String(options.listenPort ?? new URL(options.origin).port),
    HOST: '127.0.0.1',
    // Exercise the normal enabled application unless a fixture explicitly
    // verifies disabled Space boundaries; ignore ambient developer overrides.
    SPINEL_SPACE_REVIEW: options.spaceReview === false ? '0' : '1',
    ...(options.staticDirectory ? { SPINEL_STATIC_DIRECTORY: options.staticDirectory } : {}),
  };
  if (options.backupConfigPath) env.BACKUP_CONFIG_PATH = options.backupConfigPath;
  else delete env.BACKUP_CONFIG_PATH;
  if (options.image) env.SPINEL_IMAGE = options.image;
  const child = spawn(
    process.execPath,
    [
      `--max-old-space-size=${options.development ? 512 : 256}`,
      '--max-semi-space-size=8',
      ...(options.development ? ['--no-turbo-fast-api-calls'] : []),
      'server/index.ts',
      ...(options.development ? ['--dev', '--no-open'] : []),
    ],
    { cwd: options.sourceRoot ?? projectRoot, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return observeAppProcess(child, `Spinel is running at ${options.origin}`, {
    signal: options.signal,
  });
}
