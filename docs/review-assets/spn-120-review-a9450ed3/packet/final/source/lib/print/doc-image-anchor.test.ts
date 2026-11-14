import { expect, test } from 'vitest';
import { CustomRangeType } from '@univerjs/core';
import type { IDocumentBody } from '@univerjs/core';
import { moveImageAnchor } from './doc-image-anchor.ts';

test('moving an existing image control preserves authored text, styles and prepared field boundaries', () => {
  const body: IDocumentBody = {
    dataStream: '\x1f7\x1eCafé\b after\r\n',
    paragraphs: [{ startIndex: 14, paragraphId: 'source' }],
    customBlocks: [{ startIndex: 7, blockId: 'image' }],
    customRanges: [
      {
        startIndex: 0,
        endIndex: 2,
        rangeId: 'page',
        rangeType: CustomRangeType.FIELD,
        properties: { fieldType: 'PAGE' },
      },
    ],
    textRuns: [
      { st: 0, ed: 3, sId: 'field', ts: { bl: 1 } },
      { st: 3, ed: 8, sId: 'emphasis', ts: { it: 1 } },
      { st: 8, ed: 16, sId: 'tail', ts: { cl: { rgb: '#112233' } } },
    ],
  };
  const original = structuredClone(body);
  const characters = (value: IDocumentBody) =>
    [...value.dataStream].flatMap((character, index) => {
      if (character === '\b') return [];
      const run = value.textRuns!.find((entry) => entry.st <= index && entry.ed > index);
      return [{ character, sId: run?.sId, ts: run?.ts }];
    });
  moveImageAnchor(body, 'image', 0, () => {});
  expect(body.dataStream).toBe('\b\x1f7\x1eCafé after\r\n');
  expect(body.customBlocks).toEqual([{ startIndex: 0, blockId: 'image' }]);
  expect(body.customRanges).toEqual([{ ...original.customRanges![0], startIndex: 1, endIndex: 3 }]);
  expect(body.paragraphs).toEqual(original.paragraphs);
  expect(characters(body)).toEqual(characters(original));
});

test('image flow refuses a field that contains the moved image anchor', () => {
  const body: IDocumentBody = {
    dataStream: 'A\bB\r\n',
    customBlocks: [{ startIndex: 1, blockId: 'image' }],
    customRanges: [
      { startIndex: 0, endIndex: 2, rangeId: 'field', rangeType: CustomRangeType.FIELD },
    ],
  };
  expect(() => moveImageAnchor(body, 'image', 0, () => {})).toThrowError(
    'PDF image flow cannot split a prepared field.',
  );
});
