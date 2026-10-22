import { expect, test, vi } from 'vitest';
import { DocStateEmitService } from '@univerjs/docs';
import type { IDocStateChangeInfo } from '@univerjs/docs';
import { docPendingChanges } from '../../web/docPending.ts';

function fixture() {
  const states = new DocStateEmitService();
  const batches = new DocStateEmitService();
  let queued: IDocStateChangeInfo[] = [];
  const change: IDocStateChangeInfo = {
    unitId: 'document',
    commandId: 'doc.mutation.rich-text-editing',
    trigger: 'doc.command.insert-text',
    redoState: { actions: [], textRanges: [] },
    undoState: { actions: [], textRanges: [] },
    debounce: true,
  };
  const pending = docPendingChanges(change.unitId, states, {
    docStateChange$: batches.docStateChangeParams$,
    getStateCache: () => ({ history: [], collaboration: queued }),
  });
  return {
    pending,
    states,
    batches,
    change,
    queue() {
      queued = [change];
    },
    edit() {
      queued.push(change);
      states.emitStateChangeInfo(change);
    },
    submit() {
      queued = [];
      batches.emitStateChangeInfo(change);
    },
  };
}

test('a cached Doc edit is pending before attachment and local edits notify synchronously', () => {
  const f = fixture();
  f.queue();
  expect(f.pending.pending()).toBe(true);
  const notified = vi.fn(() => expect(f.pending.pending()).toBe(true));
  const stop = f.pending.subscribe(notified);
  expect(notified).not.toHaveBeenCalled();
  f.edit();
  expect(notified).toHaveBeenCalledTimes(1);
  stop();
});

test('remote, no-history and unrelated Doc events do not claim new local work', () => {
  const f = fixture();
  const notified = vi.fn();
  const stop = f.pending.subscribe(notified);
  for (const change of [
    { ...f.change, unitId: 'other-document' },
    { ...f.change, isSync: true },
    { ...f.change, noHistory: true },
  ])
    f.states.emitStateChangeInfo(change);
  f.batches.emitStateChangeInfo({ ...f.change, unitId: 'other-document' });
  f.batches.emitStateChangeInfo({ ...f.change, noHistory: true });
  expect(notified).not.toHaveBeenCalled();
  expect(f.pending.pending()).toBe(false);
  stop();
});

test('an emptied native queue stays pending through all batch subscribers before sampling acknowledgement', async () => {
  const f = fixture();
  let synchronized = true;
  const observations: { pending: boolean; synchronized: boolean }[] = [];
  const stop = f.pending.subscribe(() => {
    observations.push({ pending: f.pending.pending(), synchronized });
  });
  f.edit();
  // Register the receiver after the fence: releasing based on queue emptiness
  // inside our earlier callback would observe the previous SYNCED status.
  const receiver = f.batches.docStateChangeParams$.subscribe((change) => {
    if (change) synchronized = false;
  });
  f.submit();
  expect(f.pending.pending()).toBe(true);
  expect(observations).toEqual([
    { pending: true, synchronized: true },
    { pending: true, synchronized: true },
  ]);
  await Promise.resolve();
  expect(observations.at(-1)).toEqual({ pending: false, synchronized: false });
  expect(observations.every((state) => state.pending || !state.synchronized)).toBe(true);
  receiver.unsubscribe();
  stop();
});

test('new typing during a batch handoff cannot inherit the older empty queue', async () => {
  const f = fixture();
  const notified = vi.fn();
  const stop = f.pending.subscribe(notified);
  f.edit();
  f.submit();
  f.edit();
  await Promise.resolve();
  expect(f.pending.pending()).toBe(true);
  f.submit();
  await Promise.resolve();
  expect(f.pending.pending()).toBe(false);
  stop();
});

test('synchronous batches finish their handoff and disposal cancels late notifications', async () => {
  const f = fixture();
  const notified = vi.fn();
  const stop = f.pending.subscribe(notified);
  f.submit();
  f.states.emitStateChangeInfo({ ...f.change, debounce: false });
  expect(f.pending.pending()).toBe(true);
  await Promise.resolve();
  expect(f.pending.pending()).toBe(false);
  f.submit();
  stop();
  const count = notified.mock.calls.length;
  await Promise.resolve();
  f.edit();
  expect(notified).toHaveBeenCalledTimes(count);
});
