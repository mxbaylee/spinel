import { expect, test } from 'vitest';
import { isServerDiagnosticEvent, MAINTENANCE_PHASES } from './server.ts';
import type { ServerDiagnosticEvent } from './server.ts';

const samples: ServerDiagnosticEvent[] = [
  ...MAINTENANCE_PHASES.map((phase) => ({
    name: 'maintenance.phase' as const,
    details: { phase },
  })),
  {
    name: 'maintenance.drain',
    details: { outcome: 'success', durationMs: 12.5, admittedCount: 2 },
  },
  { name: 'maintenance.verification', details: { outcome: 'refused', durationMs: 0 } },
  { name: 'maintenance.refused', details: { reason: 'stale-epoch' } },
  {
    name: 'runtime.cpu',
    metric: { kind: 'gauge', unit: 'milliseconds', value: 45.5 },
    details: { windowMs: 60_000 },
  },
  {
    name: 'runtime.event-loop',
    metric: { kind: 'gauge', unit: 'milliseconds', value: 22.1 },
    details: { statistic: 'mean', windowMs: 60_000 },
  },
  {
    name: 'diagnostics.writer-loss',
    details: { writer: 'supervisor', invalid: 0, queue: 2, storage: 0, unavailable: 1, stale: 4 },
  },
  {
    name: 'history.checkpoint',
    metric: { kind: 'counter', unit: 'count', value: 1 },
    details: { source: 'native', outcome: 'captured', reason: 'baseline', durationMs: 3.5 },
  },
  { name: 'offline.server.publication', details: { outcome: 'duplicate', durationMs: 12 } },
  { name: 'offline.server.recovery', details: { outcome: 'published', durationMs: 23 } },
];

test('server registry accepts only its fixed content-free dimensions and exact units', () => {
  for (const event of samples) {
    expect(isServerDiagnosticEvent(event), event.name).toBe(true);
    expect(isServerDiagnosticEvent({ ...event, actorId: 'impersonated' })).toBe(false);
    expect(
      isServerDiagnosticEvent({ ...event, details: { ...event.details, error: 'secret' } }),
    ).toBe(false);
    for (const key of Object.keys(event.details)) {
      const details: Record<string, unknown> = { ...event.details };
      delete details[key];
      expect(isServerDiagnosticEvent({ ...event, details })).toBe(false);
    }
    if ('metric' in event) {
      for (const value of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
        expect(isServerDiagnosticEvent({ ...event, metric: { ...event.metric, value } })).toBe(
          false,
        );
      expect(
        isServerDiagnosticEvent({ ...event, metric: { ...event.metric, unit: 'seconds' } }),
      ).toBe(false);
    }
  }
  expect(isServerDiagnosticEvent({ name: 'maintenance.phase', details: { phase: 'secret' } })).toBe(
    false,
  );
  expect(
    isServerDiagnosticEvent({
      name: 'maintenance.drain',
      details: { outcome: 'success', durationMs: 1, admittedCount: 1.5 },
    }),
  ).toBe(false);
  expect(
    isServerDiagnosticEvent({
      name: 'runtime.cpu',
      metric: { kind: 'gauge', unit: 'milliseconds', value: 2 },
      details: { windowMs: 0 },
    }),
  ).toBe(false);
  expect(
    isServerDiagnosticEvent({
      name: 'runtime.event-loop',
      metric: { kind: 'gauge', unit: 'milliseconds', value: 2 },
      details: { statistic: 'raw-stack', windowMs: 1000 },
    }),
  ).toBe(false);
});
