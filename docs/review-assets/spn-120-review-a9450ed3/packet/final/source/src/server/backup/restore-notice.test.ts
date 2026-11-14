import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { openDatabase } from '../../../server/database.ts';
import { RESTORE_NOTICE_MS } from '../../shared/restore.ts';
import { restoreMetadataSchema } from './restore-credentials.ts';
import { markRestoreOutcome, restoreNotice } from './restore-notice.ts';

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
  const at = Date.UTC(2026, 9, 30);
  markRestoreOutcome(db, 'restored', at);
  expect(
    JSON.parse(String(db.prepare('SELECT metadata FROM spinel_recovery').get()!.metadata)),
  ).toEqual({ ...archived, restoreOutcome: { outcome: 'restored', at } });
  expect(restoreNotice(db, at + 1)).toEqual({
    outcome: 'restored',
    at,
    backupCreatedAt: archived.createdAt,
  });
  expect(restoreNotice(db, at - 1)).toBeNull();
  expect(restoreNotice(db, at + RESTORE_NOTICE_MS)).toBeNull();
  // An undone restore keeps the original content, so it names no backup.
  markRestoreOutcome(db, 'recovered', at + 5);
  expect(restoreNotice(db, at + 6)).toEqual({ outcome: 'recovered', at: at + 5 });
  db.prepare('UPDATE spinel_recovery SET metadata=?').run(
    JSON.stringify({ ...archived, restoreOutcome: { outcome: 'other', at } }),
  );
  expect(restoreNotice(db, at + 1)).toBeNull();
  db.prepare('UPDATE spinel_recovery SET metadata=?').run('{not json');
  expect(restoreNotice(db, at + 1)).toBeNull();
  expect(() => markRestoreOutcome(db, 'restored', at)).toThrow();
});
