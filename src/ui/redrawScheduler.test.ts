import { expect, test } from 'vitest';
import { redrawScheduler } from './redrawScheduler.ts';
import type { RedrawClock } from './redrawScheduler.ts';

function fakeClock(firstHandle = 1) {
  let time = 0;
  let next = firstHandle;
  const frames = new Map<number, () => void>();
  const timers = new Map<number, { at: number; callback: () => void }>();
  const clock: RedrawClock = {
    now: () => time,
    requestFrame: (callback) => (frames.set(next, callback), next++),
    cancelFrame: (handle) => void frames.delete(handle),
    setTimer: (callback, ms) => (timers.set(next, { at: time + ms, callback }), next++),
    clearTimer: (handle) => void timers.delete(handle),
  };
  return {
    clock,
    pending: () => frames.size + timers.size,
    frame() {
      const [handle, callback] = frames.entries().next().value ?? [];
      if (handle !== undefined) frames.delete(handle);
      callback?.();
    },
    advance(ms: number) {
      time += ms;
      for (const [handle, timer] of Array.from(timers))
        if (timer.at <= time) {
          timers.delete(handle);
          timer.callback();
        }
    },
  };
}

test('the first request draws on the next frame, then requests inside the interval share one trailing draw (SPN-146)', () => {
  const env = fakeClock();
  let draws = 0;
  const scheduler = redrawScheduler(() => draws++, 150, env.clock);
  scheduler.schedule();
  scheduler.schedule();
  expect(env.pending()).toBe(1);
  env.frame();
  expect(draws).toBe(1);
  // A burst of 100 layout events within 150 ms, like one per key while typing.
  for (let key = 0; key < 100; key++) {
    env.advance(1);
    scheduler.schedule();
  }
  expect(draws).toBe(1);
  env.advance(60);
  expect(draws).toBe(2);
  expect(env.pending()).toBe(0);
});

test('a request after a quiet period draws on a frame again, and cancel drops pending work', () => {
  const env = fakeClock();
  let draws = 0;
  const scheduler = redrawScheduler(() => draws++, 150, env.clock);
  scheduler.runNow();
  env.advance(500);
  scheduler.schedule();
  expect(env.pending()).toBe(1);
  env.frame();
  expect(draws).toBe(2);
  scheduler.schedule();
  expect(env.pending()).toBe(1);
  scheduler.cancel();
  expect(env.pending()).toBe(0);
  env.advance(1000);
  expect(draws).toBe(2);
});

test('runNow supersedes a pending request and restarts the interval', () => {
  const env = fakeClock();
  let draws = 0;
  const scheduler = redrawScheduler(() => draws++, 150, env.clock);
  scheduler.schedule();
  scheduler.runNow();
  expect(draws).toBe(1);
  expect(env.pending()).toBe(0);
  scheduler.schedule();
  env.advance(100);
  expect(draws).toBe(1);
  env.advance(50);
  expect(draws).toBe(2);
});

test('a draw that requests another redraw gets it after the interval, not never or at once', () => {
  const env = fakeClock();
  let draws = 0;
  const scheduler = redrawScheduler(
    () => {
      if (draws++ === 0) scheduler.schedule();
    },
    150,
    env.clock,
  );
  scheduler.schedule();
  env.frame();
  expect(draws).toBe(1);
  expect(env.pending()).toBe(1);
  env.advance(149);
  expect(draws).toBe(1);
  env.advance(1);
  expect(draws).toBe(2);
});

test('a pending frame blocks a second request, and a clock whose handles start at 0 still works', () => {
  const env = fakeClock(0);
  let draws = 0;
  const scheduler = redrawScheduler(() => draws++, 150, env.clock);
  scheduler.schedule();
  env.advance(1000); // the frame has not fired yet; time passing must not add a timer
  scheduler.schedule();
  expect(env.pending()).toBe(1);
  env.frame();
  expect(draws).toBe(1);
  scheduler.schedule();
  expect(env.pending()).toBe(1); // handle 0 timer counts as pending
  scheduler.schedule();
  expect(env.pending()).toBe(1);
  env.advance(150);
  expect(draws).toBe(2);
});

test('a request partway through the interval draws at the interval end, not a full interval later', () => {
  const env = fakeClock();
  const times: number[] = [];
  let time = 0;
  const scheduler = redrawScheduler(() => times.push(time), 150, env.clock);
  scheduler.runNow();
  const step = (ms: number) => {
    time += ms;
    env.advance(ms);
  };
  step(100);
  scheduler.schedule();
  step(49);
  expect(times).toEqual([0]);
  step(1);
  expect(times).toEqual([0, 150]);
});

test('runNow while a frame is pending cancels the frame and draws exactly once', () => {
  const env = fakeClock();
  let draws = 0;
  const scheduler = redrawScheduler(() => draws++, 150, env.clock);
  scheduler.schedule();
  expect(env.pending()).toBe(1);
  scheduler.runNow();
  expect(draws).toBe(1);
  expect(env.pending()).toBe(0);
  env.frame();
  expect(draws).toBe(1);
});
