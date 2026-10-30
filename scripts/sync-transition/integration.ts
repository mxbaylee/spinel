import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { backup, DatabaseSync } from '../../server/database.ts';
import { digest } from '../../src/server/backup/archive.ts';
import { AuthStore } from '../../src/server/auth/store.ts';
import { CollaborationStore } from '../../src/server/collaboration/service.ts';
import { WorkspaceStore } from '../../src/server/workspace/store.ts';
import { TrashStore } from '../../src/server/workspace/trash.ts';
import {
  assertSyncTransitionReady,
  exportSyncTransition,
  importSyncTransition,
} from '../../src/server/sync/transition.ts';
import { legacyTransitionReader } from './legacy.ts';
import { transitionFixture } from './fixture.ts';
import { verifyTransitionFixture } from './verify.ts';
import type { LegacySeed } from './seed.ts';

const { values } = parseArgs({ options: { 'legacy-checkout': { type: 'string' } } });
assert.ok(values['legacy-checkout'], 'An explicit pinned legacy checkout is required.');
const directory = mkdtempSync(join(tmpdir(), 'spinel-real-sync-transition-'));
const source = join(directory, 'legacy.sqlite');
const fixture = transitionFixture(source);
const nativeBefore = fixture.db
  .prepare('SELECT * FROM spinel_sync_units WHERE unit_id=?')
  .get(fixture.native.id);
const nativeRevisionsBefore = fixture.db
  .prepare('SELECT * FROM spinel_sync_revisions WHERE unit_id=? ORDER BY revision')
  .all(fixture.native.id);
const overlappingText = 'Stale SDK copy of native trial\r\n';
try {
  const queuedPurge = randomUUID();
  fixture.db.prepare('INSERT INTO collaboration_purge VALUES(?)').run(queuedPurge);
  fixture.db.close();
  const seedPath = join(directory, 'seed.json');
  const seed: LegacySeed = {
    source,
    ownerId: fixture.owner.id,
    sheetId: fixture.sheet.id,
    documentId: fixture.doc.id,
    nativeId: fixture.native.id,
    queuedPurge,
    overlappingText,
    units: fixture.units,
  };
  writeFileSync(seedPath, JSON.stringify(seed), { mode: 0o600 });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL('./seed.ts', import.meta.url)),
        '--fixture',
        seedPath,
        '--legacy-checkout',
        values['legacy-checkout']!,
      ],
      { stdio: 'inherit' },
    );
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error('Legacy fixture seeding failed.')),
    );
  });
  rmSync(seedPath);
  const seeded = new DatabaseSync(source, { readOnly: true });
  try {
    assert.deepEqual(
      seeded.prepare('SELECT * FROM spinel_sync_units WHERE unit_id=?').get(fixture.native.id),
      nativeBefore,
    );
  } finally {
    seeded.close();
  }
  const originalHash = await digest(source);
  const bundle = join(directory, 'bundle');
  const legacy = legacyTransitionReader(values['legacy-checkout']);
  await assert.rejects(
    exportSyncTransition({
      source,
      directory: bundle,
      legacy,
      progress() {
        throw new Error('intentional-export-interruption');
      },
    }),
    /intentional-export-interruption/,
  );
  assert.equal(await digest(source), originalHash, 'Source changed during interrupted export.');
  const exported = await exportSyncTransition({ source, directory: bundle, legacy });
  assert.equal(await digest(source), originalHash, 'Source changed during completed export.');
  assert.equal(exported.documents, 7);
  assert.equal(exported.converted, 5);
  const copyHash = await digest(join(bundle, 'source.sqlite'));
  const destination = join(directory, 'converted');
  await assert.rejects(
    importSyncTransition({
      directory: bundle,
      destination,
      progress(event) {
        if (event.event === 'sync_transition.imported')
          throw new Error('intentional-import-interruption');
      },
    }),
    /intentional-import-interruption/,
  );
  assert.equal(await digest(source), originalHash, 'Source changed during interrupted import.');
  const pending = new DatabaseSync(join(destination, 'pending.sqlite'));
  try {
    assert.throws(() => assertSyncTransitionReady(pending), /offline sync transition/);
  } finally {
    pending.close();
  }
  const imported = await importSyncTransition({ directory: bundle, destination });
  assert.equal(await digest(source), originalHash, 'Source changed during completed import.');
  const manifest = JSON.parse(readFileSync(join(bundle, 'transition.json'), 'utf8')) as {
    units: { file: string; unitId: string }[];
    purgedUnits: string[];
  };
  assert.ok(manifest.purgedUnits.includes(fixture.doc.id));
  assert.ok(manifest.purgedUnits.includes(queuedPurge));
  assert.ok(manifest.purgedUnits.includes(fixture.native.id));
  assert.ok(manifest.purgedUnits.includes(fixture.unopened.id));
  const cleanReader = await legacy(imported.path);
  try {
    await cleanReader.assertMissing(manifest.purgedUnits);
  } finally {
    await cleanReader.close();
  }
  assert.equal(
    await digest(source),
    originalHash,
    'Source changed during public deletion verification.',
  );
  const target = new DatabaseSync(imported.path);
  try {
    assert.deepEqual(
      target.prepare('SELECT * FROM spinel_sync_units WHERE unit_id=?').get(fixture.native.id),
      nativeBefore,
    );
    assert.deepEqual(
      target
        .prepare('SELECT * FROM spinel_sync_revisions WHERE unit_id=? ORDER BY revision')
        .all(fixture.native.id),
      nativeRevisionsBefore,
    );
    const row = target
      .prepare('SELECT revision,retained_from,snapshot FROM spinel_sync_units WHERE unit_id=?')
      .get(fixture.sheet.id);
    assert.equal(row?.revision, 2);
    assert.equal(row?.retained_from, 2);
    assert.equal(
      JSON.parse(String(row?.snapshot)).sheets.first.cellData[2][0].v,
      'Public SDK committed tail',
    );
    // Exact native export payload equality proves there was no silent importer normalization.
    for (const unit of manifest.units) {
      const current = JSON.parse(readFileSync(join(bundle, unit.file), 'utf8')) as {
        snapshot: unknown;
      };
      assert.deepEqual(
        JSON.parse(
          String(
            target
              .prepare('SELECT snapshot FROM spinel_sync_units WHERE unit_id=?')
              .get(unit.unitId)?.snapshot,
          ),
        ),
        current.snapshot,
      );
    }
  } finally {
    target.close();
  }
  assert.equal((await importSyncTransition({ directory: bundle, destination })).resumed, true);
  const verified = await verifyTransitionFixture(imported.path, fixture, directory);
  assert.equal(
    await digest(source),
    originalHash,
    'Source changed during native application verification.',
  );
  const nativePurgeDb = new DatabaseSync(imported.path);
  const nativeWorkspace = new WorkspaceStore(new AuthStore(nativePurgeDb), { spacesEnabled: true });
  const nativeCollaboration = new CollaborationStore(nativeWorkspace, imported.path);
  try {
    const trash = new TrashStore(nativeWorkspace);
    trash.trash(fixture.owner.id, fixture.native.id);
    trash.empty(fixture.owner.id, trash.list(fixture.owner.id).version);
    await nativeCollaboration.purgeDeleted();
    assert.equal(
      nativePurgeDb
        .prepare('SELECT 1 FROM spinel_sync_units WHERE unit_id=?')
        .get(fixture.native.id),
      undefined,
    );
    assert.equal(
      nativePurgeDb
        .prepare('SELECT 1 FROM collaboration_purge WHERE item_id=?')
        .get(fixture.native.id),
      undefined,
    );
  } finally {
    await nativeCollaboration.close();
    nativePurgeDb.close();
  }
  assert.equal(
    await digest(source),
    originalHash,
    'Source changed during native permanent deletion.',
  );
  const afterNativePurge = await legacy(imported.path);
  try {
    await afterNativePurge.assertMissing([fixture.native.id]);
  } finally {
    await afterNativePurge.close();
  }
  assert.equal(
    await digest(source),
    originalHash,
    'Source changed during final public deletion verification.',
  );
  // Both native-purge and public SDK work have drained. Their native statements
  // may still retain closed writers; checkpoint before measuring preservation.
  const settled = new DatabaseSync(imported.path);
  try {
    assert.deepEqual(settled.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get(), {
      busy: 0,
      log: 0,
      checkpointed: 0,
    });
  } finally {
    settled.close();
  }
  const afterEdits = await digest(imported.path);
  await assert.rejects(importSyncTransition({ directory: bundle, destination }), /verification/);
  assert.equal(await digest(imported.path), afterEdits);
  assert.equal(await digest(source), originalHash);
  assert.equal(await digest(join(bundle, 'source.sqlite')), copyHash);
  const recoveryCopy = join(directory, 'source-recovery.sqlite');
  const frozen = new DatabaseSync(join(bundle, 'source.sqlite'));
  try {
    await backup(frozen, recoveryCopy);
  } finally {
    frozen.close();
  }
  const nativeRecovery = new DatabaseSync(recoveryCopy, { readOnly: true });
  try {
    assert.deepEqual(
      nativeRecovery
        .prepare('SELECT * FROM spinel_sync_units WHERE unit_id=?')
        .get(fixture.native.id),
      nativeBefore,
    );
    assert.deepEqual(
      nativeRecovery
        .prepare('SELECT * FROM spinel_sync_revisions WHERE unit_id=? ORDER BY revision')
        .all(fixture.native.id),
      nativeRevisionsBefore,
    );
  } finally {
    nativeRecovery.close();
  }
  const originalReader = await legacy(recoveryCopy);
  try {
    const current = await originalReader.load(fixture.sheet.id, 'sheet');
    assert.equal(current.revision, 2);
    assert.equal(
      (current.snapshot as IWorkbookData).sheets.first.cellData?.[2]?.[0]?.v,
      'Public SDK committed tail',
    );
    assert.equal((await originalReader.load(fixture.doc.id, 'doc')).revision, 1);
    assert.equal((await originalReader.load(queuedPurge, 'doc')).revision, 1);
    const overlapping = await originalReader.load(fixture.native.id, 'doc');
    assert.equal(overlapping.revision, 1);
    assert.equal((overlapping.snapshot as IDocumentData).body?.dataStream, overlappingText);
  } finally {
    await originalReader.close();
  }
  process.stdout.write(
    JSON.stringify({
      event: 'sync_transition.public_sdk_verified',
      ...verified,
      interruptedExport: true,
      interruptedImport: true,
      originalSourcePreserved: true,
      legacyCopiesPurgedFromTarget: true,
      overlappingLegacyCopyPurged: true,
      existingNativePreserved: true,
      nativeTrialPurge: true,
    }) + '\n',
  );
} finally {
  if (fixture.db.isOpen) fixture.db.close();
  rmSync(directory, { recursive: true, force: true });
}
