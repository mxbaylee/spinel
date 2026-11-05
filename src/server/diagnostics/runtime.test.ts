import { expect, test, vi } from 'vitest';
import type { DiagnosticEvent, DiagnosticSink } from '@spinel/diagnostics';
import { RuntimeDiagnostics } from './runtime.ts';

function fixture() {
  let at = 10;
  let usage = { user: 1000, system: 2000 };
  const delay = {
    mean: 25_000_000,
    max: 50_000_000,
    enable: vi.fn(),
    disable: vi.fn(),
    reset: vi.fn(),
  };
  const sampler = new RuntimeDiagnostics({ now: () => at, cpu: () => usage, delay: () => delay });
  const events: DiagnosticEvent[] = [];
  const sink: DiagnosticSink = (event, context) => {
    expect(context).toEqual({ component: 'health' });
    events.push(event);
  };
  return {
    sampler,
    delay,
    sink,
    events,
    set(time: number, cpu: typeof usage) {
      at = time;
      usage = cpu;
    },
  };
}

test('runtime sampling converts cumulative CPU microseconds and histogram nanoseconds to exact windowed milliseconds', () => {
  const f = fixture();
  f.sampler.sample(f.sink);
  expect(f.events).toEqual([]);
  expect(f.delay.reset).not.toHaveBeenCalled();
  f.set(60_010, { user: 13_000, system: 6_000 });
  f.sampler.sample(f.sink);
  expect(f.events).toEqual([
    {
      name: 'runtime.cpu',
      metric: { kind: 'gauge', unit: 'milliseconds', value: 16 },
      details: { windowMs: 60_000 },
    },
    {
      name: 'runtime.event-loop',
      metric: { kind: 'gauge', unit: 'milliseconds', value: 25 },
      details: { statistic: 'mean', windowMs: 60_000 },
    },
    {
      name: 'runtime.event-loop',
      metric: { kind: 'gauge', unit: 'milliseconds', value: 50 },
      details: { statistic: 'max', windowMs: 60_000 },
    },
  ]);
  expect(f.delay.reset).toHaveBeenCalledTimes(1);
  f.set(90_010, { user: 16_000, system: 7_000 });
  f.sampler.sample(f.sink);
  expect(f.events[3]).toEqual({
    name: 'runtime.cpu',
    metric: { kind: 'gauge', unit: 'milliseconds', value: 4 },
    details: { windowMs: 30_000 },
  });
  f.sampler.close();
  f.sampler.sample(f.sink);
  expect(f.delay.disable).toHaveBeenCalledTimes(1);
  expect(f.events).toHaveLength(6);
});

test('unavailable samples and disabled or throwing observers never escape into health work', () => {
  const f = fixture();
  f.set(1010, { user: 2000, system: 2000 });
  expect(() =>
    f.sampler.sample(() => {
      throw new Error('observer');
    }),
  ).not.toThrow();
  f.set(2010, { user: 3000, system: 2000 });
  expect(() => f.sampler.sample(undefined)).not.toThrow();
  f.delay.mean = NaN;
  f.delay.max = Infinity;
  f.set(3010, { user: 2500, system: 1000 });
  f.sampler.sample(f.sink);
  expect(f.events).toEqual([]);
  f.delay.reset.mockImplementation(() => {
    throw new Error('histogram');
  });
  f.set(4010, { user: 4000, system: 4000 });
  expect(() => f.sampler.sample(f.sink)).not.toThrow();
  f.delay.disable.mockImplementation(() => {
    throw new Error('teardown');
  });
  expect(() => f.sampler.close()).not.toThrow();
  expect(
    () =>
      new RuntimeDiagnostics({
        cpu: () => {
          throw new Error('unavailable');
        },
        delay: () => f.delay,
      }),
  ).not.toThrow();
});

test('native histogram allocation failure disables sampling without becoming a startup failure', () => {
  const allocate = vi.fn(() => {
    throw new Error('native sampler allocation failed');
  });
  let sampler: RuntimeDiagnostics | undefined;
  expect(() => {
    sampler = new RuntimeDiagnostics({ delay: allocate });
  }).not.toThrow();
  expect(allocate).toHaveBeenCalledTimes(1);
  const sink = vi.fn();
  expect(() => sampler!.sample(sink)).not.toThrow();
  expect(() => sampler!.close()).not.toThrow();
  expect(sink).not.toHaveBeenCalled();
});
