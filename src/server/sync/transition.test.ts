import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
  readdirSync,
  renameSync,
  statSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import type { IDocumentData } from '@univerjs/core';
import { materialize } from '@spinel/sync-server';
import { DatabaseSync } from '../../../server/database.ts';
import * as databaseModule from '../../../server/database.ts';
import { transitionFixture } from '../../../scripts/sync-transition/fixture.ts';
import { verifyTransitionFixture } from '../../../scripts/sync-transition/verify.ts';
import { digest } from '../backup/archive.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { holdRestoredTrash } from '../workspace/recovery-holds.ts';
import { restoreFenceSchema } from '../collaboration/restore-fences.ts';
import { SQLiteSyncStorage } from './store.ts';
import {
  assertSyncTransitionReady,
  exportSyncTransition,
  importSyncTransition,
  markNativeSyncActivated,
} from './transition.ts';
import type { LegacyTransitionReaderFactory } from './transition.ts';

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return {
    ...original,
    writeFileSync: vi.fn(original.writeFileSync),
    renameSync: vi.fn(original.renameSync),
    rmSync: vi.fn(original.rmSync),
  };
});

vi.setConfig({ testTimeout: 30_000 });
const cleanup: (() => void)[] = [];
afterEach(async () => {
  const original = await vi.importActual<typeof import('node:fs')>('node:fs');
  vi.mocked(writeFileSync).mockImplementation(original.writeFileSync);
  vi.mocked(renameSync).mockImplementation(original.renameSync);
  vi.mocked(rmSync).mockImplementation(original.rmSync);
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) close();
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'spinel-transition-'));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, 'source.sqlite');
  const data = transitionFixture(source);
  cleanup.push(() => {
    if (data.db.isOpen) data.db.close();
  });
  const loads = vi.fn(async (unitId: string) => {
    const unit = data.units.find((candidate) => candidate.unitId === unitId);
    if (!unit) throw new Error('UNIT_NOT_FOUND');
    return { snapshot: structuredClone(unit.snapshot), revision: unit.revision };
  });
  const close = vi.fn(async () => {});
  const purge = vi.fn(async () => {});
  const assertMissing = vi.fn(async () => {});
  const legacy: LegacyTransitionReaderFactory = async (path) => {
    expect(path).not.toBe(source);
    expect(path).not.toBe(join(directory, 'bundle/source.sqlite'));
    return { load: loads, purge, assertMissing, close };
  };
  return {
    directory,
    source,
    data,
    loads,
    close,
    purge,
    assertMissing,
    legacy,
    bundle: join(directory, 'bundle'),
    destination: join(directory, 'destination'),
  };
}

test('all retained metadata and public snapshots survive a source-copy conversion and native edit/recovery boundaries', async () => {
  const f = fixture();
  const original = await digest(f.source);
  const progress = vi.fn();
  expect(
    await exportSyncTransition({
      source: f.source,
      directory: f.bundle,
      legacy: f.legacy,
      progress,
    }),
  ).toMatchObject({ documents: 7, converted: 5 });
  const sourceCopyHash = await digest(join(f.bundle, 'source.sqlite'));
  const result = await importSyncTransition({
    directory: f.bundle,
    destination: f.destination,
    progress,
  });
  expect(f.loads).toHaveBeenCalledTimes(5);
  expect(f.close).toHaveBeenCalledTimes(3);
  expect(await digest(f.source)).toBe(original);
  expect(await digest(join(f.bundle, 'source.sqlite'))).toBe(sourceCopyHash);
  expect(
    await importSyncTransition({ directory: f.bundle, destination: f.destination }),
  ).toMatchObject({ resumed: true });
  await verifyTransitionFixture(result.path, f.data, f.directory);
  const afterEdits = await digest(result.path);
  // A served copy has diverged from the migration receipt; preserve it and refuse
  // to claim it is still the original verified output.
  await expect(
    importSyncTransition({ directory: f.bundle, destination: f.destination }),
  ).rejects.toThrow('verification');
  expect(await digest(result.path)).toBe(afterEdits);
  const messages = JSON.stringify(progress.mock.calls);
  for (const secret of [
    'Retained budget',
    'Retained journal',
    'Retained private cell',
    f.data.owner.id,
    f.data.token.token,
  ])
    expect(messages).not.toContain(secret);
  for (const [event] of progress.mock.calls)
    expect(Object.keys(event).sort()).toEqual(['completed', 'event', 'total']);
});

test('transition retains populated workspace recovery holds and permanent retry fences', async () => {
  const f = fixture();
  holdRestoredTrash(f.data.db);
  f.data.db.exec(restoreFenceSchema);
  f.data.db.prepare('INSERT INTO spinel_restore_fences VALUES(?,?)').run('identity', randomUUID());
  f.data.db.prepare('INSERT INTO spinel_restore_fences VALUES(?,?)').run('request', randomUUID());
  f.data.db.exec('UPDATE spinel_restore_revision SET revision=500');
  const fences = f.data.db.prepare('SELECT * FROM spinel_restore_fences ORDER BY kind,id').all();
  const expected = f.data.db.prepare('SELECT * FROM workspace_recovery_holds').all();
  expect(expected.length).toBeGreaterThan(0);
  await exportSyncTransition({ source: f.source, directory: f.bundle, legacy: f.legacy });
  const result = await importSyncTransition({ directory: f.bundle, destination: f.destination });
  const db = new DatabaseSync(result.path);
  try {
    expect(db.prepare('SELECT * FROM workspace_recovery_holds').all()).toEqual(expected);
    expect(db.prepare('SELECT revision FROM spinel_restore_revision').get()!.revision).toBe(500);
    expect(db.prepare('SELECT * FROM spinel_restore_fences ORDER BY kind,id').all()).toEqual(
      fences,
    );
  } finally {
    db.close();
  }
  expect(f.data.db.prepare('SELECT * FROM workspace_recovery_holds').all()).toEqual(expected);
  expect(f.data.db.prepare('SELECT * FROM spinel_restore_fences ORDER BY kind,id').all()).toEqual(
    fences,
  );
});

test('interrupted export resumes only the frozen copy and never exports completed units twice', async () => {
  const f = fixture();
  await expect(
    exportSyncTransition({
      source: f.source,
      directory: f.bundle,
      legacy: f.legacy,
      progress() {
        throw new Error('simulated interruption');
      },
    }),
  ).rejects.toThrow('simulated interruption');
  expect(f.loads).toHaveBeenCalledTimes(1);
  const first = f.loads.mock.calls[0][0];
  await exportSyncTransition({ source: f.source, directory: f.bundle, legacy: f.legacy });
  expect(f.loads).toHaveBeenCalledTimes(5);
  expect(f.loads.mock.calls.filter(([id]) => id === first)).toHaveLength(1);
  expect(
    await importSyncTransition({ directory: f.bundle, destination: f.destination }),
  ).toMatchObject({ converted: 5 });
});

test('public SDK cleanup probes native, unopened and detached native IDs without exporting or changing native units', async () => {
  const f = fixture();
  const storage = new SQLiteSyncStorage(f.data.auth);
  const native = storage.load(f.data.native.id)!;
  const detachedId = randomUUID();
  storage.create(
    { ...native, unitId: detachedId, snapshot: { ...native.snapshot, id: detachedId } },
    () => {},
  );
  const retained = f.data.db.prepare('SELECT * FROM spinel_sync_units ORDER BY unit_id').all();
  const original = await digest(f.source);
  await exportSyncTransition({ source: f.source, directory: f.bundle, legacy: f.legacy });
  const expectedIds = expect.arrayContaining([
    f.data.native.id,
    f.data.unopened.id,
    detachedId,
    f.data.doc.id,
    f.data.generation,
  ]);
  expect(f.purge).toHaveBeenCalledExactlyOnceWith(expectedIds);
  expect(f.assertMissing).toHaveBeenCalledExactlyOnceWith(expectedIds);
  expect(f.loads).toHaveBeenCalledTimes(f.data.units.length);
  for (const id of [f.data.native.id, f.data.unopened.id, detachedId])
    expect(f.loads.mock.calls.map(([unitId]) => unitId)).not.toContain(id);
  const result = await importSyncTransition({ directory: f.bundle, destination: f.destination });
  const target = new DatabaseSync(result.path);
  try {
    for (const row of retained)
      expect(
        target.prepare('SELECT * FROM spinel_sync_units WHERE unit_id=?').get(row.unit_id),
      ).toEqual(row);
  } finally {
    target.close();
  }
  expect(await digest(f.source)).toBe(original);
});

test('interrupted import keeps a server fence, preserves original heads and generation offsets, and verifies completed units on resume', async () => {
  const f = fixture();
  f.data.units.find((unit) => unit.itemId === f.data.sheet.id)!.revision = 17;
  await exportSyncTransition({ source: f.source, directory: f.bundle, legacy: f.legacy });
  await expect(
    importSyncTransition({
      directory: f.bundle,
      destination: f.destination,
      progress(event) {
        if (event.event === 'sync_transition.imported') throw new Error('simulated interruption');
      },
    }),
  ).rejects.toThrow('simulated interruption');
  expect(existsSync(join(f.destination, 'spinel.sqlite'))).toBe(false);
  const partial = new DatabaseSync(join(f.destination, 'pending.sqlite'));
  expect(() => assertSyncTransitionReady(partial)).toThrow('Finish the offline');
  expect(
    partial.prepare('SELECT count(*) AS count FROM spinel_sync_transition_units').get()?.count,
  ).toBe(1);
  partial.close();
  const result = await importSyncTransition({ directory: f.bundle, destination: f.destination });
  const target = new DatabaseSync(result.path);
  try {
    expect(() => assertSyncTransitionReady(target)).not.toThrow();
    expect(
      target
        .prepare('SELECT revision,retained_from FROM spinel_sync_units WHERE unit_id=?')
        .get(f.data.sheet.id),
    ).toEqual({ revision: 17, retained_from: 17 });
    expect(
      target
        .prepare('SELECT unit_id,revision_offset FROM spinel_live_units WHERE item_id=?')
        .get(f.data.doc.id),
    ).toEqual({ unit_id: f.data.generation, revision_offset: 7 });
    expect(
      target.prepare('SELECT count(*) AS count FROM spinel_sync_transition_units').get()?.count,
    ).toBe(5);
  } finally {
    target.close();
  }
});

test('changed exported payloads or source copies cannot resume or publish an import', async () => {
  const f = fixture();
  await exportSyncTransition({ source: f.source, directory: f.bundle, legacy: f.legacy });
  const manifest = JSON.parse(readFileSync(join(f.bundle, 'transition.json'), 'utf8'));
  const path = join(f.bundle, manifest.units[0].file);
  const original = readFileSync(path);
  writeFileSync(path, Buffer.concat([original, Buffer.from(' ')]));
  await expect(
    importSyncTransition({ directory: f.bundle, destination: f.destination }),
  ).rejects.toThrow('verification');
  expect(existsSync(join(f.destination, 'spinel.sqlite'))).toBe(false);
  writeFileSync(path, original);
  const copy = new DatabaseSync(join(f.bundle, 'source.sqlite'));
  copy.prepare('UPDATE auth_users SET name=? WHERE id=?').run('Tampered', f.data.owner.id);
  copy.close();
  await expect(
    importSyncTransition({ directory: f.bundle, destination: f.destination }),
  ).rejects.toThrow('verification');
});

test('modified finished units and changed retry manifests remain fenced instead of being overwritten', async () => {
  const f = fixture();
  await exportSyncTransition({ source: f.source, directory: f.bundle, legacy: f.legacy });
  await expect(
    importSyncTransition({
      directory: f.bundle,
      destination: f.destination,
      progress() {
        throw new Error('interrupt');
      },
    }),
  ).rejects.toThrow('interrupt');
  const partial = new DatabaseSync(join(f.destination, 'pending.sqlite'));
  partial.exec(
    'UPDATE spinel_sync_units SET revision=revision+1 WHERE unit_id IN (SELECT unit_id FROM spinel_sync_transition_units)',
  );
  partial.close();
  await expect(
    importSyncTransition({ directory: f.bundle, destination: f.destination }),
  ).rejects.toThrow('verification');
  expect(existsSync(join(f.destination, 'spinel.sqlite'))).toBe(false);
  const path = join(f.bundle, 'transition.json');
  writeFileSync(path, readFileSync(path, 'utf8') + '\n');
  await expect(
    importSyncTransition({ directory: f.bundle, destination: f.destination }),
  ).rejects.toThrow('verification');
});

test('unavailable public units, interrupted legacy restores, cached Formula values and damaged retained images fail closed', async () => {
  const f = fixture();
  expect(() => assertSyncTransitionReady(f.data.db)).toThrow('offline sync transition');
  await expect(
    exportSyncTransition({
      source: f.source,
      directory: f.bundle,
      legacy: async () => ({
        load: async () => {
          throw new Error('UNIT_NOT_FOUND');
        },
        purge: async () => {},
        assertMissing: async () => {},
        close: async () => {},
      }),
    }),
  ).rejects.toThrow('UNIT_NOT_FOUND');
  expect(existsSync(join(f.bundle, 'source.sqlite'))).toBe(true);
  expect(
    f.data.db.prepare('SELECT count(*) AS count FROM workspace_collaboration').get()?.count,
  ).toBe(6);
  const doc = f.data.units.find((unit) => unit.itemId === f.data.doc.id)!;
  const properties = (doc.snapshot as IDocumentData).body?.customRanges?.[0]?.properties;
  if (!properties) throw new Error('Fixture Formula is missing.');
  properties.spinelFormula = {
    ...f.data.formula,
    cachedValue: 'PRIVATE_RESULT',
  };
  await expect(
    exportSyncTransition({
      source: f.source,
      directory: join(f.directory, 'cached-formula'),
      legacy: f.legacy,
    }),
  ).rejects.toThrow();
  properties.spinelFormula = structuredClone(f.data.formula);
  f.data.db
    .prepare('UPDATE doc_images SET data=? WHERE item_id=?')
    .run(Buffer.from('damaged'), f.data.child.id);
  await expect(
    exportSyncTransition({
      source: f.source,
      directory: join(f.directory, 'bad-image'),
      legacy: f.legacy,
    }),
  ).rejects.toThrow('verification');
  f.data.db
    .prepare("UPDATE spinel_restore_jobs SET status='staging' WHERE id=?")
    .run(f.data.restoreId);
  await expect(
    exportSyncTransition({
      source: f.source,
      directory: join(f.directory, 'unfinished-restore'),
      legacy: f.legacy,
    }),
  ).rejects.toThrow('interrupted restore');
});

test('fresh application initialization needs no transition and existing destination directories are never replaced', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'spinel-transition-empty-'));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const db = new DatabaseSync(join(directory, 'empty.sqlite'));
  expect(() => assertSyncTransitionReady(db)).not.toThrow();
  expect(() => markNativeSyncActivated(db)).not.toThrow();
  expect(db.prepare('SELECT id FROM spinel_sync_activation').get()).toEqual({ id: 1 });
  db.close();
  const f = fixture();
  await exportSyncTransition({ source: f.source, directory: f.bundle, legacy: f.legacy });
  await expect(
    importSyncTransition({ directory: f.bundle, destination: f.directory }),
  ).rejects.toThrow();
  expect(existsSync(f.source)).toBe(true);
});

test.each([
  ['export', 'write'],
  ['export', 'rename'],
  ['import', 'write'],
  ['import', 'rename'],
] as const)(
  'initial %s provenance %s interruption retries the same paths without changing source data',
  async (operation, failure) => {
    const f = fixture();
    const sourceHash = await digest(f.source);
    const frozen = join(f.bundle, 'source.sqlite');
    if (operation === 'import')
      await exportSyncTransition({ source: f.source, directory: f.bundle, legacy: f.legacy });
    let frozenHash = operation === 'import' ? await digest(frozen) : undefined;
    const directory = operation === 'export' ? f.bundle : f.destination;
    const marker = operation === 'export' ? 'source-origin.json' : 'transition.json';
    const start = () =>
      operation === 'export'
        ? exportSyncTransition({ source: f.source, directory: f.bundle, legacy: f.legacy })
        : importSyncTransition({ directory: f.bundle, destination: f.destination });
    const original = await vi.importActual<typeof import('node:fs')>('node:fs');
    const interrupted = Object.assign(new Error('initial provenance interrupted'), {
      code: 'ENOSPC',
    });
    let abandoned: string | undefined;
    const initialMarker = (path: unknown) =>
      String(path).startsWith(`${directory}.preparing-`) &&
      String(path).endsWith(`/${marker}.writing`);
    vi.mocked(writeFileSync).mockImplementation((path, data, options) => {
      if (initialMarker(path)) {
        abandoned = dirname(String(path));
        if (failure === 'write') throw interrupted;
      }
      original.writeFileSync(path, data, options);
    });
    vi.mocked(renameSync).mockImplementation((from, to) => {
      if (failure === 'rename' && initialMarker(from)) throw interrupted;
      original.renameSync(from, to);
    });
    // A stopped process cannot run finally. Leave that private staging directory
    // behind to prove retry does not depend on successful exception cleanup.
    vi.mocked(rmSync).mockImplementation((path, options) => {
      if (path !== abandoned) original.rmSync(path, options);
    });
    await expect(start()).rejects.toBe(interrupted);
    expect(existsSync(directory)).toBe(false);
    expect(abandoned).toBeDefined();
    if (!abandoned) throw new Error('The initial provenance write was not reached.');
    expect(statSync(abandoned).mode & 0o077).toBe(0);
    expect(readdirSync(abandoned)).toEqual(failure === 'write' ? [] : [`${marker}.writing`]);
    if (failure === 'rename')
      expect(JSON.parse(readFileSync(join(abandoned, `${marker}.writing`), 'utf8'))).toMatchObject({
        format: 1,
      });
    expect(await digest(f.source)).toBe(sourceHash);
    if (frozenHash) expect(await digest(frozen)).toBe(frozenHash);
    else expect(existsSync(frozen)).toBe(false);
    vi.mocked(writeFileSync).mockImplementation(original.writeFileSync);
    vi.mocked(renameSync).mockImplementation(original.renameSync);
    vi.mocked(rmSync).mockImplementation(original.rmSync);
    expect(await start()).toMatchObject({ documents: 7, converted: 5 });
    expect(statSync(directory).mode & 0o077).toBe(0);
    expect(existsSync(join(directory, marker))).toBe(true);
    if (operation === 'export') {
      frozenHash = await digest(frozen);
      expect(
        await importSyncTransition({ directory: f.bundle, destination: f.destination }),
      ).toMatchObject({ documents: 7, converted: 5 });
    }
    expect(await digest(f.source)).toBe(sourceHash);
    expect(await digest(frozen)).toBe(frozenHash);
    expect(existsSync(abandoned)).toBe(true);
  },
);

test.each(['export', 'import'] as const)(
  'initial %s refuses unrelated empty and writing-only directories without replacing them',
  async (operation) => {
    const f = fixture();
    const sourceHash = await digest(f.source);
    await exportSyncTransition({ source: f.source, directory: f.bundle, legacy: f.legacy });
    const frozen = join(f.bundle, 'source.sqlite');
    const frozenHash = await digest(frozen);
    const original = await vi.importActual<typeof import('node:fs')>('node:fs');
    const marker = operation === 'export' ? 'source-origin.json' : 'transition.json';
    for (const writing of [false, true]) {
      const directory = join(f.directory, `unrelated-${operation}-${writing}`);
      original.mkdirSync(directory, { mode: 0o700 });
      if (writing)
        original.writeFileSync(join(directory, `${marker}.writing`), 'Unrelated partial marker', {
          mode: 0o600,
        });
      const start =
        operation === 'export'
          ? exportSyncTransition({ source: f.source, directory, legacy: f.legacy })
          : importSyncTransition({ directory: f.bundle, destination: directory });
      await expect(start).rejects.toThrow();
      expect(readdirSync(directory)).toEqual(writing ? [`${marker}.writing`] : []);
      if (writing)
        expect(readFileSync(join(directory, `${marker}.writing`), 'utf8')).toBe(
          'Unrelated partial marker',
        );
    }
    expect(await digest(f.source)).toBe(sourceHash);
    expect(await digest(frozen)).toBe(frozenHash);
  },
);

test('an opaque name collision cannot conceal an unsafe image and a completed copy is reverified on retry', async () => {
  const f = fixture();
  const doc = f.data.units.find((unit) => unit.itemId === f.data.doc.id)!;
  doc.snapshot.resources = [{ name: 'DOC_DRAWING_PLUGIN', data: '{}' }];
  f.data.db.prepare('UPDATE spinel_generation_resources SET resources=? WHERE unit_id=?').run(
    JSON.stringify([
      {
        name: 'DOC_DRAWING_PLUGIN',
        data: JSON.stringify({ hidden: { source: 'https://private.example/image' } }),
      },
    ]),
    f.data.generation,
  );
  await expect(
    exportSyncTransition({ source: f.source, directory: f.bundle, legacy: f.legacy }),
  ).rejects.toThrow('verification');
  f.data.db
    .prepare('UPDATE spinel_generation_resources SET resources=? WHERE unit_id=?')
    .run('[]', f.data.generation);
  const cleanBundle = join(f.directory, 'clean-bundle');
  await exportSyncTransition({ source: f.source, directory: cleanBundle, legacy: f.legacy });
  const result = await importSyncTransition({ directory: cleanBundle, destination: f.destination });
  const target = new DatabaseSync(result.path);
  target
    .prepare('UPDATE spinel_sync_units SET snapshot=? WHERE unit_id=?')
    .run('{}', f.data.sheet.id);
  target.close();
  await expect(
    importSyncTransition({ directory: cleanBundle, destination: f.destination }),
  ).rejects.toThrow('verification');
});

test('sanitization must preserve application metadata and prove public deletion before publishing its copy', async () => {
  const f = fixture();
  const changing: LegacyTransitionReaderFactory = async (path) => ({
    ...(await f.legacy(path)),
    async purge() {
      const db = new DatabaseSync(path);
      db.prepare('UPDATE auth_users SET name=? WHERE id=?').run(
        'Changed by sanitizer',
        f.data.owner.id,
      );
      db.close();
    },
  });
  await expect(
    exportSyncTransition({ source: f.source, directory: f.bundle, legacy: changing }),
  ).rejects.toThrow('verification');
  expect(f.data.auth.user(f.data.owner.id)?.name).toBe('Retained Owner');
  expect(existsSync(join(f.bundle, 'metadata.sqlite'))).toBe(false);
  const refusing: LegacyTransitionReaderFactory = async (path) => ({
    ...(await f.legacy(path)),
    async assertMissing() {
      throw new Error('legacy payload remains');
    },
  });
  await expect(
    exportSyncTransition({ source: f.source, directory: f.bundle, legacy: refusing }),
  ).rejects.toThrow('legacy payload remains');
  await expect(
    exportSyncTransition({
      source: f.source,
      directory: f.bundle,
      legacy: f.legacy,
      progress(event) {
        if (event.event === 'sync_transition.sanitized') throw new Error('sanitizer checkpoint');
      },
    }),
  ).rejects.toThrow('sanitizer checkpoint');
  await expect(
    importSyncTransition({ directory: f.bundle, destination: f.destination }),
  ).rejects.toThrow('Complete');
  await exportSyncTransition({ source: f.source, directory: f.bundle, legacy: f.legacy });
  expect(f.loads).toHaveBeenCalledTimes(5);
  expect(
    await importSyncTransition({ directory: f.bundle, destination: f.destination }),
  ).toMatchObject({ converted: 5 });
});

test('public SDK cleanup cannot alter an existing native unit while removing an overlapping legacy copy', async () => {
  const f = fixture();
  const original = f.data.db
    .prepare('SELECT * FROM spinel_sync_units WHERE unit_id=?')
    .get(f.data.native.id);
  const changing: LegacyTransitionReaderFactory = async (path) => ({
    ...(await f.legacy(path)),
    async purge(unitIds) {
      expect(unitIds).toContain(f.data.native.id);
      const db = new DatabaseSync(path);
      try {
        db.prepare('UPDATE spinel_sync_units SET revision=revision+1 WHERE unit_id=?').run(
          f.data.native.id,
        );
      } finally {
        db.close();
      }
    },
  });
  await expect(
    exportSyncTransition({ source: f.source, directory: f.bundle, legacy: changing }),
  ).rejects.toThrow('verification');
  expect(existsSync(join(f.bundle, 'metadata.sqlite'))).toBe(false);
  expect(
    f.data.db.prepare('SELECT * FROM spinel_sync_units WHERE unit_id=?').get(f.data.native.id),
  ).toEqual(original);
});

test('pre-cutover native units require public cleanup once before startup even when every fence has a native row', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'spinel-transition-native-trial-'));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, 'source.sqlite');
  const db = new DatabaseSync(source);
  cleanup.push(() => db.close());
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth);
  const owner = auth.createUser('Native trial owner');
  const item = workspace.create(owner.id, { name: 'Native trial', kind: 'doc', parentId: null });
  const storage = new SQLiteSyncStorage(auth);
  storage.create(
    {
      unitId: item.id,
      kind: 'doc',
      revision: 1,
      retainedFrom: 1,
      snapshot: materialize(
        { id: item.id, documentStyle: {}, body: { dataStream: 'Retained native trial\r\n' } },
        'doc',
      ),
    },
    () => {},
  );
  const native = storage.load(item.id);
  // A native row alone cannot prove an old SDK unit with the same ID is absent.
  expect(() => assertSyncTransitionReady(db)).toThrow('offline sync transition');
  db.exec(`CREATE TABLE workspace_collaboration (
    item_id TEXT PRIMARY KEY REFERENCES workspace_items(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK(state IN ('preparing','ready'))) STRICT;`);
  db.prepare("INSERT INTO workspace_collaboration VALUES(?,'ready')").run(item.id);
  expect(() => assertSyncTransitionReady(db)).toThrow('offline sync transition');
  expect(() => markNativeSyncActivated(db)).toThrow('offline sync transition');
  expect(
    db.prepare("SELECT 1 FROM sqlite_schema WHERE name='spinel_sync_activation'").get(),
  ).toBeUndefined();
  expect(storage.load(item.id)).toEqual(native);
  const original = await digest(source);
  const load = vi.fn(async () => {
    throw new Error('Existing native units must not be re-exported.');
  });
  const purge = vi.fn(async () => {});
  const assertMissing = vi.fn(async () => {});
  const legacy: LegacyTransitionReaderFactory = async () => ({
    load,
    purge,
    assertMissing,
    close: async () => {},
  });
  const bundle = join(directory, 'bundle');
  expect(await exportSyncTransition({ source, directory: bundle, legacy })).toMatchObject({
    documents: 1,
    converted: 0,
  });
  expect(load).not.toHaveBeenCalled();
  expect(purge).toHaveBeenCalledExactlyOnceWith([item.id]);
  expect(assertMissing).toHaveBeenCalledExactlyOnceWith([item.id]);
  const result = await importSyncTransition({
    directory: bundle,
    destination: join(directory, 'destination'),
  });
  const target = new DatabaseSync(result.path);
  try {
    expect(() => assertSyncTransitionReady(target)).not.toThrow();
    expect(new SQLiteSyncStorage(new AuthStore(target)).load(item.id)).toEqual(native);
    markNativeSyncActivated(target);
  } finally {
    target.close();
  }
  const reopened = new DatabaseSync(result.path);
  try {
    expect(() => assertSyncTransitionReady(reopened)).not.toThrow();
  } finally {
    reopened.close();
  }
  expect(await digest(source)).toBe(original);
});

test('an interrupted initial copy is disposable and retry publishes only a validated complete copy', async () => {
  const f = fixture();
  await exportSyncTransition({ source: f.source, directory: f.bundle, legacy: f.legacy });
  const original = databaseModule.backup;
  const failure = vi.spyOn(databaseModule, 'backup').mockImplementation(async (db, path) => {
    if (path.endsWith('pending-copying.sqlite')) {
      writeFileSync(path, 'incomplete SQLite copy', { mode: 0o600 });
      throw new Error('initial copy interrupted');
    }
    await original(db, path);
  });
  await expect(
    importSyncTransition({ directory: f.bundle, destination: f.destination }),
  ).rejects.toThrow('initial copy interrupted');
  expect(existsSync(join(f.destination, 'pending.sqlite'))).toBe(false);
  expect(existsSync(join(f.destination, 'spinel.sqlite'))).toBe(false);
  failure.mockRestore();
  expect(
    await importSyncTransition({ directory: f.bundle, destination: f.destination }),
  ).toMatchObject({ converted: 5 });
  expect(existsSync(join(f.destination, 'pending-copying.sqlite'))).toBe(false);
});

test('unknown legacy purge leftovers fence startup while established native interrupted cleanup can resume', () => {
  const directory = mkdtempSync(join(tmpdir(), 'spinel-transition-purge-'));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const legacy = new DatabaseSync(join(directory, 'legacy.sqlite'));
  cleanup.push(() => legacy.close());
  legacy.exec(
    "CREATE TABLE collaboration_purge (item_id TEXT PRIMARY KEY) STRICT; INSERT INTO collaboration_purge VALUES('deleted-legacy');",
  );
  expect(() => assertSyncTransitionReady(legacy)).toThrow('legacy purge');
  expect(() => markNativeSyncActivated(legacy)).toThrow('legacy purge');
  expect(legacy.prepare('SELECT * FROM collaboration_purge').all()).toEqual([
    { item_id: 'deleted-legacy' },
  ]);
  legacy.exec(
    "CREATE TABLE spinel_sync_units (unit_id TEXT PRIMARY KEY) STRICT; INSERT INTO spinel_sync_units VALUES('live-native');",
  );
  expect(() => assertSyncTransitionReady(legacy)).toThrow('legacy purge');
  const native = new DatabaseSync(join(directory, 'native.sqlite'));
  markNativeSyncActivated(native);
  native.exec(
    "CREATE TABLE collaboration_purge (item_id TEXT PRIMARY KEY) STRICT; INSERT INTO collaboration_purge VALUES('already-removed-native'),('cancelled-before-create');",
  );
  native.close();
  const reopened = new DatabaseSync(join(directory, 'native.sqlite'));
  try {
    expect(() => assertSyncTransitionReady(reopened)).not.toThrow();
  } finally {
    reopened.close();
  }
});
