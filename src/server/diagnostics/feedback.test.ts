import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test, vi } from 'vitest';
import type { DiagnosticRecord } from '@spinel/diagnostics';
import { DatabaseSync } from '../../../server/database.ts';
import { FEEDBACK_LIMITS } from '../../shared/feedback.ts';
import type { FeedbackPair, FeedbackScope } from '../../shared/feedback.ts';
import { DIAGNOSTICS_LIMITS, DiagnosticsStore } from './store.ts';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'spinel-feedback-'));
  const path = join(directory, 'diagnostics.sqlite');
  let time = 100;
  const store = new DiagnosticsStore({ path, build: 'test-build', now: () => time });
  const actor = randomUUID(),
    other = randomUUID();
  const operator = { actorId: randomUUID(), sessionHash: 'operator-session' };
  const generation = store.status().generation!;
  const db = new DatabaseSync(path);
  const feedback = (actorId = actor, message = 'Deliberately submitted text', id = randomUUID()) =>
    store.feedback({ id, message, context: { route: '/files' } }, actorId, generation);
  const observation = (
    actorId: string | undefined,
    source: 'frontend' | 'backend' = 'frontend',
  ) => {
    const record: DiagnosticRecord = {
      id: randomUUID(),
      occurredAt: 9_000_000,
      event: {
        name: 'operation.result',
        details: { operation: 'document-open', outcome: 'success', durationMs: 1 },
      },
      context: { component: 'editor', route: '/files', runId: randomUUID() },
    };
    if (source === 'backend') {
      store.record(record.event, record.context, actorId);
      store.flush();
    } else store.ingest([record], actorId!, generation);
    return record;
  };
  const read = (path: string) => {
    const output = new DatabaseSync(path, { readOnly: true });
    try {
      return {
        rows: output.prepare('SELECT * FROM events ORDER BY id').all(),
        manifest: JSON.parse(
          String(output.prepare('SELECT details FROM export_manifest').get()!.details),
        ),
        check: output.prepare('PRAGMA integrity_check').get()?.integrity_check,
      };
    } finally {
      output.close();
    }
  };
  const artifact = async (pair: FeedbackPair, scope: FeedbackScope) => {
    const download = store.feedbackDownload(pair.id, operator, scope);
    try {
      return { ...read(download.path), path: download.path, bytes: readFileSync(download.path) };
    } finally {
      await download.finish(false);
    }
  };
  return {
    directory,
    path,
    store,
    actor,
    other,
    operator,
    generation,
    db,
    feedback,
    observation,
    read,
    artifact,
    time(value: number) {
      time = value;
    },
    async close() {
      db.close();
      await store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('SPN-110 expiry preserves actual paired snapshots and old feedback while new metadata reports missing observations', async () => {
  const f = fixture();
  try {
    const report = f.feedback();
    const observation = f.observation(f.actor);
    f.observation(undefined, 'backend');
    const originalRows = f.db.prepare('SELECT * FROM events ORDER BY id').all();
    expect(originalRows).toHaveLength(3);
    // Capture already-old rows before the first bounded maintenance pass.
    // Pair age stays within its own five-minute lease throughout this test.
    f.time(8 * 86_400_000);
    const pair = await f.store.prepareFeedback(f.actor, f.operator);
    if (pair.state !== 'ready') throw new Error('Expected captured pair');
    const before = {
      user: await f.artifact(pair, 'user'),
      system: await f.artifact(pair, 'system'),
    };
    expect(before.user.rows.map((row) => row.id).sort()).toEqual(
      [report.id, observation.id].sort(),
    );
    expect(before.system.rows).toEqual(originalRows);
    expect(f.store.expire()).toEqual({ deleted: 2, remaining: false });
    expect(f.store.status()).toMatchObject({
      generation: f.generation,
      recordCount: 1,
      retentionDays: 7,
      dropped: { expired: 2 },
    });
    expect(f.db.prepare('SELECT id FROM events').all()).toEqual([{ id: report.id }]);
    expect(f.store.feedbackFlags().actors).toEqual([f.actor]);
    for (const scope of ['user', 'system'] as const) {
      const after = await f.artifact(pair, scope);
      expect(after.bytes).toEqual(before[scope].bytes);
      expect(after.manifest).toEqual(before[scope].manifest);
      expect(after.manifest.retention.observationAgeTargetDays).toBe(7);
    }
    await f.store.cancelFeedback(pair.id, f.operator);
    const fresh = await f.store.prepareFeedback(f.actor, f.operator);
    if (fresh.state !== 'ready') throw new Error('Expected feedback-only pair');
    expect(fresh).toMatchObject({
      context: 'feedback-only',
      counts: { user: 1, system: 1, userObservations: 0, systemObservations: 0 },
    });
    const retained = {
      user: await f.artifact(fresh, 'user'),
      system: await f.artifact(fresh, 'system'),
    };
    for (const artifact of Object.values(retained)) {
      expect(artifact.rows.map((row) => row.id)).toEqual([report.id]);
      expect(artifact.manifest).toMatchObject({
        context: 'feedback-only',
        historicalCompleteness: 'unknown',
        retention: { observationAgeTargetDays: 7 },
        dropped: { values: { expired: 2 } },
      });
      expect(artifact.manifest.retention.observations).not.toContain(
        'no automatic expiry configured',
      );
      expect(artifact.manifest.limitations.join(' ')).toContain('expiry');
    }
    const cleared = f.store.truncate();
    expect(cleared.generation).not.toBe(f.generation);
    expect(() => f.store.feedbackDownload(fresh.id, f.operator, 'user')).toThrow(
      'expired or were cleared',
    );
    expect(() => f.store.feedbackDownload(fresh.id, f.operator, 'system')).toThrow(
      'expired or were cleared',
    );
    expect(f.store.ingest([observation], f.actor, f.generation).accepted).toBe(0);
    mkdirSync('test-results', { recursive: true });
    const inspect = (value: typeof before) =>
      Object.fromEntries(
        Object.entries(value).map(([scope, artifact]) => [
          scope,
          { rows: artifact.rows, manifest: artifact.manifest, integrity: artifact.check },
        ]),
      );
    writeFileSync(
      'test-results/spn110-paired-export.json',
      JSON.stringify(
        {
          originalRows,
          frozen: inspect(before),
          afterExpiry: inspect(retained),
          explicitTruncateInvalidatedBoth: true,
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    await f.close();
  }
});

test('feedback commits synchronously, preserves exact intentional text and retries only the same payload/actor', async () => {
  const f = fixture();
  try {
    const id = randomUUID(),
      message = 'Text explicitly entered by a person.\nKeep this exact draft.';
    const input = { id, message, context: { route: '/files' as const, runId: randomUUID() } };
    const receipt = f.store.feedback(input, f.actor, f.generation);
    expect(receipt).toEqual({ id, generation: f.generation, receivedAt: 100 });
    f.time(200);
    expect(f.store.feedback(input, f.actor, f.generation, () => false)).toEqual(receipt);
    expect(
      f.db.prepare('SELECT name,source,actor_id,message,received_at,occurred_at FROM events').get(),
    ).toEqual({
      name: 'feedback',
      source: 'frontend',
      actor_id: f.actor,
      message,
      received_at: 100,
      occurred_at: 100,
    });
    expect(f.store.feedbackFlags()).toEqual({ generation: f.generation, actors: [f.actor] });
    expect(() =>
      f.store.feedback({ ...input, message: 'Changed text' }, f.actor, f.generation),
    ).toThrow('request changed');
    expect(() => f.store.feedback(input, f.other, f.generation)).toThrow('request changed');
    expect(() =>
      f.store.feedback({ ...input, context: { route: '/profile' } }, f.actor, f.generation),
    ).toThrow('request changed');
    expect(f.store.status().recordCount).toBe(1);
    // The receipt is durable without waiting for the lossy flush queue or process shutdown.
    await f.store.close();
    const reopened = new DiagnosticsStore({ path: f.path, build: 'next-build' });
    try {
      expect(reopened.feedback(input, f.actor, f.generation)).toEqual(receipt);
      expect(reopened.feedbackFlags().actors).toEqual([f.actor]);
    } finally {
      await reopened.close();
    }
  } finally {
    await f.close();
  }
});

test('feedback failures never acknowledge or increment best-effort loss counters, and a real transactional failure rolls back', async () => {
  const f = fixture();
  try {
    const before = f.store.status();
    expect(() => f.feedback(f.actor, ' ')).toThrow('feedback message');
    expect(() => f.feedback(f.actor, 'a'.repeat(FEEDBACK_LIMITS.messageLength + 1))).toThrow(
      'feedback message',
    );
    expect(() =>
      f.store.feedback(
        { id: randomUUID(), message: 'Rate refusal', context: { route: '/files' } },
        f.actor,
        f.generation,
        () => false,
      ),
    ).toThrow('temporarily limited');
    f.db.exec(
      "CREATE TRIGGER reject_feedback BEFORE UPDATE OF logical_bytes ON diagnostics_state BEGIN SELECT RAISE(ABORT,'write failed'); END;",
    );
    expect(() => f.feedback()).toThrow('could not be saved');
    expect(f.store.status()).toEqual(before);
    f.db.exec('DROP TRIGGER reject_feedback');
    f.db
      .prepare('UPDATE diagnostics_state SET logical_bytes=?')
      .run(DIAGNOSTICS_LIMITS.storageBytes);
    expect(() => f.feedback()).toThrow('storage is full');
    expect(f.db.prepare('SELECT count(*) AS count FROM events').get()?.count).toBe(0);
    expect(f.store.status().dropped).toEqual(before.dropped);
    f.db.prepare('UPDATE diagnostics_state SET logical_bytes=0').run();
    expect(f.feedback().id).toBeTypeOf('string');
  } finally {
    await f.close();
  }
});

test('truncate atomically clears flags and fences old feedback retries across restart', async () => {
  const f = fixture();
  try {
    const input = {
      id: randomUUID(),
      message: 'Old report',
      context: { route: '/files' as const },
    };
    f.store.feedback(input, f.actor, f.generation);
    f.store.record(
      {
        name: 'operation.result',
        details: { operation: 'search', outcome: 'success', durationMs: 1 },
      },
      { component: 'server' },
      f.actor,
    );
    const next = f.store.truncate().generation;
    expect(f.store.feedbackFlags()).toEqual({ generation: next, actors: [] });
    expect(() => f.store.feedback(input, f.actor, f.generation)).toThrow('were cleared');
    f.store.flush();
    expect(f.store.status().recordCount).toBe(0);
    await f.store.close();
    const reopened = new DiagnosticsStore({ path: f.path, build: 'next-build' });
    try {
      expect(() => reopened.feedback(input, f.actor, f.generation)).toThrow('were cleared');
      expect(reopened.feedback({ ...input, id: randomUUID() }, f.actor, next).generation).toBe(
        next,
      );
    } finally {
      await reopened.close();
    }
  } finally {
    await f.close();
  }
});

test('paired exports contain exact complete receipt-time selections, including ties and backend attribution, frozen across ingestion and expiry', async () => {
  const f = fixture();
  try {
    f.time(90);
    f.feedback(f.other, 'EXCLUDED-BEFORE-PRIVATE-CONTENT');
    f.time(100);
    f.feedback();
    f.observation(f.other);
    f.time(150);
    f.observation(f.actor, 'backend');
    f.observation(undefined, 'backend');
    f.feedback(f.other, 'SYSTEM-ONLY-EXPLICIT-TEXT');
    f.time(200);
    f.observation(f.actor);
    f.observation(undefined, 'backend');
    f.time(210);
    f.feedback(f.other, 'EXCLUDED-AFTER-PRIVATE-CONTENT');
    const rows = f.db.prepare('SELECT * FROM events ORDER BY id').all();
    const userRows = rows.filter((row) => row.actor_id === f.actor);
    const systemRows = rows.filter(
      (row) => Number(row.received_at) >= 100 && Number(row.received_at) <= 200,
    );
    const prepared = await f.store.prepareFeedback(f.actor, f.operator);
    expect(prepared.state).toBe('ready');
    if (prepared.state !== 'ready') throw new Error('Expected complete pair.');
    expect(prepared.window).toEqual({ start: 100, end: 200 });
    const user = await f.artifact(prepared, 'user');
    expect(user.rows).toEqual(userRows);
    expect(user.rows.some((row) => row.source === 'backend')).toBe(true);
    expect(user.bytes.includes(Buffer.from('SYSTEM-ONLY-EXPLICIT-TEXT'))).toBe(false);
    expect(statSync(dirname(user.path)).mode & 0o777).toBe(0o700);
    expect(statSync(user.path).mode & 0o777).toBe(0o600);
    // A trusted clock rollback places new rows INSIDE the old span. They still
    // cannot enter the second artifact, because both use the same snapshot.
    f.time(175);
    f.feedback(f.other, 'NEW-AFTER-SNAPSHOT');
    f.observation(f.actor);
    // Model future observation TTL without changing the explicit truncate generation.
    f.db.exec(
      "DELETE FROM events WHERE name!='feedback'; UPDATE diagnostics_state SET logical_bytes=(SELECT coalesce(sum(byte_size),0) FROM events);",
    );
    const system = await f.artifact(prepared, 'system');
    expect(system.rows).toEqual(systemRows);
    for (const text of [
      'EXCLUDED-BEFORE-PRIVATE-CONTENT',
      'EXCLUDED-AFTER-PRIVATE-CONTENT',
      'NEW-AFTER-SNAPSHOT',
    ])
      expect(system.bytes.includes(Buffer.from(text))).toBe(false);
    expect(system.bytes.includes(Buffer.from('SYSTEM-ONLY-EXPLICIT-TEXT'))).toBe(true);
    expect(user.check).toBe('ok');
    expect(system.check).toBe('ok');
    for (const item of [user, system]) {
      expect(item.manifest).toMatchObject({
        snapshotId: prepared.id,
        generation: f.generation,
        selectedActorId: f.actor,
        window: { start: 100, end: 200 },
        completeRetainedSelection: true,
        historicalCompleteness: 'unknown',
      });
      expect(item.manifest.rowCount).toBe(item.rows.length);
      expect(item.manifest.counts).toEqual(prepared.counts);
      expect(item.manifest.dropped.scope).toContain('global process lifetime');
    }
    expect(user.manifest.snapshotWatermark).toEqual(system.manifest.snapshotWatermark);
    expect(system.rows.some((row) => row.actor_id === null)).toBe(true);
    expect(f.store.feedbackFlags().actors).toEqual([f.actor, f.other].sort());
  } finally {
    await f.close();
  }
});

test.each([undefined, 3])(
  'old-feedback-only exports report retention override %s without borrowing unrelated current metrics',
  async (retentionDays) => {
    const f = fixture();
    try {
      // SPN-110 owns the policy/expiry implementation. This adapter control checks
      // forwarding the deployment-provided policy into both real export files.
      const status = f.store.status.bind(f.store);
      const policy = retentionDays ?? status().retentionDays;
      const statusSpy = vi
        .spyOn(f.store, 'status')
        .mockImplementation(() => ({ ...status(), retentionDays: policy }));
      const report = f.feedback();
      f.time(200);
      f.observation(f.other);
      const pair = await f.store.prepareFeedback(f.actor, f.operator);
      if (pair.state !== 'ready') throw new Error('Expected feedback pair.');
      expect(pair).toMatchObject({
        window: { start: 100, end: 100 },
        context: 'feedback-only',
        counts: { user: 1, system: 1, userObservations: 0, systemObservations: 0 },
      });
      for (const scope of ['user', 'system'] as const) {
        const exported = await f.artifact(pair, scope);
        expect(exported.rows.map((row) => row.id)).toEqual([report.id]);
        expect(exported.manifest.retention.observationAgeTargetDays).toBe(policy ?? null);
        expect(exported.manifest.retention.observations).toContain(
          policy === undefined ? 'no automatic expiry configured' : 'server receipt age target',
        );
        expect(exported.manifest.historicalCompleteness).toBe('unknown');
      }
      statusSpy.mockRestore();
      await f.store.cancelFeedback(pair.id, f.operator);
      const empty = await f.store.prepareFeedback(randomUUID(), f.operator);
      expect(empty).toEqual({ state: 'empty', generation: f.generation });
      expect(
        readdirSync(f.directory).filter((name) => name.startsWith('.diagnostics-feedback-')),
      ).toEqual([]);
      expect(() => f.store.feedbackDownload(pair.id, f.operator, 'system')).toThrow(
        'expired or were cleared',
      );
    } finally {
      await f.close();
    }
  },
);

test('idle pairs retain no generic-download or maintenance lock; bounds prevent concurrent preparation or transfer', async () => {
  const f = fixture();
  try {
    f.feedback();
    const preparing = f.store.prepareFeedback(f.actor, f.operator);
    await expect(f.store.prepareFeedback(f.actor, f.operator)).rejects.toThrow('already prepared');
    await expect(f.store.snapshot()).rejects.toThrow('already active');
    const pair = await preparing;
    if (pair.state !== 'ready') throw new Error('Expected pair.');
    expect(f.store.status().exporting).toBe(false);
    const generic = await f.store.snapshot();
    expect(existsSync(generic.path)).toBe(true);
    expect(() => f.store.feedbackDownload(pair.id, f.operator, 'user')).toThrow('already active');
    await generic.dispose();
    const first = f.store.feedbackDownload(pair.id, f.operator, 'user');
    expect(() => f.store.feedbackDownload(pair.id, f.operator, 'system')).toThrow('active');
    await expect(f.store.snapshot()).rejects.toThrow('already active');
    expect(() =>
      f.store.feedbackDownload(pair.id, { ...f.operator, sessionHash: 'replacement' }, 'system'),
    ).toThrow('Not found');
    await first.finish(false);
    expect((await f.artifact(pair, 'system')).rows).toHaveLength(1);
    await f.store.drainMaintenance();
    expect(existsSync(first.path)).toBe(false);
  } finally {
    await f.close();
  }
});

test.each(['expiry', 'truncate', 'cancel', 'transfer-cancel'] as const)(
  'paired %s removes files, invalidates both buttons and permits fresh preparation',
  async (reason) => {
    const f = fixture();
    try {
      f.feedback();
      const pair = await f.store.prepareFeedback(f.actor, f.operator);
      if (pair.state !== 'ready') throw new Error('Expected pair.');
      const file = await f.artifact(pair, 'user');
      if (reason === 'expiry') {
        f.time(pair.expiresAt);
        expect(() => f.store.feedbackDownload(pair.id, f.operator, 'system')).toThrow('expired');
      }
      if (reason === 'truncate') f.store.truncate();
      if (reason === 'cancel') await f.store.cancelFeedback(pair.id, f.operator);
      if (reason === 'transfer-cancel')
        await f.store.feedbackDownload(pair.id, f.operator, 'system').finish(true);
      await expect.poll(() => existsSync(dirname(file.path))).toBe(false);
      expect(() => f.store.feedbackDownload(pair.id, f.operator, 'system')).toThrow(
        'expired or were cleared',
      );
      const refreshed = await f.store.prepareFeedback(f.actor, f.operator);
      expect(refreshed.state).toBe(reason === 'truncate' ? 'empty' : 'ready');
    } finally {
      await f.close();
    }
  },
);

test.each(['abort', 'truncate'] as const)(
  '%s during asynchronous preparation rejects instead of publishing a relabelled snapshot',
  async (reason) => {
    const f = fixture();
    try {
      f.feedback();
      const controller = new AbortController();
      const preparing = f.store.prepareFeedback(f.actor, f.operator, controller.signal);
      if (reason === 'abort') controller.abort();
      else f.store.truncate();
      await expect(preparing).rejects.toThrow();
      expect(
        readdirSync(f.directory).filter((name) => name.startsWith('.diagnostics-feedback-')),
      ).toEqual([]);
      expect(f.store.status().generation).toBe(
        reason === 'abort' ? f.generation : f.store.status().generation,
      );
    } finally {
      await f.close();
    }
  },
);

test('a lost preparation acknowledgment recovers the same session/actor pair without moving its snapshot or extending its lifetime', async () => {
  const f = fixture();
  try {
    const first = f.feedback();
    const pair = await f.store.prepareFeedback(f.actor, f.operator);
    if (pair.state !== 'ready') throw new Error('Expected pair.');
    f.time(150);
    const later = f.feedback();
    const recovered = await f.store.prepareFeedback(f.actor, f.operator);
    expect(recovered).toEqual(pair);
    expect((await f.artifact(pair, 'user')).rows.map((row) => row.id)).toEqual([first.id]);
    await expect(f.store.prepareFeedback(f.other, f.operator)).rejects.toThrow('already prepared');
    await expect(
      f.store.prepareFeedback(f.actor, { ...f.operator, sessionHash: 'replacement' }),
    ).rejects.toThrow('already prepared');
    f.time(pair.expiresAt);
    const fresh = await f.store.prepareFeedback(f.actor, f.operator);
    if (fresh.state !== 'ready') throw new Error('Expected fresh pair.');
    expect(fresh.id).not.toBe(pair.id);
    expect((await f.artifact(fresh, 'user')).rows.map((row) => row.id).sort()).toEqual(
      [first.id, later.id].sort(),
    );
  } finally {
    await f.close();
  }
});

test('an idle prepared pair expires and removes its private files by timer without another request', async () => {
  const f = fixture();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    f.feedback();
    const pair = await f.store.prepareFeedback(f.actor, f.operator);
    if (pair.state !== 'ready') throw new Error('Expected ready pair.');
    const directories = readdirSync(f.directory).filter((name) =>
      name.startsWith('.diagnostics-feedback-'),
    );
    expect(directories).toHaveLength(1);
    const retained = join(f.directory, directories[0]);
    expect(existsSync(join(retained, 'user.sqlite'))).toBe(true);
    expect(existsSync(join(retained, 'system.sqlite'))).toBe(true);
    await vi.advanceTimersByTimeAsync(FEEDBACK_LIMITS.pairLifetimeMs);
    // No download, cancel, status refresh or clock-based owned() check caused this.
    expect(existsSync(retained)).toBe(false);
    expect(f.store.feedbackFlags().actors).toEqual([f.actor]);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    await f.close();
    vi.useRealTimers();
  }
});
