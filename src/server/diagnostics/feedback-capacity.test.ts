import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync, statfsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { FEEDBACK_LIMITS } from '../../shared/feedback.ts';
import { DiagnosticsStore, DIAGNOSTICS_LIMITS } from './store.ts';

// Model the capacity boundary, while all SQLite files and workers stay real.
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return { ...original, statfsSync: vi.fn(original.statfsSync) };
});

async function fixture() {
  const original = await vi.importActual<typeof import('node:fs')>('node:fs');
  const directory = mkdtempSync(join(tmpdir(), 'spinel-feedback-capacity-'));
  const path = join(directory, 'diagnostics.sqlite');
  let freeBytes = 2 * 1024 ** 3;
  vi.mocked(statfsSync).mockImplementation((target) => {
    const result = original.statfsSync(target);
    if (target === directory)
      Object.defineProperties(result, { bsize: { value: 1 }, bavail: { value: freeBytes } });
    return result;
  });
  const store = new DiagnosticsStore({ path, build: 'capacity-test' });
  const actor = randomUUID(),
    operator = { actorId: randomUUID(), sessionHash: 'operator' };
  const db = new DatabaseSync(path);
  store.feedback(
    { id: randomUUID(), message: 'Explicit feedback', context: { route: '/files' } },
    actor,
    store.status().generation!,
  );
  return {
    store,
    actor,
    operator,
    db,
    directory,
    free(value: number) {
      freeBytes = value;
    },
    exports: () =>
      readdirSync(directory).filter((name) => name.startsWith('.diagnostics-feedback-')),
    async close() {
      await store.close();
      db.close();
      vi.mocked(statfsSync).mockImplementation(original.statfsSync);
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('pair preparation requires its complete bounded staging plus reserve and never silently returns a partial export', async () => {
  const f = await fixture();
  try {
    const required = FEEDBACK_LIMITS.stagingBytes + DIAGNOSTICS_LIMITS.reserveBytes;
    f.free(required - 1);
    await expect(f.store.prepareFeedback(f.actor, f.operator)).rejects.toThrow('not enough space');
    expect(f.exports()).toEqual([]);
    expect(f.store.status().recordCount).toBe(1);
    f.free(required);
    const pair = await f.store.prepareFeedback(f.actor, f.operator);
    expect(pair.state).toBe('ready');
    if (pair.state !== 'ready') throw new Error('Expected complete pair.');
    expect(pair.counts).toEqual({ user: 1, system: 1, userObservations: 0, systemObservations: 0 });
    await f.store.cancelFeedback(pair.id, f.operator);
    expect(f.exports()).toEqual([]);
  } finally {
    await f.close();
  }
});

test('a real source failure after staging begins cannot publish either artifact and removes interrupted files', async () => {
  const f = await fixture();
  try {
    // Keep the isolated table set but break the worker's expected schema. This
    // deterministically fails after staging starts, without a timing race.
    f.db.exec('ALTER TABLE events RENAME COLUMN actor_id TO unavailable_actor_id');
    await expect(f.store.prepareFeedback(f.actor, f.operator)).rejects.toThrow(
      'could not be prepared',
    );
    expect(f.exports()).toEqual([]);
  } finally {
    await f.close();
  }
});
