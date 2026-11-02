import { execFile, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, open, readlink, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { MaintenanceAdminStatus } from '../src/shared/maintenance.ts';
import type { ColdMaintenanceCommand } from '../src/server/maintenance/supervisor.ts';
import { filesystemIdentity } from '../src/server/backup/filesystem.ts';
import { projectRoot } from './app-process.ts';
import { processIdentity } from '../src/server/maintenance/journal.ts';
import {
  maintenanceJournalEvidence,
  maintenanceLogEvidence,
  maintenanceMemoryEvents,
  maintenanceStatusEvidence,
  readMaintenanceEvidence as evidenceRead,
} from './maintenance-evidence.ts';

const run = promisify(execFile);
async function readBounded(path: string, limit: number) {
  const file = await open(path, 'r');
  try {
    const bytes = Buffer.alloc(limit + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead > limit) throw new Error('Fixture evidence exceeds its bound.');
    return bytes.subarray(0, bytesRead).toString('utf8');
  } finally {
    await file.close();
  }
}

/** The worker never opens SQLite: even a closed libsql handle can retain native FDs.
 * `catalog` configures a private filesystem destination (Linux only) whose saved
 * backups the restore UI lists; nothing schedules writes into it. */
export async function startMaintenanceFixture({ catalog = false } = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'spinel-maintenance-e2e-')));
  const recoveryRoot = join(directory, 'recovery');
  const workspace = join(directory, 'workspace');
  const backupRoot = join(directory, 'backup-configuration');
  await mkdir(recoveryRoot, { mode: 0o700 });
  await mkdir(workspace, { mode: 0o700 });
  await mkdir(backupRoot, { mode: 0o700 });
  const origin = 'http://localhost:3198';
  const keyFile = join(backupRoot, 'recovery.key');
  const runtimeEnvironmentFile = join(backupRoot, 'runtime.env');
  const backupConfigPath = join(backupRoot, 'backup.json');
  await writeFile(keyFile, randomBytes(32), { mode: 0o600 });
  await writeFile(runtimeEnvironmentFile, `APP_ORIGIN=${origin}\nMAINTENANCE_FIXTURE=1\n`, {
    mode: 0o600,
  });
  const prefix = 'maintenance-fixture';
  const catalogRoot = join(directory, 'backups');
  if (catalog) await mkdir(join(catalogRoot, prefix), { recursive: true, mode: 0o700 });
  await writeFile(
    backupConfigPath,
    JSON.stringify({
      version: 1,
      ...(catalog
        ? { type: 'filesystem', ...(await filesystemIdentity(catalogRoot)) }
        : { type: 'manual' }),
      prefix,
      dataset: 'workspace',
      keyId: 'maintenance-recovery',
      keyFile,
      runtimeEnvironmentFile,
      automatic: false,
      manualDownload: true,
    }),
    { mode: 0o600 },
  );
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_PATH: join(workspace, 'instance.sqlite'),
    APP_ORIGIN: origin,
    PORT: '3198',
    HOST: '127.0.0.1',
    SPINEL_MAINTENANCE_ROOT: recoveryRoot,
    SPINEL_MAINTENANCE_PORT: '0',
    SPINEL_SPACE_REVIEW: '1',
    BACKUP_CONFIG_PATH: backupConfigPath,
    SPINEL_IMAGE: `sha256:${'a'.repeat(64)}`,
  };
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
    [
      // Keep the hosted service in its own PID view, like Compose. Playwright's
      // protected Chromium processes remain outside it; loopback and abstract
      // workspace ownership still use the shared host network namespace.
      ...(process.env.GITHUB_ACTIONS === 'true'
        ? ['scripts/ci/pid-namespace.ts', process.execPath]
        : []),
      '--max-old-space-size=128',
      '--max-semi-space-size=4',
      'server/supervisor.ts',
    ],
    { cwd: projectRoot, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const startedAt = performance.now();
  let exit: { at: number; code: number | null; signal: NodeJS.Signals | null } | null = null;
  let stdoutTail = Buffer.alloc(0),
    stderrTail = Buffer.alloc(0);
  let stdoutBytes = 0,
    stderrBytes = 0;
  // Continue draining after readiness; retain only a private bounded tail and
  // publish fixed diagnostic tokens, never raw server output.
  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBytes += chunk.length;
    stdoutTail = Buffer.concat([stdoutTail, chunk.subarray(-16_384)]).subarray(-16_384);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderrBytes += chunk.length;
    stderrTail = Buffer.concat([stderrTail, chunk.subarray(-16_384)]).subarray(-16_384);
  });
  child.once('exit', (code, signal) => {
    exit = { at: performance.now(), code, signal };
  });
  let cgroupFile: string | undefined;
  let memoryBefore: ReturnType<typeof maintenanceMemoryEvents> | null = null;
  let pidNamespace: string | null = null;
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
    // Hosted cleanup tears down the service namespace. The test's explicit cold
    // stop/verify commands separately prove graceful supervisor shutdown. Local
    // cleanup signals the supervisor, which owns its detached application group.
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
    // Lifecycle cleanup is installed before optional /proc reads, and an
    // unavailable identity is evidence loss rather than a new setup failure.
    const identityCapturedAt = performance.now();
    const identity = await evidenceRead(() => {
      const observed = child.pid ? processIdentity(child.pid) : null;
      return observed ? { pid: observed.pid, start: observed.start, boot: observed.boot } : null;
    });
    const memorySetup = await evidenceRead(async () => {
      if (!identity.ok || !identity.value) throw new Error('Fixture identity is unavailable.');
      pidNamespace = await readlink(`/proc/${child.pid}/ns/pid`);
      const group = /^0::([^\n]+)$/m.exec(
        await readBounded(`/proc/${child.pid}/cgroup`, 4096),
      )?.[1];
      if (!group) return;
      const path = resolve('/sys/fs/cgroup', '.' + group, 'memory.events');
      if (!path.startsWith('/sys/fs/cgroup/')) throw new Error('Unknown fixture memory scope.');
      cgroupFile = path;
      memoryBefore = maintenanceMemoryEvents(await readBounded(path, 4096));
    });
    const diagnostics = async (probe = false) => {
      const capturedAt = performance.now();
      const [journal, memoryAfter, health, status] = await Promise.all([
        evidenceRead(async () =>
          maintenanceJournalEvidence(
            JSON.parse(await readBounded(join(recoveryRoot, 'journal.json'), 262_144)),
          ),
        ),
        evidenceRead(async () =>
          cgroupFile ? maintenanceMemoryEvents(await readBounded(cgroupFile, 4096)) : null,
        ),
        probe
          ? evidenceRead(async () => {
              const response = await fetch(`${origin}/api/health`, {
                signal: AbortSignal.timeout(1000),
              });
              await response.body?.cancel();
              return { status: response.status };
            })
          : null,
        probe
          ? evidenceRead(async () => {
              const response = await fetch(`${publicOrigin}/api/maintenance`, {
                signal: AbortSignal.timeout(1000),
              });
              return maintenanceStatusEvidence(response);
            })
          : null,
      ]);
      return {
        startedAt,
        capturedAt,
        completedAt: performance.now(),
        clock: 'monotonic milliseconds in the Playwright worker',
        wrapper: { pid: child.pid ?? null, identity, identityCapturedAt, pidNamespace, exit },
        journalIdentityDomain:
          process.env.GITHUB_ACTIONS === 'true'
            ? 'private service PID namespace'
            : 'host PID namespace',
        journal,
        health,
        status,
        memory: {
          setup: memorySetup,
          before: memoryBefore,
          after: memoryAfter,
          scope:
            'wrapper cgroup; may include other job processes, not proof of this application causing OOM',
        },
        stdout: maintenanceLogEvidence(stdoutTail, stdoutBytes),
        stderr: maintenanceLogEvidence(stderrTail, stderrBytes),
      };
    };
    const operationId = randomUUID();
    const verified = await control({ action: 'verify', operationId });
    if (verified.phase !== 'stopped')
      throw new Error('Cold verification did not close the workspace.');
    const started = await control({ action: 'start', operationId });
    if (started.phase !== 'paused' || !started.readyToResume)
      throw new Error('The application did not start with edits paused.');
    const running = await control({ action: 'resume', operationId });
    if (running.phase !== 'running') throw new Error('The verified application did not resume.');
    return {
      origin,
      publicOrigin,
      setupLink,
      running,
      control,
      close,
      diagnostics,
      keyFile,
      catalogDirectory: catalog ? join(catalogRoot, prefix) : undefined,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
