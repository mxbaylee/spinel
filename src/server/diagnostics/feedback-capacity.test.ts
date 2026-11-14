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
  return {
    ...original,
    statfsSync: vi.fn(original.statfsSync),
    rmSync: vi.fn(original.rmSync),
  };
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

test('failed cleanup fences the old pair and staging allocation until removal succeeds', async () => {
  const f = await fixture();
  const original = await vi.importActual<typeof import('node:fs')>('node:fs');
  let denyRemoval = true;
  try {
    const pair = await f.store.prepareFeedback(f.actor, f.operator);
    expect(pair.state).toBe('ready');
    if (pair.state !== 'ready') throw new Error('Expected complete pair.');
    const staged = f.exports();
    expect(staged).toHaveLength(1);
    // Fail only disposal of this real prepared pair. Keep SQLite, the worker,
    // its internal frozen-source removal and all other filesystem work real.
    vi.mocked(rmSync).mockImplementation((target, options) => {
      if (
        denyRemoval &&
        typeof target === 'string' &&
        target.startsWith(join(f.directory, '.diagnostics-feedback-'))
      ) {
        throw Object.assign(new Error('Synthetic removal denial'), { code: 'EACCES' });
      }
      return original.rmSync(target, options);
    });
    await expect(f.store.cancelFeedback(pair.id, f.operator)).rejects.toThrow(
      'Temporary feedback downloads could not be removed',
    );
    expect(() => f.store.feedbackDownload(pair.id, f.operator, 'user')).toThrow(
      'expired or were cleared',
    );
    await expect(f.store.prepareFeedback(f.actor, f.operator)).rejects.toThrow(
      'Temporary feedback downloads could not be removed',
    );
    expect(f.exports()).toEqual(staged);

    denyRemoval = false;
    await f.store.cancelFeedback(pair.id, f.operator);
    expect(f.exports()).toEqual([]);
    const recovered = await f.store.prepareFeedback(f.actor, f.operator);
    expect(recovered.state).toBe('ready');
    if (recovered.state !== 'ready') throw new Error('Expected fresh complete pair.');
    expect(recovered.id).not.toBe(pair.id);
    expect(recovered.counts.user).toBe(1);
    await f.store.cancelFeedback(recovered.id, f.operator);
    expect(f.exports()).toEqual([]);
  } finally {
    denyRemoval = false;
    vi.mocked(rmSync).mockImplementation(original.rmSync);
    await f.close();
  }
});
