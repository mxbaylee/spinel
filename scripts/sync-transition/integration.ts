import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';
import { DatabaseSync } from '../../server/database.ts';
import { digest } from '../../src/server/backup/archive.ts';
import { assertSyncTransitionReady, exportSyncTransition, importSyncTransition } from '../../src/server/sync/transition.ts';
import { legacyTransitionReader, publicLegacyModules } from './legacy.ts';
import { transitionFixture } from './fixture.ts';
import { verifyTransitionFixture } from './verify.ts';

const { values } = parseArgs({ options: { 'legacy-checkout': { type: 'string' } } });
assert.ok(values['legacy-checkout'], 'An explicit pinned legacy checkout is required.');
const directory = mkdtempSync(join(tmpdir(), 'spinel-real-sync-transition-'));
const source = join(directory, 'legacy.sqlite');
const fixture = transitionFixture(source);
try {
  const api = publicLegacyModules(values['legacy-checkout']);
  const { adapter, collab, materializer } = api.open(source);
  try {
    for (const unit of fixture.units) {
      await collab.createUnitFromData({ type: api.type(unit.kind), data: { ...unit.snapshot, rev: 1 } },
        { userID: fixture.owner.id, customData: {} });
    }
    // The source must contain a real committed tail beyond its creation snapshot.
    // Exporting an old snapshot without materializing changesets fails the check below.
    const edited = await collab.submitChangeset({ changeset: {
      unitID: fixture.sheet.id, type: api.type('sheet'), userID: fixture.owner.id,
      memberID: 'fixture-member', sid: 'fixture-source-session', reqId: 1,
      baseRev: 1, revision: 0, mutations: [{ id: 'sheet.mutation.set-range-values', data: JSON.stringify({
        unitId: fixture.sheet.id, subUnitId: 'first', cellValue: { 2: { 0: { v: 'Public SDK committed tail' } } },
      }) }],
    } }, { userID: fixture.owner.id, memberID: 'fixture-member', customData: {} });
    assert.equal(edited.status, 'committed');
  } finally {
    try { await materializer.dispose(); }
    finally { try { await collab.dispose(); } finally { await adapter.dispose(); } }
  }
  fixture.db.close();
  const originalHash = await digest(source);
  const bundle = join(directory, 'bundle');
  const legacy = legacyTransitionReader(values['legacy-checkout']);
  await assert.rejects(exportSyncTransition({ source, directory: bundle, legacy,
    progress() { throw new Error('intentional-export-interruption'); } }), /intentional-export-interruption/);
  const exported = await exportSyncTransition({ source, directory: bundle, legacy });
  assert.equal(exported.documents, 7);
  assert.equal(exported.converted, 5);
  const copyHash = await digest(join(bundle, 'source.sqlite'));
  const destination = join(directory, 'converted');
  await assert.rejects(importSyncTransition({ directory: bundle, destination,
    progress(event) { if (event.event === 'sync_transition.imported') throw new Error('intentional-import-interruption'); } }), /intentional-import-interruption/);
  const pending = new DatabaseSync(join(destination, 'pending.sqlite'));
  try { assert.throws(() => assertSyncTransitionReady(pending), /offline sync transition/); }
  finally { pending.close(); }
  const imported = await importSyncTransition({ directory: bundle, destination });
  const target = new DatabaseSync(imported.path);
  try {
    const row = target.prepare('SELECT revision,retained_from,snapshot FROM spinel_sync_units WHERE unit_id=?').get(fixture.sheet.id);
    assert.equal(row?.revision, 2);
    assert.equal(row?.retained_from, 2);
    assert.equal(JSON.parse(String(row?.snapshot)).sheets.first.cellData[2][0].v, 'Public SDK committed tail');
    // Exact native export payload equality proves there was no silent importer normalization.
    const manifest = JSON.parse(readFileSync(join(bundle, 'transition.json'), 'utf8')) as { units: { file: string; unitId: string }[] };
    for (const unit of manifest.units) {
      const current = JSON.parse(readFileSync(join(bundle, unit.file), 'utf8')) as { snapshot: unknown };
      assert.deepEqual(JSON.parse(String(target.prepare('SELECT snapshot FROM spinel_sync_units WHERE unit_id=?').get(unit.unitId)?.snapshot)), current.snapshot);
    }
  } finally { target.close(); }
  assert.equal((await importSyncTransition({ directory: bundle, destination })).resumed, true);
  const verified = await verifyTransitionFixture(imported.path, fixture, directory);
  const afterEdits = await digest(imported.path);
  await assert.rejects(importSyncTransition({ directory: bundle, destination }), /verification/);
  assert.equal(await digest(imported.path), afterEdits);
  assert.equal(await digest(source), originalHash);
  assert.equal(await digest(join(bundle, 'source.sqlite')), copyHash);
  process.stdout.write(JSON.stringify({ event: 'sync_transition.public_sdk_verified', ...verified, interruptedExport: true, interruptedImport: true, originalSourcePreserved: true }) + '\n');
} finally {
  if (fixture.db.isOpen) fixture.db.close();
  rmSync(directory, { recursive: true, force: true });
}
