import { afterEach, expect, test, vi } from 'vitest';
import { Autosave, SaveFailure } from './autosave.ts';
import type { SaveRequest } from './autosave.ts';
afterEach(() => vi.useRealTimers());
test('edits made during a save remain dirty and save next with the acknowledged revision', async () => {
  vi.useFakeTimers();
  let finish!: (value: { revision: number }) => void;
  const send = vi
    .fn<Autosave['send']>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({ revision: 2 });
  const state = vi.fn();
  const save = new Autosave(0, { cell: 0 }, send, state);
  save.changed({ cell: 1 });
  const flushing = save.flush();
  save.changed({ cell: 2 });
  finish({ revision: 1 });
  await flushing;
  expect(save.dirty).toBe(true);
  await vi.runAllTimersAsync();
  expect(send.mock.calls.map(([request]) => [request.snapshot, request.revision])).toEqual([
    [{ cell: 1 }, 0],
    [{ cell: 2 }, 1],
  ]);
  expect(save.dirty).toBe(false);
  expect(state.mock.lastCall?.[0]).toMatchObject({ dirty: false, message: 'All changes saved.' });
  save.dispose();
});
test('offline/lost-response retries retain the exact write ID and payload before newer edits', async () => {
  vi.useFakeTimers();
  const requests: SaveRequest[] = [];
  const send = vi.fn<Autosave['send']>().mockImplementation(async (request) => {
    requests.push(request);
    if (requests.length === 1) throw new TypeError('offline');
    return { revision: requests.length - 1 };
  });
  const state = vi.fn();
  const save = new Autosave(0, {}, send, state);
  save.changed({ cell: 'first' });
  await save.flush();
  expect(state.mock.lastCall?.[0]).toMatchObject({ dirty: true, failed: true });
  save.changed({ cell: 'newer' });
  await save.flush();
  expect(requests[1]).toEqual(requests[0]);
  await vi.runAllTimersAsync();
  expect(requests[2].snapshot).toEqual({ cell: 'newer' });
  expect(requests[2].revision).toBe(1);
  expect(save.dirty).toBe(false);
  save.dispose();
});
test('conflicts stay visibly unsaved and cannot automatically overwrite another writer', async () => {
  vi.useFakeTimers();
  const send = vi
    .fn<Autosave['send']>()
    .mockRejectedValue(new SaveFailure(409, 'Newer version; changes not saved.'));
  const state = vi.fn();
  const save = new Autosave(4, {}, send, state);
  save.changed({ cell: 5 });
  await save.flush();
  save.changed({ cell: 6 });
  await vi.runAllTimersAsync();
  expect(send).toHaveBeenCalledTimes(1);
  expect(save.dirty).toBe(true);
  expect(state.mock.lastCall?.[0]).toEqual({
    dirty: true,
    message: 'Newer version; changes not saved.',
    failed: true,
  });
  save.dispose();
});
test('disposal cancels retry work and never reports a failed pending save as successful', async () => {
  vi.useFakeTimers();
  const send = vi.fn<Autosave['send']>().mockRejectedValue(new Error('offline'));
  const state = vi.fn();
  const save = new Autosave(0, {}, send, state);
  save.changed({ cell: 1 });
  await save.flush();
  save.dispose();
  await vi.runAllTimersAsync();
  expect(send).toHaveBeenCalledTimes(1);
  expect(state.mock.lastCall?.[0].dirty).toBe(true);
});
test('session expiry preserves explicit unsaved guidance and pending edits for a signed-in retry', async () => {
  vi.useFakeTimers();
  const send = vi
    .fn<Autosave['send']>()
    .mockRejectedValueOnce(new SaveFailure(401, 'Sign in to continue.'))
    .mockResolvedValue({ revision: 1 });
  const state = vi.fn();
  const save = new Autosave(0, {}, send, state);
  save.changed({ cell: 'preserve me' });
  await save.flush();
  await vi.runAllTimersAsync();
  expect(send).toHaveBeenCalledTimes(1);
  expect(state.mock.lastCall?.[0]).toEqual({
    dirty: true,
    failed: true,
    message: 'Changes are not saved. Keep this tab open. Sign in to continue.',
  });
  save.retry();
  await vi.runAllTimersAsync();
  expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
  expect(save.dirty).toBe(false);
  save.dispose();
});
