import { afterEach, expect, test, vi } from 'vitest';
import { FormulaAdmission, FORMULA_QUEUE_WAIT_MS, FormulaQueueTimeout } from './admission.ts';

afterEach(() => vi.useRealTimers());

test('FIFO reserves promotion atomically before a later background read; two waiting inputs only', async () => {
  const admission = new FormulaAdmission();
  const release = await admission.acquire(() => {});
  const order: string[] = [];
  const second = admission
    .acquire(() => {})
    .then((done) => {
      order.push('background');
      return done;
    });
  const save = admission
    .acquire(() => {})
    .then((done) => {
      order.push('save');
      return done;
    });
  expect(() => admission.acquire(() => {})).toThrow(/Another formula/);
  release();
  const late = admission
    .acquire(() => {})
    .then((done) => {
      order.push('later background');
      return done;
    });
  (await second)();
  (await save)();
  (await late)();
  expect(order).toEqual(['background', 'save', 'later background']);
});

test('initial authorization runs before capacity and promotion rechecks it without starving next waiter', async () => {
  const admission = new FormulaAdmission();
  const release = await admission.acquire(() => {});
  let allowed = true;
  const verify = vi.fn(() => {
    if (!allowed) throw new Error('revoked');
  });
  const revoked = admission.acquire(verify);
  const rejected = expect(revoked).rejects.toThrow('revoked');
  const next = admission.acquire(() => {});
  expect(() =>
    admission.acquire(() => {
      throw new Error('unauthorized');
    }),
  ).toThrow('unauthorized');
  allowed = false;
  release();
  await rejected;
  (await next)();
  expect(verify).toHaveBeenCalledTimes(2);
  (await admission.acquire(() => {}))();
});

test('cancelled head removes its timer and listener; expired waits do not release active work', async () => {
  vi.useFakeTimers();
  const admission = new FormulaAdmission();
  const release = await admission.acquire(() => {});
  const controller = new AbortController();
  const head = admission.acquire(() => {}, controller.signal);
  const rejected = expect(head).rejects.toMatchObject({ name: 'AbortError' });
  const next = admission.acquire(() => {});
  const expired = expect(next).rejects.toBeInstanceOf(FormulaQueueTimeout);
  controller.abort();
  await rejected;
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(FORMULA_QUEUE_WAIT_MS);
  await expired;
  let promoted = false;
  const later = admission
    .acquire(() => {})
    .then((done) => {
      promoted = true;
      return done;
    });
  await Promise.resolve();
  expect(promoted).toBe(false);
  release();
  (await later)();
  expect(vi.getTimerCount()).toBe(0);
});

test('cancelling an active caller never releases its permit; release is idempotent', async () => {
  const admission = new FormulaAdmission();
  const controller = new AbortController();
  const release = await admission.acquire(() => {}, controller.signal);
  controller.abort();
  let started = false;
  const next = admission
    .acquire(() => {})
    .then((done) => {
      started = true;
      return done;
    });
  await Promise.resolve();
  expect(started).toBe(false);
  release();
  const secondRelease = await next;
  release();
  let thirdStarted = false;
  const third = admission
    .acquire(() => {})
    .then((done) => {
      thirdStarted = true;
      return done;
    });
  await Promise.resolve();
  expect(thirdStarted).toBe(false);
  secondRelease();
  (await third)();
});

test('promotion rejects an expired waiter even when its timer has not had an event-loop turn', async () => {
  vi.useFakeTimers();
  const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
  const admission = new FormulaAdmission();
  const release = await admission.acquire(() => {});
  try {
    const verify = vi.fn();
    const waiting = admission.acquire(verify);
    const expired = expect(waiting).rejects.toBeInstanceOf(FormulaQueueTimeout);
    clock.mockReturnValue(FORMULA_QUEUE_WAIT_MS);
    release();
    await expired;
    expect(verify).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    (await admission.acquire(() => {}))();
  } finally {
    release();
    clock.mockRestore();
  }
});
