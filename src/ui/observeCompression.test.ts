import { expect, test } from 'vitest';
import { createInterceptorKey, InterceptorManager } from '@univerjs/core';
import type { IMutationInfo, IUniverInstanceService } from '@univerjs/core';
import { observeCompression } from '../../web/offline/observeCompression.ts';

function fixture() {
  const point = createInterceptorKey<IMutationInfo[], null>('APPLY');
  const manager = new InterceptorManager({
    COMPRESS_MUTATION_APPLY: point,
    COMPRESS_MUTATION_SEND: createInterceptorKey<IMutationInfo[], IUniverInstanceService>('SEND'),
  });
  const service = { interceptor: manager };
  const observations: { stage: string; value: unknown }[] = [];
  let failed = 0;
  const observer = {
    apply: (stage: 'input' | 'output', value: unknown) => {
      observations.push({ stage, value });
    },
    failed: () => {
      failed++;
    },
  };
  return { point, manager, service, observations, observer, failed: () => failed };
}
test('a filtered terminal pipeline runs exactly once and exposes its exact output object', () => {
  const f = fixture();
  let first = 0,
    terminal = 0,
    excluded = 0,
    unreachable = 0;
  const output = [{ id: 'mutation', params: { unitId: 'unit', decompressed: true } }];
  const skip = {
    priority: 3,
    handler() {
      excluded++;
      throw new Error('filtered out');
    },
  };
  f.manager.intercept(f.point, skip);
  f.manager.intercept(f.point, {
    priority: 2,
    handler(value, _context, next) {
      first++;
      return next(value);
    },
  });
  f.manager.intercept(f.point, {
    priority: 1,
    handler() {
      terminal++;
      return output;
    },
  });
  f.manager.intercept(f.point, {
    priority: 0,
    handler() {
      unreachable++;
      throw new Error('after terminal');
    },
  });
  const stop = observeCompression(f.service, f.observer);
  const input = [{ id: 'mutation', params: { unitId: 'unit' } }];
  const execute = f.service.interceptor.fetchThroughInterceptors(
    f.point,
    (interceptor) => interceptor !== skip,
  );
  expect(execute(input, null)).toBe(output);
  expect({ first, terminal, excluded, unreachable }).toEqual({
    first: 1,
    terminal: 1,
    excluded: 0,
    unreachable: 0,
  });
  expect(f.observations[0].value).toBe(input);
  expect(f.observations[1].value).toBe(output);
  expect(f.observations.map((entry) => entry.stage)).toEqual(['input', 'output']);
  stop();
  expect(f.service.interceptor).toBe(f.manager);
  execute(input, null);
  expect(f.observations).toHaveLength(2);
});
test('the pipeline error retains identity and is neither retried nor replaced', () => {
  const f = fixture(),
    failure = new Error('pipeline failed');
  let calls = 0;
  f.manager.intercept(f.point, {
    handler() {
      calls++;
      throw failure;
    },
  });
  const stop = observeCompression(f.service, f.observer);
  try {
    expect(() => f.service.interceptor.fetchThroughInterceptors(f.point)([], null)).toThrow(
      failure,
    );
    expect(calls).toBe(1);
    expect(f.failed()).toBe(1);
    expect(f.observations.map((entry) => entry.stage)).toEqual(['input']);
  } finally {
    stop();
  }
});
test('passive observer failure leaves results and unrelated points intact', () => {
  const f = fixture(),
    input: IMutationInfo[] = [];
  const stop = observeCompression(f.service, {
    ...f.observer,
    apply() {
      throw new Error('observer');
    },
  });
  try {
    expect(f.service.interceptor.fetchThroughInterceptors(f.point)(input, null)).toBe(input);
    expect(f.failed()).toBe(2);
    expect(
      f.service.interceptor.fetchThroughInterceptors(
        f.manager.getInterceptPoints().COMPRESS_MUTATION_SEND,
      )(input, {} as IUniverInstanceService),
    ).toBe(input);
    expect(f.failed()).toBe(2);
    expect(() => observeCompression(f.service, f.observer)).toThrow(/already/);
  } finally {
    stop();
  }
});

test('stale repeated cleanup cannot release another observer installation', () => {
  const f = fixture();
  const first = observeCompression(f.service, f.observer);
  first();
  const second = observeCompression(f.service, f.observer);
  try {
    first();
    expect(() => observeCompression(f.service, f.observer)).toThrow(/already/);
  } finally {
    second();
  }
  expect(f.service.interceptor).toBe(f.manager);
});
