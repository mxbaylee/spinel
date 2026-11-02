import assert from 'node:assert/strict';
import test from 'node:test';
import { createDiagnosticSequence } from './spn135-unsampled.ts';
import { verifySelection } from './spn135-selection.ts';

test('second case requires successful predecessor in the same browser and worker', () => {
  const sequence = createDiagnosticSequence();
  const browser = {};
  assert.throws(() => sequence.begin('plain-2', 0, browser, 0, 100), /completed plain-1/);
  const first = sequence.begin('plain-1', 0, browser, 0, 100);
  assert.equal(first.previousCaseCompleted, false);
  assert.throws(() => sequence.begin('plain-2', 0, browser, 0, 100), /completed plain-1/);
  sequence.complete('plain-1');
  assert.throws(() => sequence.begin('plain-2', 0, {}, 0, 100), /browser changed/);
  assert.throws(() => sequence.begin('plain-2', 0, browser, 1, 100), /worker changed/);
  assert.throws(() => sequence.begin('plain-2', 0, browser, 0, 101), /process changed/);
  const second = sequence.begin('plain-2', 0, browser, 0, 100);
  assert.equal(second.previousCaseCompleted, true);
  assert.equal(second.browserIdentity, first.browserIdentity);
});

test('retry, repeated first case and unrelated cases fail closed', () => {
  const sequence = createDiagnosticSequence();
  assert.throws(() => sequence.begin('plain-1', 1, {}, 0, 100), /retries are forbidden/);
  assert.throws(() => sequence.begin('profile', 0, {}, 0, 100));
  sequence.begin('plain-1', 0, {}, 0, 100);
  assert.throws(() => sequence.begin('plain-1', 0, {}, 0, 100), /repeated/);
});

function report() {
  return {
    errors: [],
    config: { workers: 1, maxFailures: 1, projects: [{ name: 'doc-responsiveness', retries: 0 }] },
    suites: [
      {
        specs: ['plain-1', 'plain-2'].map((sample) => ({
          title: `desktop sustained native typing ${sample}`,
          tests: [{ projectName: 'doc-responsiveness' }],
        })),
      },
    ],
  };
}

test('collection gate rejects omitted, reordered, duplicated or foreign cases', () => {
  verifySelection(report());
  for (const mutate of [
    (value: ReturnType<typeof report>) => value.suites[0].specs.pop(),
    (value: ReturnType<typeof report>) => value.suites[0].specs.reverse(),
    (value: ReturnType<typeof report>) => value.suites[0].specs.push(value.suites[0].specs[0]),
    (value: ReturnType<typeof report>) => (value.suites[0].specs[0].tests[0].projectName = 'smoke'),
  ]) {
    const value = report();
    mutate(value);
    assert.throws(() => verifySelection(value));
  }
});

test('collection gate rejects retries, parallel workers and continuing after failure', () => {
  for (const mutate of [
    (value: ReturnType<typeof report>) => (value.config.workers = 2),
    (value: ReturnType<typeof report>) => (value.config.maxFailures = 0),
    (value: ReturnType<typeof report>) => (value.config.projects[0].retries = 1),
  ]) {
    const value = report();
    mutate(value);
    assert.throws(() => verifySelection(value));
  }
});
