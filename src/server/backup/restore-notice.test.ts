import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { openDatabase } from '../../../server/database.ts';
import { RESTORE_NOTICE_MS } from '../../shared/restore.ts';
import { restoreMetadataSchema } from './restore-credentials.ts';
import { markRestoredWorkspace, restoreNotice } from './restore-notice.ts';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function database() {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-restore-notice-'));
  const db = openDatabase(join(directory, 'spinel.sqlite'));
  cleanups.push(async () => {
    db.close();
    await rm(directory, { recursive: true, force: true });
  });
  return db;
}

test('only the restore and backup dates leave archived recovery metadata', async () => {
  const db = await database();
  expect(restoreNotice(db, Date.now())).toBeNull();
  db.exec(restoreMetadataSchema);
  const archived = {
    format: 1,
    createdAt: '2026-10-28T02:00:00.000Z',
    origin: 'https://spinel.example',
    image: `sha256:${'a'.repeat(64)}`,
    runtimeEnvironment: 'SECRET=value',
  };
  db.prepare('INSERT INTO spinel_recovery(id,metadata) VALUES(1,?)').run(JSON.stringify(archived));
  // An archive or never-restored rollback provenance has no restore time yet.
  expect(restoreNotice(db, Date.now())).toBeNull();
  const restoredAt = Date.UTC(2026, 9, 30);
  markRestoredWorkspace(db, restoredAt);
  expect(
    JSON.parse(String(db.prepare('SELECT metadata FROM spinel_recovery').get()!.metadata)),
  ).toEqual({ ...archived, restoredAt });
  expect(restoreNotice(db, restoredAt + 1)).toEqual({
    restoredAt,
    backupCreatedAt: archived.createdAt,
  });
  expect(restoreNotice(db, restoredAt - 1)).toBeNull();
  expect(restoreNotice(db, restoredAt + RESTORE_NOTICE_MS)).toBeNull();
  db.prepare('UPDATE spinel_recovery SET metadata=?').run('{not json');
  expect(restoreNotice(db, restoredAt + 1)).toBeNull();
  expect(() => markRestoredWorkspace(db, restoredAt)).toThrow();
});
