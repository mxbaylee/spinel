import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { AccountDiagnostics } from '../../../web/diagnosticsAccount.ts';
import { BrowserDiagnostics } from '../../../web/diagnostics.ts';
import { observedFormulaParse } from '../../../web/formulaDiagnostics.ts';
import type { DiagnosticContext, DiagnosticEvent } from '@spinel/diagnostics';

test('guest/local absence creates no collector; account switch and explicit stop cannot revive old clients', () => {
  const clients: BrowserDiagnostics[] = [];
  const create = vi.fn((accountId: string) => {
    const client = new BrowserDiagnostics({ accountId });
    vi.spyOn(client, 'start').mockResolvedValue();
    vi.spyOn(client, 'suspend').mockImplementation(() => {});
    vi.spyOn(client, 'stop').mockImplementation(() => {});
    clients.push(client);
    return client;
  });
  const account = new AccountDiagnostics(create);
  account.connection(true);
  expect(account.runId()).toBeUndefined();
  expect(create).not.toHaveBeenCalled();
  const owner = randomUUID(), collaborator = randomUUID();
  account.account(owner); account.connection(true); account.connection(true);
  expect(create).toHaveBeenLastCalledWith(owner);
  expect(clients[0].start).toHaveBeenCalledTimes(1);
  expect(account.runId()).toMatch(/^[a-f0-9-]{36}$/);
  account.connection(false);
  expect(clients[0].suspend).toHaveBeenCalledTimes(1);
  expect(account.runId()).toBeUndefined();
  account.connection(true);
  expect(clients[0].start).toHaveBeenCalledTimes(2);
  account.account(collaborator); account.connection(true);
  expect(clients[0].stop).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenLastCalledWith(collaborator);
  account.stop(); account.connection(false); account.connection(true);
  expect(clients[1].start).toHaveBeenCalledTimes(1);
  expect(account.runId()).toBeUndefined();
  account.account(null);
  expect(create).toHaveBeenCalledTimes(2);
});

test('actual public formula parsing records only typed outcomes/timing and retains identical results/errors', () => {
  const observations: { event: DiagnosticEvent; context: DiagnosticContext }[] = [];
  const context = { component: 'formula', fileId: randomUUID(), runId: randomUUID() } as const;
  const expression = "='Private workbook'.'Secret tab'.A1";
  const sink = (event: DiagnosticEvent, context: DiagnosticContext) => { observations.push({ event, context }); };
  expect(observedFormulaParse(expression, sink, context)).toEqual([{ start: 1, end: expression.length, documentName: 'Private workbook', sheetName: 'Secret tab', range: 'A1' }]);
  expect(() => observedFormulaParse('=', sink, context)).toThrow();
  expect(observations.length).toBeGreaterThanOrEqual(3);
  expect(observations.every((value) => value.context.runId === context.runId)).toBe(true);
  expect(observations.some((value) => value.event.name === 'operation.duration')).toBe(true);
  expect(observations.some((value) => value.event.name === 'operation.failed')).toBe(true);
  const serialized = JSON.stringify(observations);
  expect(serialized).not.toContain('Private workbook');
  expect(serialized).not.toContain('Secret tab');
  expect(() => observedFormulaParse('=1+2', () => { throw new Error('broken observer'); }, context)).not.toThrow();
});
