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
