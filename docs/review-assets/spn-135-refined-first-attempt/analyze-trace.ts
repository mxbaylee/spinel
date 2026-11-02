import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const root = process.argv[2];
if (!root) throw Error('Expected extracted diagnostic directory');
type Event = { name?: string; cat?: string; ph?: string; ts?: number; dur?: number; pid?: number; tid?: number; id?: string; id2?: { local?: string; global?: string } };
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const found = fs.readdirSync(root, { recursive: true }).map(String).filter(n => n.endsWith('spn108-metrics.json'));
assert.equal(found.length, 1, 'Exactly one declared diagnostic sample');
for (const rel of found) {
  const dir = path.dirname(path.join(root, rel));
  const m = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
  assert.equal(m.source, 'dbbe5ccaf085ce20b79068d3596a35dcf2142223');
  assert.equal(m.role, 'diagnostic-only'); assert.equal(m.preset, 'desktop');
  assert.equal(m.sample, 'profile'); assert.equal(m.attempt, 0); assert.equal(m.budgetEnforced, false);
  const bytes = fs.readFileSync(path.join(dir, 'spn135-trace.json'));
  assert.equal(m.diagnosticTrace?.complete, true);
  assert.equal(hash(bytes), m.diagnosticTrace.sha256);
  const cacheBytes = fs.readFileSync(path.join(dir, 'spn135-native-idle.json'));
  assert.equal(hash(cacheBytes), m.nativeDiagnostic.sha256);
  const cache = JSON.parse(cacheBytes.toString());
  assert.equal(cache.phaseError, null); assert.equal(cache.captureError, null);
  assert.equal(cache.collectionError, undefined);
  const events = JSON.parse(bytes.toString()).traceEvents as Event[];
  const starts = events.filter(e => e.name === 'spn135-clock-start' && typeof e.ts === 'number');
  const ends = events.filter(e => e.name === 'spn135-clock-end' && typeof e.ts === 'number');
  assert.equal(starts.length, 1); assert.equal(ends.length, 1);
  const a = starts[0]!, b = ends[0]!;
  const offset = a.ts! - m.traceClockStart * 1000;
  const endOffset = b.ts! - m.traceClockEnd * 1000;
  assert.equal(a.pid, b.pid); assert.equal(a.tid, b.tid); assert.ok(b.ts! > a.ts!);
  assert.ok(Math.abs(endOffset - offset) < 2000, 'Clock anchors drifted over 2 ms');
  const timeline = events.filter(e => e.pid === a.pid && e.tid === a.tid).sort((x, y) => (x.ts ?? 0) - (y.ts ?? 0));
  const stack: Event[] = [], spans: Event[] = [];
  const asyncSpans = new Map<string, Event>();
  for (const e of timeline) {
    if (e.name?.startsWith('spn135-') && (e.ph === 'b' || e.ph === 'e')) {
      const key = e.name + '|' + (e.id2?.local ?? e.id2?.global ?? e.id);
      if (e.ph === 'b') { assert.ok(!asyncSpans.has(key)); asyncSpans.set(key, e); }
      else { const start = asyncSpans.get(key); assert.ok(start?.ts !== undefined && e.ts !== undefined); spans.push({ ...start, dur: e.ts! - start.ts! }); asyncSpans.delete(key); }
    } else if (e.ph === 'n' && e.name?.startsWith('spn135-')) spans.push({ ...e, dur: 0 });
    else if (e.ph === 'X' && typeof e.dur === 'number') spans.push(e);
    else if (e.ph === 'B') stack.push(e);
    else if (e.ph === 'E') { const start = stack.pop(); if (start?.ts !== undefined && e.ts !== undefined) spans.push({ ...start, dur: e.ts - start.ts }); }
  }
  assert.equal(asyncSpans.size, 0, 'Incomplete diagnostic phase spans');
  const native = spans.filter(e => e.name?.startsWith('spn135-') && e.name !== 'spn135-idle-capture');
  const end = (e: Event) => e.ts! + e.dur!;
  const within = (child: Event, parent: Event) => child.ts! >= parent.ts! - 1 && end(child) <= end(parent) + 1;
  const used = new Set<Event>();
  const usedCaptures = new Set<unknown>();
  const details = m.native.flushes.map((f: any) => {
    const begin = offset + f.startedAt * 1000, finish = begin + f.durationMs * 1000;
    assert.ok(begin >= a.ts! - 1000 && finish <= b.ts! + 1000, 'Flush outside anchors');
    const outer = native.filter(e => e.name === 'spn135-flush' && e.ts! >= begin - 1000 && end(e) <= finish + 1000);
    assert.equal(outer.length, 1, 'Missing or ambiguous enclosing native flush');
    assert.ok(!used.has(outer[0]!)); used.add(outer[0]!);
    const phases = native.filter(e => e !== outer[0] && within(e, outer[0]!));
    for (const scope of ['history', 'collaboration']) {
      const parents = phases.filter(e => e.name === 'spn135-' + scope);
      assert.equal(parents.length, 1);
      const children = phases.filter(e => ['spn135-composition-redoState', 'spn135-composition-undoState', 'spn135-' + scope + '-publication'].includes(e.name!) && within(e, parents[0]!));
      for (const name of ['composition-redoState', 'composition-undoState', scope + '-publication'])
        assert.equal(children.filter(e => e.name === 'spn135-' + name).length, 1, 'Incomplete composition/publication coverage');
      assert.equal(children.length, 3);
      const ordered = children.toSorted((x, y) => x.ts! - y.ts!);
      for (let i = 1; i < ordered.length; i++) assert.ok(end(ordered[i - 1]!) <= ordered[i]!.ts! + 1, 'Composition/publication overlap');
    }
    assert.equal(phases.length, 8);
    const gc = spans.filter(e => /GC|Scavenge|MarkCompact/i.test(e.name ?? '') && e.ts! < finish && end(e) > begin);
    const intervals = gc.map(e => [Math.max(begin, e.ts!), Math.min(finish, end(e))]).sort((x, y) => x[0]! - y[0]!);
    let sum = 0, lo = 0, hi = 0;
    for (const [left, right] of intervals) { if (left! > hi) { sum += hi - lo; lo = left!; hi = right!; } else hi = Math.max(hi, right!); }
    sum += hi - lo;
    let capture: unknown;
    if (f.reason === 'idle') {
      const matches = cache.idle.filter((entry: any) => entry.captureStartedAt >= m.traceClockStart && entry.captureEndedAt <= f.startedAt && f.startedAt - entry.captureEndedAt < 2);
      assert.equal(matches.length, 1, 'Idle cache/interval correspondence missing or ambiguous');
      assert.ok(!usedCaptures.has(matches[0])); usedCaptures.add(matches[0]);
      const entry = matches[0];
      const counts = Object.fromEntries(entry.cache.entries.map(([name, value]: any[]) => [name, value.entries.find(([key]: any[]) => key === 'length')[1].value]));
      assert.equal(counts.history, f.history); assert.equal(counts.collaboration, f.collaboration);
      capture = { sha256: hash(JSON.stringify(entry.cache)), counts, overheadMs: entry.captureEndedAt - entry.captureStartedAt };
    }
    return { flush: f, idleCache: capture, phases: phases.map(e => ({ name: e.name, durationMs: e.dur! / 1000 })), gcUnionOverlapMs: sum / 1000, gcNames: [...new Set(gc.map(e => e.name))] };
  });
  assert.equal(used.size, native.filter(e => e.name === 'spn135-flush').length, 'Unmatched native flush');
  assert.equal(usedCaptures.size, cache.idle.filter((e: any) => e.captureStartedAt >= m.traceClockStart && e.captureEndedAt <= m.traceClockEnd).length);
  const outsidePaired = native.filter(e => e.name !== 'spn135-flush' && ![...used].some(parent => within(e, parent))).map(e => ({name:e.name,startedAt:(e.ts!-offset)/1000,durationMs:e.dur!/1000,tracePhase:e.ph}));
  const result = { diagnosticOnly: true, measuredWindowIdleObserved: usedCaptures.size > 0, instantFormPublicationCount: native.filter(e => e.ph === 'n').length, outsidePaired, source: m.source, completed: m.completed, errors: m.errors, preUndoIntegrity: m.preUndoIntegrity?.passed, undoRedo: m.undoRedo?.outcome, budgetResults: m.budgetResults, traceSha256: hash(bytes), cacheSha256: hash(cacheBytes), coveredFlushes: details.length, phaseSpans: native.length, clockDriftMs: (endOffset - offset) / 1000, details };
  fs.writeFileSync(path.join(dir, 'spn135-trace-analysis.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ ...result, details: details.filter((e: any) => e.flush.reason === 'idle' || e.flush.durationMs > 16) }, null, 2));
}
