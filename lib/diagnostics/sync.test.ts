import { expect, test } from 'vitest';
import {
  diagnosticMessage,
  isDiagnosticEvent,
  observeSync,
  SYNC_DROP_RULES,
  SYNC_INVARIANTS,
  SYNC_MALFORMED_CHECKS,
  SYNC_REFUSAL_REASONS,
} from './index.ts';
import type { DiagnosticEvent, SyncObservation } from './index.ts';

const context = { component: 'server' as const };
const capture = (observation: SyncObservation) => {
  const events: DiagnosticEvent[] = [];
  observeSync((event) => events.push(event), context, observation);
  return events;
};

test('sync events are separately validated metrics and fixed-level static logs', () => {
  const observations: SyncObservation[] = [
    { name: 'sync.edit.transformed' },
    ...SYNC_REFUSAL_REASONS.map((reason) => ({ name: 'sync.edit.refused' as const, reason })),
    ...SYNC_DROP_RULES.map((rule) => ({ name: 'sync.edit.dropped' as const, rule, value: 2 })),
    ...SYNC_INVARIANTS.map((invariant) => ({ name: 'sync.invariant.failed' as const, invariant })),
    ...SYNC_MALFORMED_CHECKS.map((check) => ({ name: 'sync.edit.malformed' as const, check })),
    { name: 'sync.edit.unsupported', mutationId: 'private formula or URL' },
    { name: 'sync.edit.offset', value: 3 },
    { name: 'sync.divergence.detected' },
    { name: 'sync.edit.resync', reason: 'divergence' },
    { name: 'sync.resync.pending', value: 2 },
    { name: 'sync.transform.duration', value: 0.25 },
    { name: 'sync.transform.concurrent', value: 2 },
    { name: 'sync.transform.growth', value: 4 },
  ];
  for (const observation of observations) {
    const events = capture(observation);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(isDiagnosticEvent(event)).toBe(true);
      expect(diagnosticMessage(event) === null).toBe(!('level' in event));
      expect(isDiagnosticEvent({ ...event, params: 'private data' })).toBe(false);
      expect(
        isDiagnosticEvent({ ...event, details: { ...event.details, secret: 'private data' } }),
      ).toBe(false);
      if ('level' in event) {
        expect(isDiagnosticEvent({ ...event, level: 'fatal' })).toBe(false);
        expect(
          isDiagnosticEvent({ ...event, metric: { kind: 'counter', unit: 'count', value: 1 } }),
        ).toBe(false);
      }
    }
  }
});

test('arbitrary mutation IDs and error text cannot enter metrics or static logs', () => {
  const secret = 'https://private.example/?token=secret';
  const events = capture({
    name: 'sync.edit.refused',
    reason: 'name-race',
    mutationId: secret,
    againstMutationId: 'sheet.mutation.set-worksheet-name',
  });
  expect(events).toHaveLength(2);
  expect(events[0].details).toEqual({
    reason: 'name-race',
    mutationId: 'other',
    againstMutationId: 'sheet.mutation.set-worksheet-name',
  });
  expect(JSON.stringify(events)).not.toContain(secret);
  for (const event of events) {
    expect(isDiagnosticEvent({ ...event, details: { ...event.details, mutationId: secret } })).toBe(
      false,
    );
    expect(isDiagnosticEvent({ ...event, details: { ...event.details, reason: secret } })).toBe(
      false,
    );
  }
  expect(capture({ name: 'sync.edit.malformed', check: secret } as never)).toEqual([]);
  expect(capture({ name: 'sync.edit.dropped', rule: secret } as never)).toEqual([]);
});

test('count histograms reject fractions, negative, unbounded or wrong-unit samples', () => {
  const [event] = capture({ name: 'sync.resync.pending', value: 2 });
  for (const value of [0.5, -1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    expect(capture({ name: 'sync.transform.concurrent', value })).toEqual([]);
    expect(
      isDiagnosticEvent({ ...event, metric: { kind: 'histogram', unit: 'count', value } }),
    ).toBe(false);
  }
  expect(
    isDiagnosticEvent({ ...event, metric: { kind: 'histogram', unit: 'milliseconds', value: 2 } }),
  ).toBe(false);
  expect(
    isDiagnosticEvent({ ...event, metric: { kind: 'counter', unit: 'count', value: 2 } }),
  ).toBe(false);
});

test('a broken metric sink does not prevent the independent log attempt or throw', () => {
  let calls = 0;
  expect(() =>
    observeSync(
      () => {
        calls++;
        throw new Error('unavailable');
      },
      context,
      { name: 'sync.edit.unsupported', mutationId: 'secret' },
    ),
  ).not.toThrow();
  expect(calls).toBe(2);
  expect(() => observeSync(undefined, context, { name: 'sync.divergence.detected' })).not.toThrow();
});
