import { isSyncDiagnosticEvent, syncDiagnosticMessage } from './sync.ts';
import type { SyncDiagnosticEvent } from './sync.ts';
import { isServerDiagnosticEvent } from './server.ts';
import type { ServerDiagnosticEvent } from './server.ts';
export { isServerDiagnosticEvent, isMaintenanceDiagnosticEvent } from './server.ts';
export type {
  ServerDiagnosticEvent,
  MaintenanceDiagnosticEvent,
  HistoryDiagnosticEvent,
  OfflineServerDiagnosticEvent,
} from './server.ts';
import { isClientDiagnosticEvent } from './client.ts';
import type { ClientDiagnosticEvent } from './client.ts';
export { isClientDiagnosticEvent, captureDiagnostic, CLIENT_FAILURE_REASONS } from './client.ts';
export type {
  ClientDiagnosticEvent,
  ClientDiagnosticOutcome,
  ClientConnectionReason,
  ClientQueueObservation,
  DiagnosticScope,
  DiagnosticSource,
} from './client.ts';
export {
  observeSync,
  syncMutationId,
  SYNC_MUTATION_IDS,
  SYNC_REFUSAL_REASONS,
  SYNC_DROP_RULES,
  SYNC_MALFORMED_CHECKS,
  SYNC_INVARIANTS,
  SYNC_RESYNC_REASONS,
} from './sync.ts';
export type {
  SyncDiagnosticEvent,
  SyncObservation,
  SyncMutationId,
  SyncRefusalReason,
  SyncDropRule,
  SyncMalformedCheck,
  SyncInvariant,
} from './sync.ts';

/** Optional observations, never edit delivery. No storage, clocks or transport here. */
export const JOBS = [
  'history-prune',
  'trash-expiry',
  'space-trash-expiry',
  'collaboration-purge',
  'backup',
] as const;
export const OPERATIONS = [
  'document-open',
  'document-save',
  'document-save-local',
  'document-save-server-ack',
  'doc-compose',
  'formula-parse',
  'formula-evaluate',
  'search',
  'snapshot-restore',
] as const;
export const COMPONENTS = ['editor', 'dashboard', 'formula', 'server', 'health'] as const;
export const ROUTES = [
  '/files',
  '/files/:id',
  '/spaces/:id',
  '/api/items',
  '/api/history/:id',
  '/admin',
] as const;
export const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type Job = (typeof JOBS)[number];
export type Operation = (typeof OPERATIONS)[number];
export type Component = (typeof COMPONENTS)[number];
export type Route = (typeof ROUTES)[number];
export type Level = (typeof LEVELS)[number];

export type DiagnosticEvent =
  | ServerDiagnosticEvent
  | SyncDiagnosticEvent
  | ClientDiagnosticEvent
  | {
      name: 'job.result';
      details: { job: Job; outcome: 'success' | 'failure'; durationMs: number; count?: number };
    }
  | {
      name: 'operation.result';
      details: {
        operation: Operation;
        outcome: 'success' | 'failure' | 'cancelled';
        durationMs: number;
      };
    }
  | {
      name: 'operation.failed';
      level: Level;
      details: {
        operation: Operation;
        reason: 'unavailable' | 'permission' | 'timeout' | 'invalid' | 'internal';
      };
    }
  | {
      name: 'runtime.memory';
      metric: { kind: 'gauge'; unit: 'bytes'; value: number };
      details: { scope: 'process' | 'host' | 'container' };
    }
  | {
      name: 'runtime.connections';
      metric: { kind: 'gauge'; unit: 'count'; value: number };
      details: Record<string, never>;
    }
  | {
      name: 'storage.bytes';
      metric: { kind: 'gauge'; unit: 'bytes'; value: number };
      details: { store: 'application' | 'diagnostics'; part: 'database' | 'wal' };
    }
  | {
      name: 'storage.free';
      metric: { kind: 'gauge'; unit: 'bytes'; value: number };
      details: Record<string, never>;
    }
  | {
      name: 'operation.duration';
      metric: { kind: 'histogram'; unit: 'milliseconds'; value: number };
      details: { operation: Operation };
    }
  | {
      name: 'operation.count';
      metric: { kind: 'counter'; unit: 'count'; value: number };
      details: { operation: Operation; outcome: 'success' | 'failure' | 'cancelled' };
    };

export interface DiagnosticContext {
  component: Component;
  fileId?: string;
  spaceId?: string;
  route?: Route;
  runId?: string;
}
export type DiagnosticSink = (event: DiagnosticEvent, context: DiagnosticContext) => void;
export const noDiagnostics: DiagnosticSink = () => {};

/** A broken observer must not change the outcome of a library operation. */
export function observe(
  sink: DiagnosticSink | undefined,
  event: DiagnosticEvent,
  context: DiagnosticContext,
) {
  try {
    sink?.(event, context);
  } catch {
    /* Diagnostics is deliberately lossy. */
  }
}

/** Caller measures around a public operation; pure transforms need no clock or I/O. */
export function observeOperation(
  sink: DiagnosticSink | undefined,
  context: DiagnosticContext,
  operation: Operation,
  outcome: 'success' | 'failure' | 'cancelled',
  durationMs: number,
) {
  observe(sink, { name: 'operation.result', details: { operation, outcome, durationMs } }, context);
  observe(
    sink,
    {
      name: 'operation.duration',
      metric: { kind: 'histogram', unit: 'milliseconds', value: durationMs },
      details: { operation },
    },
    context,
  );
  observe(
    sink,
    {
      name: 'operation.count',
      metric: { kind: 'counter', unit: 'count', value: 1 },
      details: { operation, outcome },
    },
    context,
  );
  if (outcome === 'failure')
    observe(
      sink,
      { name: 'operation.failed', level: 'warn', details: { operation, reason: 'unavailable' } },
      context,
    );
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}
export function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
) {
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  );
}
export function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}
const member = (value: unknown, options: readonly string[]) =>
  typeof value === 'string' && options.includes(value);
const amount = (value: unknown) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= Number.MAX_SAFE_INTEGER;
const outcome = (value: unknown) => member(value, ['success', 'failure', 'cancelled']);

/** Reject unknown fields; never try to redact arbitrary error strings or payloads. */
export function isDiagnosticContext(value: unknown): value is DiagnosticContext {
  if (
    !isObject(value) ||
    !exactKeys(value, ['component'], ['fileId', 'spaceId', 'route', 'runId']) ||
    !member(value.component, COMPONENTS)
  )
    return false;
  if (Object.hasOwn(value, 'spaceId') && !Object.hasOwn(value, 'fileId')) return false;
  return (
    ['fileId', 'spaceId', 'runId'].every(
      (key) => !Object.hasOwn(value, key) || isUuid(value[key]),
    ) &&
    (!Object.hasOwn(value, 'route') || member(value.route, ROUTES))
  );
}

export function isDiagnosticEvent(value: unknown): value is DiagnosticEvent {
  if (isServerDiagnosticEvent(value)) return true;
  if (isClientDiagnosticEvent(value)) return true;
  if (isSyncDiagnosticEvent(value)) return true;
  if (!isObject(value) || !isObject(value.details)) return false;
  const d = value.details;
  if (value.name === 'job.result')
    return (
      exactKeys(value, ['name', 'details']) &&
      exactKeys(d, ['job', 'outcome', 'durationMs'], ['count']) &&
      member(d.job, JOBS) &&
      member(d.outcome, ['success', 'failure']) &&
      amount(d.durationMs) &&
      (!Object.hasOwn(d, 'count') || (amount(d.count) && Number.isSafeInteger(d.count)))
    );
  if (value.name === 'operation.result')
    return (
      exactKeys(value, ['name', 'details']) &&
      exactKeys(d, ['operation', 'outcome', 'durationMs']) &&
      member(d.operation, OPERATIONS) &&
      outcome(d.outcome) &&
      amount(d.durationMs)
    );
  if (value.name === 'operation.failed')
    return (
      exactKeys(value, ['name', 'level', 'details']) &&
      member(value.level, LEVELS) &&
      exactKeys(d, ['operation', 'reason']) &&
      member(d.operation, OPERATIONS) &&
      member(d.reason, ['unavailable', 'permission', 'timeout', 'invalid', 'internal'])
    );
  if (
    !exactKeys(value, ['name', 'metric', 'details']) ||
    !isObject(value.metric) ||
    !exactKeys(value.metric, ['kind', 'unit', 'value']) ||
    !amount(value.metric.value)
  )
    return false;
  const metric = value.metric;
  switch (value.name) {
    case 'runtime.memory':
      return (
        metric.kind === 'gauge' &&
        metric.unit === 'bytes' &&
        exactKeys(d, ['scope']) &&
        member(d.scope, ['process', 'host', 'container'])
      );
    case 'runtime.connections':
      return (
        metric.kind === 'gauge' &&
        metric.unit === 'count' &&
        Number.isSafeInteger(metric.value) &&
        exactKeys(d, [])
      );
    case 'storage.bytes':
      return (
        metric.kind === 'gauge' &&
        metric.unit === 'bytes' &&
        exactKeys(d, ['store', 'part']) &&
        member(d.store, ['application', 'diagnostics']) &&
        member(d.part, ['database', 'wal'])
      );
    case 'storage.free':
      return metric.kind === 'gauge' && metric.unit === 'bytes' && exactKeys(d, []);
    case 'operation.duration':
      return (
        metric.kind === 'histogram' &&
        metric.unit === 'milliseconds' &&
        exactKeys(d, ['operation']) &&
        member(d.operation, OPERATIONS)
      );
    case 'operation.count':
      return (
        metric.kind === 'counter' &&
        metric.unit === 'count' &&
        Number.isSafeInteger(metric.value) &&
        exactKeys(d, ['operation', 'outcome']) &&
        member(d.operation, OPERATIONS) &&
        outcome(d.outcome)
      );
    default:
      return false;
  }
}

export function diagnosticMessage(event: DiagnosticEvent): string | null {
  return event.name === 'operation.failed'
    ? 'An operation failed.'
    : isSyncDiagnosticEvent(event)
      ? syncDiagnosticMessage(event)
      : null;
}

export interface DiagnosticRecord {
  id: string;
  occurredAt: number;
  event: DiagnosticEvent;
  context: DiagnosticContext;
}
export const MAX_EVENT_BYTES = 8 * 1024;
export const MAX_BATCH_BYTES = 64 * 1024;
export const MAX_BATCH_EVENTS = 64;
export function isDiagnosticRecord(value: unknown): value is DiagnosticRecord {
  return (
    isObject(value) &&
    exactKeys(value, ['id', 'occurredAt', 'event', 'context']) &&
    isUuid(value.id) &&
    amount(value.occurredAt) &&
    Number.isSafeInteger(value.occurredAt) &&
    isDiagnosticEvent(value.event) &&
    isDiagnosticContext(value.context)
  );
}
