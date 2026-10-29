import { fork } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { captureRestoreAuthority } from '../maintenance/restore-authority.ts';
import type { RestoreAuthority } from '../maintenance/restore-authority.ts';
import { BackupService } from './service.ts';
import { FilesystemStore, filesystemIdentity } from './filesystem.ts';
import { fileChunks } from './transfer.ts';

const cleanups: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** Complete-app seed exits before this test opens SQLite. Both source paths use
 * real authenticated archive + reconciliation workers, with no verifier mocks.
 * This is preparation acceptance, not activation or provider/browser acceptance. */
test('complete-app catalog and manual upload converge on the real encrypted preparation boundary', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-registry-acceptance-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'application.sqlite');
  const child = fork(
    fileURLToPath(new URL('../maintenance/restore-controller-fixture.ts', import.meta.url)),
    [],
    {
      execArgv: ['--disable-warning=ExperimentalWarning'],
      env: { ...process.env, DATABASE_PATH: databasePath },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    },
  );
  cleanups.push(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });
  // Fixed bounded diagnostics; no fixture error/key/source bodies reach output.
  child.stderr?.resume();
  let authority: RestoreAuthority | undefined;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Complete-app seed timed out.'));
    }, 30_000);
    child.on('message', (value: unknown) => {
      if (value && typeof value === 'object' && 'restoreAuthority' in value)
        authority = value.restoreAuthority as RestoreAuthority;
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0 || !authority) reject(new Error('Complete-app seed failed.'));
      else resolve();
    });
  });
  const seed = JSON.parse(await readFile(join(directory, 'restore-source.json'), 'utf8')) as {
    archive: string;
    keyFile: string;
    bytes: number;
    sha256: string;
    folderId: string;
  };
  const db = openDatabase(databasePath);
  cleanups.push(() => db.close());
  const auth = new AuthStore(db),
    session = auth.sessionByHash(authority!.sessionHash)!;
  const proof = () =>
    captureRestoreAuthority(db, {
      actorId: authority!.actorId,
      sessionHash: session.token_hash,
      expiresAt: Math.min(session.expires_at, auth.verifiedUntil(session)!),
    });
  const target = { generationId: randomUUID(), epoch: randomUUID() };
  const service = new BackupService(db, {
    databasePath,
    origin: 'https://spinel.example',
    image: `spinel@sha256:${'a'.repeat(64)}`,
    restoreController: {
      target: () => target,
      observe: async () => ({ target, record: null, pending: false }),
      admit: async () => {
        throw new Error('This acceptance test must not admit activation.');
      },
      begin: async () => {
        throw new Error('This acceptance test must not begin maintenance.');
      },
    },
  });
  cleanups.push(() => service.close());
  const currentName = () =>
    db.prepare('SELECT name FROM workspace_items WHERE id=?').get(seed.folderId)!.name;
  expect(currentName()).toBe('Current folder');
  const manual = await service.restores.create(randomUUID(), proof(), {
    kind: 'upload',
    key: await readFile(seed.keyFile),
  });
  const input = await open(seed.archive, 'r');
  let uploaded;
  try {
    uploaded = await service.restores.upload(
      manual.id,
      authority!.actorId,
      session.token_hash,
      fileChunks(input, AbortSignal.timeout(60_000)),
      seed.bytes,
    );
  } finally {
    await input.close();
  }
  expect(uploaded.state).toBe('ready');
  expect(uploaded.sourceSha256).toBe(seed.sha256);
  expect(uploaded.preview).toMatchObject({
    provisional: true,
    currentAccounts: 2,
    currentPasskeys: 1,
  });
  expect(currentName()).toBe('Current folder');
  expect(service.state().job).toBe('restore');
  await service.restores.cancel(manual.id, authority!.actorId, session.token_hash);

  const destinationRoot = join(directory, 'destination');
  await mkdir(destinationRoot, { mode: 0o700 });
  const environment = join(directory, 'runtime.env'),
    configPath = join(directory, 'backup.json');
  await writeFile(environment, 'NODE_ENV=production\n', { mode: 0o600 });
  const config = {
    type: 'filesystem' as const,
    ...(await filesystemIdentity(destinationRoot)),
    prefix: 'workspace',
    keyFile: seed.keyFile,
    runtimeEnvironmentFile: environment,
    keyId: 'current',
    automatic: false,
    manualDownload: false,
  };
  const destination = new FilesystemStore(config);
  const published = `workspace/2026-10-29T01-02-03.000Z-${randomUUID()}.spinel`;
  try {
    await destination.put(published, seed.archive, seed.sha256, AbortSignal.timeout(30_000));
  } finally {
    await destination.close();
  }
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  service.options.configPath = configPath;
  const catalog = await service.restores.catalog();
  expect(catalog.entries).toHaveLength(1);
  const saved = await service.restores.create(randomUUID(), proof(), {
    kind: 'catalog',
    artifactId: catalog.entries[0].id,
  });
  await expect
    .poll(() => service.restores.status(saved.id, authority!.actorId, session.token_hash).state, {
      timeout: 60_000,
    })
    .not.toBe('preparing');
  const retrieved = service.restores.status(saved.id, authority!.actorId, session.token_hash);
  expect(retrieved.state).toBe('ready');
  expect(retrieved.sourceSha256).toBe(uploaded.sourceSha256);
  expect(retrieved.preview).toEqual(uploaded.preview);
  expect(currentName()).toBe('Current folder');
  expect(service.state().job).toBe('restore');
  await service.restores.cancel(saved.id, authority!.actorId, session.token_hash);

  const invalid = await service.restores.create(randomUUID(), proof(), {
    kind: 'upload',
    key: randomBytes(32),
  });
  const bare = Buffer.alloc(4096);
  bare.write('SQLite format 3\0');
  async function* rawSQLite() {
    yield bare;
  }
  const refused = await service.restores.upload(
    invalid.id,
    authority!.actorId,
    session.token_hash,
    rawSQLite(),
    bare.length,
  );
  expect(refused.state).toBe('failed');
  expect(service.state().owner).toBeNull();
  expect(currentName()).toBe('Current folder');
}, 150_000);
