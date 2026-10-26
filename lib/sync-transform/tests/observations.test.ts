import { JSONX } from '@univerjs/core';
import { formulaBody } from '@spinel/doc-formulas';
import { SYNC_MUTATION_IDS } from '@spinel/diagnostics';
import { expect, test } from 'vitest';
import { MalformedEditError, RefusedEditError, supportedMutationIds, transform } from '../index.ts';
import type { Mutation, TransformObservation } from '../index.ts';
import { nameIds } from '../src/names.ts';
import { settingIds } from '../src/settings.ts';
import { structureIds } from '../src/structure.ts';
import { mergeIds } from '../src/merges.ts';
import { cellIds } from '../src/writes.ts';
import { docIds } from '../src/docs.ts';
import { insertRows, removeSheet, target } from './edits.ts';

const cell = (row: number, col: number, v: string): Mutation => ({
  id: cellIds.setRangeValues,
  params: {
    ...target,
    cellValue: { [row]: { [col]: { v } } },
    trigger: 'sheet.command.set-range-values',
  },
});
const frozen = (value: number): Mutation => ({
  id: settingIds.frozen,
  params: { ...target, frozen: { startRow: value, startColumn: 0, xSplit: 0, ySplit: value } },
});
const named = (name: string): Mutation => ({
  id: nameIds.set,
  params: {
    unitId: target.unitId,
    id: 'name-id',
    name,
    formulaOrRefString: 's1!A1',
    trigger: 'sheet.command.set-defined-name',
  },
});
const capture = (a: Mutation[], b: Mutation[], side: 'right' | 'left' = 'right') => {
  const events: TransformObservation[] = [];
  const result = transform(a, b, side, {
    cells: () => null,
    observe: (event) => events.push(event),
  });
  expect(result).toEqual(transform(a, b, side, { cells: () => null }));
  expect(
    transform(a, b, side, {
      cells: () => null,
      observe: () => {
        throw new Error('observer offline');
      },
    }),
  ).toEqual(result);
  return { result, events };
};

test('diagnostic mutation labels match the accepted protocol vocabulary exactly', () => {
  expect([...SYNC_MUTATION_IDS].filter((id) => id !== 'other').sort()).toEqual(
    [...supportedMutationIds].sort(),
  );
});

test('names, settings, overwritten cells and removed-sheet drops report only counts and fixed rules', () => {
  const cases: [Mutation[], Mutation[], string][] = [
    [[named('Private mine')], [named('Private theirs')], 'name-first-accepted'],
    [[frozen(2)], [frozen(1)], 'setting-first-accepted'],
    [[cell(0, 0, 'Private mine')], [cell(0, 0, 'Private theirs')], 'cell-overwritten'],
    [[frozen(2)], [removeSheet('s1', 'Private title', 0)], 'removed-sheet'],
  ];
  for (const [a, b, rule] of cases) {
    const { events } = capture(a, b);
    expect(events).toContainEqual({ kind: 'dropped', rule, value: 1 });
    expect(JSON.stringify(events)).not.toContain('Private');
  }
  // The reverse bookkeeping path is not delivered to either client.
  expect(
    capture([frozen(2), frozen(3)], [frozen(1)], 'left').events.some(
      (event) => event.kind === 'dropped',
    ),
  ).toBe(false);
});

test('cut merges report exactly the removed ranges in either arrival direction', () => {
  const merge: Mutation = {
    id: mergeIds.add,
    params: { ...target, ranges: [{ startRow: 0, endRow: 3, startColumn: 0, endColumn: 1 }] },
  };
  for (const [a, b] of [
    [[merge], [insertRows(2, 1)]],
    [[insertRows(2, 1)], [merge]],
  ]) {
    expect(capture(a, b).events).toContainEqual({ kind: 'dropped', rule: 'merge-cut', value: 1 });
  }
});

test('competing native Formula entities report their loss without expression or entity IDs', () => {
  const formula = (expression: string): Mutation => {
    const body = formulaBody('private-entity-id', { version: 1, expression, references: [] });
    return {
      id: docIds.richText,
      params: {
        unitId: 'doc',
        actions: JSONX.getInstance().editOp([
          { t: 'i', len: body.dataStream.length, body },
        ] as never),
      },
    };
  };
  const { events } = capture([formula('=PrivateOne')], [formula('=PrivateTwo')]);
  expect(events).toContainEqual({ kind: 'dropped', rule: 'doc-formula-first-accepted', value: 1 });
  expect(JSON.stringify(events)).not.toMatch(/Private|private-entity/);
});

test('a clipped shift reports candidate offsets beside its band, without coordinates', () => {
  const move: Mutation = {
    id: cellIds.moveRange,
    params: {
      unitId: target.unitId,
      fromRange: { startRow: 1, endRow: 2, startColumn: 0, endColumn: 0 },
      toRange: { startRow: 2, endRow: 3, startColumn: 0, endColumn: 0 },
      from: { subUnitId: target.subUnitId, value: { 1: { 0: null }, 2: { 0: null } } },
      to: { subUnitId: target.subUnitId, value: { 2: { 0: { v: 'Private' } } } },
      shift: { axis: 'row', kind: 'insert', at: 1, count: 1 },
    },
  };
  expect(capture([cell(2, 1, 'Private')], [move]).events).toContainEqual({
    kind: 'offset',
    value: 1,
  });
  expect(
    capture([cell(0, 1, 'Private')], [move]).events.some((event) => event.kind === 'offset'),
  ).toBe(false);
});

test('refusals identify mutation types and malformed errors carry stable codes', () => {
  try {
    transform(
      [{ id: settingIds.name, params: { ...target, name: 'Same private title' } }],
      [{ id: settingIds.name, params: { ...target, subUnitId: 's2', name: 'Same private title' } }],
      'right',
    );
    throw new Error('expected refusal');
  } catch (error) {
    expect(error).toBeInstanceOf(RefusedEditError);
    expect(error).toMatchObject({
      reason: 'name-race',
      mutationId: settingIds.name,
      againstMutationId: settingIds.name,
    });
  }
  try {
    transform([{ id: structureIds.removeSheet, params: { ...target } }], [], 'right');
    throw new Error('expected malformed batch');
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
    expect(error).toBeInstanceOf(MalformedEditError);
    expect(error).toMatchObject({ check: 'remove-index' });
  }
});
