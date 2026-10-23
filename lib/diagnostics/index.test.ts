import { expect, test } from 'vitest';
import { isDiagnosticEvent, isDiagnosticContext, isDiagnosticRecord, observe, diagnosticMessage } from './index.ts';
import type { DiagnosticEvent } from './index.ts';

const event: DiagnosticEvent = { name: 'operation.failed', level: 'warn', details: { operation: 'document-open', reason: 'permission' } };
test('registered logs never accept free-form messages, errors, URLs, names or extra detail fields', () => {
  expect(isDiagnosticEvent(event)).toBe(true);
  expect(diagnosticMessage(event)).toBe('An operation failed.');
  for (const key of ['message', 'error', 'url', 'name', 'token', 'formula']) {
    expect(isDiagnosticEvent({ ...event, [key]: 'private secret' })).toBe(false);
    expect(isDiagnosticEvent({ ...event, details: { ...event.details, [key]: 'private secret' } })).toBe(false);
  }
  expect(isDiagnosticEvent({ ...event, details: { operation: 'document-open', reason: 'Bearer secret' } })).toBe(false);
  expect(isDiagnosticEvent({ ...event, level: 'warning' })).toBe(false);
});
test('metric names fix unit and semantics; values must be finite, nonnegative and counts integral', () => {
  const metric = { name: 'operation.count', metric: { kind: 'counter', unit: 'count', value: 2 }, details: { operation: 'search', outcome: 'success' } };
  expect(isDiagnosticEvent(metric)).toBe(true);
  for (const value of [-1, Infinity, NaN, 0.5, '2', Number.MAX_SAFE_INTEGER + 1]) expect(isDiagnosticEvent({ ...metric, metric: { ...metric.metric, value } })).toBe(false);
  expect(isDiagnosticEvent({ ...metric, metric: { ...metric.metric, kind: 'gauge' } })).toBe(false);
  expect(isDiagnosticEvent({ ...metric, metric: { ...metric.metric, unit: 'milliseconds' } })).toBe(false);
  expect(isDiagnosticEvent({ name: 'operation.duration', metric: { kind: 'histogram', unit: 'milliseconds', value: 0.25 }, details: { operation: 'search' } })).toBe(true);
});
test('context is identifiers and registered route templates only; partial Space context fails closed', () => {
  const id = '27313b1c-8759-4ae2-a488-29cb8e6044d2';
  expect(isDiagnosticContext({ component: 'editor', fileId: id, spaceId: id, route: '/files/:id', runId: id })).toBe(true);
  expect(isDiagnosticContext({ component: 'editor', spaceId: id })).toBe(false);
  expect(isDiagnosticContext({ component: 'editor', actorId: id })).toBe(false);
  expect(isDiagnosticContext({ component: 'editor', fileId: 'private name' })).toBe(false);
  expect(isDiagnosticContext({ component: 'editor', route: `/files/${id}?token=secret` })).toBe(false);
  const record = { id, occurredAt: 1234, event, context: { component: 'editor' } };
  expect(isDiagnosticRecord(record)).toBe(true);
  expect(isDiagnosticRecord({ ...record, source: 'backend' })).toBe(false);
  expect(isDiagnosticRecord({ ...record, actorId: id })).toBe(false);
});
test('optional or throwing observers cannot fail the observed operation', () => {
  expect(() => observe(undefined, event, { component: 'editor' })).not.toThrow();
  expect(() => observe(() => { throw new Error('observer unavailable'); }, event, { component: 'editor' })).not.toThrow();
});
