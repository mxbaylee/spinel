/** Disposable Linux backend for the real browser restore acceptance script.
 * Private control files and synthetic source material never enter server logs. */
import { createHash, randomBytes } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validRestoreJobRecord } from '../src/server/maintenance/restore-jobs.ts';
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

async function seed(): Promise<Seed> {
  // Native bootstrap imports belong only to this separately exiting container.
  // The shipped supervisor starts after Docker confirms physical closure.
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

if (process.argv[2] === '--bootstrap') {
  await chmod(stateDirectory, 0o700);
  await mkdir(data, { mode: 0o700 });
  await mkdir(root, { mode: 0o700 });
  const source = await seed();
  const exported = join(directory, 'source');
  await mkdir(exported, { mode: 0o700 });
  const archive = join(exported, 'workspace.spinel');
  const keyFile = join(exported, 'archive.key');
  await copyFile(source.archive, archive);
  await chmod(archive, 0o600);
  await copyFile(source.keyFile, keyFile);
  await chmod(keyFile, 0o600);
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
  await publish('ready.json', { ...source, archive, keyFile });
} else if (process.argv[2] === '--cold') {
  // The host writes this only after Docker independently confirms that the
  // serving container is stopped with PID 0, exit 0 and no OOM. Its volume is
  // mounted read-only here; this helper never overlaps a serving process.
  const closure = JSON.parse(await readFile(join(directory, 'supervisor-closed.json'), 'utf8'));
  if (
    closure.image !== image ||
    closure.pid !== 0 ||
    closure.running !== false ||
    closure.exitCode !== 0 ||
    closure.oomKilled !== false ||
    !/^spinel-restore-browser-[a-f0-9-]{36}$/.test(closure.container)
  )
    throw new Error('Confirmed supervisor closure required before cold inspection.');
  const source = JSON.parse(await readFile(join(directory, 'ready.json'), 'utf8')) as Seed;
  const names = await readdir(join(root, 'restore-jobs'));
  if (names.length !== 1) throw new Error('Expected one canonical restore job.');
  const completed: unknown = JSON.parse(
    await readFile(join(root, 'restore-jobs', names[0], 'state.json'), 'utf8'),
  );
  if (!validRestoreJobRecord(completed, names[0]) || completed.phase !== 'candidate-committed')
    throw new Error('Committed canonical outcome required.');
  const { DatabaseSync } = await import('../server/database.ts');
  const location = pathToFileURL(databasePath);
  location.searchParams.set('mode', 'ro');
  const db = new DatabaseSync(location.href);
  try {
    await publish('closed-proof.json', {
      committed: true,
      restoredContent:
        db.prepare('SELECT name FROM workspace_items WHERE id=?').get(source.folderId)?.name ===
        'Archived folder',
      originalSessionExcluded:
        db
          .prepare('SELECT COUNT(*) AS count FROM auth_sessions WHERE token_hash=?')
          .get(completed.intent.authority.sessionHash)?.count === 0,
      counter: db.prepare('SELECT counter FROM auth_passkeys WHERE id=?').get(input.credentialId)
        ?.counter,
    });
  } finally {
    db.close();
  }
} else {
  throw new Error('Select the exited bootstrap or post-closure cold helper.');
}
