/** Disposable Linux backend for the real browser restore acceptance script.
 * Private control files and synthetic source material never enter server logs. */
import { execFile, fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validRestoreJobRecord } from '../src/server/maintenance/restore-jobs.ts';
import type { RestoreJobRecord } from '../src/server/maintenance/restore-jobs.ts';
import type { RestoreRichMetadata } from '../src/server/maintenance/restore-rich-fixture.ts';

const directory = '/fixture';
// Database and Unix control socket require the durable Linux filesystem. The
// host bind is only a private exchange for browser input and safe evidence.
const stateDirectory = '/state';
const data = join(stateDirectory, 'data');
const databasePath = join(data, 'workspace.sqlite');
const root = join(stateDirectory, 'recovery');
const staticDirectory = '/app/dist';
const image = process.env.SPINEL_IMAGE!;
if (!/^sha256:[a-f0-9]{64}$/.test(image))
  throw new Error('Actual production image identity required.');
const run = promisify(execFile);
type PublicCredential = { credentialId: string; publicKey: string };
type Bootstrap = PublicCredential & {
  origin: string;
  owner: PublicCredential;
  reader: PublicCredential;
};
type Seed = {
  operatorId: string;
  folderId: string;
  archive: string;
  keyFile: string;
  sha256: string;
  rich: RestoreRichMetadata;
};
const input = JSON.parse(await readFile(join(directory, 'bootstrap.json'), 'utf8')) as Bootstrap;
const origin = new URL(input.origin);
if (
  origin.protocol !== 'https:' ||
  origin.hostname !== 'localhost' ||
  ![input, input.owner, input.reader].every(
    (credential) =>
      credential &&
      /^[A-Za-z0-9_-]{43}$/.test(credential.credentialId) &&
      Buffer.from(credential.publicKey, 'base64url').length === 77,
  )
)
  throw new Error('Invalid private browser fixture bootstrap.');

async function publish(name: string, value: unknown) {
  const temporary = join(directory, `${name}.pending`);
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, join(directory, name));
}

async function numericFile(path: string) {
  try {
    const value = Number((await readFile(path, 'utf8')).trim());
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

async function seed(): Promise<Seed> {
  // Keep bootstrap/native SDK imports out of the long-lived orchestration
  // process: they belong only to this separately exiting seed child.
  const [database, application, authModule, workspaceModule, archiveModule, richModule] =
    await Promise.all([
      import('../server/database.ts'),
      import('../server/app.ts'),
      import('../src/server/auth/store.ts'),
      import('../src/server/workspace/store.ts'),
      import('../src/server/backup/archive.ts'),
      import('../src/server/maintenance/restore-rich-fixture.ts'),
    ]);
  const { openDatabase } = database;
  const { createApp } = application;
  const { AuthStore } = authModule;
  const { WorkspaceStore } = workspaceModule;
  const { makeArchive } = archiveModule;
  const { seedRestoreRichFixture, mutateRestoreRichCurrent } = richModule;
  const app = await createApp({
    databasePath,
    origin: input.origin,
    image,
    staticDirectory,
    backupConfigPath: join(data, 'absent-backup-config'),
  });
  await app.close();
  const db = openDatabase(databasePath),
    key = randomBytes(32);
  try {
    const auth = new AuthStore(db),
      operator = auth.createUser('Browser restore operator', true),
      owner = auth.createUser('Workspace owner', false);
    db.prepare(
      `INSERT INTO auth_passkeys
      (id,user_id,public_key,counter,transports,name,provider,created_at,last_used_at,backed_up,device_type)
      VALUES(?,?,?,0,'[]','Browser acceptance','Browser',?,NULL,0,'singleDevice')`,
    ).run(input.credentialId, operator.id, Buffer.from(input.publicKey, 'base64url'), Date.now());
    const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
    const folder = workspace.create(owner.id, {
      kind: 'folder',
      name: 'Archived folder',
      parentId: null,
    });
    const rich = await seedRestoreRichFixture({ auth, workspace, ownerId: owner.id });
    const keyFile = join(data, 'archive.key');
    await writeFile(keyFile, key, { flag: 'wx', mode: 0o600 });
    const archive = await makeArchive(db, data, key, {
      format: 1,
      createdAt: new Date().toISOString(),
      origin: input.origin,
      image,
      runtimeEnvironment: 'NODE_ENV=production\n',
      keyId: 'browser-fixture',
    });
    workspace.update(owner.id, folder.id, { name: 'Current folder' });
    await mutateRestoreRichCurrent({
      auth,
      workspace,
      metadata: rich,
      credentials: {
        owner: {
          id: input.owner.credentialId,
          publicKey: Buffer.from(input.owner.publicKey, 'base64url'),
        },
        reader: {
          id: input.reader.credentialId,
          publicKey: Buffer.from(input.reader.publicKey, 'base64url'),
        },
      },
    });
    return {
      operatorId: operator.id,
      folderId: folder.id,
      archive: archive.archive,
      keyFile,
      sha256: archive.sha256,
      rich,
    };
  } finally {
    key.fill(0);
    db.close();
  }
}

if (process.argv.includes('--seed')) {
  try {
    const result = await seed();
    await new Promise<void>((resolve, reject) =>
      process.send!(result, (error) => (error ? reject(error) : resolve())),
    );
  } catch {
    process.exitCode = 1;
  } finally {
    process.disconnect?.();
  }
} else {
  let service: ChildProcess | undefined;
  let serviceExit: Promise<number | null> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let stopping: Promise<void> | undefined;
  let source: Seed | undefined;
  let fixturePhase = 'preparing-source';
  let driverServingPeakRssBytes = 0;
  const serviceDiagnostic: {
    exitCode: number | null;
    signal: string | null;
    errorCode: string | null;
    errno: number | null;
    syscall: string | null;
  } = { exitCode: null, signal: null, errorCode: null, errno: null, syscall: null };
  async function record() {
    const names = await readdir(join(root, 'restore-jobs')).catch(() => []);
    if (names.length !== 1) return null;
    const value = JSON.parse(
      await readFile(join(root, 'restore-jobs', names[0], 'state.json'), 'utf8'),
    );
    if (!validRestoreJobRecord(value, names[0]))
      throw new Error('Invalid fixture outcome evidence.');
    return value as RestoreJobRecord;
  }
  const stop = () =>
    (stopping ??= (async () => {
      if (timer) clearInterval(timer);
      if (deadline) clearTimeout(deadline);
      const completed = await record();
      if (service && service.exitCode === null) {
        service.kill('SIGTERM');
        const timedOut = new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Shipped supervisor shutdown timed out.')),
            25_000,
          ).unref(),
        );
        if ((await Promise.race([serviceExit!, timedOut])) !== 0)
          throw new Error('Shipped supervisor shutdown failed.');
      }
      service = undefined;
      if (source && completed?.phase === 'candidate-committed') {
        const { DatabaseSync } = await import('../server/database.ts');
        const location = pathToFileURL(databasePath);
        location.searchParams.set('mode', 'ro');
        const db = new DatabaseSync(location.href);
        try {
          await publish('closed-proof.json', {
            committed: true,
            restoredContent:
              db.prepare('SELECT name FROM workspace_items WHERE id=?').get(source.folderId)
                ?.name === 'Archived folder',
            originalSessionExcluded:
              db
                .prepare('SELECT COUNT(*) AS count FROM auth_sessions WHERE token_hash=?')
                .get(completed.intent.authority.sessionHash)?.count === 0,
            counter: db
              .prepare('SELECT counter FROM auth_passkeys WHERE id=?')
              .get(input.credentialId)?.counter,
            memoryLimitBytes: await numericFile('/sys/fs/cgroup/memory.max'),
            cpuMax: (await readFile('/sys/fs/cgroup/cpu.max', 'utf8')).trim(),
            pidsMax: await numericFile('/sys/fs/cgroup/pids.max'),
            memoryPeakBytes: await numericFile('/sys/fs/cgroup/memory.peak'),
            fixtureDriverServingPeakRssBytes: driverServingPeakRssBytes,
          });
        } finally {
          db.close();
        }
      }
    })());
  try {
    await chmod(stateDirectory, 0o700);
    await mkdir(data, { mode: 0o700 });
    await mkdir(root, { mode: 0o700 });
    source = await new Promise<Seed>((resolve, reject) => {
      const child = fork(fileURLToPath(import.meta.url), ['--seed'], {
        execArgv: ['--max-old-space-size=256', '--max-semi-space-size=8'],
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      let value: Seed | undefined;
      let failed = false;
      const timeout = setTimeout(() => {
        failed = true;
        child.kill('SIGKILL');
      }, 30_000);
      child.once('message', (message) => {
        value = message as Seed;
      });
      child.once('error', () => {
        failed = true;
        if (child.pid) child.kill('SIGKILL');
      });
      // Settle only after the child and its IPC/stdio resources physically close.
      child.once('close', (code) => {
        clearTimeout(timeout);
        if (!failed && code === 0 && value) resolve(value);
        else reject(new Error('Browser fixture seed failed.'));
      });
    });
    const exported = join(directory, 'source');
    await mkdir(exported, { mode: 0o700 });
    const archive = join(exported, 'workspace.spinel');
    const keyFile = join(exported, 'archive.key');
    await copyFile(source.archive, archive);
    await chmod(archive, 0o600);
    await copyFile(source.keyFile, keyFile);
    await chmod(keyFile, 0o600);
    source = { ...source, archive, keyFile };
    fixturePhase = 'starting-shipped-supervisor';
    const runtimeFiles = [
      'server/app.ts',
      'server/index.ts',
      'server/supervisor.ts',
      'src/shared/restore.ts',
      'src/server/backup/restore-control.ts',
      'src/server/backup/restore-registry.ts',
      'src/server/backup/restore-routes.ts',
      'src/server/maintenance/supervisor.ts',
      'src/server/maintenance/supervisor-client.ts',
      'src/server/maintenance/restore-rpc.ts',
      'src/server/maintenance/restore-jobs.ts',
      'src/server/maintenance/restore-rich-fixture.ts',
      'scripts/deploy/maintenance.ts',
    ];
    const hash = async (path: string) =>
      createHash('sha256')
        .update(await readFile(`/app/${path}`))
        .digest('hex');
    const bundleFiles = [
      'dist/index.html',
      ...(await readdir('/app/dist/assets'))
        .filter((name) => /\.(?:js|css)$/.test(name))
        .map((name) => `dist/assets/${name}`),
    ];
    await publish('image-evidence.json', {
      image,
      node: process.versions.node,
      platform: process.platform,
      architecture: process.arch,
      sourceHashes: Object.fromEntries(
        await Promise.all(runtimeFiles.map(async (path) => [path, await hash(path)])),
      ),
      bundleHashes: Object.fromEntries(
        await Promise.all(bundleFiles.map(async (path) => [path, await hash(path)])),
      ),
    });
    const environment = {
      ...process.env,
      DATABASE_PATH: databasePath,
      APP_ORIGIN: input.origin,
      SPINEL_MAINTENANCE_ROOT: root,
      SPINEL_MAINTENANCE_PORT: '0',
      SPINEL_IMAGE: image,
      SPINEL_STATIC_DIRECTORY: staticDirectory,
      PORT: '3199',
      HOST: '0.0.0.0',
      BACKUP_CONFIG_PATH: join(data, 'absent-backup-config'),
    };
    service = fork('/app/server/supervisor.ts', [], {
      env: environment,
      execArgv: ['--max-old-space-size=64'],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    // Retain only allowlisted native error metadata, never stderr text/paths.
    let stderrTail = '';
    service.stderr!.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-8192);
      serviceDiagnostic.errorCode =
        /code:\s*['"](E[A-Z0-9_]{1,63})['"]/.exec(stderrTail)?.[1] ?? serviceDiagnostic.errorCode;
      const errno = /errno:\s*(-?\d{1,8})/.exec(stderrTail)?.[1];
      if (errno !== undefined) serviceDiagnostic.errno = Number(errno);
      serviceDiagnostic.syscall =
        /syscall:\s*['"](listen|bind|open|chmod|stat|read|unlink)['"]/.exec(stderrTail)?.[1] ??
        serviceDiagnostic.syscall;
    });
    serviceExit = new Promise((resolveExit) =>
      service!.once('close', (code, signal) => {
        stderrTail = '';
        serviceDiagnostic.exitCode = code;
        serviceDiagnostic.signal = signal;
        resolveExit(code);
      }),
    );
    const control = async (action: string, operationId?: string) => {
      const result = await run(
        process.execPath,
        [
          '--max-old-space-size=64',
          '/app/scripts/deploy/maintenance.ts',
          action,
          ...(operationId ? ['--operation', operationId] : []),
        ],
        { env: environment, timeout: 70_000, maxBuffer: 32_768 },
      );
      return JSON.parse(result.stdout) as { phase: string };
    };
    const initialDeadline = Date.now() + 30_000;
    let initial: { phase: string } | undefined;
    while (Date.now() < initialDeadline && !initial) {
      try {
        initial = await control('status');
      } catch {
        if (service.exitCode !== null || service.signalCode !== null) break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      }
    }
    if (!initial) throw new Error('Shipped CLI could not observe supervisor.');
    const operationId = randomUUID();
    fixturePhase = 'cli-verify';
    await control('verify', operationId);
    fixturePhase = 'cli-start';
    await control('start', operationId);
    fixturePhase = 'cli-resume';
    const resumed = await control('resume', operationId);
    if (resumed.phase !== 'running') throw new Error('Shipped CLI did not resume workspace.');
    await publish('cli-proof.json', {
      initial: initial.phase,
      verify: true,
      start: true,
      resume: resumed.phase,
    });
    fixturePhase = 'serving-browser';
    driverServingPeakRssBytes = process.memoryUsage().rss;
    await publish('ready.json', source);
    let observing = false;
    timer = setInterval(() => {
      driverServingPeakRssBytes = Math.max(driverServingPeakRssBytes, process.memoryUsage().rss);
      if (observing || stopping) return;
      observing = true;
      void (async () => {
        const current = await record();
        const state = JSON.parse(await readFile(join(root, 'journal.json'), 'utf8')) as {
          phase: string;
        };
        await publish('status.json', {
          phase: state.phase,
          outcome: current?.phase ?? null,
          id: current?.intent.id ?? null,
          sourceSha256: current?.intent.source.archive.sha256 ?? null,
        });
      })()
        .catch(() => {})
        .finally(() => {
          observing = false;
        });
    }, 100);
    deadline = setTimeout(() => {
      void stop().finally(() => process.exit(1));
    }, 5 * 60_000);
    process.once('SIGTERM', () => {
      void stop().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
    process.once('SIGINT', () => {
      void stop().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
  } catch {
    await stop().catch(() => {});
    await publish('failed.json', { failed: true, phase: fixturePhase, service: serviceDiagnostic });
    process.exitCode = 1;
  }
}
