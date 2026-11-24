import assert from 'node:assert/strict';
import type { DocDrainWitness, DocResponsivenessEvidence } from './doc-responsiveness.ts';
import type { observeNativeDocComposition } from '../src/ui/nativeDocFlushDiagnostic.ts';

export const NATIVE_WINDOW = { start: 384, end: 448, total: 2086 } as const;
export type NativeWindowInput = { action: 'type' | 'enter'; text: string; completed: number };

/** Only split original keyboard.type spans at the two prospective boundaries. */
export function nativeWindowInput(paragraphs: readonly string[]): NativeWindowInput[] {
  assert.equal(paragraphs.length, 16);
  assert.ok(
    paragraphs.every((text) => /^[\x20-\x7e]+$/.test(text)),
    'Fixed ASCII workload required',
  );
  const result: NativeWindowInput[] = [];
  let completed = 0;
  for (const [index, paragraph] of paragraphs.entries()) {
    if (index) result.push({ action: 'enter', text: '\r', completed: ++completed });
    let remaining = paragraph;
    while (remaining) {
      const boundary = [NATIVE_WINDOW.start, NATIVE_WINDOW.end, NATIVE_WINDOW.total].find(
        (value) => value > completed,
      );
      assert.ok(boundary, 'Input exceeds fixed workload');
      const text = remaining.slice(0, boundary - completed);
      completed += text.length;
      result.push({ action: 'type', text, completed });
      remaining = remaining.slice(text.length);
    }
  }
  assert.equal(completed, NATIVE_WINDOW.total);
  assert.equal(result.filter((entry) => entry.action === 'enter').length, 15);
  assert.equal(result.map((entry) => entry.text).join(''), paragraphs.join('\r'));
  for (const boundary of [NATIVE_WINDOW.start, NATIVE_WINDOW.end])
    assert.equal(result.filter((entry) => entry.completed === boundary).length, 1);
  return result;
}

export type NativeWindowSnapshot = ReturnType<
  ReturnType<typeof observeNativeDocComposition>['snapshot']
>;

/** Validate an actual native witness, never infer completion from keyboard requests. */
export function validateNativeWindowBoundary(
  native: DocResponsivenessEvidence,
  capture: NativeWindowSnapshot,
  armed: DocDrainWitness,
  completed: 384 | 448,
  composition: { active: boolean; starts: number; ends: number },
) {
  const witness = native.drainWitness;
  assert.ok(witness, 'Missing native witness');
  assert.equal(witness.completedStates, completed);
  for (const key of ['epoch', 'unitId', 'generation', 'timeOrigin'] as const)
    assert.equal(witness[key], armed[key], `Changed ${key}`);
  assert.equal(native.unitId, armed.unitId);
  assert.equal(witness.expectedCompletedStates, NATIVE_WINDOW.total);
  assert.equal(witness.sealedAt, null);
  assert.equal(witness.invalidated, false);
  assert.deepEqual(witness.invalidations, []);
  assert.equal(witness.nativeObservationAvailable, true);
  assert.deepEqual(native.pending, { history: 0, collaboration: 0 });
  assert.deepEqual(native.history, { undos: completed / 32, redos: 0 });
  assert.deepEqual(composition, { active: false, starts: 0, ends: 0 });
  assert.equal(capture.unitId, armed.unitId);
  assert.equal(capture.states, completed * 2);
  assert.equal(capture.phases, (completed / 32) * 2);
  assert.equal(capture.dropped, 0);
  assert.deepEqual(capture.errors, []);
  assert.equal(capture.activePair, null);
  assert.equal(capture.stopped, false);
  assert.equal(capture.ownsMethods, true);
  assert.equal(capture.phasesReturned, true);
  const pairs = witness.nativeFlushes.filter((entry) => entry.phase === 'pair');
  assert.equal(pairs.length, completed / 32);
  for (const [index, pair] of pairs.entries()) {
    assert.equal(pair.completedStates, (index + 1) * 32);
    assert.equal(pair.unitId, armed.unitId);
    assert.equal(pair.epoch, armed.epoch);
    assert.equal(pair.generation, armed.generation);
    assert.equal(pair.origin, 'policy-capacity');
    assert.equal(pair.outcome, 'returned');
    assert.deepEqual(pair.before, { history: 32, collaboration: 32 });
    assert.deepEqual(pair.after, { history: 0, collaboration: 0 });
    assert.ok(Number.isFinite(pair.startedAt) && pair.endedAt >= pair.startedAt);
  }
}
