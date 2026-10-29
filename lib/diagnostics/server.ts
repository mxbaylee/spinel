/** Fixed server observations; none of these names is admitted from browsers. */
export const MAINTENANCE_PHASES = [
  'running',
  'draining',
  'paused',
  'stopping',
  'stopped',
  'starting',
  'recovery-required',
] as const;

export type MaintenanceDiagnosticEvent =
  | { name: 'maintenance.phase'; details: { phase: (typeof MAINTENANCE_PHASES)[number] } }
  | {
      name: 'maintenance.drain';
      details: { outcome: 'success' | 'failure'; durationMs: number; admittedCount: number };
    }
  | {
      name: 'maintenance.verification';
      details: { outcome: 'success' | 'failure' | 'refused'; durationMs: number };
    }
  | { name: 'maintenance.refused'; details: { reason: 'paused' | 'stale-epoch' } };

export type RuntimeDiagnosticEvent =
  | {
      name: 'runtime.cpu';
      metric: { kind: 'gauge'; unit: 'milliseconds'; value: number };
      details: { windowMs: number };
    }
  | {
      name: 'runtime.event-loop';
      metric: { kind: 'gauge'; unit: 'milliseconds'; value: number };
      details: { statistic: 'mean' | 'max'; windowMs: number };
    };

export type SupervisorLossEvent = {
  name: 'diagnostics.writer-loss';
  details: {
    writer: 'supervisor';
    invalid: number;
    queue: number;
    storage: number;
    unavailable: number;
    stale: number;
  };
};
export type HistoryDiagnosticEvent = {
  name: 'history.checkpoint';
  metric: { kind: 'counter'; unit: 'count'; value: 1 };
  details: {
    source: 'native' | 'collaboration';
    outcome: 'captured' | 'skipped' | 'failure';
    reason:
      'baseline' | 'capture' | 'coalesced' | 'migrated' | 'missing' | 'unchanged' | 'unavailable';
    durationMs: number;
  };
};
export type OfflineServerDiagnosticEvent = {
  name: 'offline.server.publication' | 'offline.server.recovery';
  details: { outcome: 'published' | 'duplicate' | 'failure' | 'cancelled'; durationMs: number };
};
export type ServerDiagnosticEvent =
  | MaintenanceDiagnosticEvent
  | RuntimeDiagnosticEvent
  | SupervisorLossEvent
  | HistoryDiagnosticEvent
  | OfflineServerDiagnosticEvent;

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const keys = (value: Record<string, unknown>, fields: readonly string[]) =>
  Object.keys(value).length === fields.length &&
  fields.every((field) => Object.hasOwn(value, field));
const member = (value: unknown, values: readonly string[]) =>
  typeof value === 'string' && values.includes(value);
const amount = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= Number.MAX_SAFE_INTEGER;

export function isServerDiagnosticEvent(value: unknown): value is ServerDiagnosticEvent {
  if (!object(value) || !object(value.details)) return false;
  const details = value.details;
  if (keys(value, ['name', 'details'])) {
    switch (value.name) {
      case 'maintenance.phase':
        return keys(details, ['phase']) && member(details.phase, MAINTENANCE_PHASES);
      case 'maintenance.drain':
        return (
          keys(details, ['outcome', 'durationMs', 'admittedCount']) &&
          member(details.outcome, ['success', 'failure']) &&
          amount(details.durationMs) &&
          amount(details.admittedCount) &&
          Number.isSafeInteger(details.admittedCount)
        );
      case 'maintenance.verification':
        return (
          keys(details, ['outcome', 'durationMs']) &&
          member(details.outcome, ['success', 'failure', 'refused']) &&
          amount(details.durationMs)
        );
      case 'maintenance.refused':
        return keys(details, ['reason']) && member(details.reason, ['paused', 'stale-epoch']);
      case 'diagnostics.writer-loss':
        return (
          keys(details, ['writer', 'invalid', 'queue', 'storage', 'unavailable', 'stale']) &&
          details.writer === 'supervisor' &&
          ['invalid', 'queue', 'storage', 'unavailable', 'stale'].every(
            (key) => amount(details[key]) && Number.isSafeInteger(details[key]),
          )
        );
      case 'offline.server.publication':
      case 'offline.server.recovery':
        return (
          keys(details, ['outcome', 'durationMs']) &&
          member(details.outcome, ['published', 'duplicate', 'failure', 'cancelled']) &&
          amount(details.durationMs)
        );
      default:
        return false;
    }
  }
  if (
    !keys(value, ['name', 'metric', 'details']) ||
    !object(value.metric) ||
    !keys(value.metric, ['kind', 'unit', 'value'])
  )
    return false;
  if (value.name === 'history.checkpoint')
    return (
      value.metric.kind === 'counter' &&
      value.metric.unit === 'count' &&
      value.metric.value === 1 &&
      keys(details, ['source', 'outcome', 'reason', 'durationMs']) &&
      member(details.source, ['native', 'collaboration']) &&
      member(details.outcome, ['captured', 'skipped', 'failure']) &&
      member(details.reason, [
        'baseline',
        'capture',
        'coalesced',
        'migrated',
        'missing',
        'unchanged',
        'unavailable',
      ]) &&
      amount(details.durationMs)
    );
  if (
    value.metric.kind !== 'gauge' ||
    value.metric.unit !== 'milliseconds' ||
    !amount(value.metric.value) ||
    !amount(details.windowMs) ||
    details.windowMs === 0
  )
    return false;
  return value.name === 'runtime.cpu'
    ? keys(details, ['windowMs'])
    : value.name === 'runtime.event-loop' &&
        keys(details, ['statistic', 'windowMs']) &&
        member(details.statistic, ['mean', 'max']);
}

export function isMaintenanceDiagnosticEvent(value: unknown): value is MaintenanceDiagnosticEvent {
  return isServerDiagnosticEvent(value) && value.name.startsWith('maintenance.');
}
