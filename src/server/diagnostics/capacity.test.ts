import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, statfsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test, vi } from 'vitest';
import type { DiagnosticRecord } from '@spinel/diagnostics';
import { DatabaseSync } from '../../../server/database.ts';
import { DiagnosticsStore, DIAGNOSTICS_LIMITS } from './store.ts';

// Only this test module substitutes capacity measurements. SQLite, files and
// the export worker remain real; the worker runs outside Vitest's module mocks.
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return {
    ...original,
    statSync: vi.fn(original.statSync),
    statfsSync: vi.fn(original.statfsSync),
    mkdtempSync: vi.fn(original.mkdtempSync),
  };
});

const event = {
  name: 'operation.failed',
  level: 'error',
  details: { operation: 'document-open', reason: 'unavailable' },
} as const;
const context = { component: 'editor' } as const;
const record = (): DiagnosticRecord => ({ id: randomUUID(), occurredAt: 1234, event, context });

async function fixture(now?: () => number) {
  const original = await vi.importActual<typeof import('node:fs')>('node:fs');
  const directory = mkdtempSync(join(tmpdir(), 'spinel-diagnostics-capacity-'));
  const path = join(directory, 'diagnostics.sqlite');
  const measured = {
    databaseBytes: undefined as number | undefined,
    walBytes: undefined as number | undefined,
    freeBytes: 2 * 1024 ** 3,
  };
  vi.mocked(statSync).mockImplementation((target) => {
    const result = original.statSync(target);
    const size =
      target === path
        ? measured.databaseBytes
        : target === `${path}-wal`
          ? measured.walBytes
          : undefined;
    // Preserve the actual file's identity, permissions and Stats methods.
    if (size !== undefined) Object.defineProperty(result, 'size', { value: size });
    return result;
  });
  vi.mocked(statfsSync).mockImplementation((target) => {
    const result = original.statfsSync(target);
    if (target === directory) {
      // A one-byte reporting block permits exact admission boundaries without
      // allocating a large database or relying on the CI runner's free space.
      Object.defineProperties(result, {
        bsize: { value: 1 },
        bavail: { value: measured.freeBytes },
      });
    }
    return result;
  });
  const store = new DiagnosticsStore({ path, build: 'capacity-test', now });
  expect(store.status().available).toBe(true);
  const database = new DatabaseSync(path);
  const rows = () => database.prepare('SELECT * FROM events ORDER BY id').all();
  const state = () => database.prepare('SELECT * FROM diagnostics_state').get();
  const exportDirectories = () =>
    readdirSync(directory).filter((name) => name.startsWith('.diagnostics-export-'));
  return {
    path,
    store,
    measured,
    rows,
    state,
    exportDirectories,
    async dispose() {
      await store.close();
      database.close();
      vi.mocked(statSync).mockImplementation(original.statSync);
      vi.mocked(statfsSync).mockImplementation(original.statfsSync);
      vi.mocked(mkdtempSync).mockClear();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test.each(['physical', 'reserve'] as const)(
  'expiry preserves accounting under %s pressure and resumes collection after capacity returns',
  async (limit) => {
    let now = 1;
    const f = await fixture(() => now);
    try {
      const actor = randomUUID(),
        generation = f.store.status().generation!;
      expect(f.store.ingest([record()], actor, generation).accepted).toBe(1);
      const beforeRows = f.rows(),
        beforeState = f.state();
      now = 8 * 86_400_000;
      if (limit === 'physical') {
        f.measured.databaseBytes = 48 * 1024 ** 2;
        f.measured.walBytes = 48 * 1024 ** 2;
      } else f.measured.freeBytes = DIAGNOSTICS_LIMITS.reserveBytes - 1;
      expect(() => f.store.expire()).toThrow('could not be expired');
      expect(f.rows()).toEqual(beforeRows);
      expect(f.state()).toEqual(beforeState);
      expect(f.store.status().dropped.expired).toBe(0);
      expect(f.store.ingest([record()], actor, generation).accepted).toBe(0);
      f.measured.databaseBytes = undefined;
      f.measured.walBytes = undefined;
      f.measured.freeBytes = DIAGNOSTICS_LIMITS.reserveBytes;
      expect(f.store.expire()).toEqual({ deleted: 1, remaining: false });
      expect(f.store.status()).toMatchObject({ generation, logicalBytes: 0, recordCount: 0 });
      const fresh = record();
      expect(f.store.ingest([fresh], actor, generation).accepted).toBe(1);
      expect(f.rows().map((row) => row.id)).toEqual([fresh.id]);
      expect(f.store.status()).toMatchObject({
        logicalBytes: Buffer.byteLength(JSON.stringify(fresh)),
        dropped: { expired: 1, storage: 1 },
      });
    } finally {
      await f.dispose();
    }
  },
);

test.each(['database', 'database plus WAL'] as const)(
  'physical %s bytes stop collection at 96 MiB, allow clear and resume only after capacity returns',
  async (source) => {
    const f = await fixture();
    try {
      expect(DIAGNOSTICS_LIMITS.physicalBytes).toBe(96 * 1024 ** 2);
      const actor = randomUUID();
      const generation = f.store.status().generation!;
      f.measured.walBytes = source === 'database' ? 0 : 48 * 1024 ** 2;
      f.measured.databaseBytes = DIAGNOSTICS_LIMITS.physicalBytes - f.measured.walBytes - 1;
      const accepted = record();
      expect(f.store.ingest([accepted], actor, generation)).toEqual({ accepted: 1, dropped: 0 });
      const beforeRows = f.rows();
      const beforeState = f.state();
      f.measured.databaseBytes++;
      const rejected = record();
      expect(f.store.ingest([rejected], actor, generation)).toEqual({ accepted: 0, dropped: 1 });
      const droppedRun = randomUUID();
      f.store.record(event, { ...context, runId: droppedRun }, actor);
      f.store.flush();
      expect(f.rows()).toEqual(beforeRows);
      expect(f.state()).toEqual(beforeState);
      expect(f.store.status()).toMatchObject({
        available: true,
        recordCount: 1,
        dropped: { storage: 2 },
      });

      // Clear remains useful at the write-stop boundary. It does not pretend
      // physical bytes shrank, and capacity recovery must not replay lost work.
      const cleared = f.store.truncate();
      expect(cleared.generation).not.toBe(generation);
      expect(f.rows()).toEqual([]);
      expect(f.store.ingest([record()], actor, cleared.generation)).toEqual({
        accepted: 0,
        dropped: 1,
      });
      f.measured.databaseBytes--;
      const recovered = record();
      expect(f.store.ingest([recovered], actor, cleared.generation)).toEqual({
        accepted: 1,
        dropped: 0,
      });
      f.store.flush();
      expect(f.rows().map((row) => row.id)).toEqual([recovered.id]);
      expect(f.store.status()).toMatchObject({
        generation: cleared.generation,
        recordCount: 1,
        dropped: { storage: 3 },
      });
    } finally {
      await f.dispose();
    }
  },
);

test('free-space reserve rejects writes below 256 MiB and accepts the exact boundary without resurrecting drops', async () => {
  const f = await fixture();
  try {
    expect(DIAGNOSTICS_LIMITS.reserveBytes).toBe(256 * 1024 ** 2);
    const actor = randomUUID();
    const generation = f.store.status().generation!;
    const existing = record();
    expect(f.store.ingest([existing], actor, generation).accepted).toBe(1);
    const beforeRows = f.rows();
    const beforeState = f.state();
    f.measured.freeBytes = DIAGNOSTICS_LIMITS.reserveBytes - 1;
    expect(f.store.ingest([record()], actor, generation)).toEqual({ accepted: 0, dropped: 1 });
    f.store.record(event, context, actor);
    f.store.flush();
    expect(f.rows()).toEqual(beforeRows);
    expect(f.state()).toEqual(beforeState);
    expect(f.store.status()).toMatchObject({
      available: true,
      recordCount: 1,
      dropped: { storage: 2 },
    });

    f.measured.freeBytes++;
    const recovered = record();
    expect(f.store.ingest([recovered], actor, generation)).toEqual({ accepted: 1, dropped: 0 });
    f.store.flush();
    expect(
      f
        .rows()
        .map((row) => row.id)
        .sort(),
    ).toEqual([existing.id, recovered.id].sort());
    expect(f.store.status()).toMatchObject({ recordCount: 2, dropped: { storage: 2 } });
  } finally {
    await f.dispose();
  }
});

test('snapshot staging requires 96 MiB plus the reserve, releases refusal and holds a real export lease until cleanup', async () => {
  const f = await fixture();
  try {
    const actor = randomUUID();
    const generation = f.store.status().generation!;
    const existing = record();
    expect(f.store.ingest([existing], actor, generation).accepted).toBe(1);
    const beforeRows = f.rows();
    const beforeState = f.state();
    f.measured.freeBytes = DIAGNOSTICS_LIMITS.physicalBytes + DIAGNOSTICS_LIMITS.reserveBytes - 1;
    vi.mocked(mkdtempSync).mockClear();
    await expect(f.store.snapshot()).rejects.toMatchObject({ status: 503 });
    expect(mkdtempSync).not.toHaveBeenCalled();
    expect(f.exportDirectories()).toEqual([]);
    expect(f.store.status()).toMatchObject({ available: true, exporting: false, recordCount: 1 });
    expect(f.rows()).toEqual(beforeRows);
    expect(f.state()).toEqual(beforeState);

    // Retrying at the exact staging threshold runs the production SQLite
    // snapshot worker over the small real database, not a stubbed artifact.
    f.measured.freeBytes++;
    const snapshot = await f.store.snapshot();
    const exported = new DatabaseSync(snapshot.path);
    try {
      expect(exported.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      expect(exported.prepare('SELECT * FROM events ORDER BY id').all()).toEqual(beforeRows);
      expect(exported.prepare('SELECT * FROM diagnostics_state').get()).toEqual(beforeState);
      expect(f.store.status().exporting).toBe(true);
      expect(f.exportDirectories()).toHaveLength(1);
      await expect(f.store.snapshot()).rejects.toMatchObject({ status: 409 });
      expect(() => f.store.truncate()).toThrow('A diagnostics download is active.');
    } finally {
      exported.close();
      await snapshot.dispose();
    }
    expect(existsSync(dirname(snapshot.path))).toBe(false);
    expect(f.exportDirectories()).toEqual([]);
    expect(f.store.status().exporting).toBe(false);
    expect(f.rows()).toEqual(beforeRows);
    const cleared = f.store.truncate();
    expect(cleared.generation).not.toBe(generation);
    expect(f.rows()).toEqual([]);
    expect(f.store.ingest([record()], actor, cleared.generation).accepted).toBe(1);
  } finally {
    await f.dispose();
  }
}, 45_000);
