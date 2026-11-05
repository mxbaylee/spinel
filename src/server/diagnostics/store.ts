import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  statfsSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  diagnosticMessage,
  isDiagnosticRecord,
  isMaintenanceDiagnosticEvent,
  isUuid,
  MAX_BATCH_BYTES,
  MAX_EVENT_BYTES,
} from '@spinel/diagnostics';
import type {
  DiagnosticContext,
  DiagnosticEvent,
  DiagnosticRecord,
  DiagnosticSink,
  MaintenanceDiagnosticEvent,
} from '@spinel/diagnostics';
import type { DiagnosticLoss, DiagnosticsStatus } from '../../shared/diagnostics.ts';
export type { DiagnosticLoss, DiagnosticsStatus } from '../../shared/diagnostics.ts';
import { DatabaseSync } from '../../../server/database.ts';
import type { MaintenanceGate } from '../maintenance/gate.ts';
import { snapshotDatabase } from './snapshot.ts';

const MiB = 1024 * 1024;
export const DIAGNOSTICS_LIMITS = {
  storageBytes: 64 * MiB,
  physicalBytes: 96 * MiB,
  queueBytes: MiB,
  queueEvents: 256,
  maintenanceRefusalIntervalMs: 1000,
  reserveBytes: 256 * MiB,
} as const;
interface Attribution {
  source: 'frontend' | 'backend';
  actorId?: string;
}
interface Pending {
  record: DiagnosticRecord;
  attribution: Attribution;
  generation: string;
  bytes: number;
}
export class DiagnosticsError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export interface DiagnosticsSnapshot {
  path: string;
  dispose(): Promise<void>;
}

/** Dedicated, lossy operational data. Never receives an application connection. */
export class DiagnosticsStore {
  readonly path: string;
  private database?: DatabaseSync;
  private currentGeneration: string | null = null;
  private readonly build: string;
  private readonly now: () => number;
  private readonly secondaryWriter: boolean;
  private queue: Pending[] = [];
  private queuedBytes = 0;
  private scheduled?: NodeJS.Immediate;
  private exportJob?: { controller: AbortController; finished: Promise<void>; release: () => void };
  private closed = false;
  private maintenance?: MaintenanceGate;
  private readonly lastMaintenanceRefusal = {
    paused: Number.NEGATIVE_INFINITY,
    'stale-epoch': Number.NEGATIVE_INFINITY,
  };
  private readonly dropped: DiagnosticsStatus['dropped'] = {
    invalid: 0,
    queue: 0,
    storage: 0,
    unavailable: 0,
    stale: 0,
  };

  constructor(options: {
    path: string;
    build: string;
    now?: () => number;
    applicationPath?: string;
    /** Supervisor observes the same store; it never owns application export cleanup. */
    secondaryWriter?: boolean;
  }) {
    this.path = resolve(options.path);
    // Deployment build only: never copy request values, branches or URLs here.
    this.build = /^[a-zA-Z0-9._-]{1,64}$/.test(options.build) ? options.build : 'unknown';
    this.now = options.now ?? Date.now;
    this.secondaryWriter = options.secondaryWriter === true;
    try {
      if (options.applicationPath) {
        if (this.path === resolve(options.applicationPath))
          throw new Error('Application storage is not diagnostics.');
        // Existing aliases (including hard links) must never become an export source.
        const application = statSync(options.applicationPath);
        let target;
        try {
          target = statSync(this.path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        if (target && target.dev === application.dev && target.ino === application.ino)
          throw new Error('Application storage is not diagnostics.');
      }
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      const database = new DatabaseSync(this.path);
      this.database = database;
      const tables = database
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all();
      if (tables.some((row) => !['diagnostics_state', 'events'].includes(String(row.name))))
        throw new Error('Not a diagnostics database.');
      chmodSync(this.path, 0o600);
      database.exec(
        `PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 0; PRAGMA cache_size = -1024; PRAGMA journal_size_limit = 4194304; PRAGMA wal_autocheckpoint = 64;`,
      );
      const version = Number(database.prepare('PRAGMA user_version').get()?.user_version);
      if (version !== 0 && version !== 1) throw new Error('Unsupported diagnostics schema.');
      database.exec(`
        CREATE TABLE IF NOT EXISTS diagnostics_state (
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
          generation TEXT NOT NULL, logical_bytes INTEGER NOT NULL DEFAULT 0 CHECK(logical_bytes >= 0)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY, schema_version INTEGER NOT NULL CHECK(schema_version = 1),
          generation TEXT NOT NULL, occurred_at INTEGER NOT NULL, received_at INTEGER NOT NULL,
          name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('log', 'metric', 'event')),
          source TEXT NOT NULL CHECK(source IN ('frontend', 'backend')), component TEXT NOT NULL,
          build TEXT NOT NULL, actor_id TEXT, file_id TEXT, space_id TEXT, route TEXT, run_id TEXT,
          level TEXT, message TEXT, metric_kind TEXT, metric_unit TEXT, metric_value REAL,
          details TEXT NOT NULL CHECK(json_valid(details) AND json_type(details) = 'object'),
          byte_size INTEGER NOT NULL CHECK(byte_size > 0)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS events_time ON events(received_at);
        CREATE INDEX IF NOT EXISTS events_name ON events(name, received_at);
        CREATE INDEX IF NOT EXISTS events_component ON events(component, received_at);
        CREATE INDEX IF NOT EXISTS events_run ON events(run_id, received_at);
        PRAGMA user_version = 1;
      `);
      database
        .prepare('INSERT OR IGNORE INTO diagnostics_state(singleton,generation) VALUES(1,?)')
        .run(randomUUID());
      this.currentGeneration = String(
        database.prepare('SELECT generation FROM diagnostics_state WHERE singleton=1').get()!
          .generation,
      );
      const pageSize = Number(database.prepare('PRAGMA page_size').get()?.page_size);
      database.exec(
        `PRAGMA max_page_count = ${Math.floor(DIAGNOSTICS_LIMITS.storageBytes / pageSize)};`,
      );
      // Only the application owns interrupted export cleanup. A supervisor writer
      // must not remove an active application's immutable download.
      for (const name of this.secondaryWriter ? [] : readdirSync(dirname(this.path))) {
        if (/^\.diagnostics-export-[a-zA-Z0-9]{6}$/.test(name))
          rmSync(join(dirname(this.path), name), { recursive: true, force: true });
      }
    } catch {
      this.database?.close();
      this.database = undefined;
      this.currentGeneration = null;
    }
  }

  status(): DiagnosticsStatus {
    try {
      const row = this.database
        ?.prepare('SELECT generation,logical_bytes FROM diagnostics_state WHERE singleton=1')
        .get();
      return {
        available: !!row && !this.closed,
        generation: row ? String(row.generation) : null,
        logicalBytes: Number(row?.logical_bytes ?? 0),
        recordCount: Number(
          this.database?.prepare('SELECT count(*) AS count FROM events').get()?.count ?? 0,
        ),
        dropped: { ...this.dropped },
        exporting: !!this.exportJob,
      };
    } catch {
      return {
        available: false,
        generation: null,
        logicalBytes: 0,
        recordCount: 0,
        dropped: { ...this.dropped },
        exporting: !!this.exportJob,
      };
    }
  }

  readonly emit: DiagnosticSink = (event, context) => {
    this.record(event, context);
  };
  setMaintenanceGate(gate: MaintenanceGate) {
    this.maintenance = gate;
    this.database?.setMaintenanceGate(gate);
  }
  /** Flush the bounded lossy queue before claiming that every storage owner drained. */
  async drainMaintenance() {
    if (this.exportJob) await this.exportJob.finished;
    this.database?.assertQuiescent();
    if (this.scheduled) clearImmediate(this.scheduled);
    this.scheduled = undefined;
    const flush = () => {
      while (this.queue.length) this.flush();
      if (this.scheduled) clearImmediate(this.scheduled);
      this.scheduled = undefined;
    };
    if (this.maintenance) this.maintenance.initialize(flush);
    else flush();
  }

  /** Backend call sites may supply only already-authorized actor/file context. */
  record(event: DiagnosticEvent, context: DiagnosticContext, actorId?: string) {
    try {
      const generation = this.secondaryWriter
        ? this.database?.prepare('SELECT generation FROM diagnostics_state WHERE singleton=1').get()
            ?.generation
        : this.currentGeneration;
      if (
        typeof generation !== 'string' ||
        this.closed ||
        (this.maintenance && !this.maintenance.running)
      )
        return this.lose('unavailable');
      const record = { id: randomUUID(), occurredAt: this.now(), event, context };
      if (!isDiagnosticRecord(record) || (actorId !== undefined && !isUuid(actorId)))
        return this.lose('invalid');
      const encoded = JSON.stringify(record);
      const bytes = Buffer.byteLength(encoded);
      if (bytes > MAX_EVENT_BYTES) return this.lose('invalid');
      if (
        this.queue.length >= DIAGNOSTICS_LIMITS.queueEvents ||
        this.queuedBytes + bytes > DIAGNOSTICS_LIMITS.queueBytes
      )
        return this.lose('queue');
      this.queue.push({
        record: JSON.parse(encoded) as DiagnosticRecord,
        attribution: { source: 'backend', ...(actorId ? { actorId } : {}) },
        generation,
        bytes,
      });
      this.queuedBytes += bytes;
      this.scheduled ??= setImmediate(() => {
        this.scheduled = undefined;
        this.database?.runBackground(() => this.flush());
      });
    } catch {
      this.lose('invalid');
    }
  }

  /** Internal lifecycle observations only; never grants application writes or client admission. */
  recordMaintenance(event: MaintenanceDiagnosticEvent) {
    try {
      if (!isMaintenanceDiagnosticEvent(event)) return this.lose('invalid');
      const generation = this.currentGeneration;
      if (typeof generation !== 'string' || this.closed) return this.lose('unavailable');
      if (event.name === 'maintenance.refused') {
        // Request admission happens before authentication. A paused-request burst
        // may write at most once per fixed reason/second, without bypassing the
        // collector's pressure accounting or starving actual lifecycle outcomes.
        const now = performance.now();
        const previous = this.lastMaintenanceRefusal[event.details.reason];
        if (
          !Number.isFinite(now) ||
          now - previous < DIAGNOSTICS_LIMITS.maintenanceRefusalIntervalMs
        )
          return this.lose('queue');
        this.lastMaintenanceRefusal[event.details.reason] = now;
      }
      const record = {
        id: randomUUID(),
        occurredAt: this.now(),
        event,
        context: { component: 'server' as const },
      };
      if (!isDiagnosticRecord(record)) return this.lose('invalid');
      const bytes = Buffer.byteLength(JSON.stringify(record));
      if (bytes > MAX_EVENT_BYTES) return this.lose('invalid');
      const append = () =>
        this.append({ record, bytes, generation, attribution: { source: 'backend' } });
      if (this.maintenance) this.maintenance.initialize(append);
      else append();
    } catch {
      this.lose('unavailable');
    }
  }

  /** Network callers validate current credentials/file access immediately before this synchronous write. */
  ingest(records: DiagnosticRecord[], actorId: string, generation: string) {
    if (!isUuid(actorId) || !isUuid(generation) || records.length > 64)
      return { accepted: 0, dropped: records.length };
    let accepted = 0;
    for (const record of records) {
      try {
        if (!isDiagnosticRecord(record)) {
          this.lose('invalid');
          continue;
        }
        const bytes = Buffer.byteLength(JSON.stringify(record));
        if (bytes > MAX_EVENT_BYTES) {
          this.lose('invalid');
          continue;
        }
        if (
          this.append({ record, bytes, generation, attribution: { actorId, source: 'frontend' } })
        )
          accepted++;
      } catch {
        this.lose('invalid');
      }
    }
    return { accepted, dropped: records.length - accepted };
  }

  private lose(reason: DiagnosticLoss) {
    this.dropped[reason] = Math.min(Number.MAX_SAFE_INTEGER, this.dropped[reason] + 1);
  }

  flush() {
    let bytes = 0;
    let count = 0;
    const started = performance.now();
    while (
      this.queue.length &&
      bytes < MAX_BATCH_BYTES &&
      count < 16 &&
      performance.now() - started < 4
    ) {
      const pending = this.queue.shift()!;
      this.queuedBytes -= pending.bytes;
      bytes += pending.bytes;
      count++;
      this.append(pending);
    }
    if (this.queue.length && !this.closed)
      this.scheduled ??= setImmediate(() => {
        this.scheduled = undefined;
        this.database?.runBackground(() => this.flush());
      });
  }

  private append(pending: Pending): boolean {
    const database = this.database;
    if (!database || this.closed) {
      this.lose('unavailable');
      return false;
    }
    try {
      const physicalBytes = this.physicalBytes();
      const volume = statfsSync(dirname(this.path));
      if (volume.bavail * volume.bsize < DIAGNOSTICS_LIMITS.reserveBytes) {
        this.lose('storage');
        return false;
      }
      database.exec('BEGIN IMMEDIATE');
      const state = database
        .prepare('SELECT generation,logical_bytes FROM diagnostics_state WHERE singleton=1')
        .get()!;
      if (pending.generation !== state.generation) {
        database.exec('ROLLBACK');
        this.lose('stale');
        return false;
      }
      const existing = database
        .prepare('SELECT source,actor_id FROM events WHERE id=?')
        .get(pending.record.id);
      if (existing) {
        database.exec('ROLLBACK');
        // A forged duplicate ID is not an acknowledged event belonging to another actor.
        return (
          existing.source === pending.attribution.source &&
          existing.actor_id === (pending.attribution.actorId ?? null)
        );
      }
      if (
        Number(state.logical_bytes) + pending.bytes > DIAGNOSTICS_LIMITS.storageBytes ||
        physicalBytes >= DIAGNOSTICS_LIMITS.physicalBytes
      ) {
        database.exec('ROLLBACK');
        this.lose('storage');
        return false;
      }
      const { record, attribution } = pending;
      const event = record.event;
      const context = record.context;
      const metric = 'metric' in event ? event.metric : undefined;
      database
        .prepare(
          `INSERT INTO events(id,schema_version,generation,occurred_at,received_at,name,kind,source,component,build,actor_id,file_id,space_id,route,run_id,level,message,metric_kind,metric_unit,metric_value,details,byte_size)
        VALUES(?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          record.id,
          pending.generation,
          record.occurredAt,
          this.now(),
          event.name,
          metric ? 'metric' : 'level' in event ? 'log' : 'event',
          attribution.source,
          context.component,
          this.build,
          attribution.actorId ?? null,
          context.fileId ?? null,
          context.spaceId ?? null,
          context.route ?? null,
          context.runId ?? null,
          'level' in event ? event.level : null,
          diagnosticMessage(event),
          metric?.kind ?? null,
          metric?.unit ?? null,
          metric?.value ?? null,
          JSON.stringify(event.details),
          pending.bytes,
        );
      database
        .prepare('UPDATE diagnostics_state SET logical_bytes=logical_bytes+? WHERE singleton=1')
        .run(pending.bytes);
      database.exec('COMMIT');
      return true;
    } catch {
      try {
        database.exec('ROLLBACK');
      } catch {
        /* The failed statement may already have rolled back. */
      }
      this.lose('storage');
      return false;
    }
  }

  private physicalBytes() {
    // A finished reader may have held a WAL above the write stop threshold.
    this.database?.exec('PRAGMA wal_checkpoint(PASSIVE)');
    let bytes = 0;
    for (const path of [this.path, `${this.path}-wal`]) {
      try {
        bytes += statSync(path).size;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return bytes;
  }

  private isolated() {
    const tables = this.database
      ?.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all();
    return (
      !!tables &&
      tables.length === 2 &&
      tables.every((row) => ['diagnostics_state', 'events'].includes(String(row.name)))
    );
  }

  truncate() {
    if (this.exportJob)
      throw new DiagnosticsError(
        409,
        'A diagnostics download is active. Finish or cancel it, then try again.',
      );
    const database = this.database;
    if (!database || this.closed || !this.isolated())
      throw new DiagnosticsError(503, 'Diagnostics are unavailable.');
    const generation = randomUUID();
    try {
      database.exec('BEGIN IMMEDIATE');
      database.exec('DELETE FROM events');
      database
        .prepare('UPDATE diagnostics_state SET generation=?,logical_bytes=0 WHERE singleton=1')
        .run(generation);
      database.exec('COMMIT');
    } catch {
      try {
        database.exec('ROLLBACK');
      } catch {
        /* Preserve the original failure. */
      }
      throw new DiagnosticsError(503, 'Diagnostics could not be cleared.');
    }
    // Only discard buffers after a successful durable boundary; failure is not success.
    this.queue = [];
    this.queuedBytes = 0;
    this.currentGeneration = generation;
    return { generation };
  }

  async snapshot(signal?: AbortSignal): Promise<DiagnosticsSnapshot> {
    if (!this.database || this.closed || !this.isolated())
      throw new DiagnosticsError(503, 'Diagnostics are unavailable.');
    if (this.exportJob)
      throw new DiagnosticsError(409, 'A diagnostics download is already active.');
    const controller = new AbortController();
    let release!: () => void;
    const finished = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.exportJob = { controller, finished, release };
    let directory: string | undefined;
    let disposed = false;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const dispose = async () => {
      if (disposed) return;
      disposed = true;
      signal?.removeEventListener('abort', abort);
      try {
        if (directory) rmSync(directory, { recursive: true, force: true });
      } catch {
        this.lose('unavailable');
      } finally {
        this.exportJob = undefined;
        release();
      }
    };
    try {
      if (signal?.aborted) throw new Error('Cancelled.');
      // A bounded batch; remaining queued events belong to subsequent collection.
      this.flush();
      const volume = statfsSync(dirname(this.path));
      if (
        volume.bavail * volume.bsize <
        DIAGNOSTICS_LIMITS.physicalBytes + DIAGNOSTICS_LIMITS.reserveBytes
      )
        throw new Error('No staging space.');
      directory = mkdtempSync(join(dirname(this.path), '.diagnostics-export-'));
      chmodSync(directory, 0o700);
      const path = join(directory, 'diagnostics.sqlite');
      await snapshotDatabase(this.path, path, controller.signal);
      if (controller.signal.aborted || statSync(path).size > DIAGNOSTICS_LIMITS.storageBytes)
        throw new Error('Snapshot unavailable.');
      controller.signal.addEventListener(
        'abort',
        () => {
          void dispose();
        },
        { once: true },
      );
      return { path, dispose };
    } catch {
      await dispose();
      throw new DiagnosticsError(503, 'Diagnostics could not be downloaded.');
    }
  }

  async close() {
    this.closed = true;
    if (this.scheduled) clearImmediate(this.scheduled);
    this.queue = [];
    this.queuedBytes = 0;
    if (this.exportJob) {
      this.exportJob.controller.abort();
      await this.exportJob.finished;
    }
    this.database?.close();
    this.database = undefined;
    this.currentGeneration = null;
  }
}
