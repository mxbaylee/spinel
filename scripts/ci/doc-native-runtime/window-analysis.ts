import assert from 'node:assert/strict';
import { alignNativeRuntimeTrace } from './analysis.ts';
import { validateNativeWindowBoundary } from '../../../e2e/doc-responsiveness-native-window.ts';

/** Nested compose calls cover a union of time, not additive inclusive durations. */
export function composeCoverage(calls: Array<{ startedAt: number; endedAt: number }>) {
  const intervals = calls.toSorted((a, b) => a.startedAt - b.startedAt);
  let end = -Infinity,
    total = 0;
  for (const call of intervals) {
    assert.ok(Number.isFinite(call.startedAt) && Number.isFinite(call.endedAt));
    assert.ok(call.endedAt >= call.startedAt);
    total += Math.max(0, call.endedAt - Math.max(end, call.startedAt));
    end = Math.max(end, call.endedAt);
  }
  return total;
}

export function analyzeNativeWindow(metrics: any, capture: any, events: any[]) {
  assert.equal(metrics.role, 'diagnostic-prior-native');
  assert.equal(metrics.completed, true);
  assert.equal(metrics.attempt, 0);
  assert.equal(metrics.nativeDiagnosticCleanup.complete, true);
  assert.equal(metrics.nativeLoadedSources.complete, true);
  assert.equal(metrics.nativeDiagnosticTrace.complete, true);
  assert.equal(capture.restored, true);
  assert.equal(capture.dropped, 0);
  assert.deepEqual(capture.errors, []);
  assert.equal(capture.states, 4172);
  assert.equal(capture.captures.length, 132);
  const window = metrics.nativeWindow;
  assert.equal(window.source, metrics.source);
  assert.equal(window.complete, true);
  assert.equal(window.traceComplete, true);
  assert.equal(window.start, 384);
  assert.equal(window.end, 448);
  assert.equal(window.timingAcceptance, false);
  assert.equal(window.continuationPerturbedByGC, true);
  assert.deepEqual(
    window.boundaries.map((b: any) => b.phase),
    [
      'window-before-start',
      'window-after-start',
      'window-before-stop',
      'window-before-gc',
      'window-after-gc',
    ],
  );
  window.boundaries.forEach((b: any, index: number) => {
    assert.equal(b.completed, index < 2 ? 384 : 448);
    validateNativeWindowBoundary(b.native, b.capture, metrics.drainArm, b.completed, b.composition);
  });
  assert.deepEqual(
    window.marks.map((m: any) => m.name),
    ['spn146-window-start', 'spn146-window-end', 'spn146-window-gc-start', 'spn146-window-gc-end'],
  );
  const [start, end, gcStart, gcEnd] = window.marks;
  assert.ok(start.time < end.time && end.time < gcStart.time && gcStart.time < gcEnd.time);
  assert.ok(window.marks.every((m: any) => m.timeOrigin === metrics.drainArm.timeOrigin));
  assert.ok(window.profilerStartBracket.beforeMs <= window.profilerStartBracket.afterMs);
  assert.ok(window.profilerStartBracket.afterMs <= start.time);
  assert.ok(end.time <= window.profilerStopBracket.beforeMs);
  assert.ok(window.profilerStopBracket.beforeMs <= window.profilerStopBracket.afterMs);
  assert.ok(window.profilerStopBracket.afterMs <= gcStart.time);
  const clock = alignNativeRuntimeTrace(events, window.marks, gcStart, gcEnd);
  const allPairs = metrics.native.drainWitness.nativeFlushes.filter((p: any) => p.phase === 'pair');
  const pairs = allPairs.filter((p: any) => p.completedStates > 384 && p.completedStates <= 448);
  assert.deepEqual(
    pairs.map((p: any) => p.completedStates),
    [416, 448],
  );
  const observations = pairs.map((pair: any) => {
    assert.ok(pair.startedAt >= start.time && pair.endedAt <= end.time);
    const phases = capture.captures.filter(
      (phase: any) => phase.captureStartedAt >= pair.startedAt && phase.returnedAt <= pair.endedAt,
    );
    assert.deepEqual(
      phases.map((p: any) => p.phase),
      ['history', 'collaboration'],
    );
    const details = phases.map((phase: any) => {
      assert.equal(phase.count, 32);
      assert.equal(phase.outcome, 'returned');
      assert.ok(
        phase.captureStartedAt <= phase.captureEndedAt && phase.captureEndedAt <= phase.returnedAt,
      );
      const calls = capture.calls.filter((call: any) => call.pair === phase.sequence);
      assert.ok(calls.length > 0);
      assert.ok(
        calls.every(
          (call: any) =>
            call.outcome === 'returned' &&
            call.startedAt >= phase.captureEndedAt &&
            call.endedAt <= phase.returnedAt,
        ),
      );
      const composeUnionMs = composeCoverage(calls);
      const nativeInclusiveMs = phase.returnedAt - phase.captureEndedAt;
      assert.ok(composeUnionMs <= nativeInclusiveMs);
      return {
        sequence: phase.sequence,
        phase: phase.phase,
        captureEncodingMs: phase.captureEndedAt - phase.captureStartedAt,
        nativeInclusiveMs,
        composeUnionMs,
        unexplainedInclusiveRemainderMs: nativeInclusiveMs - composeUnionMs,
        calls,
      };
    });
    const earliest = pair.startedAt + clock.low,
      latest = pair.endedAt + clock.high;
    const containing = clock.thread.filter(
      (event) =>
        event.ph === 'X' &&
        /RunTask|FunctionCall|EvaluateScript|V8.Execute/.test(event.name ?? '') &&
        Number.isFinite(event.ts) &&
        Number.isFinite(event.dur) &&
        event.ts! / 1000 <= earliest &&
        (event.ts! + event.dur!) / 1000 >= latest,
    );
    assert.ok(containing.length > 0, 'No containing renderer task');
    return {
      ...pair,
      durationMs: pair.endedAt - pair.startedAt,
      phases: details,
      containing,
      gcOverlaps: clock.spans.filter(
        (event) => event.ts / 1000 <= latest && (event.ts + event.dur) / 1000 >= earliest,
      ),
      gcDurationUnknown: clock.gcDurationUnknown.filter(
        (event) => event.ts! / 1000 >= earliest && event.ts! / 1000 <= latest,
      ),
    };
  });
  return {
    complete: true,
    disposition: observations.some((p: any) => p.durationMs >= 80)
      ? 'new-comparable-instrumented-observation'
      : 'inconclusive-no-comparable-window-event',
    clock: { renderer: clock.renderer, offsetMinMs: clock.low, offsetMaxMs: clock.high },
    gcControl: clock.control,
    observations,
    allPairs: allPairs.map((pair: any) => ({
      completedStates: pair.completedStates,
      startedAt: pair.startedAt,
      endedAt: pair.endedAt,
      durationMs: pair.endedAt - pair.startedAt,
    })),
    ordinarySummary: metrics.summary,
    limitation:
      'Diagnostic only. Encoding/instrumentation perturb the workload; continuation follows forced GC. No pause subtraction, historical attribution, publication-only residual, acceptance or new run allowance.',
  };
}
