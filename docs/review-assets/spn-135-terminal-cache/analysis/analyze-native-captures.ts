// Offline analysis of one retained terminal-cache diagnostic. Never runtime acceptance.
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
  const cacheBytes = fs.readFileSync(path.join(dir, 'spn135-native-caches.json'));
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

    return { flush: f, phases: phases.map(e => ({ name: e.name, durationMs: e.dur! / 1000 })), gcUnionOverlapMs: sum / 1000, gcNames: [...new Set(gc.map(e => e.name))] };
  });
  assert.equal(used.size, native.filter(e => e.name === 'spn135-flush').length, 'Unmatched native flush');
  const matchedNativeSpans = new Set<Event>();
  assert.ok(Array.isArray(cache.native));
  assert.ok(cache.native.length <= 1000);
  assert.ok(cacheBytes.length <= 4 * 1024 * 1024);
  let decodeVisits = 0;
  const decode = (value: any): any => {
    assert.ok(++decodeVisits <= 100000, 'Decoded capture exceeds value bound');
    assert.ok(value && typeof value === 'object' && !Array.isArray(value));
    if (value.kind === 'undefined') return undefined;
    if (value.kind === 'value') {
      assert.ok(value.value === null || typeof value.value === 'string' ||
        typeof value.value === 'boolean' || typeof value.value === 'number' && Number.isFinite(value.value));
      return value.value;
    }
    assert.ok(value.kind === 'array' || value.kind === 'object');
    const out: any = value.kind === 'array' ? [] : {};
    assert.ok(Array.isArray(value.entries));
    const keys = new Set<string>();
    for (const [key, child] of value.entries) {
      assert.equal(typeof key, 'string'); assert.ok(!keys.has(key)); keys.add(key);
      // Preserve own undefined, sparse-array length and safe data keys without
      // interpreting a captured __proto__ key as a prototype setter.
      Object.defineProperty(out, key, { value: decode(child), writable: true,
        enumerable: key !== 'length' || value.kind !== 'array', configurable: key !== 'length' || value.kind !== 'array' });
    }
    return out;
  };
  const nativeCaptures = cache.native.map((entry: any, index: number) => {
    assert.equal(entry.id, index + 1);
    assert.ok(['history', 'collaboration'].includes(entry.phase));
    assert.ok(Number.isInteger(entry.count) && entry.count > 0);
    for (const key of ['captureStartedAt', 'captureEndedAt', 'phaseStartedAt', 'phaseEndedAt'])
      assert.ok(Number.isFinite(entry[key]), 'Missing timestamp: ' + key);
    assert.ok(entry.captureStartedAt <= entry.captureEndedAt &&
      entry.captureEndedAt <= entry.phaseStartedAt && entry.phaseStartedAt <= entry.phaseEndedAt);
    if (entry.count < 32) {
      assert.equal(entry.cacheOmitted, null);
      decodeVisits = 0;
      const states = decode(entry.cache);
      assert.ok(Array.isArray(states)); assert.equal(states.length, entry.count);
    } else {
      assert.equal(entry.cache, null); assert.equal(entry.cacheOmitted, 'capacity-or-larger');
    }
    const begin = offset + entry.phaseStartedAt * 1000;
    const finish = offset + entry.phaseEndedAt * 1000;
    // Captures can precede the measured trace window. They remain retained but
    // cannot satisfy terminal correspondence or be given measured phase proof.
    const inWindow = entry.phaseStartedAt >= m.traceClockStart && entry.phaseEndedAt <= m.traceClockEnd;
    let phase: Event | undefined;
    if (inWindow) {
      const candidates = native.filter(e => e.name === 'spn135-' + entry.phase &&
        e.ts! >= begin - 1000 && end(e) <= finish + 1000);
      assert.equal(candidates.length, 1, 'Missing or ambiguous native capture phase');
      phase = candidates[0]!;
      assert.ok(!matchedNativeSpans.has(phase), 'Duplicate capture-to-phase match');
      matchedNativeSpans.add(phase);
    }
    const parents = phase ? [...used].filter(parent => within(phase!, parent)) : [];
    assert.ok(parents.length <= 1);
    if (inWindow && entry.origin.startsWith('policy-')) assert.equal(parents.length, 1);
    if (parents.length === 1) {
      const parentIndex = [...used].indexOf(parents[0]!);
      const flush = m.native.flushes[parentIndex];
      assert.equal(entry.unitId, m.native.unitId);
      assert.equal(entry.origin, 'policy-' + flush.reason);
      assert.equal(entry.count, flush[entry.phase]);
    }
    if (inWindow && entry.origin.endsWith('-timer')) assert.equal(parents.length, 0);
    const children = phase ? native.filter(e => e !== phase &&
      ['spn135-composition-redoState', 'spn135-composition-undoState', 'spn135-' + entry.phase + '-publication'].includes(e.name!) && within(e, phase!)) : [];
    if (inWindow) {
      for (const suffix of ['composition-redoState', 'composition-undoState', entry.phase + '-publication'])
        assert.equal(children.filter(e => e.name === 'spn135-' + suffix).length, 1);
      const ordered = children.toSorted((x, y) => x.ts! - y.ts!);
      for (let i = 1; i < ordered.length; i++)
        assert.ok(end(ordered[i - 1]!) <= ordered[i]!.ts! + 1, 'Native composition/publication overlap');
    }
    return { id: entry.id, unitId: entry.unitId, phase: entry.phase, origin: entry.origin,
      count: entry.count, rawCacheSha256: entry.cache === null ? null : hash(JSON.stringify(entry.cache)),
      captureOverheadMs: entry.captureEndedAt - entry.captureStartedAt,
      nativeIntervalMs: entry.phaseEndedAt - entry.phaseStartedAt,
      phaseStartedAt: entry.phaseStartedAt, phaseEndedAt: entry.phaseEndedAt,
      inWindow, enclosedByPolicyFlush: parents.length === 1,
      phases: children.map(e => ({ name: e.name, durationMs: e.dur! / 1000 })) };
  });
  // Empty native timer callbacks legitimately have no capture. A productive
  // invocation is identified by a composition/publication child, not duration.
  for (const phase of native.filter(e => ['spn135-history', 'spn135-collaboration'].includes(e.name!) &&
    e.ts! >= a.ts! && end(e) <= b.ts!)) {
    const productive = native.some(e => e !== phase &&
      (e.name?.startsWith('spn135-composition-') || e.name?.endsWith('-publication')) && within(e, phase));
    if (productive) assert.ok(matchedNativeSpans.has(phase), 'Productive native phase lacks a capture');
  }
  assert.equal(m.completed, true, 'Diagnostic protocol did not complete');
  assert.deepEqual(m.errors, [], 'Application errors in diagnostic');
  assert.equal(m.preUndoIntegrity?.passed, true);
  assert.equal(m.undoRedo?.outcome, 'passed');
  const lastKey = m.input.keydownAt.at(-1);
  assert.ok(Number.isFinite(lastKey));
  assert.ok(lastKey >= m.traceClockStart && lastKey <= m.traceClockEnd);
  const terminal = nativeCaptures.filter((entry: any) => entry.unitId === m.native.unitId &&
    entry.phaseStartedAt >= lastKey && entry.phaseEndedAt <= m.traceClockEnd);
  assert.deepEqual(terminal.map((entry: any) => entry.phase), ['history', 'collaboration']);
  assert.equal(terminal[0].count, terminal[1].count);
  assert.ok(terminal[0].phaseEndedAt <= terminal[1].phaseStartedAt);
  for (const entry of terminal) {
    assert.ok(entry.count > 0 && entry.count < 32);
    assert.ok(entry.rawCacheSha256);
  }
  const outsidePaired = native.filter(e => e.name !== 'spn135-flush' && ![...used].some(parent => within(e, parent))).map(e => ({name:e.name,startedAt:(e.ts!-offset)/1000,durationMs:e.dur!/1000,tracePhase:e.ph}));
  const result = { diagnosticOnly: true, measuredWindowIdleObserved: m.native.flushes.some((entry: any) => entry.reason === 'idle'), terminal, nativeCaptures, instantFormPublicationCount: native.filter(e => e.ph === 'n' && e.name?.endsWith('-publication')).length, outsidePaired, source: m.source, completed: m.completed, errors: m.errors, preUndoIntegrity: m.preUndoIntegrity?.passed, undoRedo: m.undoRedo?.outcome, budgetResults: m.budgetResults, traceSha256: hash(bytes), cacheSha256: hash(cacheBytes), coveredFlushes: details.length, phaseSpans: native.length, clockDriftMs: (endOffset - offset) / 1000, details };
  fs.writeFileSync(path.join(dir, 'spn135-trace-analysis.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ ...result, nativeCaptures: undefined, details: details.filter((e: any) => e.flush.reason === 'idle' || e.flush.durationMs > 16) }, null, 2));
}
