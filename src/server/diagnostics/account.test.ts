import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { AccountDiagnostics } from '../../../web/diagnosticsAccount.ts';
import { BrowserDiagnostics } from '../../../web/diagnostics.ts';
import { observedFormulaParse } from '../../../web/formulaDiagnostics.ts';
import type { DiagnosticContext, DiagnosticEvent, DiagnosticRecord } from '@spinel/diagnostics';

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
  expect(account.begin()).toBeUndefined();
  expect(create).not.toHaveBeenCalled();
  const owner = randomUUID(),
    collaborator = randomUUID();
  account.account(owner);
  account.connection(true);
  account.connection(true);
  expect(create).toHaveBeenLastCalledWith(owner);
  expect(clients[0].start).toHaveBeenCalledTimes(1);
  // A connected shell alone is insufficient until collection initialization finishes.
  expect(account.begin()).toBeUndefined();
  account.connection(false);
  expect(clients[0].suspend).toHaveBeenCalledTimes(1);
  expect(account.begin()).toBeUndefined();
  account.connection(true);
  expect(clients[0].start).toHaveBeenCalledTimes(2);
  account.account(collaborator);
  account.connection(true);
  expect(clients[0].stop).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenLastCalledWith(collaborator);
  account.stop();
  account.connection(false);
  account.connection(true);
  expect(clients[1].start).toHaveBeenCalledTimes(1);
  expect(account.begin()).toBeUndefined();
  account.account(null);
  expect(create).toHaveBeenCalledTimes(2);
});

test.each(['account switch', 'reconnect', 'new login', 'collection reset'] as const)(
  'an async operation cannot enter the replacement collection after %s',
  async (transition) => {
    vi.useFakeTimers();
    const starts: Promise<void>[] = [];
    const clients: BrowserDiagnostics[] = [];
    const bodies: {
      accountId: string | null;
      generation: string;
      binding: string;
      records: DiagnosticRecord[];
    }[] = [];
    let generation = randomUUID();
    let binding = 'a'.repeat(64);
    let reset = false;
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    const request = vi.fn<typeof fetch>(async (url, options) => {
      if (String(url).endsWith('/collection')) return json({ generation, binding });
      const body = JSON.parse(String(options?.body));
      bodies.push({
        ...body,
        accountId: new Headers(options?.headers).get('X-Spinel-Diagnostic-Account'),
      });
      if (reset) {
        reset = false;
        generation = randomUUID();
        binding = 'b'.repeat(64);
        return json({}, 409);
      }
      return json({ accepted: body.records.length, dropped: 0 });
    });
    const account = new AccountDiagnostics((accountId) => {
      const client = new BrowserDiagnostics({ accountId, fetch: request });
      const start = client.start.bind(client);
      vi.spyOn(client, 'start').mockImplementation(() => {
        const pending = start();
        starts.push(pending);
        return pending;
      });
      clients.push(client);
      return client;
    });
    const owner = randomUUID();
    let currentAccount = owner;
    // Both accounts may legitimately access this file; authorization cannot identify
    // an old callback that has been wrongly relabelled as the new account's run.
    const fileId = randomUUID();
    const event = {
      name: 'operation.result',
      details: { operation: 'formula-evaluate', outcome: 'success', durationMs: 4 },
    } as const;
    let release!: () => void;
    try {
      account.account(owner);
      account.connection(true);
      expect(account.begin()).toBeUndefined();
      await starts.at(-1);
      const old = account.begin()!;
      expect(old).toBeDefined();
      const completion = new Promise<void>((resolve) => {
        release = resolve;
      }).then(() => {
        old.sink(event, { component: 'formula', fileId, runId: old.runId });
      });
      if (transition === 'account switch') {
        currentAccount = randomUUID();
        account.account(currentAccount);
        account.connection(true);
      } else if (transition === 'reconnect') {
        account.connection(false);
        account.connection(true);
      } else if (transition === 'new login') {
        account.account(null);
        account.account(owner);
        account.connection(true);
      } else {
        // A server-side truncate/session reset restarts the same BrowserDiagnostics
        // instance without changing AccountDiagnostics' connected state.
        old.sink(event, { component: 'formula', fileId, runId: old.runId });
        reset = true;
        await clients[0].flush();
        expect(bodies).toHaveLength(1);
        bodies.length = 0;
      }
      await starts.at(-1);
      const fresh = account.begin()!;
      expect(fresh).toBeDefined();
      expect(fresh.runId).not.toBe(old.runId);
      release();
      await completion;
      await clients.at(-1)!.flush();
      expect(bodies).toHaveLength(0);
      fresh.sink(event, { component: 'formula', fileId, runId: fresh.runId });
      await clients.at(-1)!.flush();
      expect(bodies).toHaveLength(1);
      expect(bodies[0]).toMatchObject({ accountId: currentAccount, generation, binding });
      expect(bodies[0].records).toHaveLength(1);
      expect(bodies[0].records[0].context).toEqual({
        component: 'formula',
        fileId,
        runId: fresh.runId,
      });
      expect(JSON.stringify(bodies)).not.toContain(old.runId);
      expect(clients[0].dropped).toBe(transition === 'collection reset' ? 2 : 1);
    } finally {
      account.stop();
      vi.useRealTimers();
    }
  },
);

test('actual public formula parsing records only typed outcomes/timing and retains identical results/errors', () => {
  const observations: { event: DiagnosticEvent; context: DiagnosticContext }[] = [];
  const context = { component: 'formula', fileId: randomUUID(), runId: randomUUID() } as const;
  const expression = "='Private workbook'.'Secret tab'.A1";
  const sink = (event: DiagnosticEvent, context: DiagnosticContext) => {
    observations.push({ event, context });
  };
  expect(observedFormulaParse(expression, sink, context)).toEqual([
    {
      start: 1,
      end: expression.length,
      documentName: 'Private workbook',
      sheetName: 'Secret tab',
      range: 'A1',
    },
  ]);
  expect(() => observedFormulaParse('=', sink, context)).toThrow();
  expect(observations.length).toBeGreaterThanOrEqual(3);
  expect(observations.every((value) => value.context.runId === context.runId)).toBe(true);
  expect(observations.some((value) => value.event.name === 'operation.duration')).toBe(true);
  expect(observations.some((value) => value.event.name === 'operation.failed')).toBe(true);
  const serialized = JSON.stringify(observations);
  expect(serialized).not.toContain('Private workbook');
  expect(serialized).not.toContain('Secret tab');
  expect(() =>
    observedFormulaParse(
      '=1+2',
      () => {
        throw new Error('broken observer');
      },
      context,
    ),
  ).not.toThrow();
});
