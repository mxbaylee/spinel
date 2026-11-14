import { CustomRangeType, DocxBreakType } from '@univerjs/core';
import type { ICustomRange } from '@univerjs/core';
import { expect, test } from 'vitest';
import { PRINT_LIMITS } from './contract.ts';
import { prepareDocSnapshot } from './doc-preparation.ts';
import { textDoc } from './doc-native-test-support.ts';

function snapshot() {
  const result = textDoc(['FIRST\vSECOND']);
  result.body!.customRanges = [
    {
      rangeId: 'native-break',
      rangeType: CustomRangeType.CUSTOM,
      wholeEntity: true,
      startIndex: 5,
      endIndex: 5,
      properties: { breakType: DocxBreakType.COLUMN },
    },
  ];
  return result;
}

test('the exact live column-break model survives preparation without a Formula result', () => {
  const input = snapshot();
  const original = structuredClone(input);
  const prepared = prepareDocSnapshot(input, [], PRINT_LIMITS, () => {}).snapshot;
  expect(prepared.body!.dataStream).toBe(input.body!.dataStream);
  expect(prepared.body!.customRanges).toEqual([
    { ...input.body!.customRanges![0], rangeId: 'print-column-break-0' },
  ]);
  expect(input).toEqual(original);
});

test('column-break recognition does not discard extra Formula, rendering, or malformed range state', () => {
  const mutations: ((range: ICustomRange) => void)[] = [
    (range) => {
      range.properties!.spinelFormula = { source: 'PRIVATE' };
    },
    (range) => {
      range.properties!.glyphWidth = 100;
    },
    (range) => {
      range.endIndex++;
    },
    (range) => {
      range.startIndex = range.endIndex = 4;
    },
    (range) => {
      range.wholeEntity = false;
    },
  ];
  for (const mutate of mutations) {
    const input = snapshot();
    mutate(input.body!.customRanges![0]);
    expect(() => prepareDocSnapshot(input, [], PRINT_LIMITS, () => {})).toThrow();
  }
});
