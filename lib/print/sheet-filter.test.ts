import { expect, test } from 'vitest';
import { CellValueType, LocaleType, Styles } from '@univerjs/core';
import type { IWorkbookData } from '@univerjs/core';
import { CustomFilterOperator, FilterModel } from '@univerjs/sheets-filter';
import type { IAutoFilter, IFilterColumn } from '@univerjs/sheets-filter';
import { PRINT_LIMITS, PrintError } from './contract.ts';
import { filteredSheetRows } from './sheet-filter.ts';
import { PrintWorksheet } from './worksheet.ts';

function worksheet() {
  const book: IWorkbookData = {
    id: 'filter-parity',
    name: 'Filter parity',
    appVersion: '1.1.0',
    locale: LocaleType.EN_US,
    styles: { money: { n: { pattern: '$#,##0.00' } } },
    sheetOrder: ['one'],
    sheets: {
      one: {
        id: 'one',
        rowCount: 12,
        columnCount: 5,
        mergeData: [{ startRow: 10, endRow: 11, startColumn: 0, endColumn: 0 }],
        cellData: {
          0: { 0: { v: 'Header' } },
          1: { 0: { v: 1250.5, s: 'money' }, 1: { v: 'Keep' }, 3: { v: 'Keep' } },
          2: {
            0: { v: '12', t: CellValueType.NUMBER, s: 'money' },
            1: { v: 'Drop' },
            3: { v: 'Drop' },
          },
          3: { 0: { v: true, t: CellValueType.BOOLEAN }, 1: { v: 'Keep' } },
          4: { 0: { v: false, t: CellValueType.BOOLEAN }, 1: { v: 'Wild*literal' } },
          5: {
            0: { p: { id: 'rich-cell', documentStyle: {}, body: { dataStream: 'Rich text\r\n' } } },
            1: { v: null },
          },
          6: {
            0: { v: 0, s: { bg: { rgb: '#ff0000' }, cl: { rgb: '#00ff00' } } },
            1: { v: 'Wildcard' },
          },
          7: { 0: { v: -2, s: { bg: { rgb: 'rgb(255,0,0)' }, cl: { rgb: '#000000' } } } },
          8: { 0: { v: '12', t: CellValueType.FORCE_STRING } },
          9: { 0: { v: '' } },
          10: { 0: { v: 42, t: CellValueType.NUMBER } },
        },
      },
    },
  };
  return new PrintWorksheet(book, book.sheets.one, new Styles(book.styles));
}

const ref = { startRow: 0, endRow: 11, startColumn: 0, endColumn: 4 };
const cases: [string, IFilterColumn[]][] = [
  [
    'displayed values and rich text',
    [{ colId: 0, filters: { filters: ['$1,250.50', '$12.00', 'Rich text', 'TRUE'] } }],
  ],
  ['blanks', [{ colId: 0, filters: { blank: true, filters: [] } }]],
  [
    'normalized fill colors',
    [{ colId: 0, colorFilters: { cellFillColors: ['rgb(255,0,0)', null] } }],
  ],
  [
    'default and explicit text colors',
    [{ colId: 0, colorFilters: { cellTextColors: ['rgb(0,0,0)', 'rgb(0,255,0)'] } }],
  ],
  ['wildcard text', [{ colId: 1, customFilters: { customFilters: [{ val: 'Wild*' }] } }]],
  [
    'escaped wildcard text',
    [{ colId: 1, customFilters: { customFilters: [{ val: 'Wild~*literal' }] } }],
  ],
  [
    'text inequality',
    [
      {
        colId: 1,
        customFilters: {
          customFilters: [{ val: 'Wild*', operator: CustomFilterOperator.NOT_EQUALS }],
        },
      },
    ],
  ],
  [
    'nonblank inequality',
    [
      {
        colId: 0,
        customFilters: { customFilters: [{ val: ' ', operator: CustomFilterOperator.NOT_EQUALS }] },
      },
    ],
  ],
  [
    'numeric AND',
    [
      {
        colId: 0,
        customFilters: {
          and: 1,
          customFilters: [
            { val: 0, operator: CustomFilterOperator.GREATER_THAN_OR_EQUAL },
            { val: 42, operator: CustomFilterOperator.LESS_THAN_OR_EQUAL },
          ],
        },
      },
    ],
  ],
  [
    'numeric OR and other column',
    [
      {
        colId: 0,
        customFilters: {
          customFilters: [
            { val: -1, operator: CustomFilterOperator.LESS_THAN },
            { val: 40, operator: CustomFilterOperator.GREATER_THAN },
          ],
        },
      },
      { colId: 1, filters: { blank: true, filters: ['Keep'] } },
    ],
  ],
  ...Object.values(CustomFilterOperator).map((operator): [string, IFilterColumn[]] => [
    `numeric ${operator}`,
    [{ colId: 0, customFilters: { customFilters: [{ val: '12', operator }] } }],
  ]),
];

test.each(cases)(
  'pure saved filter matches the public native model: %s',
  (_name, filterColumns) => {
    const filter: IAutoFilter = { ref, filterColumns };
    const native = FilterModel.deserialize('filter-parity', 'one', worksheet(), filter);
    try {
      expect(
        [...filteredSheetRows(worksheet(), filter, PRINT_LIMITS, () => {})].sort((a, b) => a - b),
      ).toEqual([...native.filteredOutRows].sort((a, b) => a - b));
    } finally {
      native.dispose();
    }
  },
);

test.each([undefined, [], [1, 3]])(
  'non-A filter columns are absolute and preserve saved cache %j',
  (cachedFilteredOut) => {
    // The public command and serializer retain the absolute D-column ID even
    // when the selected filter range starts in C.
    const filter: IAutoFilter = {
      ref: { ...ref, startColumn: 2 },
      filterColumns: [{ colId: 3, filters: { filters: ['Keep'] } }],
      ...(cachedFilteredOut === undefined ? {} : { cachedFilteredOut }),
    };
    const native = FilterModel.deserialize('filter-parity', 'one', worksheet(), filter);
    try {
      const result = filteredSheetRows(worksheet(), filter, PRINT_LIMITS, () => {});
      expect([...result].sort((a, b) => a - b)).toEqual(
        [...native.filteredOutRows].sort((a, b) => a - b),
      );
      if (cachedFilteredOut === undefined) {
        expect(result.has(1)).toBe(false);
        expect(result.has(2)).toBe(true);
      } else expect([...result]).toEqual(cachedFilteredOut);
    } finally {
      native.dispose();
    }
  },
);

function textWorksheet(values: string[]) {
  const book: IWorkbookData = {
    id: 'wildcard-parity',
    name: 'Wildcard parity',
    appVersion: '1.1.0',
    locale: LocaleType.EN_US,
    styles: {},
    sheetOrder: ['one'],
    sheets: {
      one: {
        id: 'one',
        rowCount: values.length + 1,
        columnCount: 1,
        cellData: Object.fromEntries(values.map((v, index) => [index + 1, { 0: { v } }])),
      },
    },
  };
  return new PrintWorksheet(book, book.sheets.one, new Styles(book.styles));
}

function textFilter(values: string[], val: string, operator?: CustomFilterOperator): IAutoFilter {
  return {
    ref: { startRow: 0, endRow: values.length, startColumn: 0, endColumn: 0 },
    filterColumns: [{ colId: 0, customFilters: { customFilters: [{ val, operator }] } }],
  };
}

test.each([
  '',
  '*',
  '?',
  '**a*b',
  '*a*a*b',
  'a?b',
  '.*',
  '[a]',
  '~*',
  '(a)+',
  '\\*',
  '*\n*',
  '?\r?',
  '*\u2028*',
  '*\u2029*',
  'Σ*',
  'k',
  's',
  'ß',
  'é',
  '\ud83d?',
])('bounded wildcard %j retains native literal, newline and UTF-16 semantics', (pattern) => {
  const values = [
    '',
    'a',
    'b',
    'AAb',
    'abc',
    'aab',
    'axbyb',
    'a\nb',
    'a\rb',
    'a\r\nb',
    'a\u2028b',
    'a\u2029b',
    'a\n',
    '.*',
    '.xyz',
    '[a]',
    '~',
    '~literal',
    '(a)+',
    '\\abc',
    'Σ',
    'σ',
    'ς',
    'K',
    'K',
    'S',
    'ſ',
    'ß',
    'SS',
    'É',
    '😀',
  ];
  for (const operator of [undefined, CustomFilterOperator.NOT_EQUALS]) {
    const filter = textFilter(values, pattern, operator);
    const native = FilterModel.deserialize('wildcard-parity', 'one', textWorksheet(values), filter);
    try {
      expect([...filteredSheetRows(textWorksheet(values), filter, PRINT_LIMITS, () => {})]).toEqual(
        [...native.filteredOutRows],
      );
    } finally {
      native.dispose();
    }
  }
});

test('wildcard work is shared across rows and fails without a partial filter result', () => {
  const values = ['a'.repeat(40), 'a'.repeat(40)];
  const limits = { ...PRINT_LIMITS, gridCells: 24 };
  expect(
    filteredSheetRows(
      textWorksheet(values.slice(0, 1)),
      textFilter(values.slice(0, 1), '*a'),
      limits,
      () => {},
    ),
  ).toEqual(new Set());
  expect(() =>
    filteredSheetRows(textWorksheet(values), textFilter(values, '*a'), limits, () => {}),
  ).toThrow('wildcard work budget');
});

test('wildcard matching reaches the deadline/cancellation checkpoint within one long cell', () => {
  const values = ['a'.repeat(8_000)];
  let checks = 0;
  expect(() =>
    filteredSheetRows(textWorksheet(values), textFilter(values, '*a'), PRINT_LIMITS, () => {
      if (++checks > 10) throw new PrintError('cancelled', 'Cancelled during filtering');
    }),
  ).toThrow('Cancelled during filtering');
});

test('a saved filter cache does not spend work on an unused wildcard', () => {
  const values = ['a'];
  const filter = { ...textFilter(values, '*a'.repeat(100)), cachedFilteredOut: [] };
  expect(
    filteredSheetRows(textWorksheet(values), filter, { ...PRINT_LIMITS, gridCells: 1 }, () => {}),
  ).toEqual(new Set());
});
