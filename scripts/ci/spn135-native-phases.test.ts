import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { instrumentNativePhases } from './spn135-native-phases.ts';

// Supply a verified, read-only original installation. No install/patch writes here.
const root = process.env.SPN135_CONTROL_RUNTIME;
if (!root) throw new Error('SPN135_CONTROL_RUNTIME must name the original runtime');
const require = createRequire(resolve(root, 'package.json'));
const core = require('@univerjs/core');
const captures = JSON.parse(readFileSync(process.env.SPN135_CONTROL_CAPTURES!, 'utf8'));
function decode(value: any): any {
  if (value.kind === 'undefined') return undefined;
  if (value.kind === 'value') return value.value;
  const result: any = value.kind === 'array' ? [] : {};
  for (const [key, child] of value.entries) result[key] = decode(child);
  return result;
}
function manager(source: string, clockFailure: boolean, publicationFailure?: string) {
  const start = source.indexOf('function hasOnlyDocInsertKeys(');
  const end = source.indexOf('const IDocStateChangeInterceptorService =', start);
  const classStart = source.indexOf('let DocStateChangeManagerService =');
  const classEnd = source.indexOf('DocStateChangeManagerService = __decorate', classStart);
  assert.ok(start > 0 && end > start && classStart > end && classEnd > classStart);
  const phases: string[] = [];
  const context = {
    TextEncoder,
    JSONX: core.JSONX,
    _univerjs_core: core,
    RxDisposable: core.RxDisposable,
    RedoCommandId: 'redo',
    UndoCommandId: 'undo',
    performance: {
      now: () => 1,
      measure: (name: string) => {
        phases.push(name);
        if (clockFailure) throw new Error('measurement sink failed');
      },
    },
  };
  const Manager = runInNewContext(
    source.slice(start, end) +
      source.slice(classStart, classEnd) +
      ';DocStateChangeManagerService;',
    context,
  );
  const instance = Object.create(Manager.prototype);
  const published: unknown[] = [];
  const failure = new Error('publication failed');
  instance._undoRedoService = {
    pushUndoRedo(item: unknown) {
      published.push(['history', item]);
      if (publicationFailure === 'history') throw failure;
    },
  };
  instance._docStateChange$ = {
    next(item: unknown) {
      published.push(['collaboration', item]);
      if (publicationFailure === 'collaboration') throw failure;
    },
  };
  return { instance, published, phases, failure, context: context as Record<string, any> };
}

for (const format of ['es', 'cjs']) {
  const source = readFileSync(
    resolve(root, `node_modules/@univerjs/docs/lib/${format}/index.js`),
    'utf8',
  );
  const instrumented = instrumentNativePhases(source);
  test(`${format}: rejects repeat or ambiguous instrumentation`, () => {
    assert.throws(() => instrumentNativePhases(instrumented), /Ambiguous/);
    assert.throws(
      () => instrumentNativePhases(source + '\n\tflushPendingChanges(unitId) {'),
      /Ambiguous/,
    );
  });
  for (const [index, encoded] of captures.captures.entries()) {
    for (const failure of [undefined, 'history', 'collaboration']) {
      test(`${format} cache ${index}: preserves publication, mutation, return/throw (${failure ?? 'success'})`, () => {
        const original = manager(source, false, failure);
        const candidate = manager(instrumented, true, failure);
        for (const value of [original, candidate]) {
          const cache = decode(encoded);
          value.instance._historyStateCache = new Map([['unit', cache.history]]);
          value.instance._changeStateCache = new Map([['unit', cache.collaboration]]);
          if (failure)
            assert.throws(
              () => value.instance.flushPendingChanges('unit'),
              (error) => error === value.failure,
            );
          else assert.equal(value.instance.flushPendingChanges('unit'), undefined);
        }
        // Compare semantic graphs independently of the two VM realms.
        assert.deepEqual(structuredClone(candidate.published), structuredClone(original.published));
        assert.deepEqual(
          structuredClone(candidate.instance.getStateCache('unit')),
          structuredClone(original.instance.getStateCache('unit')),
        );
        assert.ok(candidate.phases.includes('spn135-flush'));
        assert.ok(candidate.phases.includes('spn135-history-publication'));
        assert.ok(candidate.phases.includes('spn135-composition-redoState'));
        assert.ok(candidate.phases.includes('spn135-composition-undoState'));
        if (failure !== 'history')
          assert.ok(candidate.phases.includes('spn135-collaboration-publication'));
      });
    }
  }
}

test('native short-cache capture preserves own undefined and survives cache clearing', () => {
  const source = readFileSync(resolve(root, 'node_modules/@univerjs/docs/lib/es/index.js'), 'utf8');
  const value = manager(instrumentNativePhases(source), false);
  const original = decode(captures.captures[0]);
  const states = original.history.slice(0, 6);
  states[0].captureProof = { own: undefined, holes: new Array(2) };
  const before = structuredClone(states);
  value.instance._historyStateCache = new Map([['unit', states]]);
  value.instance._changeStateCache = new Map([['unit', structuredClone(states)]]);
  value.instance.flushPendingChanges('unit');
  const recorded = value.context.__spn135Native;
  assert.equal(recorded.length, 2);
  assert.deepEqual(structuredClone(recorded.map((entry: any) => entry.origin)), [
    'public-flush',
    'public-flush',
  ]);
  for (const entry of recorded) {
    assert.equal(entry.count, 6);
    assert.equal(entry.unitId, 'unit');
    assert.deepEqual(structuredClone(decode(entry.cache)), before);
  }
  assert.deepEqual(structuredClone(value.instance.getStateCache('unit')), {
    history: [],
    collaboration: [],
  });
  value.instance.flushPendingChanges('unit');
  assert.equal(recorded.length, 2, 'Empty callbacks must not create substantive captures');
  const bad = structuredClone(before);
  bad[0].captureProof = () => {};
  value.instance._historyStateCache.set('unit', bad);
  assert.doesNotThrow(() => value.instance.flushPendingChanges('unit'));
  assert.match(value.context.__spn135CaptureError, /Unsupported/);
  assert.equal(value.instance.getStateCache('unit').history.length, 0);
});

for (const limit of ['records', 'values', 'bytes', 'capacity'] as const) {
  test(`capture boundary ${limit} preserves native publication and cache clearing`, () => {
    const source = readFileSync(
      resolve(root, 'node_modules/@univerjs/docs/lib/es/index.js'),
      'utf8',
    );
    const original = manager(source, false);
    const candidate = manager(instrumentNativePhases(source), false);
    const states = decode(captures.captures[0]).history.slice(0, limit === 'capacity' ? 32 : 6);
    // Unknown top-level metadata is immaterial to native composition/publication.
    if (limit === 'values') states[0].captureProof = new Array(100001).fill(null);
    if (limit === 'capacity')
      states[0].captureProof = () => {
        throw new Error('Must not traverse');
      };
    for (const value of [original, candidate]) {
      // Clone the state graph while preserving the inert function used above.
      const copies = states.map((state: any) => ({
        ...core.Tools.deepClone(state),
        captureProof: state.captureProof,
      }));
      value.instance._historyStateCache = new Map([['unit', copies]]);
      value.instance._changeStateCache = new Map([['unit', []]]);
    }
    if (limit === 'records') candidate.context.__spn135Native = new Array(1000).fill(null);
    if (limit === 'bytes') candidate.context.__spn135NativeBytes = 4 * 1024 * 1024;
    for (const value of [original, candidate])
      assert.doesNotThrow(() => value.instance.flushPendingChanges('unit'));
    assert.deepEqual(structuredClone(candidate.published), structuredClone(original.published));
    assert.deepEqual(structuredClone(candidate.instance.getStateCache('unit')), {
      history: [],
      collaboration: [],
    });
    if (limit === 'capacity') {
      assert.equal(candidate.context.__spn135CaptureError, undefined);
      assert.equal(candidate.context.__spn135Native.length, 1);
      assert.deepEqual(
        structuredClone(
          candidate.context.__spn135Native.map((entry: any) => ({
            count: entry.count,
            cache: entry.cache,
            cacheOmitted: entry.cacheOmitted,
          })),
        ),
        [{ count: 32, cache: null, cacheOmitted: 'capacity-or-larger' }],
      );
    } else {
      assert.match(candidate.context.__spn135CaptureError, /exceeds|exceed/);
      assert.equal(candidate.context.__spn135Native?.length ?? 0, limit === 'records' ? 1000 : 0);
    }
  });
}

test('invocation origin restores the enclosing context through native publication failure', () => {
  const source = readFileSync(resolve(root, 'node_modules/@univerjs/docs/lib/es/index.js'), 'utf8');
  const value = manager(instrumentNativePhases(source), false, 'history');
  const states = decode(captures.captures[0]).history.slice(0, 6);
  value.instance._historyStateCache = new Map([['unit', states]]);
  value.instance._changeStateCache = new Map([['unit', []]]);
  value.instance._spn135Origin = 'enclosing';
  assert.throws(
    () =>
      value.context.spn135WithOrigin(value.instance, 'history-timer', () =>
        value.instance.flushPendingChanges('unit'),
      ),
    (error) => error === value.failure,
  );
  assert.equal(value.instance._spn135Origin, 'enclosing');
  assert.equal(value.context.__spn135Native[0].origin, 'history-timer');
});
