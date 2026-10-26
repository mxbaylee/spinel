import type { DiagnosticContext, DiagnosticSink } from './index.ts';

/** Fixed protocol vocabulary, never a mutation id copied unvalidated from a sender. */
export const SYNC_MUTATION_IDS = [
  'sheet.mutation.set-range-values',
  'sheet.mutation.set.numfmt',
  'sheet.mutation.remove.numfmt',
  'sheet.mutation.move-range',
  'sheet.mutation.set-worksheet-row-height',
  'sheet.mutation.set-worksheet-row-is-auto-height',
  'sheet.mutation.set-worksheet-row-auto-height',
  'sheet.mutation.set-row-hidden',
  'sheet.mutation.set-row-visible',
  'sheet.mutation.set-row-data',
  'sheet.mutation.set-worksheet-col-width',
  'sheet.mutation.set-col-hidden',
  'sheet.mutation.set-col-visible',
  'sheet.mutation.set-col-data',
  'sheet.mutation.add-worksheet-merge',
  'sheet.mutation.remove-worksheet-merge',
  'sheet.mutation.set-frozen',
  'sheet.mutation.set-worksheet-row-count',
  'sheet.mutation.set-worksheet-column-count',
  'sheet.mutation.set-worksheet-default-style',
  'sheet.mutation.set-gridlines-color',
  'sheet.mutation.toggle-gridlines',
  'sheet.mutation.set-worksheet-name',
  'sheet.mutation.set-tab-color',
  'sheet.mutation.set-worksheet-hidden',
  'sheet.mutation.set-workbook-name',
  'sheet.mutation.set-drawing-apply',
  'sheet.mutation.set-worksheet-background-image',
  'doc.mutation.rich-text-editing',
  'doc.mutation.rename-doc',
  'docs.mutation.add-hyper-link',
  'docs.mutation.update-hyper-link',
  'docs.mutation.delete-hyper-link',
  'formula.mutation.set-defined-name',
  'formula.mutation.remove-defined-name',
  'sheet.mutation.insert-row',
  'sheet.mutation.insert-col',
  'sheet.mutation.remove-rows',
  'sheet.mutation.remove-col',
  'sheet.mutation.move-rows',
  'sheet.mutation.move-columns',
  'sheet.mutation.insert-sheet',
  'sheet.mutation.remove-sheet',
  'sheet.mutation.set-worksheet-order',
  'other',
] as const;
export type SyncMutationId = (typeof SYNC_MUTATION_IDS)[number];
export const SYNC_REFUSAL_REASONS = ['moved-cells', 'name-race', 'formula-race', 'growth'] as const;
export type SyncRefusalReason = (typeof SYNC_REFUSAL_REASONS)[number];
export const SYNC_DROP_RULES = [
  'name-first-accepted',
  'cell-overwritten',
  'merge-cut',
  'removed-sheet',
  'setting-first-accepted',
  'doc-formula-first-accepted',
] as const;
export type SyncDropRule = (typeof SYNC_DROP_RULES)[number];
export const SYNC_MALFORMED_CHECKS = [
  'shift',
  'reserved-key',
  'claim',
  'remove-index',
  'inline-style',
  'base-cells',
  'base-claim',
  'tail',
  'other',
] as const;
export type SyncMalformedCheck = (typeof SYNC_MALFORMED_CHECKS)[number];
export const SYNC_INVARIANTS = [
  'no-sheet',
  'no-visible-sheet',
  'worksheet-identity',
  'worksheet-name',
] as const;
export type SyncInvariant = (typeof SYNC_INVARIANTS)[number];
export const SYNC_RESYNC_REASONS = [
  ...SYNC_REFUSAL_REASONS,
  'malformed',
  'unsupported',
  'invariant',
  'divergence',
  'retention',
] as const;

interface SyncDetails {
  'sync.edit.transformed': Record<string, never>;
  'sync.edit.refused': {
    reason: SyncRefusalReason;
    mutationId: SyncMutationId;
    againstMutationId: SyncMutationId;
  };
  'sync.edit.resync': { reason: (typeof SYNC_RESYNC_REASONS)[number] };
  'sync.resync.pending': Record<string, never>;
  'sync.edit.dropped': { rule: SyncDropRule };
  'sync.edit.offset': Record<string, never>;
  'sync.edit.unsupported': { mutationId: SyncMutationId };
  'sync.edit.malformed': { check: SyncMalformedCheck };
  'sync.divergence.detected': Record<string, never>;
  'sync.invariant.failed': { invariant: SyncInvariant };
  'sync.transform.duration': Record<string, never>;
  'sync.transform.concurrent': Record<string, never>;
  'sync.transform.growth': Record<string, never>;
}
type HistogramName =
  | 'sync.resync.pending'
  | 'sync.transform.duration'
  | 'sync.transform.concurrent'
  | 'sync.transform.growth';
type SyncMetric = {
  [Name in keyof SyncDetails]: {
    name: Name;
    details: SyncDetails[Name];
    metric: {
      kind: Name extends HistogramName ? 'histogram' : 'counter';
      unit: Name extends 'sync.transform.duration' ? 'milliseconds' : 'count';
      value: number;
    };
  };
}[keyof SyncDetails];

const logs = {
  'sync.edit.refused': { level: 'info', message: 'An edit could not be merged safely.' },
  'sync.edit.resync': { level: 'warn', message: 'An editor reloaded after a sync refusal.' },
  'sync.edit.dropped': { level: 'debug', message: 'A concurrent edit took precedence.' },
  'sync.edit.offset': { level: 'debug', message: 'A write remained beside a clipped shift band.' },
  'sync.edit.unsupported': { level: 'error', message: 'An unsupported mutation was refused.' },
  'sync.edit.malformed': { level: 'error', message: 'A malformed edit was refused.' },
  'sync.divergence.detected': {
    level: 'error',
    message: 'An editor snapshot differed from the server.',
  },
  'sync.invariant.failed': { level: 'error', message: 'An edit violated a workbook invariant.' },
} as const;
type SyncLog = {
  [Name in keyof typeof logs]: {
    name: `${Name}.log`;
    level: (typeof logs)[Name]['level'];
    details: SyncDetails[Name];
  };
}[keyof typeof logs];
export type SyncDiagnosticEvent = SyncMetric | SyncLog;

const member = (value: unknown, values: readonly string[]) =>
  typeof value === 'string' && values.includes(value);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const keys = (value: Record<string, unknown>, fields: readonly string[]) =>
  Object.keys(value).length === fields.length &&
  fields.every((field) => Object.hasOwn(value, field));
export function syncMutationId(value: unknown): SyncMutationId {
  return member(value, SYNC_MUTATION_IDS) ? (value as SyncMutationId) : 'other';
}

function validDetails(name: string, d: Record<string, unknown>) {
  switch (name) {
    case 'sync.edit.refused':
      return (
        keys(d, ['reason', 'mutationId', 'againstMutationId']) &&
        member(d.reason, SYNC_REFUSAL_REASONS) &&
        member(d.mutationId, SYNC_MUTATION_IDS) &&
        member(d.againstMutationId, SYNC_MUTATION_IDS)
      );
    case 'sync.edit.resync':
      return keys(d, ['reason']) && member(d.reason, SYNC_RESYNC_REASONS);
    case 'sync.edit.dropped':
      return keys(d, ['rule']) && member(d.rule, SYNC_DROP_RULES);
    case 'sync.edit.unsupported':
      return keys(d, ['mutationId']) && member(d.mutationId, SYNC_MUTATION_IDS);
    case 'sync.edit.malformed':
      return keys(d, ['check']) && member(d.check, SYNC_MALFORMED_CHECKS);
    case 'sync.invariant.failed':
      return keys(d, ['invariant']) && member(d.invariant, SYNC_INVARIANTS);
    case 'sync.edit.transformed':
    case 'sync.edit.offset':
    case 'sync.divergence.detected':
    case 'sync.resync.pending':
    case 'sync.transform.duration':
    case 'sync.transform.concurrent':
    case 'sync.transform.growth':
      return keys(d, []);
    default:
      return false;
  }
}
export function isSyncDiagnosticEvent(value: unknown): value is SyncDiagnosticEvent {
  if (!object(value) || typeof value.name !== 'string' || !object(value.details)) return false;
  const log = value.name.endsWith('.log');
  const name = log ? value.name.slice(0, -4) : value.name;
  if (!validDetails(name, value.details)) return false;
  if (log)
    return (
      keys(value, ['name', 'level', 'details']) &&
      Object.hasOwn(logs, name) &&
      value.level === logs[name as keyof typeof logs].level
    );
  if (
    !keys(value, ['name', 'metric', 'details']) ||
    !object(value.metric) ||
    !keys(value.metric, ['kind', 'unit', 'value'])
  )
    return false;
  const histogram = [
    'sync.resync.pending',
    'sync.transform.duration',
    'sync.transform.concurrent',
    'sync.transform.growth',
  ].includes(name);
  const duration = name === 'sync.transform.duration';
  const metric = value.metric;
  return (
    metric.kind === (histogram ? 'histogram' : 'counter') &&
    metric.unit === (duration ? 'milliseconds' : 'count') &&
    typeof metric.value === 'number' &&
    Number.isFinite(metric.value) &&
    metric.value >= 0 &&
    metric.value <= Number.MAX_SAFE_INTEGER &&
    (duration || Number.isSafeInteger(metric.value))
  );
}

export function syncDiagnosticMessage(event: SyncDiagnosticEvent): string | null {
  if (!event.name.endsWith('.log')) return null;
  const name = event.name.slice(0, -4) as keyof typeof logs;
  return logs[name]?.message ?? null;
}

export type SyncObservation =
  | { name: 'sync.edit.transformed' | 'sync.divergence.detected' }
  | {
      name: 'sync.edit.refused';
      reason: SyncRefusalReason;
      mutationId?: unknown;
      againstMutationId?: unknown;
    }
  | { name: 'sync.edit.resync'; reason: (typeof SYNC_RESYNC_REASONS)[number] }
  | { name: 'sync.edit.dropped'; rule: SyncDropRule; value?: number }
  | { name: 'sync.edit.offset'; value?: number }
  | { name: 'sync.edit.unsupported'; mutationId: unknown }
  | { name: 'sync.edit.malformed'; check: SyncMalformedCheck }
  | { name: 'sync.invariant.failed'; invariant: SyncInvariant }
  | { name: HistogramName; value: number };

/** Metrics and their static log are separate observations; neither can fail the edit. */
export function observeSync(
  sink: DiagnosticSink | undefined,
  context: DiagnosticContext,
  observation: SyncObservation,
) {
  if (!sink) return;
  const { name } = observation;
  let details: Record<string, unknown> = {};
  switch (observation.name) {
    case 'sync.edit.refused':
      details = {
        reason: observation.reason,
        mutationId: syncMutationId(observation.mutationId),
        againstMutationId: syncMutationId(observation.againstMutationId),
      };
      break;
    case 'sync.edit.resync':
      details = { reason: observation.reason };
      break;
    case 'sync.edit.dropped':
      details = { rule: observation.rule };
      break;
    case 'sync.edit.unsupported':
      details = { mutationId: syncMutationId(observation.mutationId) };
      break;
    case 'sync.edit.malformed':
      details = { check: observation.check };
      break;
    case 'sync.invariant.failed':
      details = { invariant: observation.invariant };
      break;
  }
  const histogram = [
    'sync.resync.pending',
    'sync.transform.duration',
    'sync.transform.concurrent',
    'sync.transform.growth',
  ].includes(name);
  const event = {
    name,
    details,
    metric: {
      kind: histogram ? 'histogram' : 'counter',
      unit: name === 'sync.transform.duration' ? 'milliseconds' : 'count',
      value: 'value' in observation ? (observation.value ?? 1) : 1,
    },
  };
  // The helper also validates its runtime input, even when used with a custom sink.
  if (!isSyncDiagnosticEvent(event)) return;
  try {
    sink(event, context);
  } catch {
    /* Diagnostics remains lossy. */
  }
  if (Object.hasOwn(logs, name)) {
    const log = { name: `${name}.log`, level: logs[name as keyof typeof logs].level, details };
    if (isSyncDiagnosticEvent(log)) {
      try {
        sink(log, context);
      } catch {
        /* Diagnostics remains lossy. */
      }
    }
  }
}
