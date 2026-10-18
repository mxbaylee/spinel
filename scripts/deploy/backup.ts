import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readKey, restoreArchive } from '../../src/server/backup/archive.ts';
import { loadConfig, SpacesStore } from '../../src/server/backup/spaces.ts';
import { BackupService } from '../../src/server/backup/service.ts';

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'keygen' && args.length === 1) {
    await writeFile(args[0], randomBytes(32), { flag: 'wx', mode: 0o600 });
    console.log('Key created. Keep a separate private recovery copy before enabling backups.');
  } else if (command === 'run' && args.length === 0) {
    const path = resolve(process.env.DATABASE_PATH ?? 'data/spinel.sqlite');
    // Opening read/write must never silently create a new source database.
    const { stat } = await import('node:fs/promises');
    await stat(path);
    const db = new DatabaseSync(path);
    db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');
    const service = new BackupService(db, {
      databasePath: path,
      origin: process.env.APP_ORIGIN ?? '',
      image: process.env.SPINEL_IMAGE,
      configPath: process.env.BACKUP_CONFIG_PATH,
    });
    try {
      if (!(await service.run())) throw new Error('Backup failed or another run holds the lease.');
    } finally {
      await service.close();
      db.close();
    }
    console.log('Backup uploaded, verified and retention applied.');
  } else if (command === 'list' && args.length === 1) {
    const remote = new SpacesStore(await loadConfig(args[0]));
    try {
      console.log((await remote.list(AbortSignal.timeout(60_000))).join('\n'));
    } finally {
      remote.close();
    }
  } else if (command === 'download' && args.length === 3) {
    const remote = new SpacesStore(await loadConfig(args[0]));
    try {
      await remote.download(args[1], args[2]);
    } finally {
      remote.close();
    }
    console.log('Encrypted backup downloaded. Restore authenticates it with your recovery key.');
  } else if (command === 'restore' && args.length === 4) {
    await restoreArchive(args[0], await readKey(args[1]), args[2], args[3]);
    console.log(
      'Restore validated. Review private recovery.json and start the recorded app image with the restored database.',
    );
  } else {
    throw new Error(
      'Usage: keygen KEY | run | list CONFIG | download CONFIG OBJECT OUTPUT | restore ARCHIVE KEY ENCRYPTED_STAGING NEW_DIRECTORY',
    );
  }
} catch {
  console.error(
    'Backup command failed. Check arguments, private file permissions, free space, storage access and recovery key. Existing destinations are never overwritten.',
  );
  process.exitCode = 1;
}
