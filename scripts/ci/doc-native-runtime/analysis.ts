import assert from 'node:assert/strict';
type Event = {
  name?: string;
  cat?: string;
  ph?: string;
  ts?: number;
  dur?: number;
  pid?: number;
  tid?: number;
  args?: unknown;
  [key: string]: unknown;
};
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
/** All observations and overlapping GC are retained; pauses are never subtracted. */
export function analyzeRuntime(observation: any, events: Event[]) {
  assert.equal(observation.complete, true);
  const data = observation.observation;
  assert.equal(data.finished, true);
  assert.equal(data.records.length, 32);
  const marks: any[] = [],
    intervals: any[] = [];
  let id = 0;
  for (const format of ['es', 'cjs'])
    for (const completed of [544, 672, 1440, 1984])
      for (const order of ['prior-candidate', 'candidate-prior'])
        for (const variant of order.split('-')) {
          const r = data.records[id];
          assert.deepEqual(
            [r.id, r.format, r.completed, r.order, r.variant],
            [id, format, completed, order, variant],
          );
          assert.deepEqual(
            r.sequences,
            (
              { 544: [32, 33], 672: [40, 41], 1440: [88, 89], 1984: [122, 123] } as Record<
                number,
                number[]
              >
            )[completed],
          );
          assert.ok(r.durationMs > 0);
          assert.equal(r.passed, true);
          assert.equal(r.cleanup, true);
          assert.equal(r.pairParity, true);
          assert.deepEqual(
            r.phases.map((p: any) => p.phase),
            ['history', 'collaboration'],
          );
          const ranges = [{ ...r, phase: 'whole' }, ...r.phases];
          for (const range of ranges) {
            for (const n of [
              range.first.time,
              range.began,
              range.ended,
              range.last.time,
              range.durationMs,
            ])
              assert.ok(finite(n));
            assert.ok(
              range.first.time <= range.began &&
                range.began <= range.ended &&
                range.ended <= range.last.time,
            );
            assert.ok(Math.abs(range.durationMs - (range.ended - range.began)) < 1e-7);
            const prefix = `spn146-runtime-${id}${range.phase === 'whole' ? '' : '-' + range.phase}`;
            assert.equal(range.first.name, prefix + '-start');
            assert.equal(range.last.name, prefix + '-end');
            marks.push(range.first, range.last);
            intervals.push({
              id,
              phase: range.phase,
              began: range.began,
              ended: range.ended,
              durationMs: range.durationMs,
            });
          }
          const [h, c] = r.phases;
          assert.ok(
            r.began <= h.first.time && h.last.time <= c.first.time && c.last.time <= r.ended,
          );
          if (id % 2 === 1) assert.deepEqual(data.records[id - 1].output, r.output);
          id++;
        }
  assert.equal(observation.gcControl.gcStart.name, 'spn146-runtime-gc-control-start');
  assert.equal(observation.gcControl.gcEnd.name, 'spn146-runtime-gc-control-end');
  assert.ok(observation.gcControl.gcEnd.time > observation.gcControl.gcStart.time);
  assert.ok(observation.gcControl.gcStart.time > data.records.at(-1).last.time);
  marks.push(observation.gcControl.gcStart, observation.gcControl.gcEnd);
  assert.equal(marks.length, 194);
  assert.equal(new Set(marks.map((m) => m.name)).size, 194);
  const offsets: number[] = [];
  let renderer: { pid: number; tid: number } | undefined;
  for (const mark of marks) {
    const matches = events.filter((e) => e.name === mark.name);
    assert.equal(matches.length, 1, mark.name);
    const event = matches[0]!;
    assert.ok(
      finite(event.ts) && Number.isSafeInteger(event.pid) && Number.isSafeInteger(event.tid),
    );
    assert.ok(event.cat?.split(',').includes('blink.user_timing'));
    renderer ??= { pid: event.pid!, tid: event.tid! };
    assert.deepEqual({ pid: event.pid, tid: event.tid }, renderer);
    offsets.push(event.ts / 1000 - mark.time);
  }
  const low = Math.min(...offsets),
    high = Math.max(...offsets);
  assert.ok(high - low <= 0.25, 'Marker clock offset exceeds0.25ms quantization bound');
  const thread = events
    .map((event, index) => ({ ...event, index }))
    .filter((e) => e.pid === renderer!.pid && e.tid === renderer!.tid);
  const gcName = (e: Event) =>
    e.cat?.split(',').includes('disabled-by-default-v8.gc') ||
    /(?:^|[._])GC(?:[._]|$)|(?:Major|Minor)GC|GarbageCollection/i.test(e.name ?? '');
  // Chromium's instant, flow and nestable-async records are context, not measured
  // pause intervals. Keep every record; never infer duration from link distances.
  // Phase authority and the original rejection are recorded in SPN-146.md.
  const gc = thread.filter(gcName);
  assert.ok(
    gc.every((e) => ['X', 'B', 'E', 'I', 's', 't', 'f', 'b', 'e', 'n'].includes(e.ph ?? '')),
    'Unsupported GC representation',
  );
  const gcDurationUnknown = gc.filter((e) => !['X', 'B', 'E'].includes(e.ph!));
  for (const e of gcDurationUnknown) {
    assert.ok(finite(e.ts) && e.dur === undefined, 'Malformed GC context record');
  }
  const spans: any[] = [],
    stack: any[] = [];
  for (const e of thread) {
    if (e.ph === 'B') stack.push(e);
    if (e.ph === 'E') {
      const first = stack.pop();
      assert.ok(first && finite(first.ts) && finite(e.ts));
      assert.ok(e.ts >= first.ts);
      if (e.name) assert.equal(e.name, first.name, 'Mismatched synchronous interval end');
      if (gcName(first)) spans.push({ ...first, dur: e.ts - first.ts, endIndex: e.index });
    }
    if (e.ph === 'X' && gcName(e)) {
      assert.ok(finite(e.ts) && finite(e.dur) && e.dur >= 0);
      spans.push(e);
    }
  }
  assert.equal(stack.length, 0, 'Unclosed synchronous trace interval');
  const overlaps = (event: any, began: number, ended: number) =>
    event.ts / 1000 <= ended && (event.ts + event.dur) / 1000 >= began;
  const control = spans.filter(
    (e) =>
      e.dur > 0 &&
      e.ts / 1000 >= observation.gcControl.gcStart.time + high &&
      (e.ts + e.dur) / 1000 <= observation.gcControl.gcEnd.time + low,
  );
  assert.ok(control.length > 0, 'No visible post-observation GC interval control');
  const rows = intervals.map((range) => {
    const began = range.began + low,
      ended = range.ended + high;
    const containing = thread
      .filter(
        (e) =>
          e.ph === 'X' &&
          finite(e.ts) &&
          finite(e.dur) &&
          /RunTask|FunctionCall|EvaluateScript|V8.Execute/.test(e.name ?? '') &&
          e.ts / 1000 <= began &&
          (e.ts + e.dur) / 1000 >= ended,
      )
      .map((e) => ({ index: e.index, name: e.name, ts: e.ts, dur: e.dur }));
    assert.ok(containing.length > 0, 'No containing renderer task/script interval');
    return {
      ...range,
      traceWindowMs: { earliest: began, latest: ended },
      containing,
      gcOverlaps: spans.filter((e) => overlaps(e, began, ended)),
      gcContextPoints: gcDurationUnknown.filter(
        (e) => e.ts! / 1000 >= began && e.ts! / 1000 <= ended,
      ),
    };
  });
  const comparisons = [];
  for (let index = 0; index < 32; index += 2) {
    const pair = data.records.slice(index, index + 2),
      prior = pair.find((r: any) => r.variant === 'prior'),
      candidate = pair.find((r: any) => r.variant === 'candidate');
    const reductionMs = prior.durationMs - candidate.durationMs,
      reductionFraction = reductionMs / prior.durationMs;
    comparisons.push({
      ids: pair.map((r: any) => r.id),
      format: prior.format,
      completed: prior.completed,
      order: prior.order,
      priorMs: prior.durationMs,
      candidateMs: candidate.durationMs,
      reductionMs,
      reductionFraction,
      meetsCriterion: reductionMs >= 1 && reductionFraction >= 0.2,
    });
  }
  return {
    valid: true,
    disposition: comparisons.every((p) => p.meetsCriterion)
      ? 'positive-component-result'
      : comparisons.every((p) => p.reductionMs < 0)
        ? 'contradicts-runtime-benefit'
        : 'inconclusive',
    clock: { renderer, offsetMinMs: low, offsetMaxMs: high, uncertaintyMs: high - low },
    comparisons,
    intervals: rows,
    gcControl: control,
    gcEvents: gc,
    gcDurationUnknown,
    gcIntervals: spans,
    limits:
      'Linux component only; common instrumentation, controlled sinks/timers and shared ES Core. GC-associated duration spans may nest and are not a total pause accounting. Instant/flow/async records retain unknown duration, including endpoints outside a measured window; no absence-of-GC claim. No pause subtraction, cross-environment pooling or historical-maximum explanation.',
  };
}

/** Collection success needs its independently retained terminal and cleanup journal. */
export function validateRuntimeJournal(observation: any, journal: any) {
  assert.equal(journal.schema, 1);
  assert.equal(journal.terminal, 'passed');
  assert.equal(journal.firstFailure, null);
  assert.equal(journal.persistenceFailure, null);
  assert.equal(journal.droppedEvents, 0);
  const cleanup = journal.events.findIndex(
    (event: any) => event.phase === 'fixture-cleanup' && event.kind === 'phase',
  );
  const terminal = journal.events.findIndex((event: any) => event.kind === 'terminal');
  assert.ok(
    cleanup >= 0 && terminal > cleanup && terminal === journal.events.length - 1,
    'Missing ordered cleanup/terminal witnesses',
  );
  assert.deepEqual(observation.cleanup, [
    { resource: 'cdp', status: 'fulfilled' },
    { resource: 'context', status: 'fulfilled' },
    { resource: 'browser', status: 'fulfilled' },
  ]);
}
