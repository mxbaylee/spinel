import { afterEach, expect, test, vi } from 'vitest';
import type { DiagnosticEvent, DiagnosticSource } from '@spinel/diagnostics';
import { NativeReplica } from '../index.ts';
import { fixture, turns, wire, write } from './fixture.ts';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
  vi.restoreAllMocks();
});
function observer(events: DiagnosticEvent[]): DiagnosticSource {
  return () => ({ sink: (event) => events.push(event), context: { component: 'editor' } });
}

test('one logical native save includes queue delay and retries, and a duplicate receipt counts once', async () => {
  const f = fixture();
  cleanup.push(f.close);
  let at = 100;
  const events: DiagnosticEvent[] = [];
  const source = f.client({ diagnostics: observer(events), diagnosticNow: () => at });
  source.resume();
  await turns();
  source.edit([write({ v: 'Private content must never enter diagnostics' })]);
  at = 120;
  expect(source.sync.diagnosticQueue()).toEqual({ pendingCount: 1, oldestPendingAgeMs: 20 });
  source.sync.retry();
  await turns();
  const request = source.submits()[0];
  source.sync.retry();
  source.sync.retry();
  expect(source.submits()).toHaveLength(3);
  const committed = await f.accept(request);
  at = 150;
  const ack = {
    type: 'ack' as const,
    mutationId: request.mutationId,
    duplicate: true,
    ...wire(committed.edit),
  };
  source.sync.receive(ack);
  source.sync.receive(ack);
  await turns();
  expect(source.sync.state.pending).toBe(false);
  expect(source.sync.diagnosticQueue()).toEqual({ pendingCount: 0, oldestPendingAgeMs: 0 });
  expect(events.filter((event) => event.name === 'operation.result')).toEqual([
    {
      name: 'operation.result',
      details: { operation: 'document-save-server-ack', outcome: 'success', durationMs: 50 },
    },
  ]);
  expect(events.filter((event) => event.name === 'sync.client.acknowledged')).toEqual([
    { name: 'sync.client.acknowledged', details: { duplicate: true } },
  ]);
  expect(JSON.stringify(events)).not.toContain('Private content');
});

test('queue sampling skips count and age work between due observations and still reports immediate empty', async () => {
  const f = fixture();
  cleanup.push(f.close);
  let at = 100;
  const events: DiagnosticEvent[] = [];
  const source = f.client({ diagnostics: observer(events), diagnosticNow: () => at });
  source.resume();
  await turns();
  const queues = () => events.filter((event) => event.name === 'sync.client.queue');
  expect(queues()).toEqual([
    { name: 'sync.client.queue', details: { pendingCount: 0, oldestPendingAgeMs: 0 } },
  ]);
  const measurements = vi.spyOn(source.sync, 'diagnosticQueue');
  // Native input publishes repeatedly inside the sampling interval. Suppression
  // must avoid constructing the full observation, not merely discard its result.
  for (let group = 0; group < 32; group++) {
    at = 100 + group;
    source.edit([write({ v: `first-${group}` }, 0), write({ v: `second-${group}` }, 1)]);
  }
  expect(measurements).not.toHaveBeenCalled();
  expect(queues()).toHaveLength(1);
  expect(source.sync.state).toMatchObject({ pending: true, resyncing: false });

  at = 1100;
  source.sync.setConnected(true);
  expect(measurements).toHaveBeenCalledOnce();
  expect(queues().at(-1)).toEqual({
    name: 'sync.client.queue',
    details: { pendingCount: 64, oldestPendingAgeMs: 1000 },
  });
  source.sync.retry();
  await turns();
  const request = source.submits()[0];
  expect(request.mutations).toHaveLength(64);
  expect(measurements).toHaveBeenCalledOnce();
  expect(queues().at(-1)).toEqual({
    name: 'sync.client.queue',
    details: { pendingCount: 64, oldestPendingAgeMs: 1000 },
  });
  for (let publication = 0; publication < 64; publication++) source.sync.setConnected(true);
  expect(measurements).toHaveBeenCalledOnce();

  const accepted = await f.accept(request);
  at = 1101;
  source.sync.receive({
    type: 'ack',
    mutationId: request.mutationId,
    duplicate: false,
    ...wire(accepted.edit),
  });
  await turns();
  expect(measurements).toHaveBeenCalledTimes(2);
  expect(queues()).toEqual([
    { name: 'sync.client.queue', details: { pendingCount: 0, oldestPendingAgeMs: 0 } },
    { name: 'sync.client.queue', details: { pendingCount: 64, oldestPendingAgeMs: 1000 } },
    { name: 'sync.client.queue', details: { pendingCount: 0, oldestPendingAgeMs: 0 } },
  ]);
  expect(source.sync.state).toMatchObject({ pending: false, revision: 2, resyncing: false });
  expect({ ...source.live.snapshot(), rev: source.sync.confirmedRevision }).toEqual(
    f.storage.unit.snapshot,
  );
  expect(f.storage.history).toHaveLength(1);
});

test('queued persistence captures once only when requested, and a skipped hook never claims a local save', async () => {
  const f = fixture();
  cleanup.push(f.close);
  const events: DiagnosticEvent[] = [];
  let capture = false;
  const source = f.client({
    diagnostics: observer(events),
    persist: (factory) => {
      if (capture) expect(factory()).toBe(factory());
    },
  });
  const snapshots = vi.spyOn(NativeReplica.prototype, 'snapshot');
  await source.sync.persistNow();
  expect(snapshots).not.toHaveBeenCalled();
  expect(events.filter((event) => event.name === 'native.checkpoint')).toEqual([
    expect.objectContaining({ details: expect.objectContaining({ outcome: 'skipped' }) }),
  ]);
  capture = true;
  await source.sync.persistNow();
  expect(snapshots).toHaveBeenCalledOnce();
  expect(events.filter((event) => event.name === 'native.checkpoint')).toHaveLength(2);
  expect(events.some((event) => event.name === 'operation.result')).toBe(false);
});

test('preserving a refused immutable request cancels its acknowledgment wait without claiming a failed durable save', async () => {
  const f = fixture();
  cleanup.push(f.close);
  let at = 100;
  const events: DiagnosticEvent[] = [];
  const source = f.client({
    diagnostics: observer(events),
    diagnosticNow: () => at,
    preservePendingOnFailure: true,
    persist: (capture) => {
      capture();
    },
  });
  source.resume();
  await turns();
  source.edit([write({ v: 'already accepted but acknowledgment lost' })]);
  await source.sync.persistNow();
  source.sync.retry();
  await turns();
  const request = source.submits()[0];
  await f.accept(request);
  // The client cannot know whether this receipt was committed. Its retained
  // identity remains recoverable even when a different failure ends replay.
  at = 145;
  source.sync.refuse('divergence');
  await turns();
  source.sync.refuse('stale');
  expect(source.sync.checkpoint().sent).toEqual(request);
  expect(f.storage.history).toHaveLength(1);
  expect(source.sync.state).toMatchObject({ pending: true, resyncing: true });
  source.sync.dispose();
  expect(events.filter((event) => event.name === 'operation.result')).toEqual([
    {
      name: 'operation.result',
      details: { operation: 'document-save-server-ack', outcome: 'cancelled', durationMs: 45 },
    },
  ]);
  expect(events.some((event) => event.name === 'sync.client.acknowledged')).toBe(false);
});

test('rebased save timing starts at the newly observed envelope and its oldest pending age remains unknown', async () => {
  const f = fixture();
  cleanup.push(f.close);
  let at = 100;
  const events: DiagnosticEvent[] = [];
  const source = f.client({ diagnostics: observer(events), diagnosticNow: () => at });
  source.resume();
  await turns();
  source.edit([write({ v: 'local' })]);
  const peer = await f.accept(
    { type: 'submit', mutationId: 'peer', baseRevision: 1, mutations: [write({ v: 'peer' }, 2)] },
    'peer',
  );
  at = 150;
  source.sync.receive({ type: 'edit', ...wire(peer.edit) });
  expect(source.sync.diagnosticQueue()).toEqual({ pendingCount: 1, oldestPendingAgeMs: null });
  at = 200;
  source.sync.retry();
  await turns();
  const request = source.submits()[0];
  const accepted = await f.accept(request);
  at = 225;
  source.sync.receive({
    type: 'ack',
    mutationId: request.mutationId,
    duplicate: false,
    ...wire(accepted.edit),
  });
  await turns();
  expect(events.filter((event) => event.name === 'operation.result')).toEqual([
    {
      name: 'operation.result',
      details: { operation: 'document-save-server-ack', outcome: 'success', durationMs: 25 },
    },
  ]);
});

test.each([false, true])(
  'a validated durable receipt succeeds before local replay fails (preserve=%s)',
  async (preservePendingOnFailure) => {
    const f = fixture();
    cleanup.push(f.close);
    let at = 100;
    const events: DiagnosticEvent[] = [];
    const source = f.client({
      diagnostics: observer(events),
      diagnosticNow: () => at,
      preservePendingOnFailure,
    });
    source.resume();
    await turns();
    source.edit([write({ v: 'durable despite local replay failure' })]);
    source.sync.retry();
    await turns();
    const request = source.submits()[0];
    const accepted = await f.accept(request);
    const durable = structuredClone({ unit: f.storage.unit, history: f.storage.history });
    const error = new Error('Local replay failed');
    const apply = vi.spyOn(NativeReplica.prototype, 'apply').mockImplementationOnce(() => {
      at = 200;
      throw error;
    });
    at = 150;
    source.sync.receive({
      type: 'ack',
      mutationId: request.mutationId,
      duplicate: false,
      ...wire(accepted.edit),
    });
    await turns();
    expect(apply).toHaveBeenCalledOnce();
    expect(source.failures).toEqual(['malformed']);
    expect(source.sync.state).toMatchObject({
      revision: 1,
      resyncing: true,
      pending: preservePendingOnFailure,
    });
    expect(source.sync.checkpoint().sent).toEqual(preservePendingOnFailure ? request : null);
    expect({ unit: f.storage.unit, history: f.storage.history }).toEqual(durable);
    source.sync.dispose();
    expect(events.filter((event) => event.name === 'operation.result')).toEqual([
      {
        name: 'operation.result',
        details: { operation: 'document-save-server-ack', outcome: 'success', durationMs: 50 },
      },
    ]);
    expect(events.filter((event) => event.name === 'sync.client.acknowledged')).toEqual([
      { name: 'sync.client.acknowledged', details: { duplicate: false } },
    ]);
  },
);

test.each(['unmatched', 'malformed', 'conflicting'] as const)(
  '%s acknowledgment cannot claim a durable save',
  async (condition) => {
    const f = fixture();
    cleanup.push(f.close);
    const events: DiagnosticEvent[] = [];
    const source = f.client({ diagnostics: observer(events) });
    source.resume();
    await turns();
    source.edit([write({ v: 'pending' })]);
    source.sync.retry();
    await turns();
    const request = source.submits()[0];
    const accepted = await f.accept(request);
    if (condition === 'conflicting')
      source.sync.receive({ type: 'edit', ...wire(accepted.edit), hash: 'a'.repeat(64) });
    source.sync.receive({
      type: 'ack',
      mutationId: condition === 'unmatched' ? 'unmatched' : request.mutationId,
      duplicate: false,
      ...wire(accepted.edit),
      ...(condition === 'malformed' ? { hash: 'invalid' } : {}),
    });
    await turns();
    source.sync.dispose();
    expect(
      events.some(
        (event) => event.name === 'operation.result' && event.details.outcome === 'success',
      ),
    ).toBe(false);
    expect(events.some((event) => event.name === 'sync.client.acknowledged')).toBe(false);
    expect(f.storage.history).toHaveLength(1);
  },
);

test('resync emits fixed reason, pending count and duration only when its preserved checkpoint settles', async () => {
  const f = fixture();
  cleanup.push(f.close);
  const events: DiagnosticEvent[] = [];
  const entered = Promise.withResolvers<void>();
  const settled = Promise.withResolvers<void>();
  let hold = false,
    at = 100;
  const source = f.client({
    diagnostics: observer(events),
    diagnosticNow: () => at,
    preservePendingOnFailure: true,
    persist: async (capture) => {
      capture();
      if (hold) {
        entered.resolve();
        await settled.promise;
      }
    },
  });
  source.edit([write({ v: 'retained' })]);
  await source.sync.persistNow();
  hold = true;
  source.sync.refuse('stale');
  await entered.promise;
  expect(events.some((event) => event.name === 'sync.client.resync')).toBe(false);
  at = 125;
  settled.resolve();
  await turns();
  expect(events.filter((event) => event.name === 'sync.client.resync')).toEqual([
    {
      name: 'sync.client.resync',
      details: {
        reason: 'stale',
        outcome: 'handed-off',
        durationMs: 25,
        pendingCount: 1,
        oldestPendingAgeMs: 0,
      },
    },
  ]);
  expect(events.filter((event) => event.name === 'sync.edit.resync')).toEqual([
    {
      name: 'sync.edit.resync',
      metric: { kind: 'counter', unit: 'count', value: 1 },
      details: { reason: 'retention' },
    },
  ]);
  expect(source.failures).toEqual(['stale']);
  expect(source.sync.checkpoint().buffer).toHaveLength(1);
});

test('restored or rebased work has unknown age instead of a fabricated client clock', async () => {
  const f = fixture();
  cleanup.push(f.close);
  const events: DiagnosticEvent[] = [];
  const first = f.client();
  first.edit([write({ v: 'retained' })]);
  const restored = f.client({ checkpoint: first.sync.checkpoint(), diagnostics: observer(events) });
  expect(restored.sync.diagnosticQueue()).toEqual({ pendingCount: 1, oldestPendingAgeMs: null });
  restored.resume();
  await turns();
  expect(restored.sync.diagnosticQueue()).toEqual({ pendingCount: 1, oldestPendingAgeMs: null });
});

test.each(['disabled', 'throwing-source', 'throwing-sink', 'enabled'] as const)(
  '%s diagnostics preserve exact native content, durable history and save convergence',
  async (mode) => {
    const f = fixture();
    cleanup.push(f.close);
    const diagnostics: DiagnosticSource | undefined =
      mode === 'disabled'
        ? undefined
        : mode === 'throwing-source'
          ? () => {
              throw new Error('source unavailable');
            }
          : () => ({
              sink: () => {
                if (mode === 'throwing-sink') throw new Error('sink unavailable');
              },
              context: { component: 'editor' },
            });
    const source = f.client({ diagnostics });
    const peer = f.client({ diagnostics });
    source.resume();
    peer.resume();
    await turns();
    source.edit([write({ v: 'identical' })]);
    source.sync.retry();
    await turns();
    const request = source.submits()[0];
    const result = await f.accept(request);
    source.sync.receive({
      type: 'ack',
      mutationId: request.mutationId,
      duplicate: false,
      ...wire(result.edit),
    });
    peer.sync.receive({ type: 'edit', ...wire(result.edit) });
    await turns();
    expect(source.sync.state).toMatchObject({ pending: false, revision: 2, resyncing: false });
    expect(peer.sync.state).toMatchObject({ pending: false, revision: 2, resyncing: false });
    expect(source.live.snapshot()).toEqual(peer.live.snapshot());
    // The native resource export omits the protocol revision; bind it to the
    // client's verified revision while comparing every document/resource byte.
    expect({ ...source.live.snapshot(), rev: source.sync.confirmedRevision }).toEqual(
      f.storage.unit.snapshot,
    );
    expect(f.storage.history).toHaveLength(1);
  },
);
