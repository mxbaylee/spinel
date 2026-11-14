/** Complete-app source fixture. Exit releases every SQLite/native handle before
 * the supervisor takes ownership; this process never makes controller decisions. */
import { randomBytes } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createApp } from '../../../server/app.ts';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { makeArchive } from '../backup/archive.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { captureRestoreAuthority } from './restore-authority.ts';

if (!process.send || !process.env.DATABASE_PATH) throw new Error('Private fixture required.');
const databasePath = process.env.DATABASE_PATH;
const directory = dirname(databasePath);
const staticDirectory = join(directory, 'assets');
const origin = 'https://spinel.example';
const image = `spinel@sha256:${'a'.repeat(64)}`;
await mkdir(staticDirectory, { mode: 0o700 });
await writeFile(join(staticDirectory, 'index.html'), '<html><body>Restore fixture</body></html>');
const app = await createApp({
  databasePath,
  staticDirectory,
  origin,
  image,
  backupConfigPath: join(directory, 'absent-backup-config'),
});
await app.close();
const database = openDatabase(databasePath);
try {
  const auth = new AuthStore(database);
  const operator = auth.createUser('Restore operator', true);
  const owner = auth.createUser('Workspace owner', false);
  const now = Date.now();
  database
    .prepare('INSERT INTO auth_passkeys VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(
      'first',
      operator.id,
      Buffer.from([1]),
      0,
      '[]',
      'first',
      'Browser',
      now,
      null,
      0,
      'singleDevice',
    );
  const session = auth.createSession(operator.id, undefined, 'first').session;
  auth.markVerified(session, 'first');
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  const folder = workspace.create(owner.id, {
    kind: 'folder',
    name: 'Archived folder',
    parentId: null,
  });
  const key = randomBytes(32);
  const keyFile = join(directory, 'backup.key');
  await writeFile(keyFile, key, { mode: 0o600, flag: 'wx' });
  const archive = await makeArchive(database, directory, key, {
    format: 1,
    createdAt: new Date().toISOString(),
    origin,
    image,
    runtimeEnvironment: 'NODE_ENV=production\n',
    keyId: 'current',
  });
  workspace.update(owner.id, folder.id, { name: 'Current folder' });
  await writeFile(
    join(directory, 'restore-source.json'),
    JSON.stringify({
      archive: archive.archive,
      keyFile,
      bytes: (await stat(archive.archive)).size,
      sha256: archive.sha256,
      folderId: folder.id,
    }),
    { mode: 0o600, flag: 'wx' },
  );
  // Capture only after the archive is complete; this is a fixed original proof,
  // never a renewal by the supervisor or a worker.
  process.send({
    restoreAuthority: captureRestoreAuthority(database, {
      actorId: operator.id,
      sessionHash: session.token_hash,
      expiresAt: now + 60_000,
    }),
  });
} finally {
  database.close();
  process.disconnect?.();
}
