import { expect, test } from 'vitest';
import {
  DELIMITED_MAX_CELLS,
  DELIMITED_MAX_COLUMNS,
  DELIMITED_MAX_FIELDS,
  DELIMITED_MAX_ROWS,
  delimitedWorkbook,
  delimiterFor,
  parseDelimited,
} from './delimited.ts';

// Contract: fields come back exactly as written. These are pure-parser cases, so they
// run once here and not in the browser matrix.

test('the filename alone selects comma or tab, and nothing else is guessed', () => {
  expect(delimiterFor('a.csv')).toBe(',');
  expect(delimiterFor('A.TSV')).toBe('\t');
  expect(delimiterFor('a.tsv.csv')).toBe(',');
  for (const name of ['a.txt', 'a', 'a.csv.json', 'a.tab', 'a.xlsx', '.csv.bak', undefined, 7])
    expect(delimiterFor(name)).toBeNull();
});

test('comma and tab parse the same table, and the other delimiter stays literal', () => {
  expect(parseDelimited('a,b,c\n1,2,3\n', ',')).toEqual([
    ['a', 'b', 'c'],
    ['1', '2', '3'],
  ]);
  expect(parseDelimited('a\tb\tc\n1\t2\t3\n', '\t')).toEqual([
    ['a', 'b', 'c'],
    ['1', '2', '3'],
  ]);
  expect(parseDelimited('a,b\tc\n', '\t')).toEqual([['a,b', 'c']]);
  expect(parseDelimited('a,b\tc\n', ',')).toEqual([['a', 'b\tc']]);
});

test('the first row is data, empty values stay empty and rows keep their own length', () => {
  expect(parseDelimited('id,name\n1,,\n,\n\n2', ',')).toEqual([
    ['id', 'name'],
    ['1', '', ''],
    ['', ''],
    [''],
    ['2'],
  ]);
});

test('quoted delimiters, line breaks, escaped quotes and empty quoted fields', () => {
  expect(parseDelimited('"a,b","line1\nline2","say ""hi""",""\n', ',')).toEqual([
    ['a,b', 'line1\nline2', 'say "hi"', ''],
  ]);
  expect(parseDelimited('"a\tb"\t"x\r\ny"\n', '\t')).toEqual([['a\tb', 'x\r\ny']]);
});

test('CRLF, LF and lone CR end rows alike; one trailing break adds no row', () => {
  const rows = [
    ['a', 'b'],
    ['c', 'd'],
  ];
  expect(parseDelimited('a,b\r\nc,d\r\n', ',')).toEqual(rows);
  expect(parseDelimited('a,b\nc,d', ',')).toEqual(rows);
  expect(parseDelimited('a,b\rc,d\r', ',')).toEqual(rows);
  expect(parseDelimited('a,b\n\n', ',')).toEqual([['a', 'b'], ['']]);
});

test('a byte-order mark is dropped and Unicode survives intact', () => {
  expect(parseDelimited('﻿nom,emoji\nrené,🐝\n日本語,́', ',')).toEqual([
    ['nom', 'emoji'],
    ['rené', '🐝'],
    ['日本語', '́'],
  ]);
  // Only the first mark is a BOM; a later one is data.
  expect(parseDelimited('﻿﻿x', ',')).toEqual([['﻿x']]);
});

test('no value is trimmed, typed or evaluated', () => {
  const fields = [
    '007',
    '1e3',
    '2026-01-02',
    '  padded  ',
    'TRUE',
    '=SUM(A1:A2)',
    '+1',
    '@x',
    '-5',
    '0x1F',
    "'quoted",
  ];
  expect(parseDelimited(fields.join(','), ',')).toEqual([fields]);
  const sheet = delimitedWorkbook([fields], 'T').sheets['sheet-1'];
  fields.forEach((value, column) => expect(sheet.cellData[0][column]).toEqual({ v: value, t: 1 }));
  expect(JSON.stringify(sheet)).not.toContain('"f"');
  // Quoting does not license trimming either.
  expect(parseDelimited('"  padded  ", ,"\t"\n', ',')).toEqual([['  padded  ', ' ', '\t']]);
  const quoted = delimitedWorkbook([['  padded  ', ' ']], 'T').sheets['sheet-1'];
  expect(quoted.cellData[0][0]).toEqual({ v: '  padded  ', t: 1 });
  expect(quoted.cellData[0][1]).toEqual({ v: ' ', t: 1 });
});

test.each([
  ['an unterminated quote', 'a,"b\nc', 'never closed'],
  ['a quote inside a plain field', 'a,b"c\n', 'inside an unquoted field'],
  ['text after a closing quote', '"a"b,c\n', 'follows a closing quote'],
  ['a NUL character', 'a,b\0\n', 'NUL'],
  ['an empty file', '', 'empty'],
  ['only a byte-order mark', '﻿', 'empty'],
])('malformed input is refused: %s', (_name, text, reason) => {
  expect(() => parseDelimited(text, ',')).toThrow(reason);
});

test('a non-string body is refused', () => {
  for (const value of [undefined, null, 7, ['a'], { a: 1 }])
    expect(() => parseDelimited(value, ',')).toThrow('Choose a file');
});

test('error lines count rows, including breaks inside earlier quoted fields', () => {
  expect(() => parseDelimited('a\n"x\ny"\nb"c\n', ',')).toThrow('line 4');
  expect(() => parseDelimited('a\n"never', ',')).toThrow('line 2');
  // A lone CR is a line break inside quotes too.
  expect(() => parseDelimited('"a\rb"\rc"d\n', ',')).toThrow('line 3');
});

test('row, column, populated-cell and byte limits refuse without parsing further', () => {
  // Blank rows are free, so they exercise the row limit without spending the cell budget.
  const at = (rows: number) => '\n'.repeat(rows);
  expect(parseDelimited(at(DELIMITED_MAX_ROWS), ',')).toHaveLength(DELIMITED_MAX_ROWS);
  expect(() => parseDelimited(at(DELIMITED_MAX_ROWS + 1), ',')).toThrow('100,000 rows');
  const wide = (columns: number) => Array(columns).fill('x').join(',');
  expect(parseDelimited(wide(DELIMITED_MAX_COLUMNS), ',')[0]).toHaveLength(DELIMITED_MAX_COLUMNS);
  expect(() => parseDelimited(wide(DELIMITED_MAX_COLUMNS + 1), ',')).toThrow('1,024 columns');
  // Empty fields are free, so only non-empty ones spend the cell budget.
  const cells = (count: number) =>
    Array.from({ length: Math.ceil(count / 100) }, () => Array(100).fill('x').join(',')).join('\n');
  expect(parseDelimited(cells(DELIMITED_MAX_CELLS), ',').flat()).toHaveLength(DELIMITED_MAX_CELLS);
  expect(() => parseDelimited(cells(DELIMITED_MAX_CELLS) + '\nx', ',')).toThrow(
    '100,000 non-empty',
  );
  expect(
    parseDelimited(`${','.repeat(DELIMITED_MAX_COLUMNS - 1)}\n`.repeat(1000), ','),
  ).toHaveLength(1000);
  // Bare delimiters spend no cell budget, so total fields are bounded too.
  const bare = (rows: number) => `${','.repeat(999)}\n`.repeat(rows);
  expect(parseDelimited(bare(DELIMITED_MAX_FIELDS / 1000), ',').flat()).toHaveLength(
    DELIMITED_MAX_FIELDS,
  );
  // One blank row past the limit is exactly 2,000,001 fields.
  expect(() => parseDelimited(`${bare(DELIMITED_MAX_FIELDS / 1000)}\n`, ',')).toThrow(
    '2,000,000 fields',
  );
  expect(() => parseDelimited('x'.repeat(20 * 1024 * 1024 + 1), ',')).toThrow('20 MiB');
  // The cap is in bytes, not characters: 7,000,000 euro signs are 21 MB.
  expect(() => parseDelimited('€'.repeat(7_000_000), ',')).toThrow('20 MiB');
});

test('the workbook has one worksheet in field and row order, with empty values left empty', () => {
  const book = delimitedWorkbook([['a', '', 'c'], [], ['', 'e']], 'Table');
  expect(book.name).toBe('Table');
  expect(book.sheetOrder).toEqual(['sheet-1']);
  const sheet = book.sheets['sheet-1'];
  expect(sheet.cellData).toEqual({
    0: { 0: { v: 'a', t: 1 }, 2: { v: 'c', t: 1 } },
    2: { 1: { v: 'e', t: 1 } },
  });
  expect([sheet.rowCount, sheet.columnCount]).toEqual([1_000, 20]);
  // The sheet grows only as far as the data needs.
  const big = delimitedWorkbook(
    Array.from({ length: 1_500 }, () => Array(30).fill('x')),
    'Big',
  );
  expect([big.sheets['sheet-1'].rowCount, big.sheets['sheet-1'].columnCount]).toEqual([1_500, 30]);
});
