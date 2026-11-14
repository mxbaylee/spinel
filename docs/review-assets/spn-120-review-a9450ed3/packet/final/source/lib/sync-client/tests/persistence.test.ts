import { afterEach, expect, test, vi } from 'vitest';
import { NativeReplica } from '../index.ts';
import type { ClientCheckpoint, ClientCheckpointFactory } from '../index.ts';
import { book, fixture, turns, wire, write } from './fixture.ts';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
  vi.restoreAllMocks();
});

test('a delayed write captures the current revision and queue once, then keeps them coherent', async () => {
  const f = fixture();
  cleanup.push(() => f.close());
  const entered = Promise.withResolvers<void>();
  const admission = Promise.withResolvers<void>();
  const captured = Promise.withResolvers<void>();
  const committed = Promise.withResolvers<void>();
  const saved: ClientCheckpoint[] = [];
  let holdAdmission = false;
  let firstCapture!: ClientCheckpointFactory;
  const source = f.client({
    persist: async (capture) => {
      if (!holdAdmission) {
        capture();
        return;
      }
      const first = saved.length === 0;
      if (first) {
        firstCapture = capture;
        entered.resolve();
        await admission.promise;
      }
      const checkpoint = capture();
      saved.push(checkpoint);
      if (first) {
        captured.resolve();
        await committed.promise;
        expect(capture()).toBe(checkpoint);
      }
    },
  });
  source.resume();
  await source.sync.persistNow();
  holdAdmission = true;
  const snapshot = vi.spyOn(NativeReplica.prototype, 'snapshot');
  const first = write({ v: 'First' });
  const second = write({ v: 'Second' }, 1);
  const third = write({ v: 'Third' }, 2);
  source.edit([first]);
  try {
    await entered.promise;
    source.edit([second]);
    const remote = await f.accept(
      {
        type: 'submit',
        mutationId: 'peer',
        baseRevision: 1,
        mutations: [write({ v: 'Remote' }, 5)],
      },
      'peer',
    );
    source.sync.receive({ type: 'edit', ...wire(remote.edit) });
    expect(snapshot).not.toHaveBeenCalled();
    admission.resolve();
    await captured.promise;
    expect(snapshot).toHaveBeenCalledOnce();
    expect(saved[0]).toMatchObject({ revision: 2, sent: null, buffer: [[first], [second]] });
    expect((saved[0].snapshot as ReturnType<typeof book>).sheets.one.cellData![5][0].v).toBe(
      'Remote',
    );
    source.edit([third]);
    await turns();
    expect(saved).toHaveLength(1);
    expect(source.sync.state.localPersistence).toBe('saving');
    expect(firstCapture()).toBe(saved[0]);
    expect(saved[0].buffer).toEqual([[first], [second]]);
    expect(snapshot).toHaveBeenCalledOnce();
    committed.resolve();
    await source.sync.persistNow();
    expect(saved.at(-1)).toMatchObject({
      revision: 2,
      sent: null,
      buffer: [[first], [second], [third]],
    });
    expect(snapshot).toHaveBeenCalledTimes(saved.length);
    expect(source.sync.state.localPersistence).toBe('saved');
    expect(() => firstCapture()).toThrow();
    expect(snapshot).toHaveBeenCalledTimes(saved.length);
  } finally {
    admission.resolve();
    committed.resolve();
  }
});

test.each(['resolved', 'rejected'] as const)(
  'an unused checkpoint factory expires after its hook %s',
  async (outcome) => {
    const f = fixture();
    cleanup.push(() => f.close());
    let capture!: ClientCheckpointFactory;
    const source = f.client({
      persist: (value) => {
        capture = value;
        if (outcome === 'rejected') throw new Error('Store unavailable');
      },
    });
    const snapshot = vi.spyOn(NativeReplica.prototype, 'snapshot');
    if (outcome === 'resolved') await source.sync.persistNow();
    else await expect(source.sync.persistNow()).rejects.toMatchObject({ reason: 'unavailable' });
    expect(snapshot).not.toHaveBeenCalled();
    expect(() => capture()).toThrow();
    expect(snapshot).not.toHaveBeenCalled();
  },
);

test('checkpoint capture failure stays dirty and prevents send until a successful retry', async () => {
  const f = fixture();
  cleanup.push(() => f.close());
  const saved: ClientCheckpoint[] = [];
  const source = f.client({
    persist: (capture) => {
      saved.push(capture());
    },
  });
  source.resume();
  await source.sync.persistNow();
  saved.length = 0;
  const snapshot = vi.spyOn(NativeReplica.prototype, 'snapshot').mockImplementation(() => {
    throw new Error('Native snapshot unavailable');
  });
  const mutation = write({ v: 'Retain me' });
  source.edit([mutation]);
  await expect(source.sync.persistNow()).rejects.toMatchObject({ reason: 'unavailable' });
  expect(source.sync.state).toMatchObject({
    localPersistence: 'failed',
    pending: true,
    pendingMutations: 1,
    failure: 'unavailable',
  });
  expect(saved).toEqual([]);
  expect(source.submits()).toEqual([]);
  snapshot.mockRestore();
  await source.sync.persistNow();
  expect(saved.at(-1)!.buffer).toEqual([[mutation]]);
  source.sync.retry();
  await turns();
  expect(source.submits()).toHaveLength(1);
  expect(saved.at(-1)!.sent).toEqual(source.submits()[0]);
  expect(source.submits()[0].mutations).toEqual([mutation]);
  expect(source.sync.state.localPersistence).toBe('saved');
});
