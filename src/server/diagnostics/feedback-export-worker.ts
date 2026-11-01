import { workerData, parentPort } from 'node:worker_threads';
import { chmodSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, backup } from '../../../server/database.ts';
import { FEEDBACK_LIMITS } from '../../shared/feedback.ts';
import type { FeedbackPair } from '../../shared/feedback.ts';
import type { DiagnosticsStatus } from '../../shared/diagnostics.ts';

interface Input {
  source: string;
  directory: string;
  id: string;
  actorId: string;
  generation: string;
  createdAt: number;
  build: string;
  dropped: DiagnosticsStatus['dropped'];
}
const input = workerData as Input;
const frozenPath = join(input.directory, 'snapshot.sqlite');
const source = new DatabaseSync(input.source);
try {
  source.exec('PRAGMA cache_size=-1024; PRAGMA temp_store=FILE; PRAGMA busy_timeout=1000;');
  // VACUUM INTO takes one consistent SQLite snapshot, including committed WAL rows.
  // Only this stage touches the mutable live store; neither button reads it later.
  await backup(source, frozenPath);
  chmodSync(frozenPath, 0o600);
} finally {
  source.close();
}
if (statSync(frozenPath).size > 64 * 1024 * 1024) throw new Error('Source exceeded its bound.');
const frozen = new DatabaseSync(frozenPath, { readOnly: true });
try {
  const generation = String(
    frozen.prepare('SELECT generation FROM diagnostics_state WHERE singleton=1').get()?.generation,
  );
  if (generation !== input.generation) throw new Error('Collection changed.');
  const window = frozen
    .prepare(
      'SELECT min(received_at) AS start,max(received_at) AS end FROM events WHERE actor_id=?',
    )
    .get(input.actorId)!;
  if (window.start === null || window.end === null) {
    parentPort!.postMessage({ state: 'empty', generation });
  } else {
    const start = Number(window.start),
      end = Number(window.end);
    const counts = frozen
      .prepare(
        `SELECT
      count(*) AS system,
      sum(CASE WHEN actor_id=? THEN 1 ELSE 0 END) AS user,
      sum(CASE WHEN actor_id=? AND name!='feedback' THEN 1 ELSE 0 END) AS userObservations,
      sum(CASE WHEN name!='feedback' THEN 1 ELSE 0 END) AS systemObservations
      FROM events WHERE received_at BETWEEN ? AND ?`,
      )
      .get(input.actorId, input.actorId, start, end)!;
    const limitations = [
      'All means matching rows retained in this snapshot. Unsent browser queues and discarded observations are not included.',
      'Historical completeness and expired or never-collected context are unknown.',
      'Drop counters are global process-lifetime counters sampled before preparation, not loss measured for this user or time span.',
      'Feedback survives observation expiry; an old report does not guarantee its original metrics still exist.',
    ];
    const pair: FeedbackPair = {
      state: 'ready',
      id: input.id,
      actorId: input.actorId,
      generation,
      createdAt: input.createdAt,
      expiresAt: input.createdAt + FEEDBACK_LIMITS.pairLifetimeMs,
      window: { start, end },
      counts: {
        user: Number(counts.user),
        system: Number(counts.system),
        userObservations: Number(counts.userObservations),
        systemObservations: Number(counts.systemObservations),
      },
      context: Number(counts.userObservations) === 0 ? 'feedback-only' : 'retained',
      limitations,
    };
    const schema = frozen
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name IN ('events','diagnostics_state') ORDER BY name",
      )
      .all();
    if (schema.length !== 2) throw new Error('Invalid diagnostics source.');
    const snapshot = frozen
      .prepare('SELECT count(*) AS recordCount,max(received_at) AS latestReceivedAt FROM events')
      .get()!;
    for (const scope of ['user', 'system'] as const) {
      const path = join(input.directory, `${scope}.sqlite`);
      const output = new DatabaseSync(path);
      try {
        // New databases receive only matching rows. Copy-and-delete would leave
        // excluded messages in free pages and violate the user export's scope.
        output.exec('PRAGMA journal_mode=OFF; PRAGMA cache_size=-1024; PRAGMA temp_store=FILE;');
        const pageSize = Number(output.prepare('PRAGMA page_size').get()?.page_size);
        output.exec(
          `PRAGMA max_page_count=${Math.floor(FEEDBACK_LIMITS.artifactBytes / pageSize)};`,
        );
        for (const row of schema) output.exec(String(row.sql));
        output.prepare('ATTACH DATABASE ? AS frozen').run(frozenPath);
        const filter =
          scope === 'user'
            ? 'actor_id=? AND received_at BETWEEN ? AND ?'
            : 'received_at BETWEEN ? AND ?';
        const parameters = scope === 'user' ? [input.actorId, start, end] : [start, end];
        output
          .prepare(`INSERT INTO events SELECT * FROM frozen.events WHERE ${filter}`)
          .run(...parameters);
        output.prepare('DETACH DATABASE frozen').run();
        const actual = output
          .prepare('SELECT count(*) AS count,coalesce(sum(byte_size),0) AS bytes FROM events')
          .get()!;
        if (Number(actual.count) !== pair.counts[scope]) throw new Error('Incomplete export.');
        output
          .prepare(
            'INSERT INTO diagnostics_state(singleton,generation,logical_bytes) VALUES(1,?,?)',
          )
          .run(generation, Number(actual.bytes));
        output.exec(
          'CREATE TABLE export_manifest(singleton INTEGER PRIMARY KEY CHECK(singleton=1), details TEXT NOT NULL CHECK(json_valid(details))) STRICT; PRAGMA user_version=1;',
        );
        output.prepare('INSERT INTO export_manifest VALUES(1,?)').run(
          JSON.stringify({
            schemaVersion: 1,
            diagnosticsSchemaVersion: 1,
            snapshotId: pair.id,
            generation,
            createdAt: pair.createdAt,
            selectedActorId: pair.actorId,
            scope,
            window: pair.window,
            timeBasis: 'received_at; trusted server receipt; both endpoints inclusive',
            inclusion:
              scope === 'user'
                ? 'every retained row attributed to selectedActorId'
                : 'every retained row of every actor, including unattributed system rows, within window',
            completeRetainedSelection: true,
            historicalCompleteness: 'unknown',
            rowCount: Number(actual.count),
            counts: pair.counts,
            context: pair.context,
            snapshotWatermark: {
              recordCount: Number(snapshot.recordCount),
              latestReceivedAt: snapshot.latestReceivedAt,
            },
            build: input.build,
            dropped: { scope: 'global process lifetime before preparation', values: input.dropped },
            retention: {
              feedback: 'until explicit truncate',
              observations: 'no automatic expiry configured; prior deletion history unknown',
            },
            limits: {
              sourceBytes: 64 * 1024 * 1024,
              artifactBytes: FEEDBACK_LIMITS.artifactBytes,
              rowCap: null,
            },
            limitations,
          }),
        );
        if (output.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok')
          throw new Error('Invalid export.');
      } finally {
        output.close();
      }
      chmodSync(path, 0o600);
      if (statSync(path).size > FEEDBACK_LIMITS.artifactBytes)
        throw new Error('Artifact exceeded its bound.');
    }
    parentPort!.postMessage(pair);
  }
} finally {
  frozen.close();
  // The pair's files are the immutable, complete filtered datasets. The source
  // snapshot is not needed during the operator's five-minute download window.
  rmSync(frozenPath, { force: true });
}
