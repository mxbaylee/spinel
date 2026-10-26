import { CustomRangeType } from '@univerjs/core';
import type { IDocumentData } from '@univerjs/core';
import { expect, test } from 'vitest';
import { PRINT_LIMITS } from './contract.ts';
import { prepareDocSnapshot } from './doc-preparation.ts';
import type { PreparedDocFormulaResult } from './doc-formulas.ts';
import {
  docInput,
  retainDocPdf,
  runDocJobs,
  tableDoc,
  textDoc,
} from './doc-native-test-support.ts';

const expression = 'PRIVATE NESTED FORMULA';
const compact = (text: string) => text.replace(/\s+/gu, '');
const summary = (value: unknown) =>
  JSON.stringify(value, (key, item) => (key === 'bytes' ? '<bytes>' : item));

function nestedDocument(width = 270, merged = false): IDocumentData {
  const snapshot = tableDoc([merged ? [expression, ''] : [expression]], ['BEFORE-NESTED'], 36);
  const table = snapshot.tableSource!['native-table'];
  table.size.width.v = width;
  for (const column of table.tableColumns) column.size.width.v = width / table.tableColumns.length;
  for (const cell of table.tableRows[0].tableCells) {
    cell.size!.width.v = width / table.tableColumns.length;
    cell.margin = {
      start: { v: 12, u: 3 },
      end: { v: 18, u: 3 },
      top: { v: 7, u: 3 },
      bottom: { v: 9, u: 3 },
    };
  }
  if (merged) {
    table.tableRows[0].tableCells[0].columnSpan = 2;
    table.tableRows[0].tableCells[0].size!.width.v = width;
    table.tableRows[0].tableCells[1].columnSpan = 0;
  }
  const startIndex = snapshot.body!.dataStream.indexOf(expression);
  snapshot.body!.customRanges = [
    {
      rangeId: 'nested',
      rangeType: CustomRangeType.CUSTOM,
      wholeEntity: true,
      startIndex,
      endIndex: startIndex + expression.length - 1,
      properties: { expression, sourceName: 'PRIVATE SOURCE NAME', owner: 'PRIVATE OWNER' },
    },
  ];
  return snapshot;
}

async function nestedInput(snapshot: IDocumentData, result: PreparedDocFormulaResult) {
  const input = await docInput(snapshot);
  input.formulas = [{ rangeId: 'nested', result }];
  return input;
}

test('nested 2-by-2 Formula tables resolve against the actual cell viewport and merged-cell span', async () => {
  const rows = [
    ['VALUE-A1', 'VALUE-B1'],
    ['VALUE-A2', 'VALUE-B2'],
  ];
  const snapshots = [nestedDocument(), nestedDocument(360, true)];
  const inputs = await Promise.all(
    snapshots.map((snapshot) => nestedInput(snapshot, { kind: 'array', rows })),
  );
  const results = await runDocJobs(inputs.map((input) => ({ input })));
  for (const [index, result] of results.entries()) {
    expect(result, summary(result)).toMatchObject({
      ok: true,
      pages: 1,
      restored: true,
      remainingFonts: 0,
    });
    const pages = await retainDocPdf(
      index ? 'nested-formula-merged-cell' : 'nested-formula-cell',
      result.bytes!,
    );
    const text = compact(pages[0].text);
    for (const value of ['BEFORE-NESTED', ...rows.flat(), 'TABLE-END-SENTINEL'])
      expect(text.split(compact(value))).toHaveLength(2);
    expect(text).not.toContain('PRIVATE');
    const first = pages[0].items.find((item) => item.str.includes('VALUE-A1'))!;
    const second = pages[0].items.find((item) => item.str.includes('VALUE-B1'))!;
    // 12/18 px native outer-cell margins leave 240 or 330 px; two equal
    // generated columns occupy half that exact viewport, including merged spans.
    expect(second.transform[4] - first.transform[4]).toBeCloseTo(
      ((index ? 330 : 240) * 0.75) / 2,
      1,
    );
    expect(second.transform[4] + second.width).toBeLessThan(
      (48 + (index ? 360 : 270) - 18) * 0.75 + 1,
    );
  }
}, 60_000);

test('thirty nested Formula rows continue completely without an editor atomic-table height limit', async () => {
  const rows = Array.from({ length: 30 }, (_, index) => [
    `ROW-${String(index).padStart(2, '0')}`,
    `Complete value ${String(index).padStart(2, '0')}`,
  ]);
  const snapshot = nestedDocument(330);
  snapshot.documentStyle.pageSize = { width: 600, height: 340 };
  const [result] = await runDocJobs([
    { input: await nestedInput(snapshot, { kind: 'table', rows }) },
  ]);
  expect(result, summary(result)).toMatchObject({ ok: true, restored: true, remainingFonts: 0 });
  const pages = await retainDocPdf('nested-formula-thirty-rows', result.bytes!);
  expect(pages.length).toBeGreaterThan(2);
  const text = compact(pages.map((page) => page.text).join(''));
  for (const value of ['BEFORE-NESTED', ...rows.flat(), 'TABLE-END-SENTINEL'])
    expect(text.split(compact(value))).toHaveLength(2);
  expect(pages.at(-1)!.text).toContain('TABLE-END-SENTINEL');
  expect(text).not.toContain('PRIVATE');
}, 60_000);

test('deeply nested Formula output uses each containing viewport instead of the document width', async () => {
  const first = nestedDocument(300);
  const nested = prepareDocSnapshot(
    first,
    [{ rangeId: 'nested', result: { kind: 'table', rows: [[expression]] } }],
    PRINT_LIMITS,
    () => {},
  ).snapshot;
  const startIndex = nested.body!.dataStream.indexOf(expression);
  nested.body!.customRanges = [
    {
      rangeId: 'nested',
      rangeType: CustomRangeType.CUSTOM,
      wholeEntity: true,
      startIndex,
      endIndex: startIndex + expression.length - 1,
    },
  ];
  const rows = [
    ['INNER-A', 'INNER-B'],
    ['INNER-C', 'INNER-D'],
  ];
  const [result] = await runDocJobs([
    { input: await nestedInput(nested, { kind: 'table', rows }) },
  ]);
  expect(result, summary(result)).toMatchObject({ ok: true, pages: 1 });
  const pages = await retainDocPdf('nested-formula-two-levels', result.bytes!);
  const text = compact(pages[0].text);
  for (const value of rows.flat()) expect(text.split(value)).toHaveLength(2);
  const firstCell = pages[0].items.find((item) => item.str.includes('INNER-A'))!;
  const secondCell = pages[0].items.find((item) => item.str.includes('INNER-B'))!;
  expect(secondCell.transform[4] - firstCell.transform[4]).toBeCloseTo(
    ((300 - 12 - 18 - 5 - 5) * 0.75) / 2,
    1,
  );
}, 60_000);

test('explicit nested widths must fit the native cell and failure returns no bytes before recovery', async () => {
  const fitting = await nestedInput(nestedDocument(270), {
    kind: 'table',
    rows: [['LEFT', 'RIGHT']],
    columnWidths: [70, 90],
  });
  const overflowing = await nestedInput(nestedDocument(270), {
    kind: 'table',
    rows: [['LEFT', '']],
    columnWidths: [100, 200],
  });
  const [good, bad, recovered] = await runDocJobs([
    { input: fitting },
    { input: overflowing },
    { input: await docInput(textDoc(['AFTER-NESTED-FAILURE'])) },
  ]);
  expect(good, summary(good)).toMatchObject({ ok: true, pages: 1 });
  const pages = await retainDocPdf('nested-formula-explicit-widths', good.bytes!);
  expect(pages[0].text).toContain('RIGHT');
  expect(bad, summary(bad)).toMatchObject({
    ok: false,
    code: 'unsupported',
    restored: true,
    remainingFonts: 0,
  });
  expect(bad.bytes).toBeUndefined();
  expect(recovered, summary(recovered)).toMatchObject({
    ok: true,
    pages: 1,
    restored: true,
    remainingFonts: 0,
  });
  await retainDocPdf('after-nested-formula-failure', recovered.bytes!);
}, 60_000);

test('body Formula tables fit the second native section column without covering adjacent content', async () => {
  const snapshot = textDoc(['LEFT-COLUMN', '\vRIGHT-COLUMN', expression, 'AFTER-COLUMN-TABLE']);
  snapshot.body!.sectionBreaks = [{
    sectionId: 'two-columns', startIndex: snapshot.body!.dataStream.length - 1,
    columnProperties: [{ width: 240, paddingEnd: 24 }, { width: 240, paddingEnd: 0 }],
  }];
  const startIndex = snapshot.body!.dataStream.indexOf(expression);
  snapshot.body!.customRanges = [{
    rangeId: 'nested', rangeType: CustomRangeType.CUSTOM, wholeEntity: true,
    startIndex, endIndex: startIndex + expression.length - 1,
  }];
  const rows = [['COL-A1', 'COL-B1'], ['COL-A2', 'COL-B2']];
  const [result] = await runDocJobs([{ input: await nestedInput(snapshot, { kind: 'table', rows }) }]);
  expect(result, summary(result)).toMatchObject({ ok: true, pages: 1, restored: true, remainingFonts: 0 });
  const pages = await retainDocPdf('formula-second-section-column', result.bytes!);
  const text = compact(pages[0].text);
  for (const value of ['LEFT-COLUMN', 'RIGHT-COLUMN', ...rows.flat(), 'AFTER-COLUMN-TABLE'])
    expect(text.split(value)).toHaveLength(2);
  const first = pages[0].items.find((item) => item.str.includes('COL-A1'))!;
  const second = pages[0].items.find((item) => item.str.includes('COL-B1'))!;
  expect(first.transform[4]).toBeGreaterThan(234);
  expect(second.transform[4] - first.transform[4]).toBeCloseTo(240 * 0.75 / 2, 1);
  expect(second.transform[4] + second.width).toBeLessThan((600 - 48) * 0.75);
}, 60_000);
