import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { transitionFixture } from '../../../scripts/sync-transition/fixture.ts';
import { verifyTransitionFixture } from '../../../scripts/sync-transition/verify.ts';
import { digest } from '../backup/archive.ts';
import { assertSyncTransitionReady, exportSyncTransition, importSyncTransition } from './transition.ts';
import type { LegacyTransitionReaderFactory } from './transition.ts';

vi.setConfig({ testTimeout: 30_000 });
const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'spinel-transition-'));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, 'source.sqlite');
  const data = transitionFixture(source);
  cleanup.push(() => { if (data.db.isOpen) data.db.close(); });
  const loads = vi.fn(async (unitId: string) => {
    const unit = data.units.find((candidate) => candidate.unitId === unitId);
    if (!unit) throw new Error('UNIT_NOT_FOUND');
    return { snapshot: structuredClone(unit.snapshot), revision: unit.revision };
  });
  const close = vi.fn(async () => {});
  const legacy: LegacyTransitionReaderFactory = async (path) => {
    expect(path).not.toBe(source);
    expect(path).not.toBe(join(directory, 'bundle/source.sqlite'));
    return { load: loads, close };
  };
  return { directory, source, data, loads, close, legacy, bundle: join(directory, 'bundle'), destination: join(directory, 'destination') };
}

test('all retained metadata and public snapshots survive a source-copy conversion and native edit/recovery boundaries', async () => {
  const f = fixture();
  const original = await digest(f.source);
  const progress = vi.fn();
  expect(await exportSyncTransition({ source: f.source, directory: f.bundle, legacy: f.legacy, progress })).toMatchObject({ documents: 7, converted: 5 });
  const sourceCopyHash = await digest(join(f.bundle, 'source.sqlite'));
  const result = await importSyncTransition({ directory: f.bundle, destination: f.destination, progress });
  expect(f.loads).toHaveBeenCalledTimes(5);
  expect(f.close).toHaveBeenCalledOnce();
  expect(await digest(f.source)).toBe(original);
  expect(await digest(join(f.bundle, 'source.sqlite'))).toBe(sourceCopyHash);
  expect(await importSyncTransition({ directory: f.bundle, destination: f.destination })).toMatchObject({ resumed: true });
  await verifyTransitionFixture(result.path, f.data, f.directory);
  const afterEdits = await digest(result.path);
  // A served copy has diverged from the migration receipt; preserve it and refuse
  // to claim it is still the original verified output.
  await expect(importSyncTransition({ directory: f.bundle, destination: f.destination })).rejects.toThrow('verification');
  expect(await digest(result.path)).toBe(afterEdits);
  const messages = JSON.stringify(progress.mock.calls);
  for (const secret of ['Retained budget', 'Retained journal', 'Retained private cell', f.data.owner.id, f.data.token.token]) expect(messages).not.toContain(secret);
  for (const [event] of progress.mock.calls) expect(Object.keys(event).sort()).toEqual(['completed', 'event', 'total']);
});

test('interrupted export resumes only the frozen copy and never exports completed units twice', async () => {
  const f = fixture();
  await expect(exportSyncTransition({ source: f.source, directory: f.bundle, legacy: f.legacy,
    progress() { throw new Error('simulated interruption'); } })).rejects.toThrow('simulated interruption');
  expect(f.loads).toHaveBeenCalledTimes(1);
  const first = f.loads.mock.calls[0][0];
  await exportSyncTransition({ source: f.source, directory: f.bundle, legacy: f.legacy });
  expect(f.loads).toHaveBeenCalledTimes(5);
  expect(f.loads.mock.calls.filter(([id]) => id === first)).toHaveLength(1);
  expect(await importSyncTransition({ directory: f.bundle, destination: f.destination })).toMatchObject({ converted: 5 });
});

test('interrupted import keeps a server fence, preserves original heads and generation offsets, and verifies completed units on resume', async () => {
  const f = fixture();
  f.data.units.find((unit) => unit.itemId === f.data.sheet.id)!.revision = 17;
  await exportSyncTransition({ source: f.source, directory: f.bundle, legacy: f.legacy });
  await expect(importSyncTransition({ directory: f.bundle, destination: f.destination,
    progress(event) { if (event.event === 'sync_transition.imported') throw new Error('simulated interruption'); } })).rejects.toThrow('simulated interruption');
  expect(existsSync(join(f.destination, 'spinel.sqlite'))).toBe(false);
  const partial = new DatabaseSync(join(f.destination, 'pending.sqlite'));
  expect(() => assertSyncTransitionReady(partial)).toThrow('Finish the offline');
  expect(partial.prepare('SELECT count(*) AS count FROM spinel_sync_transition_units').get()?.count).toBe(1);
  partial.close();
  const result = await importSyncTransition({ directory: f.bundle, destination: f.destination });
  const target = new DatabaseSync(result.path);
  try {
    expect(() => assertSyncTransitionReady(target)).not.toThrow();
    expect(target.prepare('SELECT revision,retained_from FROM spinel_sync_units WHERE unit_id=?').get(f.data.sheet.id)).toEqual({ revision: 17, retained_from: 17 });
    expect(target.prepare('SELECT unit_id,revision_offset FROM spinel_live_units WHERE item_id=?').get(f.data.doc.id)).toEqual({ unit_id: f.data.generation, revision_offset: 7 });
    expect(target.prepare('SELECT count(*) AS count FROM spinel_sync_transition_units').get()?.count).toBe(5);
  } finally { target.close(); }
});

test('changed exported payloads or source copies cannot resume or publish an import', async () => {
  const f = fixture();
  await exportSyncTransition({ source: f.source, directory: f.bundle, legacy: f.legacy });
  const manifest = JSON.parse(readFileSync(join(f.bundle, 'transition.json'), 'utf8'));
  const path = join(f.bundle, manifest.units[0].file);
  const original = readFileSync(path);
  writeFileSync(path, Buffer.concat([original, Buffer.from(' ')]));
  await expect(importSyncTransition({ directory: f.bundle, destination: f.destination })).rejects.toThrow('verification');
  expect(existsSync(join(f.destination, 'spinel.sqlite'))).toBe(false);
  writeFileSync(path, original);
  const copy = new DatabaseSync(join(f.bundle, 'source.sqlite'));
  copy.prepare('UPDATE auth_users SET name=? WHERE id=?').run('Tampered', f.data.owner.id);
  copy.close();
  await expect(importSyncTransition({ directory: f.bundle, destination: f.destination })).rejects.toThrow('verification');
});

test('modified finished units and changed retry manifests remain fenced instead of being overwritten', async () => {
  const f = fixture();
  await exportSyncTransition({ source: f.source, directory: f.bundle, legacy: f.legacy });
  await expect(importSyncTransition({ directory: f.bundle, destination: f.destination,
    progress() { throw new Error('interrupt'); } })).rejects.toThrow('interrupt');
  const partial = new DatabaseSync(join(f.destination, 'pending.sqlite'));
  partial.exec('UPDATE spinel_sync_units SET revision=revision+1 WHERE unit_id IN (SELECT unit_id FROM spinel_sync_transition_units)');
  partial.close();
  await expect(importSyncTransition({ directory: f.bundle, destination: f.destination })).rejects.toThrow('verification');
  expect(existsSync(join(f.destination, 'spinel.sqlite'))).toBe(false);
  const path = join(f.bundle, 'transition.json');
  writeFileSync(path, readFileSync(path, 'utf8') + '\n');
  await expect(importSyncTransition({ directory: f.bundle, destination: f.destination })).rejects.toThrow('verification');
});

test('unavailable public units, interrupted legacy restores, cached Formula values and damaged retained images fail closed', async () => {
  const f = fixture();
  expect(() => assertSyncTransitionReady(f.data.db)).toThrow('offline sync transition');
  await expect(exportSyncTransition({ source: f.source, directory: f.bundle,
    legacy: async () => ({ load: async () => { throw new Error('UNIT_NOT_FOUND'); }, close: async () => {} }) })).rejects.toThrow('UNIT_NOT_FOUND');
  expect(existsSync(join(f.bundle, 'source.sqlite'))).toBe(true);
  expect(f.data.db.prepare('SELECT count(*) AS count FROM workspace_collaboration').get()?.count).toBe(6);
  const doc = f.data.units.find((unit) => unit.itemId === f.data.doc.id)!;
  (doc.snapshot as { body: { customRanges: { properties: { spinelFormula: object } }[] } }).body.customRanges[0].properties.spinelFormula = { ...f.data.formula, cachedValue: 'PRIVATE_RESULT' };
  await expect(exportSyncTransition({ source: f.source, directory: join(f.directory, 'cached-formula'), legacy: f.legacy })).rejects.toThrow();
  f.data.db.prepare('UPDATE doc_images SET data=? WHERE item_id=?').run(Buffer.from('damaged'), f.data.child.id);
  await expect(exportSyncTransition({ source: f.source, directory: join(f.directory, 'bad-image'), legacy: f.legacy })).rejects.toThrow();
  f.data.db.prepare("UPDATE spinel_restore_jobs SET status='staging' WHERE id=?").run(f.data.restoreId);
  await expect(exportSyncTransition({ source: f.source, directory: join(f.directory, 'unfinished-restore'), legacy: f.legacy })).rejects.toThrow('interrupted restore');
});

test('fresh application initialization needs no transition and existing destination directories are never replaced', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'spinel-transition-empty-'));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const db = new DatabaseSync(join(directory, 'empty.sqlite'));
  expect(() => assertSyncTransitionReady(db)).not.toThrow();
  db.close();
  const f = fixture();
  await exportSyncTransition({ source: f.source, directory: f.bundle, legacy: f.legacy });
  await expect(importSyncTransition({ directory: f.bundle, destination: f.directory })).rejects.toThrow();
  expect(existsSync(f.source)).toBe(true);
});

test('an opaque name collision cannot conceal an unsafe image and a completed copy is reverified on retry', async () => {
  const f = fixture();
  const doc = f.data.units.find((unit) => unit.itemId === f.data.doc.id)!;
  doc.snapshot.resources = [{ name: 'DOC_DRAWING_PLUGIN', data: '{}' }];
  f.data.db.prepare('UPDATE spinel_generation_resources SET resources=? WHERE unit_id=?').run(
    JSON.stringify([{ name: 'DOC_DRAWING_PLUGIN', data: JSON.stringify({ hidden: { source: 'https://private.example/image' } }) }]), f.data.generation);
  await expect(exportSyncTransition({ source: f.source, directory: f.bundle, legacy: f.legacy })).rejects.toThrow('verification');
  f.data.db.prepare('UPDATE spinel_generation_resources SET resources=? WHERE unit_id=?').run('[]', f.data.generation);
  const cleanBundle = join(f.directory, 'clean-bundle');
  await exportSyncTransition({ source: f.source, directory: cleanBundle, legacy: f.legacy });
  const result = await importSyncTransition({ directory: cleanBundle, destination: f.destination });
  const target = new DatabaseSync(result.path);
  target.prepare('UPDATE spinel_sync_units SET snapshot=? WHERE unit_id=?').run('{}', f.data.sheet.id);
  target.close();
  await expect(importSyncTransition({ directory: cleanBundle, destination: f.destination })).rejects.toThrow('verification');
});
