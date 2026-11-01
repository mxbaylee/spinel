import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { createApp } from '../../../server/app.ts';
import { DatabaseSync } from '../../../server/database.ts';
import { CollaborationStore } from '../collaboration/service.ts';
import { restoreSnapshotFingerprint } from './inventory.ts';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

test.each([false, true])(
  'final app shutdown waits for witness acceptance and closes on rejection=%s',
  async (reject) => {
    const root = await mkdtemp(join(tmpdir(), 'spinel-drain-app-'));
    roots.push(root);
    await writeFile(join(root, 'index.html'), 'Fixture');
    const path = join(root, 'spinel.sqlite');
    const seed = new DatabaseSync(path);
    seed.exec(
      "CREATE TABLE final_flush(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO final_flush VALUES(1,'before')",
    );
    seed.close();
    const originalClose = CollaborationStore.prototype.close;
    vi.spyOn(CollaborationStore.prototype, 'close').mockImplementation(async function (
      this: CollaborationStore,
    ) {
      await originalClose.call(this);
      const late = new DatabaseSync(path);
      try {
        late.exec("UPDATE final_flush SET value='final flush'");
      } finally {
        late.close();
      }
    });
    const guard = vi.spyOn(DatabaseSync.prototype, 'setWriteGuard');
    const app = await createApp({ databasePath: path, staticDirectory: root });
    let terminal: DatabaseSync | undefined;
    let release: (() => void) | undefined;
    const closed = app.close({
      async acceptRestoreWitness(fingerprint) {
        terminal = guard.mock.contexts.at(-1) as DatabaseSync;
        expect(terminal.path).toBe(path);
        expect(terminal.prepare('SELECT value FROM final_flush').get()!.value).toBe('final flush');
        expect(fingerprint).toBe(restoreSnapshotFingerprint(terminal));
        terminal.assertQuiescent();
        expect(() => terminal!.exec('DELETE FROM final_flush')).toThrow('sealed');
        await new Promise<void>((resolve, rejectPromise) => {
          release = () =>
            reject ? rejectPromise(new Error('Supervisor persistence failed.')) : resolve();
        });
      },
    });
    void closed.catch(() => {});
    try {
      await expect.poll(() => !!release).toBe(true);
      expect(terminal!.isOpen).toBe(true);
      release!();
      if (reject) await expect(closed).rejects.toThrow('Supervisor persistence failed');
      else await closed;
      // Logical close is asserted here; process reaping/FD inventory is separate.
      expect(terminal!.isOpen).toBe(false);
    } finally {
      release?.();
      await closed.catch(() => {});
    }
  },
);
