import { expect, test } from 'vitest';
import { LocaleType, getDocsEmptySnapshot } from '@univerjs/core';
import type { IWorkbookData } from '@univerjs/core';
import { snapshotIdentity } from './snapshotIdentity.ts';

test('generation rebasing preserves sheets, styles, text and opaque resources while updating known self references', () => {
  const old = 'old-unit';
  const resources = [
    {
      name: 'SHEET_DRAWING_PLUGIN',
      data: JSON.stringify({
        first: {
          unitId: old,
          subUnitId: 'first',
          order: ['drawing'],
          data: {
            drawing: { unitId: old, subUnitId: 'first', source: '/api/items/stable/images/hash' },
          },
        },
      }),
    },
    {
      name: 'SHEET_RANGE_THEME_MODEL_PLUGIN',
      data: JSON.stringify({
        rangeThemeStyleRuleMap: {
          rule: {
            themeName: 'custom',
            rangeInfo: { unitId: old, subUnitId: 'first', range: { startRow: 0, endRow: 1 } },
          },
        },
        rangeThemeStyleMapJson: { custom: { name: 'custom' } },
      }),
    },
    ...['SHEET_WORKSHEET_PROTECTION_PLUGIN', 'SHEET_WORKSHEET_PROTECTION_POINT_PLUGIN'].map(
      (name) => ({
        name,
        data: JSON.stringify({
          [old]: [{ unitId: old, subUnitId: 'first', permissionId: 'permission' }],
        }),
      }),
    ),
    {
      name: 'SHEET_DEFINED_NAME_PLUGIN',
      data: JSON.stringify({
        myRange: {
          id: 'name-id',
          formulaOrRefString: '=[old-unit]Sheet1!A1',
          localSheetId: 'first',
        },
      }),
    },
    { name: 'OPAQUE_PLUGIN', data: '{ "unitId": "old-unit", "text": "old-unit" }' },
  ];
  const snapshot: IWorkbookData = {
    id: old,
    name: 'Budget',
    appVersion: '1.1.0',
    locale: LocaleType.EN_US,
    sheetOrder: ['first', 'second'],
    styles: { strong: { bl: 1 } },
    resources,
    sheets: {
      first: {
        id: 'first',
        name: 'Sheet1',
        rowCount: 20,
        columnCount: 10,
        cellData: {
          0: {
            0: { v: old, s: 'strong' },
            1: { f: '=[old-unit]Sheet1!A1' },
            2: { f: '=INDIRECT("[old-unit]Sheet1!A1")' },
            3: { f: '="old-unit"' },
            4: {
              p: {
                ...getDocsEmptySnapshot('cell-doc'),
                drawings: {
                  image: {
                    unitId: 'cell-doc',
                    subUnitId: 'cell-doc',
                    source: '/api/items/stable/images/hash',
                  },
                },
              } as unknown as ReturnType<typeof getDocsEmptySnapshot>,
            },
          },
        },
      },
      second: {
        id: 'second',
        name: 'Other',
        rowCount: 20,
        columnCount: 10,
        cellData: { 0: { 0: { f: '=Sheet1!A1' } } },
      },
    },
  };
  const original = JSON.stringify(snapshot);
  const changed = snapshotIdentity(snapshot, 'new-unit');
  expect(changed.id).toBe('new-unit');
  expect(changed.sheetOrder).toEqual(snapshot.sheetOrder);
  expect(changed.styles).toEqual(snapshot.styles);
  expect(changed.sheets.first.cellData?.[0]?.[0]).toEqual({ v: old, s: 'strong' });
  expect(changed.sheets.first.cellData?.[0]?.[1]?.f).toBe('=[new-unit]Sheet1!A1');
  expect(changed.sheets.first.cellData?.[0]?.[2]?.f).toBe('=INDIRECT("[new-unit]Sheet1!A1")');
  expect(changed.sheets.first.cellData?.[0]?.[3]?.f).toBe('="old-unit"');
  // Embedded cell images belong to their own Doc unit, not the enclosing workbook.
  expect(changed.sheets.first.cellData?.[0]?.[4]).toEqual(snapshot.sheets.first.cellData?.[0]?.[4]);
  expect(changed.sheets.second).toEqual(snapshot.sheets.second);
  const data = (name: string) => JSON.parse(changed.resources!.find((r) => r.name === name)!.data);
  expect(data('SHEET_DRAWING_PLUGIN').first.data.drawing).toMatchObject({
    unitId: 'new-unit',
    subUnitId: 'first',
    source: '/api/items/stable/images/hash',
  });
  expect(data('SHEET_RANGE_THEME_MODEL_PLUGIN').rangeThemeStyleRuleMap.rule.rangeInfo.unitId).toBe(
    'new-unit',
  );
  expect(data('SHEET_WORKSHEET_PROTECTION_PLUGIN')['new-unit']).toEqual([
    { unitId: 'new-unit', subUnitId: 'first', permissionId: 'permission' },
  ]);
  expect(data('SHEET_DEFINED_NAME_PLUGIN').myRange.formulaOrRefString).toBe('=[new-unit]Sheet1!A1');
  expect(changed.resources!.at(-1)).toEqual(resources.at(-1));
  expect(JSON.stringify(snapshot)).toBe(original);
  expect(snapshotIdentity(changed, old)).toEqual(snapshot);
});

test('document drawing IDs change without touching image paths or comment subunits', () => {
  const snapshot = {
    ...getDocsEmptySnapshot('old-unit'),
    drawings: {
      picture: {
        unitId: 'old-unit',
        subUnitId: 'old-unit',
        source: '/api/items/stable/images/hash',
      },
    },
    resources: [
      { name: 'THREAD_COMMENT_PLUGIN', data: '{"unitId":"old-unit","subUnitId":"default_doc"}' },
    ],
  };
  const changed = snapshotIdentity(
    snapshot as unknown as ReturnType<typeof getDocsEmptySnapshot>,
    'new-unit',
  );
  expect(changed.drawings?.picture).toMatchObject({
    unitId: 'new-unit',
    subUnitId: 'new-unit',
    source: '/api/items/stable/images/hash',
  });
  expect(changed.resources).toEqual(snapshot.resources);
});
