import { expect, test, vi } from 'vitest';
import type { DiagnosticContext, DiagnosticEvent } from '@spinel/diagnostics';
import { beginOperation, diagnosticSource } from '../../web/operationDiagnostics.ts';

test.each(['success', 'failure', 'cancelled'] as const)(
  'an operation records one %s outcome on its initiating binding',
  (outcome) => {
    let at = 100;
    const events: DiagnosticEvent[] = [];
    const sink = vi.fn((event: DiagnosticEvent, _context: DiagnosticContext) => events.push(event));
    const begin = vi.fn(() => ({ sink, runId: 'f154e55f-c5b7-4e92-962a-3dac564d53bb' }));
    const done = beginOperation(
      diagnosticSource({ begin }, { component: 'editor' }),
      'document-open',
      () => at,
    );
    at = 140;
    done(outcome);
    at = 160;
    done('success');
    expect(begin).toHaveBeenCalledOnce();
    expect(events.filter((event) => event.name === 'operation.result')).toEqual([
      {
        name: 'operation.result',
        details: { operation: 'document-open', outcome, durationMs: 40 },
      },
    ]);
    expect(events.filter((event) => event.name === 'operation.count')).toHaveLength(1);
    expect(sink.mock.calls.every((call) => call.length === 2)).toBe(true);
  },
);

test('unavailable, throwing sources, clocks and sinks cannot affect the measured operation', () => {
  for (const source of [
    undefined,
    () => {
      throw new Error('source');
    },
    () => ({
      sink: () => {
        throw new Error('sink');
      },
      context: { component: 'editor' as const },
    }),
  ]) {
    const done = beginOperation(source, 'search');
    expect(() => done('success')).not.toThrow();
  }
  const done = beginOperation(undefined, 'search', () => {
    throw new Error('clock');
  });
  expect(() => done('failure')).not.toThrow();
});
