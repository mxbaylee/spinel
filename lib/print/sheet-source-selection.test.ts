import { expect, test, vi } from 'vitest';
import { ImageSourceType, LocaleType } from '@univerjs/core';
import type { ICellData, IWorkbookData } from '@univerjs/core';
import sharp from 'sharp';
import { PrintError } from './contract.ts';
import { selectSheetImageSources } from './index.ts';
import { prepareSheetLayout } from './layout.ts';

function picture(source: string): ICellData {
  return {
    p: {
      id: 'cell',
      documentStyle: {},
      body: { dataStream: '\b\r\n', customBlocks: [{ startIndex: 0, blockId: 'picture' }] },
      drawingsOrder: ['picture'],
      drawings: {
        picture: {
          drawingId: 'picture',
          unitId: 'cell',
          subUnitId: 'cell',
          drawingType: 0,
          layoutType: 0,
          imageSourceType: ImageSourceType.UUID,
          source,
          docTransform: {
            size: { width: 10, height: 10 },
            positionH: { relativeFrom: 1, posOffset: 0 },
            positionV: { relativeFrom: 1, posOffset: 0 },
            angle: 0,
          },
        },
      },
    },
  } as ICellData;
}

function drawing(id: string, extra: Record<string, unknown> = {}) {
  return {
    drawingId: id,
    unitId: 'book',
    subUnitId: 'one',
    drawingType: 0,
    source: id,
    anchorType: '2',
    transform: { left: 0, top: 0, width: 20, height: 20 },
    ...extra,
  };
}

function fixture(): IWorkbookData {
  const group = (id: string, extra: Record<string, unknown> = {}) =>
    drawing(id, {
      drawingType: 6,
      source: undefined,
      groupBaseBound: { left: 0, top: 0, width: 20, height: 20 },
      ...extra,
    });
  const collapsed = {
    anchorType: '1',
    sheetTransform: {
      from: { row: 4, column: 1, rowOffset: 0, columnOffset: 0 },
      to: { row: 5, column: 2, rowOffset: 0, columnOffset: 0 },
    },
  };
  const data = {
    root: group('root'),
    visible: drawing('visible', { groupId: 'root', source: 'visible-floating' }),
    duplicate: drawing('duplicate', { groupId: 'root', source: 'visible-floating' }),
    nested: group('nested', { groupId: 'root', hidden: true }),
    nestedLeaf: drawing('nestedLeaf', { groupId: 'nested' }),
    hiddenLeaf: drawing('hiddenLeaf', { groupId: 'root', hidden: true }),
    hiddenRoot: group('hiddenRoot', { hidden: true }),
    hiddenChild: drawing('hiddenChild', { groupId: 'hiddenRoot' }),
    collapsed: drawing('collapsed', collapsed),
    collapsedGroup: group('collapsedGroup', collapsed),
    collapsedChild: drawing('collapsedChild', { groupId: 'collapsedGroup' }),
    absolute: drawing('absolute', {
      source: 'visible-negative',
      transform: { left: -10, top: -10, width: 20, height: 20 },
    }),
  };
  return {
    id: 'book',
    name: 'Selection',
    appVersion: '1.1.0',
    locale: LocaleType.EN_US,
    styles: {},
    sheetOrder: ['one', 'collapsed', 'hidden'],
    sheets: {
      one: {
        id: 'one',
        rowCount: 8,
        columnCount: 5,
        defaultRowHeight: 24,
        defaultColumnWidth: 80,
        rowData: { 0: { hd: 1 }, 2: { hd: 1 }, 4: { hd: 1 }, 5: { hd: 1 } },
        columnData: { 0: { hd: 1 }, 3: { hd: 1 } },
        mergeData: [{ startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 }],
        cellData: {
          0: { 0: picture('visible-merge') },
          1: { 1: picture('nonanchor') },
          2: { 2: picture('hidden-row') },
          3: { 3: picture('hidden-column') },
          6: { 1: picture('filtered') },
        },
        backgroundImage: { source: 'visible-background', imageSourceType: ImageSourceType.UUID },
      },
      collapsed: {
        id: 'collapsed',
        rowCount: 2,
        columnCount: 1,
        columnData: { 0: { hd: 1 } },
        backgroundImage: { source: 'collapsed-background', imageSourceType: ImageSourceType.UUID },
      },
      hidden: {
        id: 'hidden',
        hidden: 1,
        backgroundImage: { source: 'hidden-sheet', imageSourceType: ImageSourceType.UUID },
      },
    },
    resources: [
      {
        name: 'SHEET_DRAWING_PLUGIN',
        data: JSON.stringify({ one: { data, order: Object.keys(data) } }),
      },
      {
        name: 'SHEET_FILTER_PLUGIN',
        data: JSON.stringify({
          one: {
            ref: { startRow: 0, endRow: 7, startColumn: 0, endColumn: 4 },
            cachedFilteredOut: [6],
          },
        }),
      },
    ],
  };
}

test('host metadata and native layout agree on hidden axes, merge anchors, groups and collapsed drawings', async () => {
  const source = fixture();
  const original = structuredClone(source);
  const expected = ['visible-merge', 'visible-floating', 'visible-negative', 'visible-background'];
  expect(selectSheetImageSources(source)).toEqual(expected);
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#8020f0' } })
    .png()
    .toBuffer();
  const native = await prepareSheetLayout(
    source,
    expected.map((source) => ({ source, bytes })),
    { width: 595, height: 842 },
  );
  expect([...native.images.keys()]).toEqual(expected);
  expect(source).toEqual(original);
  expect(selectSheetImageSources(source, { worksheetIds: ['collapsed', 'hidden'] })).toEqual([]);
});

test('uncached formula or theme-dependent filters keep possible sources until worker preparation', () => {
  const source = fixture();
  source.sheetOrder = ['one'];
  source.sheets = {
    one: {
      id: 'one',
      rowCount: 3,
      columnCount: 2,
      cellData: {
        0: { 0: { v: 'Header' } },
        1: { 0: { f: '=1', v: 0 }, 1: picture('formula-row') },
      },
    },
  };
  const filter = {
    ref: { startRow: 0, endRow: 2, startColumn: 0, endColumn: 1 },
    filterColumns: [{ colId: 0, filters: { filters: ['1'] } }],
  };
  const save = (value: unknown) => {
    source.resources = [{ name: 'SHEET_FILTER_PLUGIN', data: JSON.stringify({ one: value }) }];
  };
  save(filter);
  expect(selectSheetImageSources(source)).toEqual(['formula-row']);
  delete source.sheets.one.cellData![1][0]!.v;
  expect(selectSheetImageSources(source)).toEqual(['formula-row']);
  save({ ...filter, cachedFilteredOut: [1] });
  expect(selectSheetImageSources(source)).toEqual([]);
  delete source.sheets.one.cellData![1][0]!.f;
  source.sheets.one.cellData![1][0]!.v = 0;
  save(filter);
  expect(selectSheetImageSources(source)).toEqual([]);
  source.resources!.push({
    name: 'SHEET_RANGE_THEME_MODEL_PLUGIN',
    data: '{"rangeThemeStyleRuleMap":{"pending":{}}}',
  });
  expect(selectSheetImageSources(source)).toEqual(['formula-row']);
});

test('Sheet source metadata retains malformed, source, work and cancellation safeguards', () => {
  const source = fixture();
  const getter = vi.fn(() => 'private');
  Object.defineProperty(source, 'name', { enumerable: true, get: getter });
  expect(() => selectSheetImageSources(source)).toThrow(PrintError);
  expect(getter).not.toHaveBeenCalled();
  expect(() => selectSheetImageSources(fixture(), { limits: { images: 1 } })).toThrow(
    'too many drawings',
  );
  const controller = new AbortController();
  controller.abort();
  expect(() => selectSheetImageSources(fixture(), { signal: controller.signal })).toThrow(
    'cancelled',
  );
  for (const change of [
    (data: Record<string, Record<string, unknown>>) => {
      data.visible.source = 17;
    },
    (data: Record<string, Record<string, unknown>>) => {
      data.visible.groupId = 'absent';
    },
    (data: Record<string, Record<string, unknown>>) => {
      data.root.groupId = 'nested';
    },
  ]) {
    const bad = fixture();
    const resource = JSON.parse(bad.resources![0].data);
    change(resource.one.data);
    bad.resources![0].data = JSON.stringify(resource);
    expect(() => selectSheetImageSources(bad)).toThrow(PrintError);
  }
});
