import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { backup, DatabaseSync, openDatabase } from '../../../server/database.ts';
import { createApp } from '../../../server/app.ts';
import type { MaintenanceAdminStatus, MaintenanceBridge } from '../../shared/maintenance.ts';
import { publicMaintenance } from '../../shared/maintenance.ts';
import { copyClosedRestoreInput } from './restore-input.ts';
import type { ClosedRestoreInput } from './restore-input.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { SpaceStore } from '../workspace/spaces.ts';
import { resolveSpaceScope } from '../workspace/space-scope.ts';
import { migrateSpaceSchema } from '../workspace/space-schema.ts';
import { TrashStore } from '../workspace/trash.ts';
import { DocumentStore } from '../workspace/documents.ts';
import { CollaborationStore } from '../collaboration/service.ts';
import { OfflineCreations } from '../workspace/offline-creation.ts';
import { PortableFiles } from '../workspace/portable.ts';
import { McpDocuments } from '../mcp/documents.ts';
import { HistoryStore } from '../history/store.ts';
import { BackupService } from './service.ts';
import {
  recoveryInventory,
  restoreSnapshotFingerprint,
  verifyInventory,
  writeInventory,
} from './inventory.ts';
import { reconcileRestoreCandidate, reconcileRestoreRollback } from './restore-candidate.ts';
import { rotateRestoreGenerations } from './restore-generations.ts';
import { prepareRestoreRollback } from './restore-rollback.ts';
import { digest, makeArchive } from './archive.ts';
import { prepareRestoreArchive, reconcilePreparedRestore } from './verification.ts';
import type { ChildProcess } from 'node:child_process';

// Hooks affect only this parent process. The restricted child runs unmodified
// modules, including its own SQLite and cleanup operations.
const boundaries = vi.hoisted(() => ({
  remove: undefined as ((path: unknown) => void) | undefined,
  fork: undefined as ((child: ChildProcess) => void) | undefined,
  availableBytes: undefined as bigint | undefined,
}));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return {
    ...actual,
    statfs: async (...args: Parameters<typeof actual.statfs>) => {
      const value = await actual.statfs(...args);
      return boundaries.availableBytes === undefined
        ? value
        : { ...value, bsize: 1n, bavail: boundaries.availableBytes };
    },
    rm: async (...args: Parameters<typeof actual.rm>) => {
      await actual.rm(...args);
      boundaries.remove?.(args[0]);
    },
  };
});
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>();
  return {
    ...actual,
    fork: (...args: Parameters<typeof actual.fork>) => {
      const child = actual.fork(...args);
      boundaries.fork?.(child);
      return child;
    },
  };
});

vi.setConfig({ testTimeout: 30_000 });
const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  boundaries.remove = undefined;
  boundaries.fork = undefined;
  boundaries.availableBytes = undefined;
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
const options = { spacesEnabled: true, now: 1_000_000 };
async function fixture(completeStartup = false) {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-restore-candidate-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'current.sqlite');
  if (completeStartup) {
    await writeFile(join(directory, 'index.html'), 'Restore startup fixture');
    const initialized = await createApp({ databasePath, staticDirectory: directory });
    await initialized.close();
  }
  const db = openDatabase(databasePath);
  cleanup.push(() => db.close());
  const auth = new AuthStore(db, () => options.now),
    workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  migrateSpaceSchema(db);
  const owner = auth.createUser('Owner'),
    reader = auth.createUser('Collaborator');
  auth.createUser('Operator', true);
  const collaboration = new CollaborationStore(workspace, db.path);
  cleanup.push(() => collaboration.close());
  const service = new BackupService(db, {
    databasePath: db.path,
    origin: 'https://spinel.example',
  });
  cleanup.push(() => service.close());
  const docs = new DocumentStore(workspace);
  const doc = workspace.create(owner.id, { kind: 'doc', name: 'Archived', parentId: null });
  docs.save(owner.id, doc.id, {
    revision: 0,
    writeId: randomUUID(),
    snapshot: { id: doc.id, body: { dataStream: 'Retained\r\n' } },
  });
  await collaboration.prepare(owner.id, doc.id);
  const root = new SpaceStore(workspace).createRoot(owner.id, {
    name: 'Space',
    parentId: null,
  }).space;
  db.prepare('INSERT INTO workspace_grants VALUES(?,?,?,0)').run(root.id, reader.id, 'viewer');
  const session = auth.createSession(owner.id).token;
  if (completeStartup) {
    const history = new HistoryStore(workspace, collaboration);
    cleanup.push(() => history.close());
    await history.capture(owner.id, doc.id);
    const trash = workspace.create(owner.id, {
      kind: 'folder',
      name: 'Retained trash',
      parentId: null,
    });
    new TrashStore(workspace).trash(owner.id, trash.id);
  }
  // Simulate a database that was previously recovered. Its current inventory
  // will be stale after subsequent legitimate current writes.
  db.exec(
    'CREATE TABLE spinel_recovery (id INTEGER PRIMARY KEY CHECK(id=1), metadata TEXT NOT NULL, inventory TEXT) STRICT',
  );
  db.prepare('INSERT INTO spinel_recovery(id,metadata) VALUES(1,?)').run('{}');
  const snapshot = async () => {
    writeInventory(db);
    const path = join(directory, `${randomUUID()}.sqlite`);
    await backup(db, path);
    const candidate = new DatabaseSync(path);
    cleanup.push(() => candidate.close());
    return candidate;
  };
  return {
    directory,
    db,
    auth,
    workspace,
    owner,
    reader,
    doc,
    root,
    session,
    snapshot,
    collaboration,
  };
}

async function originalCopy(db: DatabaseSync, directory: string) {
  const path = join(directory, `${randomUUID()}.sqlite`);
  await backup(db, path);
  const copy = new DatabaseSync(path);
  cleanup.push(() => copy.close());
  return copy;
}

async function rollbackRequest(completeStartup = false) {
  const f = await fixture(completeStartup);
  f.db.exec('DROP TABLE spinel_recovery');
  const fingerprint = restoreSnapshotFingerprint(f.db);
  const path = join(f.directory, 'rollback-original.sqlite');
  await backup(f.db, path);
  await chmod(path, 0o600);
  const current = {
    databasePath: path,
    databaseBytes: (await stat(path)).size,
    databaseSha256: await digest(path),
    fingerprint,
  };
  return { f, request: { ...options, current, additional: [], stagingRoot: f.directory } };
}

async function verifyPreparedApplication(
  source: ClosedRestoreInput & { logicalFingerprint: string },
  stagingRoot: string,
) {
  const directory = await mkdtemp(join(stagingRoot, 'startup-'));
  const databasePath = join(directory, 'spinel.sqlite');
  await copyClosedRestoreInput(source, databasePath);
  await writeFile(join(directory, 'index.html'), 'Prepared startup fixture');
  const state: MaintenanceAdminStatus = {
    available: true,
    phase: 'starting',
    notice: null,
    epoch: randomUUID(),
    generationId: randomUUID(),
    operationId: randomUUID(),
    authorityExpiresAt: Date.now() + 60_000,
    lastFailure: null,
    readyToResume: false,
  };
  const bridge: MaintenanceBridge = {
    status: () => publicMaintenance(state),
    adminStatus: () => state,
    subscribe: () => () => {},
    async control() {
      throw new Error('Unexpected control');
    },
    ready() {},
    drained() {},
    fail() {},
    close() {},
  };
  const app = await createApp({ databasePath, staticDirectory: directory, maintenance: bridge });
  try {
    app.verifyPausedRestore({
      fingerprint: source.logicalFingerprint,
      epoch: state.epoch,
      generationId: state.generationId,
    });
    expect(() => app.maintenance.assertWrite()).toThrow();
  } finally {
    await app.close({
      async acceptRestoreWitness(value) {
        expect(value).toBe(source.logicalFingerprint);
      },
    });
  }
  // The staged original remains closed and byte-identical after startup/shutdown
  // of a disposable copy. Actual process handoff/activation is a different gate.
  expect(await digest(source.databasePath)).toBe(source.databaseSha256);
}

test('source verification reads its authenticated private copy after the transfer path changes', async () => {
  const f = await fixture(),
    key = randomBytes(32),
    keyFile = join(f.directory, 'source-key');
  await writeFile(keyFile, key, { mode: 0o600 });
  const recovery = {
    format: 1 as const,
    createdAt: '2026-10-29T00:00:00.000Z',
    origin: 'https://spinel.example',
    image: `sha256:${'a'.repeat(64)}`,
    runtimeEnvironment: '',
    keyId: 'current',
  };
  const archive = await makeArchive(f.db, f.directory, key, recovery);
  cleanup.push(archive.dispose);
  const bytes = await readFile(archive.archive);
  boundaries.fork = () => writeFileSync(archive.archive, Buffer.alloc(bytes.length));
  const prepared = await prepareRestoreArchive({
    archive: archive.archive,
    keyFile,
    stagingRoot: f.directory,
    expectedImage: recovery.image,
    expectedOrigin: recovery.origin,
    expectedArchive: { bytes: bytes.length, sha256: archive.sha256 },
  });
  cleanup.push(prepared.dispose);
  expect(prepared.recovery).toMatchObject({ createdAt: recovery.createdAt });
  expect(await readFile(prepared.archive.path)).toEqual(bytes);
  expect(await readFile(archive.archive)).not.toEqual(bytes);
});

test('real rollback worker prepares a closed private original and retires attempted native identities', async () => {
  const { f, request } = await rollbackRequest(true);
  const attempt = await originalCopy(f.db, f.directory);
  rotateRestoreGenerations(f.db, attempt);
  const retired = attempt
    .prepare('SELECT unit_id FROM spinel_live_units')
    .all()
    .map((row) => row.unit_id);
  const attemptPath = join(f.directory, 'retained-attempt.sqlite');
  await backup(attempt, attemptPath);
  await chmod(attemptPath, 0o600);
  const evidence = {
    databasePath: attemptPath,
    databaseBytes: (await stat(attemptPath)).size,
    databaseSha256: await digest(attemptPath),
  };
  const originals = [await readFile(request.current.databasePath), await readFile(attemptPath)];
  const maximum = 2 * request.current.databaseBytes;
  boundaries.availableBytes = BigInt(
    request.current.databaseBytes + evidence.databaseBytes + 256 * 1024 ** 2 + 3 * maximum,
  );
  let spawned!: ChildProcess;
  boundaries.fork = (child) => {
    spawned = child;
    vi.spyOn(child, 'send');
  };
  const prepared = await prepareRestoreRollback({ ...request, additional: [evidence] });
  cleanup.push(prepared.dispose);
  expect(vi.mocked(spawned.send).mock.calls[0][0]).toMatchObject({
    kind: 'rollback',
    maxDatabaseBytes: maximum,
  });
  expect(prepared.databaseBytes).toBeLessThanOrEqual(maximum);
  expect(await readdir(dirname(prepared.databasePath))).toEqual(['rollback.sqlite']);
  expect((await stat(prepared.databasePath)).mode & 0o777).toBe(0o600);
  expect(await digest(prepared.databasePath)).toBe(prepared.databaseSha256);
  await verifyPreparedApplication(prepared, f.directory);
  expect(prepared.originalFingerprint).toBe(request.current.fingerprint);
  expect(prepared.reconciliation.generations.rotated).toBe(1);
  expect([await readFile(request.current.databasePath), await readFile(attemptPath)]).toEqual(
    originals,
  );
  const output = new DatabaseSync(prepared.databasePath);
  cleanup.push(() => output.close());
  expect(prepared.logicalFingerprint).toBe(restoreSnapshotFingerprint(output));
  expect(verifyInventory(output)).toEqual({ tables: prepared.tables, rows: prepared.rows });
  for (const unit of retired) {
    expect(
      output
        .prepare("SELECT 1 FROM spinel_restore_fences WHERE kind='identity' AND id=?")
        .get(unit),
    ).toBeDefined();
    expect(
      output.prepare('SELECT 1 FROM spinel_live_units WHERE unit_id=?').get(unit),
    ).toBeUndefined();
  }
});

test('a wrong original witness is rejected by the actual rollback worker with complete staging cleanup', async () => {
  const { f, request } = await rollbackRequest();
  const original = await readFile(request.current.databasePath);
  await expect(
    prepareRestoreRollback({
      ...request,
      current: { ...request.current, fingerprint: 'f'.repeat(64) },
    }),
  ).rejects.toThrow();
  expect(await readFile(request.current.databasePath)).toEqual(original);
  expect(
    (await readdir(f.directory)).filter((name) => name.startsWith('.restore-rollback-')),
  ).toEqual([]);
});

test('actual rollback growth beyond the admitted disk cap fails without retaining output', async () => {
  const { f, request } = await rollbackRequest();
  const original = await readFile(request.current.databasePath);
  // VACUUM produced a compact original with no recovery table. Creating its
  // required inventory needs another page, but this allowance cannot grow it.
  boundaries.availableBytes = BigInt(256 * 1024 ** 2 + 4 * request.current.databaseBytes);
  await expect(prepareRestoreRollback(request)).rejects.toThrow();
  expect(await readFile(request.current.databasePath)).toEqual(original);
  expect(
    (await readdir(f.directory)).filter((name) => name.startsWith('.restore-rollback-')),
  ).toEqual([]);
});

test('rollback rejects changed input bytes and alias attempts without publishing output', async () => {
  const { f, request } = await rollbackRequest();
  await expect(
    prepareRestoreRollback({
      ...request,
      current: { ...request.current, databaseSha256: 'f'.repeat(64) },
    }),
  ).rejects.toThrow();
  await expect(
    prepareRestoreRollback({ ...request, additional: [request.current] }),
  ).rejects.toThrow('independent');
  const controller = new AbortController();
  controller.abort();
  await expect(prepareRestoreRollback({ ...request, signal: controller.signal })).rejects.toThrow();
  expect(
    (await readdir(f.directory)).filter((name) => name.startsWith('.restore-rollback-')),
  ).toEqual([]);
});

test('rollback cancellation at source-cleanup never publishes an otherwise valid result', async () => {
  const { f, request } = await rollbackRequest();
  const controller = new AbortController();
  boundaries.remove = (path) => {
    if (String(path).includes('.restore-rollback-') && String(path).endsWith('/current.sqlite'))
      controller.abort();
  };
  await expect(prepareRestoreRollback({ ...request, signal: controller.signal })).rejects.toThrow();
  expect(
    (await readdir(f.directory)).filter((name) => name.startsWith('.restore-rollback-')),
  ).toEqual([]);
});

test('rollback retains original ownership, filing and content with only attempted negative evidence', async () => {
  const f = await fixture();
  new OfflineCreations(f.workspace, f.collaboration);
  new PortableFiles(f.workspace, f.collaboration);
  new McpDocuments(f.workspace, f.collaboration);
  const history = new HistoryStore(f.workspace, f.collaboration);
  cleanup.push(() => history.close());
  await history.capture(f.owner.id, f.doc.id);
  f.db.prepare('INSERT INTO workspace_grants VALUES(?,?,?,0)').run(f.doc.id, f.reader.id, 'editor');
  f.db.prepare('INSERT INTO workspace_placements VALUES(?,?,NULL)').run(f.reader.id, f.doc.id);
  const trash = f.workspace.create(f.owner.id, {
    kind: 'folder',
    name: 'Original trash',
    parentId: null,
  });
  new TrashStore(f.workspace).trash(f.owner.id, trash.id);
  writeInventory(f.db);
  f.db
    .prepare('UPDATE workspace_items SET name=? WHERE id=?')
    .run('Original after backup', f.doc.id);
  expect(() => verifyInventory(f.db)).toThrow();
  const attempt = await originalCopy(f.db, f.directory);
  const rollback = await originalCopy(f.db, f.directory);
  const originalAgain = await originalCopy(f.db, f.directory);
  const again = await originalCopy(f.db, f.directory);
  const actor = new AuthStore(attempt).createUser('Attempt administrator', true);
  attempt
    .prepare('UPDATE workspace_items SET owner_id=?,name=? WHERE id=?')
    .run(actor.id, 'Attempt content', f.doc.id);
  attempt
    .prepare('UPDATE auth_users SET disabled=1,is_admin=1,name=? WHERE id=?')
    .run('Attempt authority', f.owner.id);
  const altered = JSON.parse(
    String(
      attempt.prepare('SELECT snapshot FROM spinel_sync_units WHERE unit_id=?').get(f.doc.id)!
        .snapshot,
    ),
  );
  altered.body.dataStream = 'Attempt body\r\n';
  attempt
    .prepare('UPDATE spinel_sync_units SET snapshot=? WHERE unit_id=?')
    .run(JSON.stringify(altered), f.doc.id);
  const item = randomUUID(),
    unit = randomUUID();
  attempt
    .prepare('INSERT INTO workspace_offline_creations VALUES(?,?,?,?,?)')
    .run(item, unit, actor.id, 'a'.repeat(64), actor.id);
  attempt
    .prepare('INSERT INTO mcp_writes VALUES(?,?,?,?)')
    .run('token:retired', 'request', 'b'.repeat(64), 10);
  const attemptGeneration = rotateRestoreGenerations(f.db, attempt);
  const before = [restoreSnapshotFingerprint(f.db), restoreSnapshotFingerprint(attempt)];
  const result = await reconcileRestoreRollback(f.db, rollback, [attempt], options);
  expect(result.generations.revisionOffset).toBeGreaterThan(attemptGeneration.revisionOffset);
  for (const table of [
    'workspace_items',
    'workspace_grants',
    'workspace_placements',
    'workspace_recovery_holds',
    'history_checkpoints',
  ])
    expect(rollback.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).toEqual(
      f.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all(),
    );
  expect(rollback.prepare('SELECT * FROM auth_users WHERE id=?').get(f.owner.id)).toEqual(f.owner);
  expect(rollback.prepare('SELECT * FROM auth_users WHERE id=?').get(actor.id)).toEqual({
    id: actor.id,
    name: 'Retained request identity',
    is_admin: 0,
    disabled: 1,
  });
  expect(
    rollback.prepare('SELECT 1 FROM auth_users WHERE id=?').get('token:retired'),
  ).toBeUndefined();
  expect(rollback.prepare('SELECT 1 FROM auth_sessions').get()).toBeUndefined();
  const restoredUnit = rollback
    .prepare('SELECT unit_id FROM spinel_live_units WHERE item_id=?')
    .get(f.doc.id)!.unit_id;
  expect(
    JSON.parse(
      String(
        rollback
          .prepare('SELECT snapshot FROM spinel_sync_units WHERE unit_id=?')
          .get(restoredUnit)!.snapshot,
      ),
    ).body.dataStream,
  ).toBe('Retained\r\n');
  expect(
    rollback.prepare('SELECT unit_id FROM workspace_offline_creations WHERE item_id=?').get(item),
  ).toEqual({ unit_id: unit });
  expect(
    rollback
      .prepare("SELECT 1 FROM spinel_restore_fences WHERE kind='identity' AND id=?")
      .get(unit),
  ).toBeDefined();
  expect([restoreSnapshotFingerprint(f.db), restoreSnapshotFingerprint(attempt)]).toEqual(before);
  expect(result.inventory).toEqual(verifyInventory(rollback));
  const repeated = await reconcileRestoreRollback(
    originalAgain,
    again,
    [attempt, rollback],
    options,
  );
  expect(repeated.generations.revisionOffset).toBeGreaterThan(result.generations.revisionOffset);
  expect(again.prepare('SELECT unit_id FROM spinel_live_units ORDER BY item_id').all()).not.toEqual(
    rollback.prepare('SELECT unit_id FROM spinel_live_units ORDER BY item_id').all(),
  );
});

test('rollback of a never-restored original establishes inventory without inventing a backup', async () => {
  const f = await fixture();
  f.db.exec('DROP TABLE spinel_recovery');
  const before = restoreSnapshotFingerprint(f.db);
  const candidate = await originalCopy(f.db, f.directory);
  const result = await reconcileRestoreRollback(f.db, candidate, [], options);
  expect(result.inventory).toEqual(verifyInventory(candidate));
  const metadata = JSON.parse(
    String(candidate.prepare('SELECT metadata FROM spinel_recovery').get()!.metadata),
  );
  expect(metadata).toEqual({
    format: 1,
    kind: 'supervised-rollback',
    originalFingerprint: before,
    preparedAt: options.now,
  });
  expect(restoreSnapshotFingerprint(f.db)).toBe(before);
  expect(
    f.db.prepare("SELECT 1 FROM sqlite_schema WHERE name='spinel_recovery'").get(),
  ).toBeUndefined();
});

test('rollback refuses a different logical original before changing credentials', async () => {
  const f = await fixture(),
    candidate = await f.snapshot();
  candidate
    .prepare('UPDATE workspace_items SET name=? WHERE id=?')
    .run('Different content', f.doc.id);
  writeInventory(candidate); // A valid inventory does not make it the original.
  const before = restoreSnapshotFingerprint(candidate);
  await expect(reconcileRestoreRollback(f.db, candidate, [], options)).rejects.toThrow(
    'frozen original',
  );
  expect(restoreSnapshotFingerprint(candidate)).toBe(before);
  expect(candidate.prepare('SELECT 1 FROM auth_sessions').get()).toBeDefined();
});

test('a late rollback failure invalidates the working copy and leaves all evidence sealed', async () => {
  const f = await fixture(),
    candidate = await f.snapshot();
  const attempt = await originalCopy(f.db, f.directory);
  const before = [restoreSnapshotFingerprint(f.db), restoreSnapshotFingerprint(attempt)];
  const prepare = candidate.prepare.bind(candidate);
  vi.spyOn(candidate, 'prepare').mockImplementation((sql) => {
    if (sql.includes('INSERT INTO spinel_live_units')) throw new Error('late rollback failure');
    return prepare(sql);
  });
  await expect(reconcileRestoreRollback(f.db, candidate, [attempt], options)).rejects.toThrow(
    'late rollback failure',
  );
  expect([restoreSnapshotFingerprint(f.db), restoreSnapshotFingerprint(attempt)]).toEqual(before);
  await expect(reconcileRestoreRollback(f.db, candidate, [attempt], options)).rejects.toThrow(
    'frozen original',
  );
  for (const db of [f.db, attempt])
    expect(() => db.prepare('UPDATE auth_users SET is_admin=1').run()).toThrow('cannot be changed');
});

test('composes current authority and Space access with archived content, fresh native identities and verified inventory', async () => {
  const f = await fixture();
  f.db.prepare('INSERT INTO workspace_grants VALUES(?,?,?,0)').run(f.doc.id, f.reader.id, 'editor');
  const gone = f.workspace.create(f.owner.id, {
    kind: 'folder',
    name: 'Recovered trash',
    parentId: null,
  });
  new TrashStore(f.workspace).trash(f.owner.id, gone.id);
  const candidate = await f.snapshot();
  const joined = f.auth.createUser('Joined after backup');
  f.db
    .prepare(
      "INSERT INTO auth_passkeys(id,user_id,public_key,counter,transports,name,provider,created_at,last_used_at,backed_up,device_type) VALUES('current-key',?,x'0102',7,'[]','Current key','fixture',100,NULL,0,'singleDevice')",
    )
    .run(joined.id);
  f.db.prepare('DELETE FROM workspace_grants WHERE item_id=?').run(f.doc.id);
  f.db.prepare('UPDATE workspace_items SET name=? WHERE id=?').run('Current', f.doc.id);
  f.db.exec("UPDATE backup_state SET last_good=200,lease=900,owner='current',job='verify'");
  expect(() => verifyInventory(f.db)).toThrow('does not match');
  const before = recoveryInventory(f.db);
  const result = await reconcileRestoreCandidate(f.db, candidate, options);
  expect(result.generations.rotated).toBe(1);
  expect(result.generations.initialized).toBe(1);
  expect(result.inventory).toEqual(verifyInventory(candidate));
  expect(candidate.prepare('SELECT name FROM workspace_items WHERE id=?').get(f.doc.id)!.name).toBe(
    'Archived',
  );
  expect(candidate.prepare('SELECT 1 FROM auth_sessions').get()).toBeUndefined();
  expect(candidate.prepare('SELECT name FROM auth_users WHERE id=?').get(joined.id)!.name).toBe(
    'Joined after backup',
  );
  expect(
    candidate.prepare("SELECT user_id,counter FROM auth_passkeys WHERE id='current-key'").get(),
  ).toEqual({ user_id: joined.id, counter: 7 });
  expect(
    candidate.prepare('SELECT 1 FROM workspace_grants WHERE item_id=?').get(f.doc.id),
  ).toBeUndefined();
  expect(
    candidate.prepare('SELECT role FROM workspace_grants WHERE item_id=?').get(f.root.id)!.role,
  ).toBe('viewer');
  expect(candidate.prepare('SELECT count(*) AS n FROM workspace_recovery_holds').get()!.n).toBe(1);
  const active = candidate
    .prepare('SELECT unit_id FROM spinel_live_units WHERE item_id=?')
    .get(f.doc.id)!.unit_id;
  expect(active).not.toBe(f.doc.id);
  expect(
    candidate
      .prepare("SELECT 1 FROM spinel_restore_fences WHERE kind='identity' AND id=?")
      .get(f.doc.id),
  ).toBeDefined();
  expect(candidate.prepare('SELECT last_good,lease,owner,job FROM backup_state').get()).toEqual({
    last_good: 200,
    lease: 0,
    owner: null,
    job: null,
  });
  expect(recoveryInventory(f.db)).toEqual(before);
  // Real Space permission reads use AuthStore's transaction wrapper. They must
  // work while INSERT/UPDATE and writable RETURNING remain denied on this copy.
  expect(resolveSpaceScope(f.auth, f.reader.id, f.root.id, f.root.id).access).toBe('viewer');
  expect(() => f.db.prepare('UPDATE auth_users SET name=? RETURNING id').all('changed')).toThrow(
    'frozen',
  );
  expect(() => candidate.exec('DELETE FROM workspace_items')).toThrow();
});

test('an authenticated inventory mismatch refuses before authority changes', async () => {
  const f = await fixture(),
    candidate = await f.snapshot();
  candidate.prepare('UPDATE auth_users SET name=? WHERE id=?').run('Tampered', f.owner.id);
  const before = recoveryInventory(candidate),
    current = recoveryInventory(f.db);
  await expect(reconcileRestoreCandidate(f.db, candidate, options)).rejects.toThrow(
    'does not match',
  );
  expect(recoveryInventory(candidate)).toEqual(before);
  expect(recoveryInventory(f.db)).toEqual(current);
});

test('matching old schemas cannot silently initialize a missing resolver index', async () => {
  const f = await fixture();
  f.db.exec('DROP INDEX workspace_links_expiry');
  const candidate = await f.snapshot(),
    before = recoveryInventory(candidate);
  const exec = vi.spyOn(f.db, 'exec');
  await expect(reconcileRestoreCandidate(f.db, candidate, options)).rejects.toThrow('compatible');
  expect(exec).not.toHaveBeenCalled();
  expect(recoveryInventory(candidate)).toEqual(before);
});

test('future constructor row side effects are detected even without a schema change', async () => {
  const f = await fixture(),
    candidate = await f.snapshot(),
    exec = f.db.exec.bind(f.db);
  vi.spyOn(f.db, 'exec').mockImplementation((sql) => {
    exec(sql);
    if (sql.includes('CREATE TABLE IF NOT EXISTS auth_users'))
      exec('UPDATE auth_users SET name=name');
  });
  await expect(reconcileRestoreCandidate(f.db, candidate, options)).rejects.toThrow('compatible');
  expect(candidate.prepare('SELECT count(*) AS n FROM auth_sessions').get()!.n).toBe(1);
});

test('late semantic failure publishes no result and makes the partially transformed candidate unusable for an in-place retry', async () => {
  const f = await fixture(),
    candidate = await f.snapshot(),
    current = recoveryInventory(f.db);
  // Semantic verification streams images, so inject at its actual read seam.
  const iterate = candidate.iterate.bind(candidate);
  vi.spyOn(candidate, 'iterate').mockImplementation(function* (sql, ...values) {
    if (sql === 'SELECT item_id,id,mime,data FROM doc_images')
      throw new Error('fixture semantic failure');
    yield* iterate(sql, ...values);
  });
  await expect(reconcileRestoreCandidate(f.db, candidate, options)).rejects.toThrow(
    'fixture semantic failure',
  );
  expect(candidate.prepare('SELECT 1 FROM auth_sessions').get()).toBeUndefined();
  expect(recoveryInventory(f.db)).toEqual(current);
  // Final verification deliberately leaves query_only set; only the worker may
  // discard this file and rebuild from immutable authenticated input.
  await expect(reconcileRestoreCandidate(f.db, candidate, options)).rejects.toThrow();
});

test('real isolated reconciliation publishes only the closed verified candidate, preserves inputs and removes current authority staging', async () => {
  const f = await fixture(true),
    key = randomBytes(32),
    keyFile = join(f.directory, 'recovery-key');
  await writeFile(keyFile, key, { mode: 0o600 });
  const recovery = {
    format: 1 as const,
    createdAt: '2026-10-29T00:00:00.000Z',
    origin: 'https://spinel.example',
    image: `sha256:${'a'.repeat(64)}`,
    runtimeEnvironment: 'DO_NOT_APPLY=archived\n',
    keyId: 'current',
  };
  const archive = await makeArchive(f.db, f.directory, key, recovery);
  cleanup.push(archive.dispose);
  const candidate = await prepareRestoreArchive({
    archive: archive.archive,
    expectedArchive: { bytes: (await stat(archive.archive)).size, sha256: archive.sha256 },
    keyFile,
    stagingRoot: f.directory,
    expectedOrigin: recovery.origin,
    expectedImage: recovery.image,
  });
  cleanup.push(candidate.dispose);
  const currentUser = f.auth.createUser('Joined after archive');
  f.db.prepare('UPDATE workspace_items SET name=? WHERE id=?').run('Current', f.doc.id);
  const currentPath = join(f.directory, 'frozen-current.sqlite');
  await backup(f.db, currentPath);
  await chmod(currentPath, 0o600);
  const current = {
    databasePath: currentPath,
    databaseBytes: (await stat(currentPath)).size,
    databaseSha256: await digest(currentPath),
  };
  const inputs = [
    await readFile(currentPath),
    await readFile(candidate.databasePath),
    await readFile(archive.archive),
  ];
  const request = {
    ...options,
    candidate,
    current,
    stagingRoot: f.directory,
    expectedOrigin: recovery.origin,
    expectedImage: recovery.image,
  };
  const maximum = candidate.databaseBytes * 2;
  boundaries.availableBytes = BigInt(current.databaseBytes + 256 * 1024 ** 2 + 3 * maximum);
  let spawned!: ChildProcess;
  boundaries.fork = (child) => {
    spawned = child;
    vi.spyOn(child, 'send');
  };
  const output = await reconcilePreparedRestore(request);
  cleanup.push(output.dispose);
  expect(vi.mocked(spawned.send).mock.calls[0][0]).toMatchObject({
    kind: 'reconcile',
    maxDatabaseBytes: maximum,
  });
  expect(output.databaseBytes).toBeLessThanOrEqual(maximum);
  expect(output.databasePath).not.toBe(candidate.databasePath);
  expect(output.recovery).toEqual(candidate.recovery);
  expect(output.databaseSha256).toBe(await digest(output.databasePath));
  await verifyPreparedApplication(output, f.directory);
  expect(output.reconciliation?.credentials.currentAccounts).toBe(4);
  expect(output.reconciliation?.generations.rotated).toBe(1);
  expect(await readdir(dirname(dirname(output.databasePath)))).toEqual(['restored']);
  expect(await readdir(dirname(output.databasePath))).toEqual(['spinel.sqlite']);
  const opened = new DatabaseSync(output.databasePath);
  try {
    expect(output.logicalFingerprint).toBe(restoreSnapshotFingerprint(opened));
    expect(verifyInventory(opened)).toEqual({ tables: output.tables, rows: output.rows });
    expect(opened.prepare('SELECT name FROM workspace_items WHERE id=?').get(f.doc.id)!.name).toBe(
      'Archived',
    );
    expect(opened.prepare('SELECT name FROM auth_users WHERE id=?').get(currentUser.id)!.name).toBe(
      'Joined after archive',
    );
    expect(opened.prepare('SELECT 1 FROM auth_sessions').get()).toBeUndefined();
  } finally {
    opened.close();
  }
  expect([
    await readFile(currentPath),
    await readFile(candidate.databasePath),
    await readFile(archive.archive),
  ]).toEqual(inputs);
  await output.dispose();
  await expect(reconcilePreparedRestore({ ...request, timeoutMs: 1 })).rejects.toThrow();
  const cancelled = new AbortController();
  cancelled.abort();
  await expect(
    reconcilePreparedRestore({ ...request, signal: cancelled.signal }),
  ).rejects.toThrow();
  // Both copies exist when fork occurs; cancel the actual child and prove cleanup.
  const activeCancellation = new AbortController();
  let reachedFork = false;
  boundaries.fork = () => {
    reachedFork = true;
    queueMicrotask(() => activeCancellation.abort());
  };
  await expect(
    reconcilePreparedRestore({ ...request, signal: activeCancellation.signal }),
  ).rejects.toThrow();
  expect(reachedFork).toBe(true);
  boundaries.fork = undefined;
  // Stop only this owned child so the real timeout must kill and reap it.
  reachedFork = false;
  boundaries.fork = (child) => {
    reachedFork = true;
    child.kill('SIGSTOP');
  };
  await expect(reconcilePreparedRestore({ ...request, timeoutMs: 2_000 })).rejects.toThrow(
    'time limit',
  );
  expect(reachedFork).toBe(true);
  boundaries.fork = undefined;
  const atPublication = (path: unknown) =>
    typeof path === 'string' &&
    path.includes('.restore-reconciled-') &&
    path.endsWith('/current.sqlite');
  const lateCancellation = new AbortController();
  boundaries.remove = (path) => {
    if (atPublication(path)) lateCancellation.abort();
  };
  await expect(
    reconcilePreparedRestore({ ...request, signal: lateCancellation.signal }),
  ).rejects.toThrow();
  expect(lateCancellation.signal.aborted).toBe(true);
  boundaries.remove = (path) => {
    if (atPublication(path)) vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_001);
  };
  await expect(reconcilePreparedRestore(request)).rejects.toThrow('time limit');
  vi.restoreAllMocks();
  boundaries.remove = undefined;
  expect(await readFile(currentPath)).toEqual(inputs[0]);
  // Refuse after credential overlay inside the real worker; expose no raw SQL.
  const incompatible = new DatabaseSync(currentPath);
  incompatible.prepare("UPDATE workspace_items SET kind='sheet' WHERE id=?").run(f.doc.id);
  incompatible.close();
  current.databaseSha256 = await digest(currentPath);
  current.databaseBytes = (await stat(currentPath)).size;
  const incompatibleBytes = await readFile(currentPath);
  await expect(reconcilePreparedRestore(request)).rejects.toThrow('Recovery verification failed');
  expect(await readFile(currentPath)).toEqual(incompatibleBytes);
  // A changed source is refused during bounded copy, before any SQLite opening.
  const changed = Buffer.from(inputs[0]);
  changed[0] ^= 1;
  await writeFile(currentPath, changed);
  await expect(reconcilePreparedRestore(request)).rejects.toThrow('changed');
  expect(
    (await readdir(f.directory)).filter((name) => name.startsWith('.restore-reconciled-')),
  ).toEqual([]);
  expect(await readFile(candidate.databasePath)).toEqual(inputs[1]);
  expect(await readFile(archive.archive)).toEqual(inputs[2]);
}, 120_000);
