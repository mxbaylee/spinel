import { ICommandService, IUniverInstanceService, UniverInstanceType } from '@univerjs/core';
import type { ICommand, Workbook } from '@univerjs/core';
import {
  AddWorksheetMergeMutation,
  InsertColMutation,
  InsertRowMutation,
  InsertSheetMutation,
  SetWorksheetColumnCountMutation,
  SetWorksheetRowCountMutation,
} from '@univerjs/sheets';
import { expect, test, vi } from 'vitest';
import { captureNative, NativeReplica } from '../index.ts';
import type { ClientFailure } from '../index.ts';
import { book } from './fixture.ts';

const oneCell = { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 };
const huge = { ...oneCell, endRow: 1000, endColumn: 1000 };
const insertedSheet = { id: 'three', name: 'Three', rowCount: 12, columnCount: 6 };

function fixture(command: ICommand<any, boolean>) {
  // Replace the real exported handler before registration. Even a broken
  // admission hook cannot allocate the intentionally huge cache in this test.
  const handler = vi.spyOn(command, 'handler').mockReturnValue(true);
  const replica = new NativeReplica(book(), 'sheet');
  const injector = replica.univer.__getInjector();
  const workbook = injector
    .get(IUniverInstanceService)
    .getUnit<Workbook>('book', UniverInstanceType.UNIVER_SHEET)!;
  const commands = injector.get(ICommandService);
  const failures: ClientFailure[] = [];
  const outgoing = vi.fn();
  const capture = captureNative({
    univer: replica.univer,
    unitId: 'book',
    onMutation: outgoing,
    onFailure: (reason) => failures.push(reason),
  });
  handler.mockClear();
  return {
    handler,
    workbook,
    failures,
    outgoing,
    apply(params: object) {
      return commands.syncExecuteCommand(command.id, {
        unitId: 'book',
        subUnitId: 'one',
        ...params,
      });
    },
    close() {
      capture.dispose();
      replica.dispose();
      handler.mockRestore();
    },
  };
}

test.each<{
  name: string;
  command: ICommand<any, boolean>;
  params: object;
  reason: ClientFailure;
}>([
  {
    name: 'compact merge',
    command: AddWorksheetMergeMutation,
    params: { ranges: [huge] },
    reason: 'capacity',
  },
  {
    name: 'inserted sheet merge',
    command: InsertSheetMutation,
    params: { index: 2, sheet: { ...insertedSheet, mergeData: [huge] } },
    reason: 'capacity',
  },
  {
    name: 'aggregate new merges',
    command: AddWorksheetMergeMutation,
    params: {
      ranges: [
        { ...oneCell, endRow: 249, endColumn: 499 },
        { startRow: 250, endRow: 500, startColumn: 0, endColumn: 499 },
      ],
    },
    reason: 'capacity',
  },
  {
    name: 'reversed merge',
    command: AddWorksheetMergeMutation,
    params: { ranges: [{ ...oneCell, endRow: -1 }] },
    reason: 'malformed',
  },
  {
    name: 'inserted sheet row count',
    command: InsertSheetMutation,
    params: { index: 2, sheet: { ...insertedSheet, rowCount: 1_048_577 } },
    reason: 'capacity',
  },
  {
    name: 'inserted sheet column count',
    command: InsertSheetMutation,
    params: { index: 2, sheet: { ...insertedSheet, columnCount: 16_385 } },
    reason: 'capacity',
  },
  {
    name: 'row count update',
    command: SetWorksheetRowCountMutation,
    params: { rowCount: 1_048_577 },
    reason: 'capacity',
  },
  {
    name: 'column count update',
    command: SetWorksheetColumnCountMutation,
    params: { columnCount: 16_385 },
    reason: 'capacity',
  },
  {
    name: 'missing row count',
    command: SetWorksheetRowCountMutation,
    params: {},
    reason: 'malformed',
  },
  {
    name: 'out-of-bounds inserted row',
    command: InsertRowMutation,
    params: { range: { ...oneCell, startRow: 1_048_576, endRow: 1_048_576 } },
    reason: 'capacity',
  },
  {
    name: 'out-of-bounds inserted column',
    command: InsertColMutation,
    params: { range: { ...oneCell, startColumn: 16_384, endColumn: 16_384 } },
    reason: 'capacity',
  },
])('rejects $name before the native handler is invoked', ({ command, params, reason }) => {
  const f = fixture(command);
  try {
    expect(f.apply(params)).toBe(false);
    expect(f.handler).not.toHaveBeenCalled();
    expect(f.outgoing).not.toHaveBeenCalled();
    expect(f.failures).toEqual([reason]);
  } finally {
    f.close();
  }
});

test.each([AddWorksheetMergeMutation, InsertSheetMutation])(
  'counts existing live merge caches before $id',
  (command) => {
    const f = fixture(command);
    const sheet = f.workbook.getSheetBySheetId('one')!;
    const config = sheet.getConfig();
    // Only the public getter reports this budget; no large SpanModel is built.
    const state = vi
      .spyOn(sheet, 'getConfig')
      .mockReturnValue({ ...config, mergeData: [{ ...oneCell, endRow: 499, endColumn: 499 }] });
    const params =
      command.id === AddWorksheetMergeMutation.id
        ? { ranges: [oneCell] }
        : { index: 2, sheet: { ...insertedSheet, mergeData: [oneCell] } };
    try {
      expect(f.apply(params)).toBe(false);
      expect(f.handler).not.toHaveBeenCalled();
      expect(f.failures).toEqual(['capacity']);
      state.mockRestore();
      // A preceding removal frees the budget: read the current model each time.
      expect(f.apply(params)).toBe(true);
      expect(f.handler).toHaveBeenCalledTimes(1);
      expect(f.outgoing).toHaveBeenCalledTimes(1);
    } finally {
      state.mockRestore();
      f.close();
    }
  },
);

test.each([
  [InsertRowMutation, 'getRowCount', 1_048_576],
  [InsertColMutation, 'getColumnCount', 16_384],
] as const)('bounds the resulting axis count before $id', (command, method, count) => {
  const f = fixture(command);
  const state = vi.spyOn(f.workbook.getSheetBySheetId('one')!, method).mockReturnValue(count);
  try {
    expect(f.apply({ range: oneCell })).toBe(false);
    expect(f.handler).not.toHaveBeenCalled();
    expect(f.failures).toEqual(['capacity']);
  } finally {
    state.mockRestore();
    f.close();
  }
});

test('bounds the worksheet count before constructing another native sheet', () => {
  const f = fixture(InsertSheetMutation);
  const state = vi
    .spyOn(f.workbook, 'getSheetOrders')
    .mockReturnValue(Array.from({ length: 1024 }, (_, index) => `sheet-${index}`));
  try {
    expect(f.apply({ index: 1024, sheet: insertedSheet })).toBe(false);
    expect(f.handler).not.toHaveBeenCalled();
    expect(f.failures).toEqual(['capacity']);
  } finally {
    state.mockRestore();
    f.close();
  }
});
