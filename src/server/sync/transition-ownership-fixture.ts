/** Disposable process: exercise the real copy/rename/receipt paths while its
 * parent attempts competing cold leases at every pre-open inode barrier. */
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from '../../../server/database.ts';
import { transitionFixture } from '../../../scripts/sync-transition/fixture.ts';
import type { TransitionFixtureUnit } from '../../../scripts/sync-transition/fixture.ts';
import { digest } from '../backup/archive.ts';
import { acquireColdWorkspaceFiles } from '../maintenance/journal.ts';
import { exportSyncTransition, importSyncTransition } from './transition.ts';
import type { LegacyTransitionReaderFactory } from './transition.ts';

if (!process.send || !process.env.SPINEL_TRANSITION_FIXTURE)
  throw new Error('Private transition fixture required.');
const directory = process.env.SPINEL_TRANSITION_FIXTURE;
const source = join(directory, 'original.sqlite');
const bundle = join(directory, 'bundle');
const destination = join(directory, 'destination');
if (process.argv[2] === 'seed') {
  const data = transitionFixture(source);
  data.db.close();
  process.send!({ units: data.units }, (error: Error | null) => {
    if (error) throw error;
    process.disconnect?.();
  });
} else {
  // Cold transition starts only after previous native SQLite owners have exited;
  // close() in this process is not a stable source-header/checkpoint boundary.
  const seeded = fork(fileURLToPath(import.meta.url), ['seed'], {
    env: process.env,
    execArgv: ['--max-old-space-size=256'],
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  let units: TransitionFixtureUnit[] | undefined;
  seeded.on('message', (value: { units: TransitionFixtureUnit[] }) => {
    units = value.units;
  });
  const [seedCode] = await once(seeded, 'exit');
  assert.equal(seedCode, 0);
  assert.ok(units);
  const sourceHash = await digest(source);
  // A prior attempt can leave a metadata file before its completion receipt.
  mkdirSync(bundle, { mode: 0o700 });
  writeFileSync(
    join(bundle, 'source-origin.json'),
    JSON.stringify({ format: 1, originalPath: source }),
    { mode: 0o600 },
  );
  const staleMetadata = new DatabaseSync(join(bundle, 'metadata.sqlite'));
  staleMetadata.exec('CREATE TABLE abandoned (value TEXT)');
  staleMetadata.close();
  const paths = [
    source,
    ...[
      'source.sqlite',
      'source-copying.sqlite',
      'metadata.sqlite',
      'legacy-working.sqlite',
      'sanitizing.sqlite',
    ].map((name) => join(bundle, name)),
    ...['spinel.sqlite', 'pending.sqlite', 'pending-copying.sqlite'].map((name) =>
      join(destination, name),
    ),
  ];
  const files = await acquireColdWorkspaceFiles(paths);
  async function checkpoint(value: Record<string, unknown>) {
    await new Promise<void>((resolve, reject) => {
      const resume = (message: unknown) => {
        if (message !== 'continue') return;
        process.off('message', resume);
        resolve();
      };
      process.on('message', resume);
      process.send!(value, (error: Error | null) => {
        if (error) {
          process.off('message', resume);
          reject(error);
        }
      });
    });
  }
  await checkpoint({ event: 'reserved', paths });
  const interrupted = new Error('deliberate transition interruption');
  const emptyInterruptions = new Set([
    'source-copying.sqlite',
    'sanitizing.sqlite',
    'pending-copying.sqlite',
  ]);
  const bindFile = async (path: string) => {
    await files.bindFile(path);
    const info = statSync(path, { bigint: true });
    await checkpoint({
      event: 'bound',
      path,
      inode: String(info.ino),
      device: String(info.dev),
      size: Number(info.size),
    });
    if (info.size === 0n && emptyInterruptions.delete(basename(path))) throw interrupted;
  };
  const legacy: LegacyTransitionReaderFactory = async (path) => {
    // The public legacy adapter runs in this process; use a real native handle to
    // retain that lifetime without inspecting or depending on proprietary storage.
    const db = new DatabaseSync(path);
    await checkpoint({ event: 'legacy-open', path });
    return {
      async load(unitId) {
        const unit = units!.find((value) => value.unitId === unitId);
        assert.ok(unit);
        return { snapshot: structuredClone(unit.snapshot), revision: unit.revision };
      },
      async purge() {},
      async assertMissing() {},
      async close() {
        db.close();
      },
    };
  };
  let interruptExport = true;
  const exportOptions = {
    source,
    directory: bundle,
    legacy,
    bindFile,
    progress() {
      if (interruptExport) {
        interruptExport = false;
        throw interrupted;
      }
    },
  };
  // These are deterministic injected failures at different boundaries, not retries
  // of a flaky assertion. Keep the same process to retain all prior native owners.
  for (let attempt = 0; attempt < 3; attempt++) {
    await assert.rejects(exportSyncTransition(exportOptions), (error) => error === interrupted);
    await checkpoint({ event: 'interrupted', operation: 'export' });
  }
  const exported = await exportSyncTransition(exportOptions);
  assert.equal(exported.documents, 7);
  assert.equal(exported.converted, 5);
  let interruptImport = true;
  const importOptions = {
    directory: bundle,
    destination,
    bindFile,
    progress() {
      if (interruptImport) {
        interruptImport = false;
        throw interrupted;
      }
    },
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(importSyncTransition(importOptions), (error) => error === interrupted);
    await checkpoint({ event: 'interrupted', operation: 'import' });
  }
  const imported = await importSyncTransition(importOptions);
  assert.equal(imported.documents, 7);
  assert.equal(imported.converted, 5);
  assert.equal(imported.resumed, false);
  assert.equal((await importSyncTransition(importOptions)).resumed, true);
  assert.equal(await digest(source), sourceHash);
  assert.equal(emptyInterruptions.size, 0);
  await checkpoint({ event: 'complete' });
  // No release(): even after native close and source/staging unlink, ownership
  // ends only when this process and its native descriptors have actually exited.
  process.disconnect?.();
}
