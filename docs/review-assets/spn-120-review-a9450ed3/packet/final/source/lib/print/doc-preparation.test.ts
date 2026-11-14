import { expect, test } from 'vitest';
import {
  CustomRangeType,
  DocumentFlavor,
  NAMED_STYLE_MAP,
  NamedStyleType,
  NumberUnitType,
  PresetListType,
  resolveDocumentParagraphStyle,
} from '@univerjs/core';
import type { IDocumentData, ITextStyle } from '@univerjs/core';
import { PRINT_LIMITS, PrintError } from './contract.ts';
import { prepareDocFonts, prepareDocSnapshot } from './doc-preparation.ts';
import type { PreparedDocFormula, PreparedDocFormulaResult } from './doc-formulas.ts';
import { PreparedFonts } from './fonts.ts';
import { fixtureFonts } from './font-fixtures.ts';

function document(text = 'Prepared content'): IDocumentData {
  return {
    id: 'private-document-identity',
    title: 'Private title',
    documentStyle: {},
    body: { dataStream: `${text}\r\n` },
  };
}

function formula(result: PreparedDocFormulaResult, prefix = '', suffix = '') {
  const expression = 'PRIVATE SOURCE EXPRESSION';
  const snapshot = document(`${prefix}${expression}${suffix}`);
  snapshot.body!.customRanges = [
    {
      rangeId: 'formula',
      rangeType: CustomRangeType.CUSTOM,
      wholeEntity: true,
      startIndex: prefix.length,
      endIndex: prefix.length + expression.length - 1,
      properties: { sourceName: 'SECRET SOURCE NAME', identity: 'PRIVATE ACCOUNT', expression },
    },
  ];
  const formulas: PreparedDocFormula[] = [{ rangeId: 'formula', result }];
  return { snapshot, formulas };
}

function prepare(snapshot: IDocumentData, formulas: readonly PreparedDocFormula[] = []) {
  return prepareDocSnapshot(snapshot, formulas, PRINT_LIMITS, () => {}).snapshot;
}

test('owns public document data and preserves stored geometry while defining exact A4 fallback', () => {
  const source = document();
  const fallback = prepare(source);
  // Doc paper dimensions remain exact; 48 layout px is exactly 12.7 mm.
  expect(fallback.documentStyle.pageSize!.width! * 0.75).toBeCloseTo((210 * 72) / 25.4, 9);
  expect(fallback.documentStyle.pageSize!.height! * 0.75).toBeCloseTo((297 * 72) / 25.4, 9);
  expect(fallback.documentStyle.marginTop).toBe(48);
  expect(source.documentStyle).toEqual({});
  expect(source.title).toBe('Private title');
  expect(fallback.title).toBeUndefined();
  expect(fallback.id).toBe('print-document');
  source.documentStyle = {
    documentFlavor: DocumentFlavor.MODERN,
    pageSize: { width: 801.25, height: 611.5 },
    marginTop: 31.5,
    marginBottom: 32.25,
    marginLeft: 40,
    marginRight: 41,
  };
  const stored = prepare(source);
  expect(stored.documentStyle).toEqual({
    ...source.documentStyle,
    defaultParagraphStyle: resolveDocumentParagraphStyle(source.documentStyle, undefined),
    documentFlavor: DocumentFlavor.TRADITIONAL,
  });
  expect(stored.body).not.toBe(source.body);
  source.documentStyle.defaultParagraphStyle = { spaceBelow: { v: 4 }, lineSpacing: 1.3 };
  expect(prepare(source).documentStyle.defaultParagraphStyle).toMatchObject({
    spaceBelow: { v: 4 },
    lineSpacing: 1.3,
  });
});

test('rejects malformed data and accessors without evaluating getter or copying invalid content', () => {
  const source = document();
  let called = false;
  Object.defineProperty(source, 'title', {
    enumerable: true,
    get: () => {
      called = true;
      return 'secret';
    },
  });
  expect(() => prepare(source)).toThrow(PrintError);
  expect(called).toBe(false);
  for (const mutate of [
    (input: IDocumentData) => {
      input.body!.dataStream = 'not terminated';
    },
    (input: IDocumentData) => {
      input.documentStyle.pageSize = { width: Infinity, height: 300 };
    },
    (input: IDocumentData) => {
      input.documentStyle.pageSize = { width: 90, height: 300 };
    },
    (input: IDocumentData) => {
      input.body!.paragraphs = [{ paragraphId: 'bad', startIndex: 0 }];
    },
    (input: IDocumentData) => {
      input.body!.textRuns = [{ st: 1, ed: 500, ts: {} }];
    },
  ]) {
    const invalid = document();
    mutate(invalid);
    expect(() => prepare(invalid)).toThrow(PrintError);
  }
});

test('neutral unavailable erases the whole Formula expression and its private metadata', () => {
  const { snapshot, formulas } = formula({ kind: 'unavailable' }, 'Before ', ' after');
  const before = structuredClone(snapshot);
  const projected = prepare(snapshot, formulas);
  expect(projected.body!.dataStream).toBe('Before Unavailable after\r\n');
  expect(projected.body!.customRanges).toBeUndefined();
  expect(JSON.stringify(projected)).not.toMatch(/PRIVATE|SECRET|EXPRESSION/u);
  expect(snapshot).toEqual(before);
  expect(() => prepare(snapshot)).toThrow(PrintError);
  expect(() =>
    prepare(snapshot, [
      {
        rangeId: 'formula',
        result: { kind: 'unavailable', reason: 'PRIVATE NAME' } as PreparedDocFormulaResult,
      },
    ]),
  ).toThrow(PrintError);
});

test('scalar Formula projection shifts following formatting, image anchors and soft breaks', () => {
  const { snapshot, formulas } = formula({ kind: 'scalar', value: 42 }, 'Before ', ' after\b\f');
  const end = snapshot.body!.dataStream.length - 2;
  snapshot.body!.textRuns = [{ st: end - 7, ed: end - 2, ts: { it: 1 } }];
  snapshot.body!.renderedPageBreaks = [end - 1];
  snapshot.body!.customBlocks = [{ startIndex: end - 2, blockId: 'image' }];
  snapshot.drawings = {
    image: {
      drawingId: 'image',
      unitId: 'private',
      subUnitId: 'private',
      drawingType: 0,
      source: 'https://not-fetched.invalid/private',
      layoutType: 0,
      docTransform: { size: { width: 20, height: 20 }, angle: 0 },
    },
  } as unknown as IDocumentData['drawings'];
  const projected = prepare(snapshot, formulas);
  expect(projected.body!.dataStream).toBe('Before 42 after\b\f\r\n');
  expect(projected.body!.customBlocks![0].startIndex).toBe(15);
  expect(projected.body!.renderedPageBreaks).toEqual([16]);
  expect(projected.body!.textRuns?.find((run) => run.ts?.it === 1)).toMatchObject({
    st: 10,
    ed: 15,
  });
  expect(projected.drawings!.image.unitId).toBe('print-document');
  const styled = structuredClone(projected);
  const appearance = styled.drawings!.image as unknown as Record<string, unknown>;
  appearance.opacity = 0.5;
  appearance.srcRect = { left: 4, top: 2 };
  appearance.prstGeom = 'rect';
  expect(prepare(styled).drawings!.image).toMatchObject({
    opacity: 0.5,
    srcRect: { left: 4, top: 2, right: 0, bottom: 0 },
  });
  for (const props of [
    { prstGeom: 'ellipse' },
    { adjustValues: { shape: 1 } },
    { transform: { scaleX: 2 } },
    { srcRect: { left: -100 } },
    { srcRect: { left: 0, unknown: 1 } },
    { opacity: 2 },
  ]) {
    const malformed = structuredClone(styled);
    Object.assign(malformed.drawings!.image, props);
    expect(() => prepare(malformed)).toThrow(PrintError);
  }
  for (const flag of [1, 'yes']) {
    const malformed = structuredClone(projected);
    (malformed.drawings!.image as unknown as Record<string, unknown>).hidden = flag;
    expect(() => prepare(malformed)).toThrow(PrintError);
  }
  for (const [horizontal, vertical] of [
    [
      { relativeFrom: 2, posOffset: 0 },
      { relativeFrom: 1, posOffset: 0 },
    ],
    [
      { relativeFrom: 3, percent: 0.5 },
      { relativeFrom: 1, posOffset: 0 },
    ],
    [
      { relativeFrom: 0, align: 1 },
      { relativeFrom: 1, posOffset: 0 },
    ],
    [
      { relativeFrom: 0, posOffset: 0 },
      { relativeFrom: 4, posOffset: 0 },
    ],
    [
      { relativeFrom: 0, posOffset: 0 },
      { relativeFrom: 1, align: 1 },
    ],
  ]) {
    const malformed = structuredClone(projected);
    const drawing = malformed.drawings!.image;
    drawing.layoutType = 1;
    drawing.docTransform.positionH = horizontal;
    drawing.docTransform.positionV = vertical;
    expect(() => prepare(malformed)).toThrow(PrintError);
  }
});

test('Formula arrays become complete native tables with every row and wrapped/multiline values', () => {
  const rows = Array.from({ length: 30 }, (_, index) => [
    `ROW-${index + 1}`,
    `Prepared paragraph ${index + 1} with enough content to wrap.`,
  ]);
  rows[29][1] = 'LATE VALUE\nSECOND LINE';
  const { snapshot, formulas } = formula({ kind: 'table', rows }, 'Before ', ' after');
  const projected = prepare(snapshot, formulas);
  const table = Object.values(projected.tableSource!)[0];
  expect(table.tableRows).toHaveLength(30);
  expect(
    table.tableRows.every((row) => row.trHeight.hRule === 0 && row.tableCells.length === 2),
  ).toBe(true);
  expect(projected.body!.dataStream).toContain('ROW-30');
  expect(projected.body!.dataStream).toContain('LATE VALUE\rSECOND LINE');
  expect(projected.body!.dataStream).toContain('Before \r\x1a');
  expect(projected.body!.dataStream).toContain('\x0f after\r\n');
  expect(projected.body!.paragraphs).toHaveLength(63);
  expect(snapshot.body!.dataStream).toContain('PRIVATE SOURCE EXPRESSION');
});

test('Formula scalar, unavailable and complete table results project inside native cells', () => {
  const expression = 'PRIVATE NESTED EXPRESSION';
  const base = formula({ kind: 'table', rows: [[expression]] });
  const snapshot = prepare(base.snapshot, base.formulas);
  const start = snapshot.body!.dataStream.indexOf(expression);
  snapshot.body!.customRanges = [
    {
      rangeId: 'nested',
      rangeType: CustomRangeType.CUSTOM,
      wholeEntity: true,
      startIndex: start,
      endIndex: start + expression.length - 1,
      properties: { privateSource: 'PRIVATE SOURCE NAME' },
    },
  ];
  for (const result of [
    { kind: 'scalar', value: 'CELL VALUE' },
    { kind: 'unavailable' },
  ] as PreparedDocFormulaResult[]) {
    const projected = prepare(snapshot, [{ rangeId: 'nested', result }]);
    expect(projected.body!.dataStream).toContain(
      result.kind === 'scalar' ? 'CELL VALUE' : 'Unavailable',
    );
    expect(JSON.stringify(projected)).not.toContain('PRIVATE');
    expect(Object.keys(projected.tableSource!)).toHaveLength(1);
  }
  for (const kind of ['array', 'table'] as const) {
    const projected = prepare(snapshot, [
      { rangeId: 'nested', result: { kind, rows: [['NESTED VALUE']] } },
    ]);
    expect(Object.keys(projected.tableSource!)).toHaveLength(2);
    const nestedRange = projected.body!.tables![1];
    expect(projected.tableSource![nestedRange.tableId].size.width).toEqual({
      v: 100,
      u: NumberUnitType.PERCENT,
    });
    expect(projected.body!.dataStream).toContain('NESTED VALUE');
    expect(JSON.stringify(projected)).not.toContain('PRIVATE');
  }
  const explicit = prepare(snapshot, [
    {
      rangeId: 'nested',
      result: {
        kind: 'table',
        rows: [['NESTED VALUE']],
        columnWidths: [120],
      },
    },
  ]);
  expect(explicit.tableSource![explicit.body!.tables![1].tableId].size.width).toEqual({
    v: 120,
    u: 3,
  });
  expect(snapshot.body!.dataStream).toContain(expression);
});

test('Formula block projection keeps authored paragraph breaks before the result', () => {
  for (const inlinePrefix of ['', 'Inline prefix ']) {
    const { snapshot, formulas } = formula(
      { kind: 'table', rows: [['RESULT']] },
      `BEFORE\r${inlinePrefix}`,
      '\rAFTER',
    );
    snapshot.body!.paragraphs = [...snapshot.body!.dataStream.matchAll(/\r/gu)].map(
      (match, index) => ({
        paragraphId: `paragraph-${index}`,
        startIndex: match.index,
        paragraphStyle: index === 1 ? { pageBreakBefore: 1 } : {},
      }),
    );
    const projected = prepare(snapshot, formulas);
    const breaks = projected.body!.paragraphs!.filter(
      (paragraph) => paragraph.paragraphStyle?.pageBreakBefore === 1,
    );
    expect(breaks).toHaveLength(1);
    if (inlinePrefix) {
      expect(projected.body!.dataStream.slice(0, breaks[0].startIndex)).toBe(
        `BEFORE\r${inlinePrefix}`,
      );
    } else {
      const result = projected.body!.dataStream.indexOf('RESULT');
      expect(breaks[0].startIndex).toBe(result + 'RESULT'.length);
    }
    expect(
      projected.body!.paragraphs!.find((paragraph) => paragraph.paragraphId === 'paragraph-1')!
        .paragraphStyle?.pageBreakBefore,
    ).toBe(0);
  }
});

test('Formula block projection preserves a fitting source paragraph keep chain without forcing an atomic table', () => {
  for (const keepNext of [0, 1] as const) {
    const { snapshot, formulas } = formula(
      { kind: 'table', rows: Array.from({ length: 30 }, (_, index) => [`Row ${index}`]) },
      'Inline ',
      ' suffix',
    );
    snapshot.body!.paragraphs = [
      {
        paragraphId: 'source',
        startIndex: snapshot.body!.dataStream.length - 2,
        paragraphStyle: { keepLines: 1, keepNext },
      },
    ];
    const projected = prepare(snapshot, formulas);
    const source = projected.body!.paragraphs!.find(
      (paragraph) => paragraph.paragraphId === 'source',
    )!;
    expect(source.paragraphStyle).toMatchObject({ keepLines: 1, keepNext });
    const generated = projected.body!.paragraphs!.filter((paragraph) => paragraph !== source);
    expect(generated).toHaveLength(31);
    expect(generated.every((paragraph) => paragraph.paragraphStyle?.keepNext === 1)).toBe(true);
    expect(Object.values(projected.tableSource!)[0].tableRows).toHaveLength(30);
    expect(projected.body!.dataStream).toContain('Row 29');
  }
});

test('prepared results cannot inject native tokens or bypass aggregate projection limits', () => {
  for (const result of [
    { kind: 'scalar', value: '\x1a malicious table' },
    { kind: 'scalar', value: NaN },
    { kind: 'array', rows: [['one'], ['two', 'unexpected']] },
    { kind: 'table', rows: [['one']], columnWidths: [99999] },
  ] as PreparedDocFormulaResult[]) {
    const { snapshot, formulas } = formula(result);
    expect(() => prepare(snapshot, formulas)).toThrow(PrintError);
  }
  const { snapshot, formulas } = formula({
    kind: 'table',
    rows: [
      ['one', 'two'],
      ['three', 'four'],
    ],
  });
  expect(() =>
    prepareDocSnapshot(snapshot, formulas, { ...PRINT_LIMITS, cells: 3 }, () => {}),
  ).toThrow('budget');
  expect(() =>
    prepareDocSnapshot(snapshot, formulas, { ...PRINT_LIMITS, textCharacters: 30 }, () => {}),
  ).toThrow('budget');
  expect(() =>
    prepareDocSnapshot(snapshot, formulas, PRINT_LIMITS, () => {
      throw new PrintError('cancelled', 'cancelled');
    }),
  ).toThrow('cancelled');
});

test('Formula projection preserves heading, named paragraph and named character typography', async () => {
  const fonts = new PreparedFonts(
    await fixtureFonts(),
    'Atkinson Hyperlegible',
    ['Noto Sans Symbols 2'],
    PRINT_LIMITS,
  );
  for (const result of [
    { kind: 'scalar', value: 'Styled result' },
    { kind: 'table', rows: [['Styled result']] },
  ] as PreparedDocFormulaResult[]) {
    const { snapshot, formulas } = formula(result);
    snapshot.styles = {
      emphasisBase: { name: 'Base', type: 0, textStyle: { cl: { rgb: '#665588' } } },
      emphasis: { name: 'Emphasis', type: 0, basedOn: 'emphasisBase', textStyle: { it: 1 } },
    };
    snapshot.body!.paragraphs = [
      {
        paragraphId: 'heading',
        startIndex: snapshot.body!.dataStream.length - 2,
        paragraphStyle: { namedStyleType: NamedStyleType.HEADING_1 },
      },
    ];
    snapshot.body!.textRuns = [
      { st: 0, ed: snapshot.body!.dataStream.length - 2, sId: 'emphasis' },
    ];
    const projected = prepare(snapshot, formulas);
    prepareDocFonts(projected, fonts, PRINT_LIMITS, () => {});
    const at = projected.body!.dataStream.indexOf('Styled result');
    const painted = projected.body!.textRuns!.find((run) => run.st <= at && run.ed > at)!.ts!;
    expect(painted).toMatchObject({
      it: 1,
      fs: NAMED_STYLE_MAP[NamedStyleType.HEADING_1]!.fs,
      cl: { rgb: '#665588' },
    });
    expect(painted.ff).toMatch(/^PrintFont/u);
  }
  const { snapshot, formulas } = formula({ kind: 'table', rows: [['Named paragraph']] });
  snapshot.styles = { paragraph: { name: 'Named', type: 1, textStyle: { fs: 19, bl: 1 } } };
  snapshot.body!.paragraphs = [
    { paragraphId: 'p', styleId: 'paragraph', startIndex: snapshot.body!.dataStream.length - 2 },
  ];
  const projected = prepare(snapshot, formulas);
  const at = projected.body!.dataStream.indexOf('Named paragraph');
  prepareDocFonts(projected, fonts, PRINT_LIMITS, () => {});
  expect(projected.body!.textRuns!.find((run) => run.st <= at && run.ed > at)!.ts).toMatchObject({
    fs: 19,
    bl: 1,
    ff: 'PrintFont1',
  });
});

test('duplicate, overlapping, stale and grapheme-splitting Formula ranges fail explicitly', () => {
  const { snapshot, formulas } = formula({ kind: 'scalar', value: 1 });
  expect(() => prepare(snapshot, [...formulas, ...formulas])).toThrow(PrintError);
  const overlap = structuredClone(snapshot);
  overlap.body!.customRanges!.push({ ...overlap.body!.customRanges![0], rangeId: 'second' });
  expect(() =>
    prepare(overlap, [...formulas, { rangeId: 'second', result: { kind: 'unavailable' } }]),
  ).toThrow(PrintError);
  const stale = structuredClone(snapshot);
  stale.body!.customRanges![0].endIndex = stale.body!.dataStream.length;
  expect(() => prepare(stale, formulas)).toThrow(PrintError);
  const grapheme = document('a\u0301');
  grapheme.body!.customRanges = [
    {
      rangeId: 'formula',
      rangeType: CustomRangeType.CUSTOM,
      wholeEntity: true,
      startIndex: 1,
      endIndex: 1,
    },
  ];
  expect(() => prepare(grapheme, formulas)).toThrow(PrintError);
});

test('native table tree, merge coverage and payload integrity are checked before parsing', () => {
  const { snapshot, formulas } = formula({
    kind: 'table',
    rows: [
      ['first', 'second'],
      ['third', 'last'],
    ],
  });
  const projected = prepare(snapshot, formulas);
  const tableId = projected.body!.tables![0].tableId;
  const malformed = structuredClone(projected);
  malformed.body!.dataStream = malformed.body!.dataStream.replace('\x0e', '\x1d');
  expect(() => prepare(malformed)).toThrow(PrintError);
  const missing = structuredClone(projected);
  delete missing.tableSource![tableId];
  expect(() => prepare(missing)).toThrow(PrintError);
  const overlap = structuredClone(projected);
  overlap.tableSource![tableId].tableRows[0].tableCells[0].rowSpan = 2;
  expect(() => prepare(overlap)).toThrow(PrintError);
  const repeat = structuredClone(projected);
  repeat.tableSource![tableId].tableRows[0].repeatHeaderRow = 1;
  expect(() => prepare(repeat)).toThrow(PrintError);
  projected.body!.payloads = { formula: 'PRIVATE SOURCE' };
  expect(() => prepare(projected)).toThrow(PrintError);
});

test('unsupported appearance and malformed section geometry fail without changing source', () => {
  for (const mutate of [
    (source: IDocumentData) => {
      source.resources = [{ name: 'unknown', data: '{"private":1}' }];
    },
    (source: IDocumentData) => {
      source.documentStyle.background = { source: 'private-url' };
    },
    (source: IDocumentData) => {
      source.body!.customDecorations = [{ startIndex: 0, endIndex: 3, id: 'comment', type: 0 }];
    },
    (source: IDocumentData) => {
      source.body!.sectionBreaks = [
        {
          sectionId: 'second',
          startIndex: source.body!.dataStream.length - 1,
          pageSize: { width: 80, height: 800 },
        },
      ];
    },
    (source: IDocumentData) => {
      source.body!.sectionBreaks = [
        {
          sectionId: 'columns',
          startIndex: source.body!.dataStream.length - 1,
          columnProperties: [{ width: -1, paddingEnd: 12 }],
        },
      ];
    },
  ]) {
    const source = document();
    mutate(source);
    const before = structuredClone(source);
    expect(() => prepare(source)).toThrow(PrintError);
    expect(source).toEqual(before);
  }
});

test('font admission includes rich styles, heading inheritance, Unicode fallback and list markers', async () => {
  const source = document('Heading\rRegular café 🂡\rNested item');
  const ends = [...source.body!.dataStream.matchAll(/\r/gu)].map((match) => match.index);
  source.body!.paragraphs = ends.map((startIndex, index) => ({
    paragraphId: `p${index}`,
    startIndex,
  }));
  source.body!.paragraphs![0].paragraphStyle = { namedStyleType: NamedStyleType.HEADING_1 };
  source.body!.paragraphs![2].bullet = {
    listId: 'same-list',
    listType: PresetListType.ORDER_LIST,
    nestingLevel: 1,
    startNumber: 0,
  };
  source.body!.textRuns = [{ st: 8, ed: 15, ts: { it: 1 } }];
  const prepared = prepare(source);
  const fonts = new PreparedFonts(
    await fixtureFonts(),
    'Atkinson Hyperlegible',
    ['Noto Sans Symbols 2'],
    PRINT_LIMITS,
  );
  prepareDocFonts(prepared, fonts, PRINT_LIMITS, () => {});
  const styles = prepared.body!.textRuns!.map((run) => run.ts!);
  expect(styles.some((style) => style.ff === 'PrintFont2')).toBe(true);
  expect(styles.some((style) => style.ff === 'PrintFont4')).toBe(true);
  expect(prepared.body!.textRuns![0].ts!.fs).toBe(NAMED_STYLE_MAP[NamedStyleType.HEADING_1]!.fs);
  expect(prepared.body!.paragraphs![2].bullet!.listType).toMatch(/^print-list-/u);
  expect(prepared.body!.paragraphs![2].bullet!.startNumber).toBe(0);
  expect(
    Object.values(prepared.lists!)[0].nestingLevel.every((level) =>
      level.textStyle!.ff!.startsWith('PrintFont'),
    ),
  ).toBe(true);
});

test('style cycles, absent font faces and unsupported generated glyphs cannot fall back silently', async () => {
  const fonts = new PreparedFonts(
    (await fixtureFonts()).slice(0, 1),
    'Atkinson Hyperlegible',
    [],
    PRINT_LIMITS,
  );
  const bold = prepare(document('Bold'));
  bold.body!.textRuns = [{ st: 0, ed: 4, ts: { bl: 1 } }];
  expect(() => prepareDocFonts(bold, fonts, PRINT_LIMITS, () => {})).toThrow('font style');
  const cyclic = prepare(document());
  cyclic.styles = {
    a: { name: 'a', type: 1, basedOn: 'b' },
    b: { name: 'b', type: 1, basedOn: 'a' },
  };
  cyclic.body!.paragraphs![0].styleId = 'a';
  expect(() => prepareDocFonts(cyclic, fonts, PRINT_LIMITS, () => {})).toThrow(PrintError);
  const marker = prepare(document());
  marker.lists = {
    missing: {
      listType: 'missing',
      nestingLevel: [
        {
          startNumber: 0,
          bulletAlignment: 1,
          glyphFormat: '%1',
          glyphSymbol: String.fromCodePoint(0x10ffff),
        },
      ],
    },
  };
  marker.body!.paragraphs![0].bullet = { listId: 'list', listType: 'missing', nestingLevel: 0 };
  expect(() => prepareDocFonts(marker, fonts, PRINT_LIMITS, () => {})).toThrow('glyphs');
  const effect = document();
  effect.body!.textRuns = [
    { st: 0, ed: 1, ts: { customGlyphKey: 'opaque-private' } as ITextStyle },
  ];
  expect(() => prepare(effect)).toThrow(PrintError);
});
