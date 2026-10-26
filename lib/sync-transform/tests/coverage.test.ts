import { expect, test } from 'vitest';
import { FamilyCoverage } from './coverage.ts';

test('original-mutation fates stay exclusive across refusal, reload and replay', () => {
  const coverage = new FamilyCoverage();
  for (const [label, action] of [
    ['sent', 'edit'],
    ['buffered', 'undo'],
    ['retry', 'redo'],
  ] as const) {
    coverage.generated(label, { family: 'docs', action });
  }
  coverage.finish(['sent'], 'refused');
  coverage.finish(['sent', 'buffered'], 'discarded');
  coverage.finish(['retry'], 'accepted');
  coverage.finish(['retry'], 'accepted');
  coverage.assertSettled();
  expect(coverage.families.get('docs')).toEqual({
    generated: 3,
    accepted: 1,
    refused: 1,
    discarded: 1,
    edit: 1,
    undo: 1,
    redo: 1,
    acceptedUndo: 0,
    acceptedRedo: 1,
  });
});

test('coverage rejects a generated mutation with no acceptance or discard evidence', () => {
  const coverage = new FamilyCoverage();
  coverage.generated('pending', { family: 'structure', action: 'edit' });
  expect(() => coverage.assertSettled()).toThrow('has no terminal outcome');
});

test('two original mutations sharing batch metadata still have independent fates', () => {
  const coverage = new FamilyCoverage();
  const description = { family: 'cuts', action: 'edit' as const };
  coverage.generated('first', description);
  coverage.generated('second', description);
  coverage.finish(['first'], 'accepted');
  expect(() => coverage.assertSettled()).toThrow('second has no terminal outcome');
  coverage.finish(['second'], 'discarded');
  coverage.assertSettled();
  expect(coverage.families.get('cuts')).toMatchObject({ generated: 2, accepted: 1, discarded: 1 });
});
