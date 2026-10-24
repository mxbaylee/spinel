import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import type { DiagnosticRecord } from '@spinel/diagnostics';
import { DatabaseSync } from '../../../server/database.ts';
import { DiagnosticsStore, DIAGNOSTICS_LIMITS } from './store.ts';

const event = {
  name: 'operation.failed',
  level: 'error',
  details: { operation: 'document-open', reason: 'unavailable' },
} as const;
const context = { component: 'editor' } as const;
const record = (): DiagnosticRecord => ({ id: randomUUID(), occurredAt: 1234, event, context });

test.each(['same', 'symlink', 'hardlink'])(
  'rejects an empty application database through a %s path before creating diagnostics tables',
  async (kind) => {
    const directory = mkdtempSync(join(tmpdir(), 'spinel-diagnostics-alias-'));
    const applicationPath = join(directory, 'app.sqlite');
    const app = new DatabaseSync(applicationPath);
    const path = kind === 'same' ? applicationPath : join(directory, 'diagnostics.sqlite');
    if (kind === 'symlink') symlinkSync(applicationPath, path);
    if (kind === 'hardlink') linkSync(applicationPath, path);
    const store = new DiagnosticsStore({ path, applicationPath, build: 'test-build' });
    try {
      expect(store.status().available).toBe(false);
      expect(app.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);
    } finally {
      await store.close();
      app.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'spinel-diagnostics-'));
  const path = join(directory, 'diagnostics.sqlite');
  const store = new DiagnosticsStore({ path, build: 'test-build' });
  const read = () => new DatabaseSync(path);
  return {
    store,
    path,
    directory,
    read,
    async dispose() {
      await store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('separate schema stores derived provenance, registered messages and valid JSON without app tables', async () => {
  const f = fixture();
  try {
    const actor = randomUUID(),
      runId = randomUUID();
    f.store.record(event, { ...context, runId }, actor);
    f.store.flush();
    const db = f.read();
    try {
      const row = db.prepare('SELECT * FROM events').get()!;
      expect(row).toMatchObject({
        source: 'backend',
        actor_id: actor,
        run_id: runId,
        level: 'error',
        message: 'An operation failed.',
        build: 'test-build',
      });
      expect(JSON.parse(String(row.details))).toEqual(event.details);
      expect(
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
          .all()
          .map((row) => row.name),
      ).toEqual(['diagnostics_state', 'events']);
      expect(statSync(f.path).mode & 0o777).toBe(0o600);
    } finally {
      db.close();
    }
  } finally {
    await f.dispose();
  }
});

test('retry IDs deduplicate only for their authenticated provenance', async () => {
  const f = fixture();
  try {
    const generation = f.store.status().generation!,
      actor = randomUUID(),
      data = record();
    expect(f.store.ingest([data], actor, generation)).toEqual({ accepted: 1, dropped: 0 });
    expect(f.store.ingest([data], actor, generation)).toEqual({ accepted: 1, dropped: 0 });
    expect(f.store.ingest([data], randomUUID(), generation)).toEqual({ accepted: 0, dropped: 1 });
    expect(f.store.status().recordCount).toBe(1);
  } finally {
    await f.dispose();
  }
});

test('truncate clears queued old events and persists the retry fence through reopen', async () => {
  const f = fixture();
  try {
    const oldGeneration = f.store.status().generation!,
      actor = randomUUID();
    f.store.ingest([record()], actor, oldGeneration);
    f.store.emit(event, context); // Still queued when the operator confirms clear.
    const { generation } = f.store.truncate();
    expect(generation).not.toBe(oldGeneration);
    f.store.flush();
    expect(f.store.status().recordCount).toBe(0);
    expect(f.store.ingest([record()], actor, oldGeneration).accepted).toBe(0);
    expect(f.store.ingest([record()], actor, generation).accepted).toBe(1);
    await f.store.close();
    const reopened = new DiagnosticsStore({ path: f.path, build: 'test-build' });
    try {
      expect(reopened.status()).toMatchObject({ generation, recordCount: 1 });
      expect(reopened.ingest([record()], actor, oldGeneration).accepted).toBe(0);
    } finally {
      await reopened.close();
    }
  } finally {
    await f.dispose();
  }
});

test('a real SQLite clear failure rolls back deleted rows and preserves the generation and pending observations', async () => {
  const f = fixture();
  const db = f.read();
  try {
    const generation = f.store.status().generation!;
    const actor = randomUUID();
    const stored = record();
    expect(f.store.ingest([stored], actor, generation)).toEqual({ accepted: 1, dropped: 0 });
    const queuedRun = randomUUID();
    f.store.record(event, { ...context, runId: queuedRun }, actor);
    const before = f.store.status();
    const state = db.prepare('SELECT * FROM diagnostics_state').get();
    const rows = db.prepare('SELECT * FROM events').all();
    // Fail after DELETE has run, so the test proves transaction rollback rather
    // than merely refusing entry. There is no await that could flush the queue.
    db.exec(`CREATE TRIGGER reject_clear BEFORE UPDATE OF generation ON diagnostics_state
      BEGIN SELECT RAISE(ABORT, 'Injected clear failure'); END;`);
    expect(() => f.store.truncate()).toThrow('Diagnostics could not be cleared.');
    expect(f.store.status()).toEqual(before);
    expect(db.prepare('SELECT * FROM diagnostics_state').get()).toEqual(state);
    expect(db.prepare('SELECT * FROM events').all()).toEqual(rows);

    db.exec('DROP TRIGGER reject_clear');
    const laterRun = randomUUID();
    f.store.record(event, { ...context, runId: laterRun }, actor);
    f.store.flush();
    await vi.waitFor(() => expect(f.store.status().recordCount).toBe(3));
    expect(f.store.status()).toMatchObject({
      generation,
      recordCount: 3,
      dropped: { stale: 0, storage: 0, unavailable: 0 },
    });
    expect(db.prepare('SELECT id FROM events WHERE id=?').get(stored.id)?.id).toBe(stored.id);
    for (const run of [queuedRun, laterRun]) {
      expect(
        db.prepare('SELECT generation,source,actor_id FROM events WHERE run_id=?').get(run),
      ).toEqual({ generation, source: 'backend', actor_id: actor });
    }
  } finally {
    db.close();
    await f.dispose();
  }
});

test('bounded queues/storage and unavailable stores drop observations without throwing into callers', async () => {
  const f = fixture();
  try {
    for (let i = 0; i < DIAGNOSTICS_LIMITS.queueEvents + 10; i++) f.store.emit(event, context);
    expect(f.store.status().dropped.queue).toBe(10);
    f.store.truncate();
    const db = f.read();
    try {
      db.prepare('UPDATE diagnostics_state SET logical_bytes=?').run(
        DIAGNOSTICS_LIMITS.storageBytes,
      );
    } finally {
      db.close();
    }
    expect(() => {
      f.store.emit(event, context);
      f.store.flush();
    }).not.toThrow();
    expect(f.store.status()).toMatchObject({ recordCount: 0, dropped: { storage: 1 } });
    const unavailable = new DiagnosticsStore({ path: f.directory, build: 'test-build' });
    try {
      expect(unavailable.status().available).toBe(false);
      expect(() => unavailable.emit(event, context)).not.toThrow();
    } finally {
      await unavailable.close();
    }
  } finally {
    await f.dispose();
  }
});

test('the configured logical ceiling admits its exact final record, drops the next and resumes after clear', async () => {
  const f = fixture();
  const db = f.read();
  try {
    expect(DIAGNOSTICS_LIMITS.storageBytes).toBe(64 * 1024 * 1024);
    const generation = f.store.status().generation!;
    const actor = randomUUID();
    const finalRecord = record();
    const bytes = Buffer.byteLength(JSON.stringify(finalRecord));
    // Isolate the real configured arithmetic without allocating 64 MiB or
    // accidentally reaching SQLite's separate physical-page limit first.
    db.prepare('UPDATE diagnostics_state SET logical_bytes=? WHERE singleton=1').run(
      DIAGNOSTICS_LIMITS.storageBytes - bytes,
    );
    const started = performance.now();
    expect(f.store.ingest([finalRecord], actor, generation)).toEqual({ accepted: 1, dropped: 0 });
    const admittedMs = performance.now() - started;
    expect(f.store.status()).toMatchObject({
      logicalBytes: DIAGNOSTICS_LIMITS.storageBytes,
      recordCount: 1,
    });
    const rejectedRecord = record();
    const rejectStarted = performance.now();
    expect(f.store.ingest([rejectedRecord], actor, generation)).toEqual({
      accepted: 0,
      dropped: 1,
    });
    const rejectedMs = performance.now() - rejectStarted;
    expect(db.prepare('SELECT id FROM events WHERE id=?').get(rejectedRecord.id)).toBeUndefined();
    expect(f.store.status()).toMatchObject({
      generation,
      logicalBytes: DIAGNOSTICS_LIMITS.storageBytes,
      recordCount: 1,
      dropped: { storage: 1 },
    });
    const next = f.store.truncate().generation;
    expect(next).not.toBe(generation);
    expect(f.store.ingest([rejectedRecord], actor, next)).toEqual({ accepted: 1, dropped: 0 });
    expect(f.store.status().logicalBytes).toBe(Buffer.byteLength(JSON.stringify(rejectedRecord)));
    console.log(
      JSON.stringify({
        probe: 'diagnostics-logical-boundary',
        configuredLogicalBytes: DIAGNOSTICS_LIMITS.storageBytes,
        boundaryMode: 'seeded-counter-not-full-size-store',
        admittedRecordBytes: bytes,
        admittedMs,
        rejectedMs,
      }),
    );
  } finally {
    db.close();
    await f.dispose();
  }
});

test('a bounded seeded store exports a standalone consistent SQLite file and reports observed CI costs', async () => {
  const f = fixture();
  const seed = f.read();
  const copies = 4096;
  const expectedRows = copies + 1;
  let sample: ReturnType<typeof setInterval> | undefined;
  try {
    const original = record();
    original.id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const generation = f.store.status().generation!;
    expect(f.store.ingest([original], randomUUID(), generation)).toEqual({
      accepted: 1,
      dropped: 0,
    });
    // Clone a validated, actually stored record in one bounded SQLite statement.
    // Fixed-width unique UUIDs preserve serialized byte_size; this prepares an
    // export fixture, not a claim about HTTP rate limits or ingestion throughput.
    seed.exec('BEGIN IMMEDIATE');
    seed
      .prepare(
        `WITH RECURSIVE sequence(n) AS (
      VALUES(1) UNION ALL SELECT n+1 FROM sequence WHERE n < ?
    ) INSERT INTO events (
      id,schema_version,generation,occurred_at,received_at,name,kind,source,component,build,
      actor_id,file_id,space_id,route,run_id,level,message,metric_kind,metric_unit,metric_value,details,byte_size
    ) SELECT '00000000-0000-4000-8000-' || printf('%012x',n),
      schema_version,generation,occurred_at,received_at,name,kind,source,component,build,
      actor_id,file_id,space_id,route,run_id,level,message,metric_kind,metric_unit,metric_value,details,byte_size
      FROM sequence CROSS JOIN events WHERE events.id=?`,
      )
      .run(copies, original.id);
    seed.exec(
      'UPDATE diagnostics_state SET logical_bytes=(SELECT sum(byte_size) FROM events) WHERE singleton=1; COMMIT; PRAGMA wal_checkpoint(TRUNCATE);',
    );
    const logicalBytes = f.store.status().logicalBytes;
    expect(f.store.status().recordCount).toBe(expectedRows);
    expect(logicalBytes).toBe(expectedRows * Buffer.byteLength(JSON.stringify(original)));
    expect(statSync(f.path).size).toBeLessThanOrEqual(DIAGNOSTICS_LIMITS.storageBytes);

    const rssBeforeBytes = process.memoryUsage().rss;
    let sampledPeakRssBytes = rssBeforeBytes;
    sample = setInterval(() => {
      sampledPeakRssBytes = Math.max(sampledPeakRssBytes, process.memoryUsage().rss);
    }, 10);
    const started = performance.now();
    const snapshot = await f.store.snapshot();
    const snapshotDurationMs = performance.now() - started;
    clearInterval(sample);
    sample = undefined;
    const rssAfterBytes = process.memoryUsage().rss;
    sampledPeakRssBytes = Math.max(sampledPeakRssBytes, rssAfterBytes);
    const snapshotBytes = statSync(snapshot.path).size;
    expect(snapshotBytes).toBeLessThanOrEqual(DIAGNOSTICS_LIMITS.storageBytes);
    const standalonePath = join(f.directory, 'standalone.sqlite');
    try {
      // Later collection must not change the already completed snapshot.
      expect(f.store.ingest([record()], randomUUID(), generation)).toEqual({
        accepted: 1,
        dropped: 0,
      });
      copyFileSync(snapshot.path, standalonePath);
    } finally {
      await snapshot.dispose();
    }
    expect(f.store.status()).toMatchObject({ exporting: false, recordCount: expectedRows + 1 });
    expect(
      readdirSync(f.directory).filter((name) => name.startsWith('.diagnostics-export-')),
    ).toEqual([]);
    seed.close();
    await f.store.close();
    expect(existsSync(standalonePath + '-wal')).toBe(false);
    expect(existsSync(standalonePath + '-shm')).toBe(false);
    const exported = new DatabaseSync(standalonePath);
    try {
      expect(exported.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');
      expect(exported.prepare('PRAGMA user_version').get()?.user_version).toBe(1);
      expect(
        exported
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
          )
          .all()
          .map((row) => row.name),
      ).toEqual(['diagnostics_state', 'events']);
      expect(exported.prepare('SELECT count(*) AS count FROM events').get()?.count).toBe(
        expectedRows,
      );
      expect(
        exported.prepare('SELECT generation,logical_bytes FROM diagnostics_state').get(),
      ).toEqual({ generation, logical_bytes: logicalBytes });
      expect(exported.prepare('SELECT count(DISTINCT id) AS count FROM events').get()?.count).toBe(
        expectedRows,
      );
      expect(
        exported
          .prepare(
            'SELECT count(*) AS invalid FROM events WHERE json_valid(details)=0 OR generation<>?',
          )
          .get(generation)?.invalid,
      ).toBe(0);
    } finally {
      exported.close();
    }
    console.log(
      JSON.stringify({
        probe: 'diagnostics-bounded-export',
        fixtureRows: expectedRows,
        fixtureLogicalBytes: logicalBytes,
        snapshotBytes,
        snapshotDurationMs,
        rssBeforeBytes,
        rssAfterBytes,
        sampledPeakRssBytes,
        sampleIntervalMs: 10,
        resourceScope: 'test-process-including-export-worker-not-isolated-worker-or-deployment',
      }),
    );
  } finally {
    if (sample) clearInterval(sample);
    if (seed.isOpen) seed.close();
    await f.dispose();
  }
}, 30_000);

test('refuses an application database even if accidentally given its path', async () => {
  const f = fixture();
  try {
    const path = join(f.directory, 'application.sqlite'),
      db = new DatabaseSync(path);
    db.exec(
      "CREATE TABLE private_documents(content TEXT); INSERT INTO private_documents VALUES('private document')",
    );
    db.close();
    const wrong = new DiagnosticsStore({ path, build: 'test' });
    try {
      expect(wrong.status().available).toBe(false);
      await expect(wrong.snapshot()).rejects.toThrow('unavailable');
      expect(() => wrong.truncate()).toThrow('unavailable');
    } finally {
      await wrong.close();
    }
    const verify = new DatabaseSync(path);
    try {
      expect(verify.prepare('SELECT content FROM private_documents').get()?.content).toBe(
        'private document',
      );
    } finally {
      verify.close();
    }
  } finally {
    await f.dispose();
  }
});

test('consistent export leases block destructive clear, permit new collection and clean up on delivery', async () => {
  const f = fixture();
  try {
    f.store.emit(event, context);
    const pending = f.store.snapshot();
    expect(() => f.store.truncate()).toThrow('download is active');
    const snapshot = await pending;
    try {
      const exported = new DatabaseSync(snapshot.path);
      try {
        expect(exported.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');
        expect(exported.prepare('SELECT count(*) AS count FROM events').get()?.count).toBe(1);
        f.store.emit(event, context);
        f.store.flush();
        expect(exported.prepare('SELECT count(*) AS count FROM events').get()?.count).toBe(1);
        expect(f.store.status().recordCount).toBe(2);
      } finally {
        exported.close();
      }
      await expect(f.store.snapshot()).rejects.toThrow('already active');
    } finally {
      await snapshot.dispose();
    }
    expect(
      readdirSync(f.directory).filter((name) => name.startsWith('.diagnostics-export-')),
    ).toEqual([]);
    f.store.truncate();
    expect(f.store.status().recordCount).toBe(0);
  } finally {
    await f.dispose();
  }
});

test('interrupted snapshot releases its worker/lease and removes private staging', async () => {
  const f = fixture();
  try {
    const controller = new AbortController();
    const pending = f.store.snapshot(controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('could not be downloaded');
    expect(f.store.status().exporting).toBe(false);
    expect(
      readdirSync(f.directory).filter((name) => name.startsWith('.diagnostics-export-')),
    ).toEqual([]);
    expect(() => f.store.truncate()).not.toThrow();
  } finally {
    await f.dispose();
  }
});
