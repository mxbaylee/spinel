import assert from 'node:assert/strict';
import { test } from 'node:test';
import { observeNativeDocComposition } from '../../src/ui/nativeDocFlushDiagnostic.ts';

function fixture() {
  const cache = { history: [{ ownUndefined: undefined }], collaboration: [{ actions: [] }] };
  const composer = {
    compose(left: unknown, right: unknown) {
      return [left, right];
    },
  };
  const manager = {
    getStateCache() {
      return cache;
    },
    _pushHistory(unit: string) {
      const output = composer.compose(unit, cache.history);
      cache.history = [];
      return output;
    },
    _emitChangeState(unit: string) {
      const output = composer.compose(unit, cache.collaboration);
      cache.collaboration = [];
      return output;
    },
    flushPendingChanges(unit: string) {
      const output = this._pushHistory(unit);
      this._emitChangeState(unit);
      return output;
    },
  };
  return { cache, manager, composer };
}

test('native diagnostic delegates exact calls, losslessly retains preflush data and restores methods', () => {
  const { manager, composer, cache } = fixture();
  const originalFlush = manager._pushHistory,
    originalCompose = composer.compose;
  const flushDescriptor = Object.getOwnPropertyDescriptor(manager, '_pushHistory');
  const composeDescriptor = Object.getOwnPropertyDescriptor(composer, 'compose');
  let clock = 0;
  const diagnostic = observeNativeDocComposition(manager, composer, 'doc', () => ++clock);
  const originalHistory = cache.history;
  assert.deepEqual(manager.flushPendingChanges('doc'), ['doc', originalHistory]);
  const report = diagnostic.finish();
  assert.equal(report.dropped, 0);
  assert.equal(report.restored, true);
  assert.equal(report.states, 2);
  assert.equal(report.captures.length, 2);
  assert.equal(report.calls.length, 2);
  assert.ok(JSON.stringify(report.captures[0].cache).includes('"kind":"undefined"'));
  assert.ok((report.captures[0].captureEndedAt as number) < (report.calls[0].startedAt as number));
  assert.equal(manager._pushHistory, originalFlush);
  assert.equal(composer.compose, originalCompose);
  assert.deepEqual(Object.getOwnPropertyDescriptor(manager, '_pushHistory'), flushDescriptor);
  assert.deepEqual(Object.getOwnPropertyDescriptor(composer, 'compose'), composeDescriptor);
  assert.equal(diagnostic.finish().captures.length, 2);
});

test('nonterminal scalar snapshot preserves ownership and continued native observation', () => {
  const { manager, composer, cache } = fixture();
  const diagnostic = observeNativeDocComposition(manager, composer, 'doc');
  const wrapper = manager._pushHistory;
  manager.flushPendingChanges('doc');
  const first = diagnostic.snapshot();
  assert.deepEqual(
    { ...first, observedAt: 0 },
    {
      unitId: 'doc',
      observedAt: 0,
      states: 2,
      phases: 2,
      dropped: 0,
      errors: [],
      activePair: null,
      stopped: false,
      ownsMethods: true,
      phasesReturned: true,
    },
  );
  assert.equal(manager._pushHistory, wrapper);
  cache.history = [{ ownUndefined: undefined }];
  cache.collaboration = [{ actions: [] }];
  manager.flushPendingChanges('doc');
  assert.equal(diagnostic.snapshot().states, 4);
  assert.equal(diagnostic.finish().captures.length, 4);
  assert.equal(diagnostic.snapshot().stopped, true);
  assert.equal(diagnostic.snapshot().ownsMethods, false);
});

test('capture errors do not change native behavior and remain incomplete evidence', () => {
  const { manager, composer, cache } = fixture();
  let reads = 0;
  Object.defineProperty(cache.history[0], 'accessor', {
    get() {
      reads++;
      return 1;
    },
  });
  const diagnostic = observeNativeDocComposition(manager, composer, 'doc');
  manager.flushPendingChanges('doc');
  const result = diagnostic.finish();
  assert.equal(reads, 0);
  assert.equal(result.dropped, 1);
  assert.equal(result.restored, true);
  assert.equal(result.captures.length, 1);
  assert.match(result.errors[0], /accessor/);
});

test('native exceptions survive instrumentation and restoration', () => {
  const { manager, composer } = fixture();
  const failure = new Error('native failure');
  composer.compose = () => {
    throw failure;
  };
  const diagnostic = observeNativeDocComposition(manager, composer, 'doc');
  assert.throws(
    () => manager.flushPendingChanges('doc'),
    (error) => error === failure,
  );
  const result = diagnostic.finish();
  assert.equal(result.restored, true);
  assert.equal(result.calls[0].outcome, 'threw');
  assert.equal(result.captures[0].outcome, 'threw');
});

test('diagnostic overflow and replacement ownership cannot look complete', () => {
  const { manager, composer, cache } = fixture();
  const diagnostic = observeNativeDocComposition(manager, composer, 'doc');
  for (let index = 0; index < 81; index++) {
    cache.history = [{ ownUndefined: undefined }];
    cache.collaboration = [{ actions: [] }];
    manager.flushPendingChanges('doc');
  }
  const replacement = () => [];
  composer.compose = replacement;
  const result = diagnostic.finish();
  assert.equal(result.captures.length, 160);
  assert.ok(result.dropped > 0);
  assert.equal(result.restored, false);
  assert.equal(composer.compose, replacement);
});
