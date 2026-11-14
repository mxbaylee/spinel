import { createHash } from 'node:crypto';
import { BooleanNumber, FormulaType } from '@univerjs/core';
import type { ICellData } from '@univerjs/core';
import { expect, test } from 'vitest';
import { hashTouched as serverHash } from '@spinel/sync-server';
import { hashTouched } from '../index.ts';
import type { Touched } from '../index.ts';
import { book, doc } from './fixture.ts';

test('browser SHA matches the server and a fixed canonical cell representation', async () => {
  const snapshot = book();
  snapshot.styles = { local: { bl: 1, ul: { s: 1, cl: { rgb: '#123456' } } } };
  snapshot.sheets.one.cellData = {
    0: { 0: { v: 7, t: 2, s: 'local', custom: { z: false, a: 'kept' }, fd: 1 } },
  };
  const touched: Touched = {
    kind: 'sheet',
    cells: [
      { sheetId: 'one', row: 2, column: 3 },
      { sheetId: 'one', row: 0, column: 0 },
    ],
  };
  const representation =
    '[{"column":0,"row":0,"sheetId":"one","value":{"custom":{"a":"kept","z":false},"fd":1,"s":{"bl":1,"ul":{"s":1}},"v":7}},{"column":3,"row":2,"sheetId":"one","value":null}]';
  const expected = createHash('sha256').update(representation).digest('hex');
  expect(serverHash(snapshot, touched)).toBe(expected);
  expect(await hashTouched(snapshot, touched)).toBe(expected);
  const before = structuredClone(snapshot);
  snapshot.sheets.one.cellData[0][0].custom = { a: 'changed', z: false };
  expect(await hashTouched(snapshot, touched)).not.toBe(expected);
  expect(before.styles.local).toEqual({ bl: 1, ul: { s: 1, cl: { rgb: '#123456' } } });
});

test('Doc rich text and formula ranges survive shared normalization', async () => {
  const snapshot = doc();
  snapshot.body!.textRuns = [
    { st: 0, ed: 2, ts: { bl: 1 } },
    { st: 2, ed: 5, ts: { bl: 1 } },
  ];
  snapshot.body!.customRanges = [
    {
      startIndex: 0,
      endIndex: 4,
      rangeId: 'formula',
      rangeType: 0,
      properties: { definition: { source: 'a' } },
    } as never,
  ];
  snapshot.body!.customBlocks = [];
  const touched: Touched = { kind: 'doc' };
  const original = structuredClone(snapshot);
  const hash = await hashTouched(snapshot, touched);
  expect(hash).toBe(serverHash(snapshot, touched));
  expect(snapshot).toEqual(original);
  snapshot.body!.textRuns = [{ st: 0, ed: 5, ts: { bl: 1 } }];
  expect(await hashTouched(snapshot, touched)).toBe(hash);
  snapshot.body!.customRanges![0].rangeId = 'different-formula';
  expect(await hashTouched(snapshot, touched)).not.toBe(hash);
});

test.each<ICellData>([
  { f: '=A1*2' },
  { si: 'shared-formula' },
  { f: '={1,2;3,4}', ft: FormulaType.ARRAY, fd: BooleanNumber.TRUE, ref: 'B1:C2' },
])('formula calculation caches do not change authored-cell verification: %j', async (formula) => {
  const stored = book();
  stored.sheets.one.cellData = {
    0: { 1: { ...formula, s: { bl: 1 }, custom: { retained: 'authored' } } },
  };
  const touched: Touched = { kind: 'sheet', cells: [{ sheetId: 'one', row: 0, column: 1 }] };
  const expected = serverHash(stored, touched);
  const calculated = structuredClone(stored);
  calculated.sheets.one.cellData![0][1].v = 24;
  calculated.sheets.one.cellData![0][1].t = 2;
  const original = structuredClone(calculated);
  expect(await hashTouched(calculated, touched)).toBe(expected);
  expect(serverHash(calculated, touched)).toBe(expected);
  expect(calculated).toEqual(original);

  // Excluding a derived scalar must not hide a changed formula, shared identity,
  // array extent, authored style, rich text, or opaque application metadata.
  for (const changed of [
    { f: '=A1*3' },
    { si: 'different-shared-formula' },
    { ref: 'B1:D3' },
    { fd: BooleanNumber.FALSE },
    { s: { bl: 0 } },
    { p: { id: 'rich', documentStyle: {}, body: { dataStream: 'Authored text\r\n' } } },
    { custom: { retained: 'changed' } },
  ]) {
    const different = structuredClone(calculated);
    Object.assign(different.sheets.one.cellData![0][1], changed);
    expect(await hashTouched(different, touched)).not.toBe(expected);
    expect(serverHash(different, touched)).not.toBe(expected);
  }
});

test.each<ICellData>([
  {},
  { f: '', si: '' },
  { f: 'literal text' },
  { ft: FormulaType.ARRAY, fd: BooleanNumber.TRUE, ref: 'B1:C2' },
  { p: { id: 'rich', documentStyle: {}, body: { dataStream: 'Authored text\r\n' } } },
])('nonformula values remain part of cell verification: %j', async (metadata) => {
  const stored = book();
  stored.sheets.one.cellData = { 0: { 1: { ...metadata, v: 24 } } };
  const touched: Touched = { kind: 'sheet', cells: [{ sheetId: 'one', row: 0, column: 1 }] };
  const expected = serverHash(stored, touched);
  stored.sheets.one.cellData![0][1].v = 42;
  expect(await hashTouched(stored, touched)).not.toBe(expected);
  expect(serverHash(stored, touched)).not.toBe(expected);
});

test('both hashing implementations bound shared-style expansion', async () => {
  const snapshot = book();
  snapshot.styles = { large: { ff: 'x'.repeat(200_000) } };
  snapshot.sheets.one.cellData = {
    0: Object.fromEntries(
      Array.from({ length: 60 }, (_, column) => [column, { v: column, s: 'large' }]),
    ),
  };
  const touched: Touched = {
    kind: 'sheet',
    cells: Array.from({ length: 60 }, (_, column) => ({ sheetId: 'one', row: 0, column })),
  };
  expect(() => serverHash(snapshot, touched)).toThrow();
  await expect(hashTouched(snapshot, touched)).rejects.toMatchObject({ reason: 'capacity' });
});
