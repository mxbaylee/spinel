import { randomUUID } from 'node:crypto';
import { linkSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
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
