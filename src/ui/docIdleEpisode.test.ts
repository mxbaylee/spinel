import { expect, test } from 'vitest';
import { terminalIdleEpisode } from './docIdleEpisode.ts';
import type { DocTerminalState, EpochDocFlush } from './docIdleEpisode.ts';
import type { DocFlushObservation } from './boundedDocHistory.ts';

function fixture() {
  const terminal: DocTerminalState = {
    epoch: 'epoch',
    generation: 'generation',
    unitId: 'doc',
    timeOrigin: 1,
    completedStates: 2086,
    observedAt: 100,
    pending: { history: 6, collaboration: 6 },
  };
  const common = {
    unitId: 'doc',
    epoch: 'epoch',
    generation: 'generation',
    completedStates: 2086,
    outcome: 'returned' as const,
  };
  const phases: EpochDocFlush[] = [
    {
      ...common,
      sequence: 1,
      phase: 'history',
      origin: 'history-timer',
      startedAt: 400,
      endedAt: 410,
      before: { history: 6, collaboration: 6 },
      after: { history: 0, collaboration: 6 },
    },
    {
      ...common,
      sequence: 2,
      phase: 'collaboration',
      origin: 'collaboration-timer',
      startedAt: 410,
      endedAt: 420,
      before: { history: 0, collaboration: 6 },
      after: { history: 0, collaboration: 0 },
    },
  ];
  return {
    terminal,
    phases,
    evaluate: (policy: Parameters<typeof terminalIdleEpisode>[3] = []) =>
      terminalIdleEpisode(terminal, 500, phases, policy),
  };
}

test('two individually cheap timer phases retain the full paired duration and intercallback gap', () => {
  const f = fixture();
  expect(f.evaluate()).toMatchObject({
    durationMs: 20,
    origin: 'native-timers',
    nativeSequences: [1, 2],
  });
  expect(f.evaluate().durationMs).toBeGreaterThan(16);
  f.phases[0].endedAt = 401;
  f.phases[1].startedAt = 430;
  f.phases[1].endedAt = 431;
  expect(f.evaluate().durationMs).toBe(31);
  f.phases.push({
    ...f.phases[1],
    sequence: 3,
    startedAt: 450,
    endedAt: 450,
    before: { history: 0, collaboration: 0 },
    after: { history: 0, collaboration: 0 },
  });
  expect(f.evaluate().durationMs).toBe(31);
});

test('policy and mixed ownership preserve the complete outer interval without duplicate samples', () => {
  for (const mixed of [false, true]) {
    const f = fixture();
    if (!mixed) {
      f.phases[0].origin = 'policy-idle';
      f.phases[0].sequence = 2;
    }
    f.phases[1].sequence = mixed ? 4 : 3;
    f.phases[1].origin = 'policy-idle';
    const startedAt = mixed ? 409 : 399;
    const durationMs = mixed ? 20 : 34.3;
    f.phases.push({
      ...f.phases[mixed ? 1 : 0],
      phase: 'pair',
      sequence: mixed ? 2 : 1,
      startedAt,
      endedAt: startedAt + durationMs - 0.1,
      origin: 'policy-idle',
      after: { history: 0, collaboration: 0 },
    });
    const policy: DocFlushObservation = {
      outcome: 'success',
      reason: 'idle',
      startedAt,
      durationMs,
      history: mixed ? 0 : 6,
      collaboration: 6,
      quietForMs: 300,
    };
    const episode = f.evaluate([policy]);
    expect(episode.durationMs).toBeCloseTo(mixed ? 29 : 34.3);
    expect(episode.origin).toBe(mixed ? 'mixed' : 'policy-idle');
    expect(episode.durationMs).toBeGreaterThan(16);
    expect(episode.nativeSequences).toEqual(mixed ? [1, 4] : [2, 3]);
    // Retained schema-5 rows have no diagnostic outcome; native phases still
    // independently establish that every member returned successfully.
    const historical: Parameters<typeof terminalIdleEpisode>[3][number] = { ...policy };
    delete historical.outcome;
    expect(f.evaluate([historical])).toEqual(episode);
  }
});

test('missing, interrupted, unrecognized and malformed terminal phases cannot pass', () => {
  const mutations: Array<(f: ReturnType<typeof fixture>) => void> = [
    (f) => {
      f.phases.length = 0;
    },
    (f) => {
      f.phases.pop();
    },
    (f) => {
      f.phases[1].sequence = 1;
    },
    (f) => {
      f.phases[1].sequence = 1.5;
    },
    (f) => {
      f.phases.unshift({
        ...f.phases[0],
        sequence: 3,
        startedAt: 50,
        endedAt: 51,
        completedStates: 2000,
      });
    },
    (f) => {
      f.phases.push({ ...f.phases[1], sequence: 3, startedAt: NaN });
    },
    (f) => {
      f.phases[1].unitId = 'other';
    },
    (f) => {
      f.phases[1].epoch = 'stale';
    },
    (f) => {
      f.phases[1].generation = 'stale';
    },
    (f) => {
      f.phases[1].completedStates++;
    },
    (f) => {
      f.phases[1].before.collaboration++;
    },
    (f) => {
      f.phases[0].after.history = 1;
    },
    (f) => {
      f.phases[1].outcome = 'threw';
    },
    (f) => {
      f.phases[1].startedAt = NaN;
    },
    (f) => {
      f.phases[1].endedAt = Infinity;
    },
    (f) => {
      f.phases[1].endedAt = 1000;
    },
    (f) => {
      f.phases[1].startedAt = 409;
    },
    (f) => {
      f.phases.push({ ...f.phases[1], sequence: 3 });
    },
    ...(
      [
        'public-flush',
        'segment-boundary',
        'immediate',
        'history-command',
        'policy-capacity',
        'unknown',
        'policy-idle',
      ] as const
    ).map((origin) => (f: ReturnType<typeof fixture>) => {
      f.phases[1].origin = origin;
    }),
  ];
  for (const [index, change] of mutations.entries()) {
    const f = fixture();
    change(f);
    expect(() => f.evaluate(), `mutation ${index}`).toThrow(/idle-evidence/);
  }
});

test('policy outer counts and unique containing pairs must reconcile with native phases', () => {
  for (const kind of ['outer-count', 'before-count', 'after-count', 'duplicate', 'failure']) {
    const f = fixture();
    f.phases.forEach((value) => {
      value.origin = 'policy-idle';
      value.sequence++;
    });
    const pair: EpochDocFlush = {
      ...f.phases[0],
      phase: 'pair',
      sequence: 1,
      startedAt: 399,
      endedAt: 421,
      after: { history: 0, collaboration: 0 },
    };
    f.phases.push(pair);
    const outer: DocFlushObservation[] = [
      {
        outcome: 'success',
        reason: 'idle',
        startedAt: 399,
        durationMs: 23,
        history: 6,
        collaboration: 6,
        quietForMs: 300,
      },
    ];
    if (kind === 'outer-count') outer[0].history = 1;
    if (kind === 'failure') outer[0].outcome = 'failure';
    if (kind === 'before-count') pair.before = { history: 1, collaboration: 6 };
    if (kind === 'after-count') pair.after = { history: 1, collaboration: 0 };
    if (kind === 'duplicate') {
      f.phases.push({ ...pair, sequence: 4 });
      outer.push({ ...outer[0] });
    }
    expect(() => f.evaluate(outer), kind).toThrow(/idle-evidence/);
  }
});

test('a quantized zero-duration timer preceding a policy pair is not its child', () => {
  const f = fixture();
  f.phases[0].endedAt = 400;
  f.phases[1] = {
    ...f.phases[1],
    sequence: 4,
    origin: 'policy-idle',
    startedAt: 400,
    endedAt: 401,
  };
  f.phases.push({ ...f.phases[1], sequence: 2, phase: 'pair', startedAt: 400, endedAt: 402 });
  expect(
    f.evaluate([
      {
        outcome: 'success',
        reason: 'idle',
        startedAt: 400,
        durationMs: 3,
        quietForMs: 300,
        history: 0,
        collaboration: 6,
      },
    ]),
  ).toMatchObject({ origin: 'mixed', durationMs: 3 });
});
