import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { MaintenanceAdminStatus } from '../src/shared/maintenance.ts';
import type { ColdMaintenanceCommand } from '../src/server/maintenance/supervisor.ts';
import { projectRoot } from './app-process.ts';

const run = promisify(execFile);

/** The worker never opens SQLite: even a closed libsql handle can retain native FDs. */
export async function startMaintenanceFixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'spinel-maintenance-e2e-')));
  const recoveryRoot = join(directory, 'recovery');
  const workspace = join(directory, 'workspace');
  await mkdir(recoveryRoot, { mode: 0o700 });
  await mkdir(workspace, { mode: 0o700 });
  const origin = 'http://localhost:3198';
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_PATH: join(workspace, 'instance.sqlite'),
    APP_ORIGIN: origin,
    PORT: '3198',
    HOST: '127.0.0.1',
    SPINEL_MAINTENANCE_ROOT: recoveryRoot,
    SPINEL_MAINTENANCE_PORT: '0',
    SPINEL_SPACE_REVIEW: '1',
  };
  delete env.BACKUP_CONFIG_PATH;
  delete env.SPINEL_SUPERVISED;
  delete env.SPINEL_PROCESS_GROUP_TOKEN;
  delete env.SPINEL_STATIC_DIRECTORY;

  // Run the normal cold-host setup command before the supervisor owns the file.
  // Its one-time link remains inside this fixture and is never an attachment.
  let setupLink: string;
  try {
    const { stdout } = await run(
      process.execPath,
      ['--max-old-space-size=128', '--max-semi-space-size=4', 'server/setup.ts'],
      { cwd: projectRoot, env, timeout: 30_000 },
    );
    setupLink = stdout.trim().split('\n').at(-1)!;
    if (!setupLink.startsWith(`${origin}/setup#`))
      throw new Error('The cold setup command did not issue a setup link.');
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }

  const child = spawn(
    process.execPath,
    ['--max-old-space-size=128', '--max-semi-space-size=4', 'server/supervisor.ts'],
    { cwd: projectRoot, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  let startupError: Error | undefined;
  child.on('error', (error) => {
    startupError = error;
  });
  const stopOnExit = () => {
    child.kill('SIGTERM');
  };
  process.once('exit', stopOnExit);
  const exited = new Promise<void>((resolveExit) => {
    child.once('close', () => {
      process.off('exit', stopOnExit);
      resolveExit();
    });
  });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    // The supervisor owns its detached application group and confirms its stop.
    // On a forced parent exit, the app's private IPC disconnect also fails closed.
    const timer = setTimeout(() => child.kill('SIGKILL'), 25_000);
    try {
      await exited;
    } finally {
      clearTimeout(timer);
      await rm(directory, { recursive: true, force: true });
    }
  };
  const control = async (command: ColdMaintenanceCommand): Promise<MaintenanceAdminStatus> => {
    const { stdout } = await run(
      process.execPath,
      [
        '--max-old-space-size=64',
        '--max-semi-space-size=4',
        'scripts/deploy/maintenance.ts',
        command.action,
        ...('operationId' in command ? ['--operation', command.operationId] : []),
      ],
      { cwd: projectRoot, env, timeout: 70_000, maxBuffer: 64 * 1024 },
    );
    return JSON.parse(stdout) as MaintenanceAdminStatus;
  };
  try {
    const publicOrigin = await new Promise<string>((resolveReady, reject) => {
      const timer = setTimeout(
        () => finish(new Error(`Maintenance supervisor startup timed out.\n${output}`)),
        15_000,
      );
      const onClose = () => finish(startupError ?? new Error(`Supervisor exited.\n${output}`));
      const onData = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-16_384);
        const address = /Spinel recovery control is available on 127\.0\.0\.1:(\d+)\./.exec(output);
        if (address) finish(undefined, `http://127.0.0.1:${address[1]}`);
      };
      const finish = (error?: Error, address?: string) => {
        clearTimeout(timer);
        child.off('close', onClose);
        child.stdout.off('data', onData);
        child.stderr.off('data', onData);
        child.stdout.resume();
        child.stderr.resume();
        if (error) reject(error);
        else resolveReady(address!);
      };
      child.once('close', onClose);
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
    });
    const operationId = randomUUID();
    const verified = await control({ action: 'verify', operationId });
    if (verified.phase !== 'stopped')
      throw new Error('Cold verification did not close the workspace.');
    const started = await control({ action: 'start', operationId });
    if (started.phase !== 'paused' || !started.readyToResume)
      throw new Error('The application did not start with edits paused.');
    const running = await control({ action: 'resume', operationId });
    if (running.phase !== 'running') throw new Error('The verified application did not resume.');
    return { origin, publicOrigin, setupLink, running, control, close };
  } catch (error) {
    await close();
    throw error;
  }
}
