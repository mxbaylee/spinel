import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  captureWaitingReplacement,
  hasActivatedReplacement,
  upgradeWorkerState,
} from '../../e2e/offline-upgrade-worker-state.ts';

function transition() {
  const original = { state: 'activated' as ServiceWorkerState };
  const replacement = { state: 'installed' as ServiceWorkerState };
  const registration = {
    active: original,
    waiting: null as typeof replacement | null,
  };
  return {
    original,
    replacement,
    registration,
    control: {
      original,
      replacement: null as typeof replacement | null,
      registration,
      result: null as null | { ok: boolean },
    },
  };
}

test('waiting capture rejects the premature first hosted observation synchronously', () => {
  const { control, registration, replacement } = transition();
  assert.equal(captureWaitingReplacement(control), false);
  assert.equal(control.replacement, null);
  registration.waiting = replacement;
  replacement.state = 'installing';
  assert.equal(captureWaitingReplacement(control), false);
  replacement.state = 'installed';
  assert.equal(captureWaitingReplacement(control), true);
  assert.equal(control.replacement, replacement);
  assert.deepEqual(upgradeWorkerState(control), {
    active: 'activated',
    activeIsOriginal: true,
    activeIsReplacement: false,
    original: 'activated',
    waiting: 'installed',
    waitingIsReplacement: true,
    replacement: 'installed',
    preparation: null,
  });
});

test('waiting capture requires the pending original event and a distinct replacement', () => {
  const { control, original, registration, replacement } = transition();
  registration.waiting = original;
  assert.equal(captureWaitingReplacement(control), false);
  registration.waiting = replacement;
  registration.active = replacement;
  assert.equal(captureWaitingReplacement(control), false);
  registration.active = original;
  control.result = { ok: false };
  assert.equal(captureWaitingReplacement(control), false);
});

test('activation rejects both premature hosted states and requires the captured worker', () => {
  const { control, original, registration, replacement } = transition();
  registration.waiting = replacement;
  assert.equal(captureWaitingReplacement(control), true);
  control.result = { ok: false };
  registration.waiting = null;
  // The old worker is still active even though there is no waiting slot.
  assert.equal(hasActivatedReplacement(control), false);
  registration.active = replacement;
  original.state = 'redundant';
  replacement.state = 'activating';
  assert.equal(hasActivatedReplacement(control), false);
  replacement.state = 'activated';
  registration.active = { state: 'activated' };
  assert.equal(hasActivatedReplacement(control), false);
  registration.active = replacement;
  original.state = 'activated';
  assert.equal(hasActivatedReplacement(control), false);
  original.state = 'redundant';
  registration.waiting = replacement;
  assert.equal(hasActivatedReplacement(control), false);
  registration.waiting = null;
  control.result = { ok: true };
  assert.equal(hasActivatedReplacement(control), false);
  control.result = { ok: false };
  assert.equal(hasActivatedReplacement(control), true);
  const completed = upgradeWorkerState(control);
  assert.equal(completed.active, 'activated');
  assert.equal(completed.activeIsReplacement, true);
  assert.equal(completed.original, 'redundant');
});
