import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  callbackProgress,
  persistCallbackManifest,
} from '../../e2e/doc-responsiveness-callback-progress.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeRuntime, validateRuntimeJournal } from './doc-native-runtime/analysis.ts';
import { owned, resourceFailure } from './doc-native-runtime/watchdog.ts';
function fixture() {
  const records: any[] = [],
    events: any[] = [];
  let time = 100;
  const mark = (name: string, at: number) => {
    events.push({
      name,
      cat: 'blink.user_timing',
      ph: 'I',
      ts: (at + 10000) * 1000,
      pid: 7,
      tid: 8,
    });
    return { name, time: at };
  };
  for (const format of ['es', 'cjs'])
    for (const completed of [544, 672, 1440, 1984])
      for (const order of ['prior-candidate', 'candidate-prior'])
        for (const variant of order.split('-')) {
          const id = records.length,
            label = `spn146-runtime-${id}`,
            durationMs = variant === 'prior' ? 10 : 5,
            began = time;
          const range = (prefix: string, start: number, duration: number) => ({
            first: mark(prefix + '-start', start - 0.1),
            began: start,
            ended: start + duration,
            last: mark(prefix + '-end', start + duration + 0.1),
            durationMs: duration,
          });
          const whole = range(label, began, durationMs),
            phaseDuration = (durationMs - 1) / 2;
          records.push({
            id,
            format,
            completed,
            sequences: ({ 544: [32, 33], 672: [40, 41], 1440: [88, 89], 1984: [122, 123] } as any)[
              completed
            ],
            order,
            variant,
            passed: true,
            cleanup: true,
            pairParity: true,
            ...whole,
            phases: [
              { phase: 'history', ...range(label + '-history', began + 0.2, phaseDuration) },
              {
                phase: 'collaboration',
                ...range(label + '-collaboration', began + 0.6 + phaseDuration, phaseDuration),
              },
            ],
            output: { native: true },
          });
          events.push({
            name: 'ThreadControllerImpl::RunTask',
            cat: 'toplevel',
            ph: 'X',
            pid: 7,
            tid: 8,
            ts: (began + 10000 - 2) * 1000,
            dur: (durationMs + 4) * 1000,
          });
          time += 100;
        }
  const gcStart = mark('spn146-runtime-gc-control-start', time),
    gcEnd = mark('spn146-runtime-gc-control-end', time + 5);
  events.push({
    name: 'MajorGC',
    cat: 'devtools.timeline',
    ph: 'X',
    pid: 7,
    tid: 8,
    ts: (time + 10001) * 1000,
    dur: 1000,
  });
  return {
    observation: {
      complete: true,
      observation: { finished: true, records },
      gcControl: { gcStart, gcEnd },
    },
    events,
  };
}
test('all fixed matched cases pass with complete same-thread clock and post-GC evidence', () => {
  const f = fixture(),
    result = analyzeRuntime(f.observation, f.events);
  assert.equal(result.disposition, 'positive-component-result');
  assert.equal(result.comparisons.length, 16);
  assert.equal(result.intervals.length, 96);
  assert.equal(result.gcControl.length, 1);
});
for (const [name, mutate] of [
  ['missing case', (f: any) => f.observation.observation.records.pop()],
  ['wrong case identity', (f: any) => (f.observation.observation.records[4].completed = 999)],
  ['partial collection', (f: any) => (f.observation.complete = false)],
  ['failed cleanup', (f: any) => (f.observation.observation.records[0].cleanup = false)],
  ['failed pair parity', (f: any) => (f.observation.observation.records[0].pairParity = false)],
  [
    'different publication',
    (f: any) => (f.observation.observation.records[1].output = { different: true }),
  ],
  ['wrong phase order', (f: any) => f.observation.observation.records[0].phases.reverse()],
  ['missing mark', (f: any) => f.events.shift()],
  ['duplicate mark', (f: any) => f.events.push(f.events[0])],
  ['different renderer', (f: any) => (f.events[0].tid = 9)],
  ['clock drift', (f: any) => (f.events[0].ts += 1000)],
  ['missing GC control', (f: any) => f.events.pop()],
  [
    'missing containing tasks',
    (f: any) => (f.events = f.events.filter((e: any) => e.cat !== 'toplevel')),
  ],
  ['unsupported GC representation', (f: any) => (f.events.at(-1).ph = 'unknown')],
] as const)
  test(`selected evidence cannot pass: ${name}`, () => {
    const f = fixture();
    mutate(f);
    assert.throws(() => analyzeRuntime(f.observation, f.events));
  });
test('one below-threshold pair remains inconclusive; other improvements cannot hide it', () => {
  const f = fixture(),
    r = f.observation.observation.records[1],
    delta = 4.5;
  r.durationMs += delta;
  r.ended += delta;
  r.last.time += delta;
  f.events.find((e) => e.name === r.last.name).ts += delta * 1000;
  f.events.find(
    (e) => e.name === 'ThreadControllerImpl::RunTask' && e.ts === (r.began + 10000 - 2) * 1000,
  ).dur += delta * 1000;
  const result = analyzeRuntime(f.observation, f.events);
  assert.equal(result.disposition, 'inconclusive');
  assert.equal(result.comparisons.filter((p) => !p.meetsCriterion).length, 1);
});
test('overlapping GC is reported without subtracting its time from the threshold', () => {
  const f = fixture(),
    r = f.observation.observation.records[0];
  f.events.push({
    name: 'MinorGC',
    cat: 'devtools.timeline',
    ph: 'X',
    pid: 7,
    tid: 8,
    ts: (r.began + 10001) * 1000,
    dur: 1000,
  });
  const result = analyzeRuntime(f.observation, f.events);
  assert.equal(result.intervals[0].gcOverlaps.length, 1);
  assert.equal(result.comparisons[0].priorMs, 10);
});
test('process ownership retains reparented identity and excludes PID reuse and unrelated apps', () => {
  const known = new Map([[2, { pid: 2, parent: 1, start: 'old', rssKiB: 10 }]]);
  const rows = [
    { pid: 1, parent: 0, start: 'root', rssKiB: 10 },
    { pid: 2, parent: 0, start: 'old', rssKiB: 10 },
    { pid: 3, parent: 2, start: 'child', rssKiB: 10 },
    { pid: 4, parent: 0, start: 'owner', rssKiB: 10 },
  ];
  assert.deepEqual(
    owned(rows, 1, known).map((p) => p.pid),
    [1, 2, 3],
  );
  assert.deepEqual(owned([{ pid: 2, parent: 0, start: 'new', rssKiB: 10 }], 1, known), []);
});

test('duration-unknown GC cannot support positive temporal evidence', () => {
  const f = fixture();
  f.events.push({
    name: 'MinorGC',
    cat: 'devtools.timeline',
    ph: 'I',
    pid: 7,
    tid: 8,
    ts: 10102000,
  });
  assert.throws(() => analyzeRuntime(f.observation, f.events), /Unsupported GC/);
});
test('GC overlapping control from before its start does not prove forced-control visibility', () => {
  const f = fixture(),
    e = f.events.at(-1);
  e.ts -= 2000;
  e.dur += 2000;
  assert.throws(() => analyzeRuntime(f.observation, f.events), /No visible/);
});
test('same resource policy rejects final-only memory/deadline/missing observations', () => {
  const good = { elapsedMs: 1, rssKiB: 1000, availableKiB: 2 * 1024 ** 2 };
  assert.equal(resourceFailure(good), null);
  for (const change of [
    { elapsedMs: 60000 },
    { rssKiB: 2 * 1024 ** 2 + 1 },
    { availableKiB: 1024 ** 2 - 1 },
    { availableKiB: NaN },
  ])
    assert.ok(resourceFailure({ ...good, ...change }));
});

test('terminal-only persistence failure and missing cleanup cannot pass analysis', () => {
  const observation = {
    cleanup: [
      { resource: 'cdp', status: 'fulfilled' },
      { resource: 'context', status: 'fulfilled' },
      { resource: 'browser', status: 'fulfilled' },
    ],
  };
  const journal = {
    schema: 1,
    terminal: 'passed',
    firstFailure: null,
    persistenceFailure: null,
    droppedEvents: 0,
    events: [
      { kind: 'phase', phase: 'fixture-cleanup' },
      { kind: 'terminal', phase: 'fixture-cleanup' },
    ],
  };
  validateRuntimeJournal(observation, journal);
  for (const mutation of [
    { terminal: null },
    { persistenceFailure: { code: 'ENOSPC' } },
    { firstFailure: { kind: 'trace' } },
    { droppedEvents: 1 },
    { events: [{ kind: 'terminal', phase: 'fixture-cleanup' }] },
  ])
    assert.throws(() => validateRuntimeJournal(observation, { ...journal, ...mutation }));
  assert.throws(() => validateRuntimeJournal({ cleanup: [] }, journal));
});

test('actual terminal write failure remains visible and cannot leave a passed journal', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'spn146-terminal-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'progress.json'),
    progress = callbackProgress(path);
  progress.cleanup();
  mkdirSync(path + '.tmp');
  progress.terminal('passed');
  assert.ok(progress.persistenceFailure);
  assert.notEqual(JSON.parse(readFileSync(path, 'utf8')).terminal, 'passed');
});
test('analysis persistence failure preserves earlier primary error', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'spn146-result-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'analysis.json');
  mkdirSync(path);
  const primary = new Error('original converter failure'),
    record: any = { passed: false, failure: String(primary) };
  assert.equal(await persistCallbackManifest(path, record, primary), primary);
  assert.equal(record.manifestPersistenceError, true);
  assert.equal(record.passed, false);
});
