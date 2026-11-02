import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { instrumentNativePhases, idleCaptureSource } from './spn135-native-phases.ts';

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
  return { instance, published, phases, failure };
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

test('idle capture preserves own undefined, array holes and original cache', () => {
  // Node strips the exact TypeScript overlay before VM evaluation.
  const { stripTypeScriptTypes } = require('node:module');
  const pending = { history: [{ own: undefined, holes: new Array(2) }], collaboration: [] };
  const before = structuredClone(pending);
  const context: any = {
    pending,
    reason: 'idle',
    quietForMs: 301,
    performance: { now: () => 1, measure() {} },
    TextEncoder,
  };
  runInNewContext(stripTypeScriptTypes(idleCaptureSource), context);
  assert.equal(context.__spn135CaptureError, undefined);
  assert.deepEqual(structuredClone(decode(context.__spn135Idle[0].cache)), before);
  assert.deepEqual(pending, before);
  context.pending = { history: [() => {}], collaboration: [] };
  runInNewContext(stripTypeScriptTypes(idleCaptureSource), context);
  assert.match(context.__spn135CaptureError, /Unsupported/);
  assert.equal(context.__spn135Idle.length, 1);
});
