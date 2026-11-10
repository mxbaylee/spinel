/**
 * Coalesces redraw requests: the first request after a quiet period draws on the next animation frame, and
 * requests inside the interval share one trailing draw when it elapses (SPN-146). The caller reports the
 * draw by calling `ran()` at its start; `cancel()` drops anything pending.
 */
export interface RedrawClock {
  now(): number;
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  setTimer(callback: () => void, ms: number): number;
  clearTimer(handle: number): void;
}

export const browserRedrawClock: RedrawClock = {
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
  setTimer: (callback, ms) => window.setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle),
};

export function redrawScheduler(
  draw: () => void,
  intervalMs: number,
  clock: RedrawClock = browserRedrawClock,
) {
  let frame: number | null = null;
  let timer: number | null = null;
  let last = -Infinity;
  const cancel = () => {
    if (frame !== null) clock.cancelFrame(frame);
    if (timer !== null) clock.clearTimer(timer);
    frame = null;
    timer = null;
  };
  const run = () => {
    cancel();
    last = clock.now();
    draw();
  };
  return {
    /** Request a redraw; does nothing while one is already pending. */
    schedule() {
      if (frame !== null || timer !== null) return;
      const wait = last + intervalMs - clock.now();
      if (wait > 0) timer = clock.setTimer(run, wait);
      else frame = clock.requestFrame(run);
    },
    /** Draw now (disconnects, deactivation); counts as the latest draw. */
    runNow: run,
    cancel,
  };
}
