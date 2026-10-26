import { afterEach, expect, test, vi } from 'vitest';
import {
  ICommandService,
  ILogService,
  IUniverInstanceService,
  LocaleService,
  LocaleType,
  LogLevel,
  Univer,
  UniverInstanceType,
} from '@univerjs/core';
import type {
  ICellData,
  IObjectMatrixPrimitiveType,
  IWorkbookData,
  IWorksheetData,
  Nullable,
  Workbook,
} from '@univerjs/core';
import { UniverRenderEnginePlugin } from '@univerjs/engine-render';
import { CopySheetCommand, UniverSheetsPlugin } from '@univerjs/sheets';
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import { IMenuManagerService } from '@univerjs/ui';
import {
  canCopySheet,
  SyncSheetMenuPlugin,
  syncSheetMenuConfig,
} from '../../web/syncSheetMenus.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function cells(count: number): NonNullable<IWorksheetData['cellData']> {
  return Object.fromEntries(
    Array.from({ length: count }, (_, row) => [row, { 0: { v: `cell ${row}` } }]),
  );
}

function fixture(count: number) {
  const updateMenuConfig = vi.fn();
  const univer = new Univer({
    locale: LocaleType.EN_US,
  });
  cleanups.push(() => univer.dispose());
  const injector = univer.__getInjector();
  injector.add([IMenuManagerService, { useValue: { updateMenuConfig } as IMenuManagerService }]);
  injector.get(ILogService).setLogLevel(LogLevel.SILENT);
  univer.registerPlugin(UniverRenderEnginePlugin);
  univer.registerPlugin(UniverSheetsPlugin);
  univer.registerPlugin(UniverSheetsFormulaPlugin);
  injector.get(LocaleService).load({ [LocaleType.EN_US]: {} });
  const snapshot: IWorkbookData = {
    id: 'book',
    name: 'Book',
    appVersion: '1.1.0',
    locale: LocaleType.EN_US,
    sheetOrder: ['source', 'empty'],
    styles: {},
    sheets: {
      source: {
        id: 'source',
        name: 'Source',
        rowCount: 7000,
        columnCount: 20,
        cellData: cells(count),
      },
      empty: { id: 'empty', name: 'Empty', rowCount: 7000, columnCount: 20, cellData: {} },
    },
  };
  univer.createUnit(UniverInstanceType.UNIVER_SHEET, snapshot);
  const instances = injector.get(IUniverInstanceService);
  instances.focusUnit('book');
  const book = instances.getUnit<Workbook>('book', UniverInstanceType.UNIVER_SHEET)!;
  book.setActiveSheet(book.getSheetBySheetId('source')!);
  const plugin = new SyncSheetMenuPlugin({}, injector);
  plugin.onRendered();
  cleanups.push(() => plugin.dispose());
  const commands = injector.get(ICommandService);
  return { book, commands, updateMenuConfig };
}

test('unsupported policy controls are hidden without removing names or range moves', () => {
  expect(Object.keys(syncSheetMenuConfig).sort()).toEqual(
    [
      'sheet.command.add-range-protection-from-toolbar',
      'sheet.contextMenu.permission',
      'sheet.command.add-range-protection-from-context-menu',
      'sheet.command.add-range-protection-from-sheet-bar',
      'sheet.command.set-range-protection-from-context-menu',
      'sheet.command.delete-range-protection-from-context-menu',
      'sheet.command.change-sheet-protection-from-sheet-bar',
      'sheet.command.delete-worksheet-protection-from-sheet-bar',
      'sheet.command.view-sheet-permission-from-context-menu',
      'sheet.command.view-sheet-permission-from-sheet-bar',
      'sheets-formula-ui.operation.calculation-options',
      'sheet.command.copy-sheet',
    ].sort(),
  );
  expect(Object.values(syncSheetMenuConfig).every((entry) => entry.hidden === true)).toBe(true);
});

test('the Copy boundary counts stored keys, including explicit empty cells, not sheet dimensions', () => {
  expect(canCopySheet(undefined)).toBe(true);
  expect(canCopySheet(cells(5999))).toBe(true);
  expect(canCopySheet(cells(6000))).toBe(false);
  const sparse: IObjectMatrixPrimitiveType<Nullable<ICellData>> = cells(5999);
  sparse[90000] = { 8: null };
  expect(canCopySheet(sparse)).toBe(false);
});

test('a 5999-cell native copy preserves every cell and never schedules split-copy mutations', async () => {
  const f = fixture(5999);
  const mutations: string[] = [];
  const listener = f.commands.onCommandExecuted((command) => mutations.push(command.id));
  cleanups.push(() => listener.dispose());
  expect(f.updateMenuConfig).toHaveBeenLastCalledWith({ [CopySheetCommand.id]: { hidden: false } });
  expect(
    await f.commands.executeCommand(CopySheetCommand.id, { unitId: 'book', subUnitId: 'source' }),
  ).toBe(true);
  expect(f.book.getSheets()).toHaveLength(3);
  const copied = f.book
    .getSheets()
    .find((sheet) => !['source', 'empty'].includes(sheet.getSheetId()))!;
  expect(copied.getCellMatrix().getMatrix()).toEqual(cells(5999));
  expect(mutations).not.toContain('sheet.mutation.copy-worksheet-end');
});

test('an explicit large-sheet copy is refused before mutation even while an empty sheet is active', async () => {
  const f = fixture(6000);
  expect(f.updateMenuConfig).toHaveBeenLastCalledWith({ [CopySheetCommand.id]: { hidden: true } });
  f.book.setActiveSheet(f.book.getSheetBySheetId('empty')!);
  expect(f.updateMenuConfig).toHaveBeenLastCalledWith({ [CopySheetCommand.id]: { hidden: false } });
  const original = structuredClone(f.book.getSnapshot());
  expect(
    await f.commands.executeCommand(CopySheetCommand.id, { unitId: 'book', subUnitId: 'source' }),
  ).toBe(false);
  expect(f.book.getSnapshot()).toEqual(original);
});

test('crossing the threshold through a peer mutation refreshes an already open Copy menu', async () => {
  const f = fixture(5999);
  expect(f.updateMenuConfig).toHaveBeenLastCalledWith({ [CopySheetCommand.id]: { hidden: false } });
  expect(
    await f.commands.executeCommand(
      'sheet.mutation.set-range-values',
      {
        unitId: 'book',
        subUnitId: 'source',
        cellValue: { 5999: { 0: { v: 'peer edit' } } },
      },
      { fromCollab: true },
    ),
  ).toBe(true);
  expect(f.updateMenuConfig).toHaveBeenLastCalledWith({ [CopySheetCommand.id]: { hidden: true } });
  expect(await f.commands.executeCommand(CopySheetCommand.id)).toBe(false);
  f.book.setActiveSheet(f.book.getSheetBySheetId('empty')!);
  expect(f.updateMenuConfig).toHaveBeenLastCalledWith({ [CopySheetCommand.id]: { hidden: false } });
});
