import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { LocaleType } from '@univerjs/core';
import type { IWorkbookData } from '@univerjs/core';
import { NativeModel } from '../src/native.ts';

// A real Node process has no DOM Image constructor. Background formula work
// must neither crash later nor alter authored data after a synchronous load.
assert.equal(typeof globalThis.Image, 'undefined');
const source: IWorkbookData = {
  id: 'headless-formulas',
  name: 'Headless formula fixture',
  appVersion: '1.1.0',
  locale: LocaleType.EN_US,
  styles: {},
  sheetOrder: ['one'],
  sheets: {
    one: {
      id: 'one',
      name: 'One',
      rowCount: 10,
      columnCount: 5,
      cellData: {
        0: {
          0: { f: '=IMAGE("https://tracker.invalid/initial.png")' },
          1: { f: '=2*3' },
          2: { f: '=4*5', v: 20 },
        },
      },
    },
  },
};
const model = new NativeModel(source, 'sheet');
try {
  const loaded = model.snapshot();
  await setTimeout(100);
  assert.deepEqual(model.snapshot(), loaded);
  const first = (loaded as IWorkbookData).sheets.one.cellData![0];
  assert.equal(first[0].f, source.sheets.one.cellData![0][0].f);
  assert.equal(first[1].v, undefined);
  assert.equal(first[2].v, 20);
  const after = model.apply([
    {
      id: 'sheet.mutation.set-range-values',
      params: {
        unitId: source.id,
        subUnitId: 'one',
        cellValue: { 1: { 0: { f: '=IMAGE("https://tracker.invalid/edit.png")' }, 1: { v: 7 } } },
      },
    },
  ]);
  await setTimeout(100);
  assert.deepEqual(model.snapshot(), after);
  assert.equal((after as IWorkbookData).sheets.one.cellData![1][1].v, 7);
  assert.equal(
    (after as IWorkbookData).sheets.one.cellData![1][0].f,
    '=IMAGE("https://tracker.invalid/edit.png")',
  );
} finally {
  model.dispose();
}
process.stdout.write('headless authored formulas preserved\n');
