import { expect, test } from 'vitest';
import { createInterceptorKey, InterceptorManager } from '@univerjs/core';
import type { IMutationInfo, IUniverInstanceService } from '@univerjs/core';
import { observeCompression } from '../../web/offline/observeCompression.ts';
import { RecoveryLedger } from '../../web/offline/RecoveryLedger.ts';
import { OfflineAccess } from '../../web/offline/OfflineAccess.ts';

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

function guardedFixture() {
  const f = fixture();
  const access = new OfflineAccess(
    {
      origin: 'https://localhost:3103',
      accountId: 'owner',
      itemId: 'item',
      unitId: 'unit',
      kind: 'sheet',
      access: 'owner',
      sdkVersion: '1.1.0',
      schema: 1,
      revisionOffset: 0,
    },
    async () => {
      throw new Error('No remote approval in this fixture');
    },
  );
  const record = {
    unitID: 'unit',
    userId: 'owner',
    type: 2,
    rev: 1,
    awaitingChangeset: null,
    mutations: [{ id: 'fixture.mutation', params: { unitId: 'unit', compressed: true } }],
  };
  const ledger = new RecoveryLedger(access, 1, record, () => 'owner');
  return { ...f, access, ledger, record, input: ledger.readForSDK().mutations };
}
test('guarded public decompression transfers exact singleton provenance and preserves originals', () => {
  const f = guardedFixture();
  const output = [{ id: f.input[0].id, params: { unitId: 'unit', expanded: true } }];
  let calls = 0;
  f.manager.intercept(f.point, {
    handler() {
      calls++;
      return output;
    },
  });
  const stop = observeCompression(f.service, f.observer, f.ledger);
  try {
    expect(f.service.interceptor.fetchThroughInterceptors(f.point)(f.input, null)).toBe(output);
    const claim = f.ledger.claim(output[0].id, output[0].params)!;
    f.ledger.succeed(claim, true);
    expect(f.ledger.readForSDK()).toEqual(f.record);
    f.ledger.assertComplete();
    expect(calls).toBe(1);
    expect(f.access.state.recovered).toBe(false);
  } finally {
    stop();
    f.access.dispose();
  }
});
test.each(['before', 'during', 'replaced', 'disposed'])(
  '%s cleanup/replacement prevents guarded APPLY from returning for dispatch',
  (mode) => {
    const f = guardedFixture();
    let calls = 0;
    let stop = () => {};
    f.manager.intercept(f.point, {
      handler(value) {
        calls++;
        if (mode === 'during') stop();
        return value;
      },
    });
    stop = observeCompression(f.service, f.observer, f.ledger);
    const retained = f.service.interceptor;
    const execute = retained.fetchThroughInterceptors(f.point);
    if (mode === 'before') stop();
    if (mode === 'replaced') f.service.interceptor = f.manager;
    if (mode === 'disposed') retained.dispose();
    try {
      expect(() => execute(f.input, null)).toThrow();
      expect(calls).toBe(mode === 'during' ? 1 : 0);
      expect(f.access.mayReadLocal).toBe(false);
      expect(() => retained.fetchThroughInterceptors(f.point)(f.input, null)).toThrow();
      expect(f.ledger.accounting()).toMatchObject({ phase: 'failed', applied: 0 });
    } finally {
      stop();
      f.access.dispose();
    }
  },
);
test.each(['begin', 'pipeline', 'finish'])(
  '%s failure is enforced outside the passive observer boundary',
  (mode) => {
    const f = guardedFixture();
    const failure = new Error('original pipeline error');
    let calls = 0;
    f.manager.intercept(f.point, {
      handler() {
        calls++;
        if (mode === 'pipeline') throw failure;
        return [];
      },
    });
    const stop = observeCompression(f.service, f.observer, f.ledger);
    try {
      const invoke = () =>
        f.service.interceptor.fetchThroughInterceptors(f.point)(
          mode === 'begin' ? [...f.input, structuredClone(f.input[0])] : f.input,
          null,
        );
      if (mode === 'pipeline') expect(invoke).toThrow(failure);
      else expect(invoke).toThrow();
      expect(calls).toBe(mode === 'begin' ? 0 : 1);
      expect(f.ledger.accounting()).toMatchObject({ phase: 'failed', applied: 0 });
      expect(f.access.mayReadLocal).toBe(false);
      expect(f.record.mutations[0].params.compressed).toBe(true);
    } finally {
      stop();
      f.access.dispose();
    }
  },
);
test('unregistered baseline transformations remain unclaimed under the guard', () => {
  const f = guardedFixture();
  const baseline = structuredClone(f.input);
  const stop = observeCompression(f.service, f.observer, f.ledger);
  try {
    const output = f.service.interceptor.fetchThroughInterceptors(f.point)(baseline, null)!;
    expect(output).toBe(baseline);
    expect(f.ledger.inspectIdentity(output[0].params)).toBeUndefined();
    expect(f.ledger.accounting()).toEqual({ expected: 1, applied: 0, phase: 'recovering' });
  } finally {
    stop();
    f.access.dispose();
  }
});

test.each(['cleanup', 'replacement'])(
  'ownership loss during finish (%s) cannot return output for dispatch',
  (mode) => {
    const f = guardedFixture();
    let stop = () => {};
    const guard = {
      beginTransform: f.ledger.beginTransform.bind(f.ledger),
      rejectTransform: f.ledger.rejectTransform.bind(f.ledger),
      finishTransform: (...args: Parameters<RecoveryLedger['finishTransform']>) => {
        f.ledger.finishTransform(...args);
        if (mode === 'cleanup') stop();
        else f.service.interceptor = f.manager;
        return undefined;
      },
    };
    stop = observeCompression(f.service, f.observer, guard);
    try {
      expect(() =>
        f.service.interceptor.fetchThroughInterceptors(f.point)(f.input, null),
      ).toThrow();
      expect(f.ledger.accounting()).toMatchObject({ phase: 'failed', applied: 0 });
      expect(f.access.mayReadLocal).toBe(false);
    } finally {
      stop();
      f.access.dispose();
    }
  },
);
