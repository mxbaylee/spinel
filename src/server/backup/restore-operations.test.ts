import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { backup, DatabaseSync, openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { BackupService } from './service.ts';
import { reconcileRestoreOperations } from './restore-operations.ts';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'spinel-restore-operations-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const db = openDatabase(join(root, 'current.sqlite'));
  cleanup.push(() => db.close());
  new WorkspaceStore(new AuthStore(db));
  const service = new BackupService(db, {
    databasePath: db.path,
    origin: 'https://spinel.example',
  });
  cleanup.push(() => service.close());
  const snapshot = async () => {
    const path = join(root, 'candidate.sqlite');
    await backup(db, path);
    const candidate = new DatabaseSync(path);
    cleanup.push(() => candidate.close());
    return candidate;
  };
  return { db, snapshot };
}
const history = (db: DatabaseSync) =>
  ['backup_state', 'verification_state'].map((table) => db.prepare(`SELECT * FROM ${table}`).all());

test('current publication history and retention pin replace archived successes and leases without claiming a new publication', async () => {
  const f = await fixture();
  f.db.exec(
    "UPDATE backup_state SET last_good=999999, lease=999999, owner='archived', job='backup', publication_identity='old-destination'; UPDATE verification_state SET last_good=999999, lease=999999, owner='archived', backup_key='old-pin'",
  );
  const candidate = await f.snapshot();
  f.db.exec(
    "UPDATE backup_state SET last_attempt=200, last_good=150, error='Current safe failure', lease=300, owner='current', job='verify', publication_identity='current-destination', publication_destination='filesystem', publication_key_id='current-key'; UPDATE verification_state SET last_attempt=220, last_good=180, error='Current safe verification failure', lease=300, owner='current', backup_key='current-pin', key_id='retained-key', identity='current-verifier'",
  );
  const original = history(f.db);
  expect(reconcileRestoreOperations(f.db, candidate)).toEqual({ copied: 2, defaulted: 0 });
  expect(history(candidate)).toEqual(
    original.map((rows, index) =>
      rows.map((row) => ({ ...row, lease: 0, owner: null, ...(index === 0 && { job: null }) })),
    ),
  );
  expect(history(f.db)).toEqual(original);
  expect(candidate.prepare('SELECT backup_key FROM verification_state').get()!.backup_key).toBe(
    'current-pin',
  );
  reconcileRestoreOperations(f.db, candidate);
  expect(candidate.prepare('SELECT last_good FROM backup_state').get()!.last_good).toBe(150);
});

test('missing current history produces empty defaults, never archived success or a stale pin', async () => {
  const f = await fixture();
  f.db.exec(
    "UPDATE backup_state SET last_good=999999; UPDATE verification_state SET last_good=999999, backup_key='archived-pin'",
  );
  const candidate = await f.snapshot();
  f.db.exec('DELETE FROM backup_state; DELETE FROM verification_state');
  expect(reconcileRestoreOperations(f.db, candidate)).toEqual({ copied: 0, defaulted: 2 });
  expect(candidate.prepare('SELECT last_good,lease,owner,job FROM backup_state').get()).toEqual({
    last_good: null,
    lease: 0,
    owner: null,
    job: null,
  });
  expect(
    candidate.prepare('SELECT last_good,backup_key,lease,owner FROM verification_state').get(),
  ).toEqual({ last_good: null, backup_key: null, lease: 0, owner: null });
});

test('later history failure restores every archived record and leaves current evidence unchanged', async () => {
  const f = await fixture(),
    candidate = await f.snapshot();
  f.db.exec('UPDATE backup_state SET last_good=100; UPDATE verification_state SET last_good=200');
  const before = history(candidate),
    original = history(f.db),
    prepare = candidate.prepare.bind(candidate);
  vi.spyOn(candidate, 'prepare').mockImplementation((sql) => {
    if (sql.startsWith('INSERT INTO verification_state')) throw new Error('fixture failure');
    return prepare(sql);
  });
  expect(() => reconcileRestoreOperations(f.db, candidate)).toThrow('fixture failure');
  expect(history(candidate)).toEqual(before);
  expect(history(f.db)).toEqual(original);
  expect(() => reconcileRestoreOperations(f.db, f.db)).toThrow('reconciliation');
});

test.each([-1, Number.MAX_SAFE_INTEGER + 1])(
  'invalid current timestamp %s refuses before publishing history',
  async (timestamp) => {
    const f = await fixture(),
      candidate = await f.snapshot(),
      before = history(candidate);
    f.db.prepare('UPDATE backup_state SET last_good=?').run(timestamp);
    expect(() => reconcileRestoreOperations(f.db, candidate)).toThrow('reconciliation');
    expect(history(candidate)).toEqual(before);
  },
);

test('matching but unknown operational columns require explicit reconciliation support', async () => {
  const f = await fixture();
  f.db.exec('ALTER TABLE verification_state ADD COLUMN future_policy TEXT');
  const candidate = await f.snapshot(),
    before = history(candidate);
  f.db.prepare('UPDATE backup_state SET last_good=200').run();
  expect(() => reconcileRestoreOperations(f.db, candidate)).toThrow('reconciliation');
  expect(history(candidate)).toEqual(before);
});
