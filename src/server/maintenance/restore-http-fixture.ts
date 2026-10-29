/** Synthetic credential/schema bootstrap only. All sessions and fresh proofs in
 * the acceptance test are created by production HTTP/WebAuthn verification. */
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createApp } from '../../../server/app.ts';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { makeArchive } from '../backup/archive.ts';
import { WorkspaceStore } from '../workspace/store.ts';

export interface RestoreHttpSeed {
  operatorId: string;
  folderId: string;
  archive: string;
  keyFile: string;
  bytes: number;
  sha256: string;
}

if (!process.send || !process.env.DATABASE_PATH) throw new Error('Private fixture required.');
try {
  const [input] = await once(process, 'message');
  if (
    input?.kind !== 'credential' ||
    !/^[A-Za-z0-9_-]{43}$/.test(input.id) ||
    typeof input.publicKey !== 'string'
  )
    throw new Error('Invalid fixture credential.');
  const publicKey = Buffer.from(input.publicKey, 'base64url');
  if (publicKey.length !== 77) throw new Error('Invalid fixture credential.');
  const databasePath = process.env.DATABASE_PATH;
  const directory = dirname(databasePath),
    staticDirectory = join(directory, 'assets');
  await mkdir(staticDirectory, { mode: 0o700 });
  await writeFile(join(staticDirectory, 'index.html'), '<html><body>Restore fixture</body></html>');
  const origin = 'https://spinel.example',
    image = `spinel@sha256:${'a'.repeat(64)}`;
  const app = await createApp({
    databasePath,
    staticDirectory,
    origin,
    image,
    backupConfigPath: join(directory, 'absent-backup-config'),
  });
  await app.close();
  const database = openDatabase(databasePath);
  const key = randomBytes(32);
  try {
    const auth = new AuthStore(database);
    const operator = auth.createUser('HTTP restore operator', true);
    const owner = auth.createUser('Workspace owner', false);
    database
      .prepare(
        `INSERT INTO auth_passkeys
      (id,user_id,public_key,counter,transports,name,provider,created_at,last_used_at,backed_up,device_type)
      VALUES(?,?,?,0,'[]','HTTP fixture','Browser',?,NULL,0,'singleDevice')`,
      )
      .run(input.id, operator.id, publicKey, Date.now());
    const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
    const folder = workspace.create(owner.id, {
      kind: 'folder',
      name: 'Archived folder',
      parentId: null,
    });
    const keyFile = join(directory, 'archive.key');
    await writeFile(keyFile, key, { mode: 0o600, flag: 'wx' });
    const archive = await makeArchive(database, directory, key, {
      format: 1,
      createdAt: new Date().toISOString(),
      origin,
      image,
      runtimeEnvironment: 'NODE_ENV=production\n',
      keyId: 'http-fixture',
    });
    workspace.update(owner.id, folder.id, { name: 'Current folder' });
    const result: RestoreHttpSeed = {
      operatorId: operator.id,
      folderId: folder.id,
      archive: archive.archive,
      keyFile,
      bytes: (await stat(archive.archive)).size,
      sha256: archive.sha256,
    };
    await new Promise<void>((resolve, reject) =>
      process.send!(result, (error) => (error ? reject(error) : resolve())),
    );
  } finally {
    key.fill(0);
    database.close();
  }
} catch {
  // Neither private paths nor key/session material belongs in fixture output.
  process.exitCode = 1;
} finally {
  process.disconnect?.();
}
