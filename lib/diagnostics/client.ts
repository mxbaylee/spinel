import type { DiagnosticContext, DiagnosticSink } from './index.ts';

export const CLIENT_FAILURE_REASONS = [
  'unsupported',
  'refused',
  'stale',
  'divergence',
  'unavailable',
  'malformed',
  'capacity',
  'retry-conflict',
  'invariant',
] as const;
export type ClientDiagnosticOutcome = 'success' | 'failure' | 'cancelled';
export type ClientConnectionReason = 'initial' | 'transport' | 'timeout' | 'offline';
export interface ClientQueueObservation {
  /** Native mutations: inflight.length plus all buffered group lengths, not saves/groups. */
  pendingCount: number;
  /** Unknown after reload/rebase: monotonic timestamps are never persisted. */
  oldestPendingAgeMs: number | null;
}
export type ClientDiagnosticEvent =
  | {
      name: 'sync.client.connection';
      details: ClientQueueObservation & {
        reason: ClientConnectionReason;
        outcome: ClientDiagnosticOutcome;
        durationMs: number;
      };
    }
  | {
      name: 'sync.client.resync';
      details: ClientQueueObservation & {
        reason: (typeof CLIENT_FAILURE_REASONS)[number];
        outcome: 'handed-off' | 'cancelled';
        durationMs: number;
      };
    }
  | {
      name: 'sync.client.refresh';
      details: ClientQueueObservation & {
        reason: 'retention' | 'access-change' | 'maintenance';
        outcome: 'handed-off' | 'failure' | 'cancelled';
        durationMs: number;
      };
    }
  /** Active queue samples are bounded to once/second, plus the immediate empty transition. */
  | { name: 'sync.client.queue'; details: ClientQueueObservation }
  | { name: 'sync.client.acknowledged'; details: { duplicate: boolean } }
  | {
      name: 'native.flush';
      details: {
        reason: 'capacity' | 'idle';
        outcome: 'success' | 'failure';
        durationMs: number;
        history: number;
        collaboration: number;
      };
    }
  | {
      name: 'native.checkpoint';
      details: {
        outcome: 'captured' | 'skipped' | 'failure' | 'cancelled';
        durationMs: number;
      };
    }
  | {
      name: 'offline.persistence';
      details: {
        outcome: 'persisted' | 'skipped' | 'failure' | 'cancelled';
        durationMs: number;
        reason: 'write' | 'not-prepared' | 'read-only';
      };
    }
  | {
      name: 'offline.publication' | 'offline.recovery';
      details: {
        outcome: ClientDiagnosticOutcome;
        durationMs: number;
      };
    };

export interface DiagnosticScope {
  sink: DiagnosticSink;
  context: DiagnosticContext;
}
/** Capture the initiating account/collection, not whichever account finishes later. */
export type DiagnosticSource = () => DiagnosticScope | undefined;
export function captureDiagnostic(
  source: DiagnosticSource | undefined,
): DiagnosticScope | undefined {
  try {
    return source?.();
  } catch {
    return undefined;
  }
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const keys = (value: Record<string, unknown>, fields: readonly string[]) =>
  Object.keys(value).length === fields.length && fields.every((key) => Object.hasOwn(value, key));
const member = (value: unknown, values: readonly string[]) =>
  typeof value === 'string' && values.includes(value);
const amount = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= Number.MAX_SAFE_INTEGER;
const count = (value: unknown) => amount(value) && Number.isSafeInteger(value);
const outcome = (value: unknown) => member(value, ['success', 'failure', 'cancelled']);
const queue = (value: Record<string, unknown>) =>
  count(value.pendingCount) &&
  (value.oldestPendingAgeMs === null || amount(value.oldestPendingAgeMs));

/** Exact browser vocabulary; this never admits server sync, runtime or maintenance events. */
export function isClientDiagnosticEvent(value: unknown): value is ClientDiagnosticEvent {
  if (!object(value) || !keys(value, ['name', 'details']) || !object(value.details)) return false;
  const d = value.details;
  switch (value.name) {
    case 'sync.client.connection':
    case 'sync.client.resync':
      return (
        keys(d, ['reason', 'outcome', 'durationMs', 'pendingCount', 'oldestPendingAgeMs']) &&
        (value.name === 'sync.client.connection'
          ? outcome(d.outcome)
          : member(d.outcome, ['handed-off', 'cancelled'])) &&
        amount(d.durationMs) &&
        queue(d) &&
        member(
          d.reason,
          value.name === 'sync.client.connection'
            ? ['initial', 'transport', 'timeout', 'offline']
            : CLIENT_FAILURE_REASONS,
        )
      );
    case 'sync.client.refresh':
      return (
        keys(d, ['reason', 'outcome', 'durationMs', 'pendingCount', 'oldestPendingAgeMs']) &&
        member(d.reason, ['retention', 'access-change', 'maintenance']) &&
        member(d.outcome, ['handed-off', 'failure', 'cancelled']) &&
        amount(d.durationMs) &&
        queue(d)
      );
    case 'sync.client.queue':
      return keys(d, ['pendingCount', 'oldestPendingAgeMs']) && queue(d);
    case 'sync.client.acknowledged':
      return keys(d, ['duplicate']) && typeof d.duplicate === 'boolean';
    case 'native.flush':
      return (
        keys(d, ['reason', 'outcome', 'durationMs', 'history', 'collaboration']) &&
        member(d.reason, ['capacity', 'idle']) &&
        member(d.outcome, ['success', 'failure']) &&
        amount(d.durationMs) &&
        count(d.history) &&
        count(d.collaboration)
      );
    case 'native.checkpoint':
      return (
        keys(d, ['outcome', 'durationMs']) &&
        member(d.outcome, ['captured', 'skipped', 'failure', 'cancelled']) &&
        amount(d.durationMs)
      );
    case 'offline.persistence':
      return (
        keys(d, ['outcome', 'durationMs', 'reason']) &&
        member(d.outcome, ['persisted', 'skipped', 'failure', 'cancelled']) &&
        member(d.reason, ['write', 'not-prepared', 'read-only']) &&
        amount(d.durationMs)
      );
    case 'offline.publication':
    case 'offline.recovery':
      return keys(d, ['outcome', 'durationMs']) && outcome(d.outcome) && amount(d.durationMs);
    default:
      return false;
  }
}
