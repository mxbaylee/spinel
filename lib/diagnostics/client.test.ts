import { expect, test } from 'vitest';
import { isClientDiagnosticEvent, isDiagnosticEvent } from './index.ts';
import type { ClientDiagnosticEvent } from './index.ts';

const events: ClientDiagnosticEvent[] = [
  {
    name: 'sync.client.connection',
    details: {
      reason: 'timeout',
      outcome: 'success',
      durationMs: 42.5,
      pendingCount: 2,
      oldestPendingAgeMs: 100,
    },
  },
  {
    name: 'sync.client.resync',
    details: {
      reason: 'stale',
      outcome: 'handed-off',
      durationMs: 30,
      pendingCount: 1,
      oldestPendingAgeMs: null,
    },
  },
  {
    name: 'sync.client.refresh',
    details: {
      reason: 'retention',
      outcome: 'handed-off',
      durationMs: 40,
      pendingCount: 0,
      oldestPendingAgeMs: 0,
    },
  },
  { name: 'sync.client.queue', details: { pendingCount: 0, oldestPendingAgeMs: 0 } },
  { name: 'sync.client.acknowledged', details: { duplicate: true } },
  {
    name: 'native.flush',
    details: {
      reason: 'capacity',
      outcome: 'failure',
      durationMs: 4,
      history: 32,
      collaboration: 31,
    },
  },
  { name: 'native.checkpoint', details: { outcome: 'skipped', durationMs: 2 } },
  {
    name: 'offline.persistence',
    details: { outcome: 'persisted', reason: 'write', durationMs: 3 },
  },
  { name: 'offline.publication', details: { outcome: 'failure', durationMs: 5 } },
  { name: 'offline.recovery', details: { outcome: 'cancelled', durationMs: 8 } },
];

test.each(events)('$name has an exact content-free schema shared with exports', (event) => {
  expect(isClientDiagnosticEvent(event)).toBe(true);
  expect(isDiagnosticEvent(event)).toBe(true);
  for (const field of ['title', 'error', 'url', 'actorId', 'query', 'formula', 'payload']) {
    expect(isClientDiagnosticEvent({ ...event, [field]: 'private' })).toBe(false);
    expect(
      isClientDiagnosticEvent({ ...event, details: { ...event.details, [field]: 'private' } }),
    ).toBe(false);
  }
});

test('browser admission is finite and cannot impersonate server observations or arbitrary reasons', () => {
  for (const name of [
    'runtime.memory',
    'job.result',
    'sync.edit.transformed',
    'maintenance.phase',
    'native.secret',
  ])
    expect(isClientDiagnosticEvent({ name, details: {} })).toBe(false);
  const event = events[0];
  expect(
    isClientDiagnosticEvent({
      ...event,
      details: { ...event.details, reason: 'https://private.test/query' },
    }),
  ).toBe(false);
  for (const amount of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    expect(
      isClientDiagnosticEvent({ ...event, details: { ...event.details, durationMs: amount } }),
    ).toBe(false);
  expect(
    isClientDiagnosticEvent({ ...event, details: { ...event.details, pendingCount: 0.5 } }),
  ).toBe(false);
  expect(
    isClientDiagnosticEvent({
      ...events[1],
      details: { ...events[1].details, outcome: 'success' },
    }),
  ).toBe(false);
});
