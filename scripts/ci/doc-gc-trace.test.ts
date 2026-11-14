import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeGcTrace } from '../../e2e/doc-responsiveness-gc-trace.ts';

const trace = (events: unknown[]) => JSON.stringify({ traceEvents: events });

test('GC events are aligned to the page clock through the sync mark and matched to each flush', () => {
  // Page clock 1000 ms is trace clock 5,000,000 us, so a trace time of T us is page time T/1000 - 4000.
  const result = analyzeGcTrace(
    trace([
      { name: 'spn146-gc-sync', ph: 'R', ts: 5_000_000, pid: 1, tid: 1 },
      { name: 'V8.GC_MC', ph: 'X', ts: 5_100_000, dur: 60_000, pid: 1, tid: 1 }, // page 1100-1160
      { name: 'V8.GC_MC_MARK', ph: 'X', ts: 5_100_000, dur: 40_000, pid: 1, tid: 1 }, // nested phase, not counted twice
      { name: 'V8.GC_MC_BACKGROUND_MARKING', ph: 'X', ts: 5_100_000, dur: 90_000, pid: 1, tid: 1 }, // background name
      { name: 'V8.GC_SCAVENGER', ph: 'X', ts: 5_100_000, dur: 90_000, pid: 1, tid: 2 }, // other thread
      { name: 'V8.GC_SCAVENGER', ph: 'X', ts: 5_500_000, dur: 2_000, pid: 1, tid: 1 }, // page 1500-1502
    ]),
    1000,
    [
      { startedAt: 1090, durationMs: 80 }, // overlaps 1100-1160 fully: 60 ms
      { startedAt: 1200, durationMs: 30 }, // no GC
      { startedAt: 1499, durationMs: 10 }, // overlaps 2 ms
    ],
  );
  assert.equal(result.aligned, true);
  if (!result.aligned) return;
  assert.deepEqual(
    result.slowestFlushes.map((entry) => Math.round(entry.gcMs)),
    [60, 0, 2],
  );
  assert.equal(Math.round(result.totalGcInFlushMs), 62);
  assert.equal(result.flushesWithGc, 2);
  assert.equal(result.gcEvents.length, 2); // main-thread events of at least 5 ms: V8.GC_MC and its MARK phase
});

test('a trace without the sync mark is reported as unaligned, never guessed', () => {
  const result = analyzeGcTrace(trace([{ name: 'MajorGC', ph: 'X', ts: 1, dur: 1 }]), 0, []);
  assert.equal(result.aligned, false);
});
