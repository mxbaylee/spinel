import { expect, test } from 'vitest';
import { CustomRangeType } from '@univerjs/core';
import type { IDocumentData } from '@univerjs/core';
import { PRINT_LIMITS, PrintError } from './contract.ts';
import { prepareDocSnapshot } from './doc-preparation.ts';

function linked(): IDocumentData {
  return {
    id: 'document',
    documentStyle: {},
    body: {
      dataStream: 'Before Linked text after\r\n',
      textRuns: [{ st: 8, ed: 12, ts: { bl: 1, cl: { rgb: '#aabbcc' } } }],
      customRanges: [
        {
          rangeId: 'link',
          rangeType: CustomRangeType.HYPERLINK,
          startIndex: 7,
          endIndex: 17,
          properties: { url: 'https://private.invalid/account', sourceName: 'private account' },
        },
      ],
    },
  };
}
const prepare = (snapshot: IDocumentData) =>
  prepareDocSnapshot(snapshot, [], PRINT_LIMITS, () => {}).snapshot;

test('link text retains exact content, underline, color and rich styles without destinations', () => {
  const source = linked();
  const prepared = prepare(source);
  expect(prepared.body!.dataStream).toBe(source.body!.dataStream);
  expect(prepared.body!.textRuns).toEqual([
    { st: 7, ed: 8, ts: { ul: { s: 1 }, cl: { rgb: '#2563eb' } } },
    { st: 8, ed: 12, ts: { bl: 1, ul: { s: 1 }, cl: { rgb: '#2563eb' } } },
    { st: 12, ed: 18, ts: { ul: { s: 1 }, cl: { rgb: '#2563eb' } } },
  ]);
  expect(JSON.stringify(prepared)).not.toContain('private');
  expect(source.body!.customRanges).toHaveLength(1);
});

test('text color/style modes and hidden link annotations retain authored appearance', () => {
  const source = linked();
  source.body!.customRanges![0].properties!.textColorMode = 'text';
  const color = prepare(source);
  expect(color.body!.textRuns![1].ts).toEqual({ bl: 1, cl: { rgb: '#aabbcc' }, ul: { s: 1 } });
  source.body!.customRanges![0].properties!.textStyleMode = 'text';
  expect(prepare(source).body!.textRuns).toEqual(source.body!.textRuns);
  delete source.body!.customRanges![0].properties!.textStyleMode;
  Object.assign(source.body!.customRanges![0], { show: false });
  expect(prepare(source).body!.textRuns).toEqual(source.body!.textRuns);
});

test('links preserve named character styles outside and inside their ranges', () => {
  const source = linked();
  source.styles = {
    emphasis: { name: 'Emphasis', type: 0, textStyle: { bl: 1, ff: 'Times New Roman' } },
  };
  source.body!.textRuns = [
    { st: 0, ed: 6, sId: 'emphasis' },
    { st: 8, ed: 12, sId: 'emphasis', ts: { it: 1 } },
  ];
  const result = prepare(source);
  expect(result.body!.textRuns!.find((run) => run.st === 0)).toMatchObject({
    st: 0,
    ed: 6,
    sId: 'emphasis',
  });
  expect(result.body!.textRuns!.find((run) => run.st === 8)).toMatchObject({
    sId: 'emphasis',
    ts: { it: 1, ul: { s: 1 } },
  });
  expect(result.styles).toEqual(source.styles);
});

test('Formula replacement shifts complete linked text but never retains either private source', () => {
  const source = linked();
  source.body!.customRanges!.push({
    rangeId: 'formula',
    rangeType: CustomRangeType.CUSTOM,
    wholeEntity: true,
    startIndex: 0,
    endIndex: 5,
    properties: { source: 'secret formula' },
  });
  const prepared = prepareDocSnapshot(
    source,
    [{ rangeId: 'formula', result: { kind: 'scalar', value: 42 } }],
    PRINT_LIMITS,
    () => {},
  ).snapshot;
  expect(prepared.body!.dataStream).toBe('42 Linked text after\r\n');
  expect(prepared.body!.textRuns!.find((run) => run.st === 3)?.ts?.ul).toEqual({ s: 1 });
  expect(JSON.stringify(prepared)).not.toContain('secret');
  expect(JSON.stringify(prepared)).not.toContain('private');
});

test('overlapping or split-grapheme links fail before projection', () => {
  const source = linked();
  source.body!.customRanges!.push({
    ...source.body!.customRanges![0],
    rangeId: 'second',
    startIndex: 10,
  });
  expect(() => prepare(source)).toThrow(PrintError);
  const emoji = linked();
  emoji.body!.dataStream = 'A😀Z\r\n';
  emoji.body!.textRuns = [];
  emoji.body!.customRanges![0].startIndex = 2;
  emoji.body!.customRanges![0].endIndex = 3;
  expect(() => prepare(emoji)).toThrow(PrintError);
});
