/** Disposable Linux backend for the real browser restore acceptance script.
 * Private control files and synthetic source material never enter server logs. */
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
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

const coldFiles = ['workspace.sqlite', 'workspace.sqlite-wal', 'workspace.sqlite-shm'] as const;
type ColdFile = {
  device: string;
  inode: string;
  bytes: number;
  mtime: number;
  ctime: number;
  sha256: string;
};
type ColdGroup = Record<(typeof coldFiles)[number], ColdFile | null>;
async function closedGroup(base: string, destination?: string): Promise<ColdGroup> {
  const result = {} as ColdGroup;
  let total = 0;
  const maximum = 64 * 1024 * 1024; // Explicit bound for this small synthetic fixture, not production policy.
  const absent = (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  };
  if (await lstat(join(base, 'workspace.sqlite-journal')).catch(absent))
    throw new Error('Unexpected rollback journal; cold group is unresolved.');
  for (const name of coldFiles) {
    const path = join(base, name);
    const initial = await lstat(path).catch(absent);
    if (!initial) {
      result[name] = null;
      continue;
    }
    if (!initial.isFile() || !Number.isSafeInteger(initial.size) || initial.size > maximum - total)
      throw new Error('Closed fixture group exceeds its file or byte bound.');
    const input = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let output: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const before = await input.stat();
      const identity = (value: typeof before) => [
        value.dev,
        value.ino,
        value.size,
        value.mtimeMs,
        value.ctimeMs,
      ];
      if (JSON.stringify(identity(before)) !== JSON.stringify(identity(initial)))
        throw new Error('Closed source identity changed before reading.');
      if (destination) output = await open(join(destination, name), 'wx', 0o600);
      const digest = createHash('sha256'),
        buffer = Buffer.alloc(64 * 1024);
      let bytes = 0;
      for (;;) {
        const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        total += bytesRead;
        bytes += bytesRead;
        if (total > maximum) throw new Error('Closed fixture group exceeds its byte bound.');
        const chunk = buffer.subarray(0, bytesRead);
        digest.update(chunk);
        if (output) await output.writeFile(chunk);
      }
      const after = await input.stat();
      if (
        bytes !== initial.size ||
        JSON.stringify(identity(after)) !== JSON.stringify(identity(initial))
      )
        throw new Error('Closed source changed while reading.');
      result[name] = {
        device: String(initial.dev),
        inode: String(initial.ino),
        bytes,
        mtime: initial.mtimeMs,
        ctime: initial.ctimeMs,
        sha256: digest.digest('hex'),
      };
    } finally {
      await Promise.all([input.close(), output?.close()]);
    }
  }
  if (!result['workspace.sqlite']) throw new Error('Closed workspace database is missing.');
  return result;
}
const groupContents = (group: ColdGroup) =>
  coldFiles.map((name) => {
    const file = group[name];
    return [name, file ? { bytes: file.bytes, sha256: file.sha256 } : null];
  });
function coldError(error: unknown, stage: string) {
  const value = error as { code?: unknown; name?: unknown; stack?: unknown };
  const code =
    typeof value?.code === 'string' &&
    /^(?:SQLITE_(?:READONLY|CANTOPEN|IOERR|BUSY|LOCKED|NOTADB|CORRUPT|ERROR|MISUSE)(?:_[A-Z]{1,24})?|EROFS|ENOENT|EACCES)$/.test(
      value.code,
    )
      ? value.code
      : typeof value?.code === 'number' && Number.isSafeInteger(value.code)
        ? value.code
        : null;
  const names = ['Error', 'SqliteError', 'Sqlite3Error', 'LibsqlError', 'TypeError'];
  const line =
    typeof value?.stack === 'string'
      ? /restore-browser-fixture\.ts:(\d+):\d+/.exec(value.stack)?.[1]
      : undefined;
  return {
    stage,
    code,
    name: typeof value?.name === 'string' && names.includes(value.name) ? value.name : null,
    sourceLine: line === undefined ? null : Number(line),
  };
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
  const runId = process.env.SPINEL_RESTORE_HELPER_RUN;
  if (
    !runId ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(runId)
  )
    throw new Error('Fresh cold helper identity required.');
  let stage = 'closure';
  let before: ColdGroup | undefined;
  let copied: ColdGroup | undefined;
  let after: ColdGroup | undefined;
  let copySidecarsAfterFirstSelect: Record<
    string,
    { present: boolean; bytes: number | null }
  > | null = null;
  let failure: ReturnType<typeof coldError> | null = null;
  let proof:
    | {
        committed: true;
        restoredContent: boolean;
        originalSessionExcluded: boolean;
        counter: unknown;
      }
    | undefined;
  try {
    // The host independently confirmed physical closure before launching this
    // separate helper. The original named volume remains mounted read-only.
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
    stage = 'canonical-record';
    const source = JSON.parse(await readFile(join(directory, 'ready.json'), 'utf8')) as Seed;
    const names = await readdir(join(root, 'restore-jobs'));
    if (names.length !== 1) throw new Error('Expected one canonical restore job.');
    const completed: unknown = JSON.parse(
      await readFile(join(root, 'restore-jobs', names[0], 'state.json'), 'utf8'),
    );
    if (!validRestoreJobRecord(completed, names[0]) || completed.phase !== 'candidate-committed')
      throw new Error('Committed canonical outcome required.');
    stage = 'source-group';
    before = await closedGroup(data);
    const copy = await mkdtemp(join(tmpdir(), 'spinel-cold-'));
    stage = 'copy-group';
    const duringCopy = await closedGroup(data, copy);
    stage = 'copy-verification';
    copied = await closedGroup(copy);
    if (
      JSON.stringify(before) !== JSON.stringify(duringCopy) ||
      JSON.stringify(groupContents(before)) !== JSON.stringify(groupContents(copied))
    )
      throw new Error('Cold copy differs from the complete closed source group.');
    stage = 'database-open';
    const { DatabaseSync } = await import('../server/database.ts');
    // mode=ro preserves WAL visibility. A private writable directory permits
    // SQLite sidecar initialization; immutable=1 would incorrectly bypass WAL.
    const location = pathToFileURL(join(copy, 'workspace.sqlite'));
    location.searchParams.set('mode', 'ro');
    const db = new DatabaseSync(location.href);
    try {
      stage = 'content-query';
      const restoredContent =
        db.prepare('SELECT name FROM workspace_items WHERE id=?').get(source.folderId)?.name ===
        'Archived folder';
      stage = 'sidecar-observation';
      copySidecarsAfterFirstSelect = {};
      for (const name of coldFiles.slice(1)) {
        const file = await lstat(join(copy, name)).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (file && !file.isFile()) throw new Error('Unexpected cold sidecar type.');
        copySidecarsAfterFirstSelect[name] = { present: !!file, bytes: file?.size ?? null };
      }
      stage = 'session-query';
      const originalSessionExcluded =
        db
          .prepare('SELECT COUNT(*) AS count FROM auth_sessions WHERE token_hash=?')
          .get(completed.intent.authority.sessionHash)?.count === 0;
      stage = 'counter-query';
      const counter = db
        .prepare('SELECT counter FROM auth_passkeys WHERE id=?')
        .get(input.credentialId)?.counter;
      stage = 'assertions';
      if (
        !restoredContent ||
        !originalSessionExcluded ||
        typeof counter !== 'number' ||
        !Number.isSafeInteger(counter) ||
        counter < 4
      )
        throw new Error('Closed workspace assertions failed.');
      proof = { committed: true, restoredContent, originalSessionExcluded, counter };
    } finally {
      const priorStage = stage;
      stage = 'database-close';
      db.close();
      stage = priorStage;
    }
  } catch (error) {
    failure = coldError(error, stage);
  }
  try {
    stage = 'source-recheck';
    if (before) {
      after = await closedGroup(data);
      if (JSON.stringify(before) !== JSON.stringify(after))
        throw new Error('Original closed workspace changed during inspection.');
    }
  } catch (error) {
    failure ??= coldError(error, stage);
  }
  const sourceUnchanged = !!before && !!after && JSON.stringify(before) === JSON.stringify(after);
  await publish('cold-diagnostic.json', {
    runId,
    stage: failure?.stage ?? 'complete',
    failure,
    before: before ?? null,
    copied: copied ?? null,
    after: after ?? null,
    sourceUnchanged,
    copySidecarsAfterFirstSelect,
  });
  if (failure || !proof || !sourceUnchanged) process.exitCode = 1;
  else
    await publish('closed-proof.json', {
      ...proof,
      helperRunId: runId,
      sourceUnchanged,
      sourceGroup: before,
      copiedGroup: copied,
      copySidecarsAfterFirstSelect,
    });
  // The disposable copy belongs to this container. Remove its writable layer
  // only after Docker confirms helper exit, so native descriptors cannot outlive cleanup.
} else {
  throw new Error('Select the exited bootstrap or post-closure cold helper.');
}
