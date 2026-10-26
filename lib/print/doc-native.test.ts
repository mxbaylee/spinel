import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import {
  CustomRangeType,
  DocumentFlavor,
  DocStyleType,
  ListGlyphType,
  LocaleType,
  NumberUnitType,
  ObjectRelativeFromH,
  ObjectRelativeFromV,
  PositionedObjectLayoutType,
  SpacingRule,
} from '@univerjs/core';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { expect, test } from 'vitest';
import type { DocPrintInput, SheetPrintInput } from './index.ts';
import type { DocNativeJob } from './doc-native-fixture.ts';
import {
  docEvidenceDirectory,
  docInput,
  retainDocPdf,
  runDocJobs,
  tableDoc,
  textDoc,
} from './doc-native-test-support.ts';

const compact = (text: string) => text.replace(/\s+/gu, '');

test('stored, fractional, zero-margin and fallback frames reopen at their complete geometry', async () => {
  const stored = await docInput(textDoc(['Stored frame final paragraph']));
  const fractional = await docInput(
    textDoc(['Fractional frame final paragraph'], { pageSize: { width: 601.5, height: 701.25 } }),
  );
  const zero = await docInput(
    textDoc(['Zero margin final paragraph'], {
      marginLeft: 0,
      marginRight: 0,
      marginTop: 0,
      marginBottom: 0,
    }),
  );
  const fallback = await docInput({
    id: 'fallback',
    body: { dataStream: 'Fallback final paragraph\r\n' },
    documentStyle: {},
  });
  const cases = [stored, fractional, zero, fallback];
  const results = await runDocJobs(cases.map((input) => ({ input })));
  for (const [index, result] of results.entries()) {
    expect(
      result,
      JSON.stringify(result, (key, value) => (key === 'bytes' ? '<bytes>' : value)),
    ).toMatchObject({ ok: true, pages: 1, restored: true, remainingFonts: 0 });
    const pages = await retainDocPdf(
      ['stored', 'fractional', 'zero-margins', 'fallback'][index],
      result.bytes!,
    );
    expect(pages[0].view).toEqual(
      index === 1
        ? [0, 0, 451.125, 525.9375]
        : index === 3
          ? [0, 0, ((210 * 96) / 25.4) * 0.75, ((297 * 96) / 25.4) * 0.75]
          : [0, 0, 450, 525],
    );
    expect(pages[0].text).toContain('final paragraph');
    expect(Array.from(pages[0].pixels.slice(-4))).toEqual([255, 255, 255, 255]);
    const loading = getDocument({ data: new Uint8Array(result.bytes!) });
    try {
      const metadata = await (await loading.promise).getMetadata();
      expect(JSON.stringify(metadata)).not.toContain('PRIVATE DOC TITLE');
      expect(JSON.stringify(metadata)).not.toContain('private-account-sentinel');
    } finally {
      await loading.destroy();
    }
  }
}, 60_000);

test('complete paragraphs span finite modern pages and preserve explicit breaks', async () => {
  const lines = Array.from(
    { length: 70 },
    (_, index) =>
      `PARA-${String(index).padStart(3, '0')} complete native paragraph with wrapped content beyond the editor viewport.`,
  );
  const snapshot = textDoc(lines, {
    documentFlavor: DocumentFlavor.MODERN,
    pageSize: { width: 600, height: 420 },
  });
  snapshot.body!.paragraphs![35].paragraphStyle = { pageBreakBefore: 1 };
  const [result] = await runDocJobs([{ input: await docInput(snapshot) }]);
  expect(
    result,
    JSON.stringify(result, (key, value) => (key === 'bytes' ? '<bytes>' : value)),
  ).toMatchObject({ ok: true, restored: true, remainingFonts: 0 });
  const pages = await retainDocPdf('modern-complete-paragraphs', result.bytes!);
  expect(pages.length).toBeGreaterThan(3);
  const content = compact(pages.map((page) => page.text).join(' '));
  for (const line of lines) {
    expect(content).toContain(compact(line));
    expect(content.split(line.slice(0, 8))).toHaveLength(2);
  }
  const before = pages.findIndex((page) => page.text.includes('PARA-034'));
  const after = pages.findIndex((page) => page.text.includes('PARA-035'));
  expect(after).toBeGreaterThan(before);
  expect(pages.at(-1)!.text).toContain('PARA-069');
  expect(pages.every((page) => page.view[2] === 450 && page.view[3] === 315)).toBe(true);
}, 60_000);

test('rich faces, heading styles, nested lists and deterministic Unicode fallback survive native drawing', async () => {
  const lines = [
    'Heading fixture',
    'Regular café e\u0301',
    'Bold face',
    'Italic face',
    'Bold italic face',
    'Symbol \u2605',
    'Outer item',
    'Inner item',
    'Outer tail',
  ];
  const snapshot = textDoc(lines);
  snapshot.styles = {
    heading: {
      name: 'Fixture heading',
      type: DocStyleType.paragraph,
      textStyle: { fs: 24, bl: 1 },
    },
  } as typeof snapshot.styles;
  snapshot.body!.paragraphs![0].styleId = 'heading';
  const start = (index: number) =>
    lines.slice(0, index).reduce((length, line) => length + line.length + 1, 0);
  snapshot.body!.textRuns = [
    { st: start(2), ed: start(2) + lines[2].length, ts: { bl: 1, cl: { rgb: '#775276' } } },
    { st: start(3), ed: start(3) + lines[3].length, ts: { it: 1 } },
    { st: start(4), ed: start(4) + lines[4].length, ts: { bl: 1, it: 1 } },
  ];
  snapshot.lists = {
    numbered: {
      listType: 'numbered',
      nestingLevel: [0, 1].map((level) => ({
        bulletAlignment: 0,
        glyphFormat: `%${level + 1}.`,
        startNumber: 0,
        glyphType: ListGlyphType.DECIMAL,
        paragraphProperties: {
          indentStart: { v: 36 + level * 24, u: 3 },
          hanging: { v: 24, u: 3 },
        },
        textStyle: { ff: 'Atkinson Hyperlegible' },
      })),
    },
  };
  for (const [index, nestingLevel] of [
    [6, 0],
    [7, 1],
    [8, 0],
  ])
    snapshot.body!.paragraphs![index].bullet = {
      listId: 'list',
      listType: 'numbered',
      nestingLevel,
    };
  const [result] = await runDocJobs([{ input: await docInput(snapshot) }]);
  expect(
    result,
    JSON.stringify(result, (key, value) => (key === 'bytes' ? '<bytes>' : value)),
  ).toMatchObject({ ok: true, pages: 1 });
  const pages = await retainDocPdf('rich-fonts-headings-lists', result.bytes!);
  const text = compact(pages[0].text);
  for (const line of lines) expect(text.normalize('NFC')).toContain(compact(line).normalize('NFC'));
  const bytes = Buffer.from(result.bytes!).toString('latin1');
  for (const face of [
    'AtkinsonHyperlegible-Regular',
    'AtkinsonHyperlegible-Bold',
    'AtkinsonHyperlegible-Italic',
    'AtkinsonHyperlegible-BoldItalic',
    'NotoSansSymbols2-Regular',
  ])
    expect(bytes).toContain(face);
  const outer = pages[0].items.find((item) => item.str.includes('Outer item'));
  const inner = pages[0].items.find((item) => item.str.includes('Inner item'));
  expect(outer).toBeDefined();
  expect(inner).toBeDefined();
  expect(inner!.transform[4]).toBeGreaterThan(outer!.transform[4]);
}, 60_000);

function formulaDoc(prefix: string[], value = 'PRIVATE_SOURCE_EXPRESSION') {
  const snapshot = textDoc([...prefix, value, 'AFTER-FORMULA-SENTINEL'], {
    pageSize: { width: 600, height: 500 },
  });
  const startIndex = prefix.reduce((length, line) => length + line.length + 1, 0);
  snapshot.body!.customRanges = [
    {
      rangeId: 'f',
      rangeType: CustomRangeType.CUSTOM,
      wholeEntity: true,
      startIndex,
      endIndex: startIndex + value.length - 1,
      properties: { expression: 'PRIVATE_SOURCE_NAME', account: 'PRIVATE_ACCOUNT' },
    },
  ];
  return snapshot;
}

test('a 30-row wrapped Formula table beginning near a page bottom remains complete', async () => {
  const prefix = Array.from({ length: 14 }, (_, index) => `PREFIX-${index}`);
  const snapshot = formulaDoc(prefix);
  // A group taller than a page must continue completely despite a saved keep rule.
  snapshot.body!.paragraphs![prefix.length].paragraphStyle = { keepLines: 1 };
  const input = await docInput(snapshot);
  const rows = Array.from({ length: 30 }, (_, index) => [
    `ROW-${String(index + 1).padStart(2, '0')}`,
    `Wrapped authorized value ${index + 1} with enough words to wrap across several lines in its narrow prepared cell.`,
  ]);
  input.formulas = [{ rangeId: 'f', result: { kind: 'table', rows, columnWidths: [100, 380] } }];
  const [result] = await runDocJobs([{ input }]);
  expect(
    result,
    JSON.stringify(result, (key, value) => (key === 'bytes' ? '<bytes>' : value)),
  ).toMatchObject({ ok: true, restored: true, remainingFonts: 0 });
  const pages = await retainDocPdf('formula-thirty-rows', result.bytes!);
  expect(pages.length).toBeGreaterThan(3);
  // Native discretionary hyphens at line ends preserve a wrapped word.
  const content = compact(
    pages
      .map((page) => page.text)
      .join(' ')
      .replace(/-\s+(?=[a-z])/g, ''),
  );
  for (const row of rows) {
    for (const value of row) expect(content).toContain(compact(value));
    expect(content.split(row[0])).toHaveLength(2);
  }
  const firstRow = pages[0].items.find((item) => item.str.includes('ROW-01'));
  expect(firstRow).toBeDefined();
  expect(firstRow!.transform[5]).toBeLessThan(pages[0].height * 0.3);
  expect(content).toContain('AFTER-FORMULA-SENTINEL');
  expect(content).not.toContain('PRIVATE');
  expect(pages.findIndex((page) => page.text.includes('ROW-30'))).toBeGreaterThan(0);
}, 60_000);

test('prepared scalar, array and whole unavailable Formula results expose no source metadata', async () => {
  const inputs = await Promise.all([
    docInput(formulaDoc([])),
    docInput(formulaDoc([])),
    docInput(formulaDoc([])),
  ]);
  inputs[0].formulas = [{ rangeId: 'f', result: { kind: 'scalar', value: 'Authorized scalar' } }];
  inputs[1].formulas = [
    {
      rangeId: 'f',
      result: {
        kind: 'array',
        rows: [
          [1, true],
          [null, 'Final array value'],
        ],
      },
    },
  ];
  inputs[2].formulas = [{ rangeId: 'f', result: { kind: 'unavailable' } }];
  const results = await runDocJobs(inputs.map((input) => ({ input })));
  for (const [index, result] of results.entries()) {
    expect(
      result,
      JSON.stringify(result, (key, value) => (key === 'bytes' ? '<bytes>' : value)),
    ).toMatchObject({ ok: true, restored: true, remainingFonts: 0 });
    const pages = await retainDocPdf(
      ['formula-scalar', 'formula-array', 'formula-unavailable'][index],
      result.bytes!,
    );
    const text = pages.map((page) => page.text).join(' ');
    expect(text).not.toContain('PRIVATE');
    expect(text).toContain('AFTER-FORMULA-SENTINEL');
    if (index === 0) expect(text).toContain('Authorized scalar');
    if (index === 1) expect(text).toContain('Final array value');
    if (index === 2) expect(text).toMatch(/unavailable/i);
    const loading = getDocument({ data: new Uint8Array(result.bytes!) });
    try {
      expect(JSON.stringify(await (await loading.promise).getMetadata())).not.toContain('PRIVATE');
    } finally {
      await loading.destroy();
    }
  }
}, 60_000);

test('a Formula table retains its paragraph page break before the first result row', async () => {
  const snapshot = formulaDoc(['BEFORE-TABLE-BREAK']);
  snapshot.body!.paragraphs![1].paragraphStyle = { pageBreakBefore: 1 };
  const input = await docInput(snapshot);
  input.formulas = [{ rangeId: 'f', result: { kind: 'table', rows: [['RESULT-A', 'RESULT-B']] } }];
  const [result] = await runDocJobs([{ input }]);
  expect(
    result,
    JSON.stringify(result, (key, value) => (key === 'bytes' ? '<bytes>' : value)),
  ).toMatchObject({ ok: true, pages: 2 });
  const pages = await retainDocPdf('formula-explicit-break', result.bytes!);
  expect(pages[0].text).toContain('BEFORE-TABLE-BREAK');
  expect(pages[0].text).not.toContain('RESULT-A');
  expect(pages[1].text).toContain('RESULT-A');
  expect(pages[1].text).toContain('RESULT-B');
  expect(pages[1].text).toContain('AFTER-FORMULA-SENTINEL');
}, 60_000);

test('modern implicit paragraph spacing survives finite print geometry', async () => {
  const inputs = await Promise.all(
    [DocumentFlavor.MODERN, DocumentFlavor.TRADITIONAL].map((flavor) =>
      docInput(
        textDoc(['FIRST-SPACING-MARKER', 'SECOND-SPACING-MARKER'], { documentFlavor: flavor }),
      ),
    ),
  );
  const results = await runDocJobs(inputs.map((input) => ({ input })));
  const gaps: number[] = [];
  for (const [index, result] of results.entries()) {
    expect(
      result,
      JSON.stringify(result, (key, value) => (key === 'bytes' ? '<bytes>' : value)),
    ).toMatchObject({ ok: true, pages: 1 });
    const [page] = await retainDocPdf(
      index === 0 ? 'modern-spacing' : 'traditional-spacing',
      result.bytes!,
    );
    const first = page.items.find((item) => item.str.includes('FIRST-SPACING-MARKER'))!;
    const second = page.items.find((item) => item.str.includes('SECOND-SPACING-MARKER'))!;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    gaps.push(first.transform[5] - second.transform[5]);
  }
  expect(gaps[0]).toBeGreaterThan(gaps[1] + 5);
}, 60_000);

test('a short Formula table preserves its source paragraph keep-lines group near a page bottom', async () => {
  const snapshot = formulaDoc(Array.from({ length: 15 }, (_, index) => `KEEP-PREFIX-${index}`));
  snapshot.body!.paragraphs![15].paragraphStyle = { keepLines: 1 };
  const input = await docInput(snapshot);
  input.formulas = [
    {
      rangeId: 'f',
      result: {
        kind: 'table',
        rows: [
          ['KEPT-ROW-ONE', 'A'],
          ['KEPT-ROW-TWO', 'B'],
        ],
      },
    },
  ];
  const [result] = await runDocJobs([{ input }]);
  expect(
    result,
    JSON.stringify(result, (key, value) => (key === 'bytes' ? '<bytes>' : value)),
  ).toMatchObject({ ok: true, pages: 2 });
  const pages = await retainDocPdf('formula-keep-lines', result.bytes!);
  expect(pages[0].text).toContain('KEEP-PREFIX-14');
  expect(
    pages
      .map((page) => page.text)
      .join(' ')
      .split('KEEP-PREFIX-14'),
  ).toHaveLength(2);
  expect(pages[1].text).not.toContain('KEEP-PREFIX-14');
  expect(pages[0].text).not.toContain('KEPT-ROW-ONE');
  expect(pages[1].text).toContain('KEPT-ROW-ONE');
  expect(pages[1].text).toContain('KEPT-ROW-TWO');
  // No table decoration belongs on the page containing only short prefix lines.
  // Text extraction alone misses an orphan top border at the physical seam.
  let rightSideInk = 0;
  for (let i = 0; i < pages[0].pixels.length; i += 4) {
    if ((i / 4) % pages[0].width < pages[0].width * 0.6) continue;
    if (pages[0].pixels[i] < 240 || pages[0].pixels[i + 1] < 240 || pages[0].pixels[i + 2] < 240)
      rightSideInk++;
  }
  expect(rightSideInk).toBe(0);
}, 60_000);

test('a native row taller than a physical page preserves every wrapped word and its following row', async () => {
  const words = Array.from(
    { length: 120 },
    (_, index) => `WORD${String(index).padStart(3, '0')}`,
  ).join(' ');
  const snapshot = tableDoc(
    [
      [words, 'TALL-NEIGHBOR'],
      ['AFTER-TALL-ROW', 'LAST-CELL'],
    ],
    [],
    36,
  );
  snapshot.documentStyle.pageSize = { width: 600, height: 400 };
  const [result] = await runDocJobs([{ input: await docInput(snapshot) }]);
  expect(
    result,
    JSON.stringify(result, (key, value) => (key === 'bytes' ? '<bytes>' : value)),
  ).toMatchObject({ ok: true });
  const pages = await retainDocPdf('native-tall-row', result.bytes!);
  expect(pages.length).toBeGreaterThan(2);
  const text = compact(pages.map((page) => page.text).join(' '));
  for (const word of words.split(' ')) expect(text.split(word)).toHaveLength(2);
  for (const marker of ['TALL-NEIGHBOR', 'AFTER-TALL-ROW', 'LAST-CELL', 'TABLE-END-SENTINEL'])
    expect(text).toContain(marker);
}, 60_000);

test('vertical and horizontal merged cells preserve tall content through physical seams', async () => {
  const words = Array.from(
    { length: 100 },
    (_, index) => `MERGED${String(index).padStart(3, '0')}`,
  ).join(' ');
  const vertical = tableDoc([
    [words, 'NEIGHBOR-ONE'],
    ['', 'NEIGHBOR-TWO'],
    ['AFTER-MERGE', 'MERGE-LAST-CELL'],
  ]);
  vertical.documentStyle.pageSize = { width: 600, height: 400 };
  const rows = vertical.tableSource!['native-table'].tableRows;
  rows[0].tableCells[0].rowSpan = 2;
  rows[1].tableCells[0].rowSpan = 0;
  const horizontal = tableDoc([
    ['HORIZONTAL-MERGE-COMPLETE', ''],
    ['AFTER-HORIZONTAL', 'SECOND-CELL'],
  ]);
  horizontal.tableSource!['native-table'].tableRows[0].tableCells[0].columnSpan = 2;
  horizontal.tableSource!['native-table'].tableRows[0].tableCells[1].columnSpan = 0;
  const results = await runDocJobs([
    { input: await docInput(vertical) },
    { input: await docInput(horizontal) },
  ]);
  for (const [index, result] of results.entries()) {
    expect(
      result,
      JSON.stringify(result, (key, value) => (key === 'bytes' ? '<bytes>' : value)),
    ).toMatchObject({ ok: true });
    const pages = await retainDocPdf(
      index === 0 ? 'vertical-tall-merge' : 'horizontal-merge',
      result.bytes!,
    );
    const text = compact(pages.map((page) => page.text).join(' '));
    if (index === 0) {
      expect(pages.length).toBeGreaterThan(2);
      for (const word of words.split(' ')) expect(text.split(word)).toHaveLength(2);
      for (const marker of ['NEIGHBOR-ONE', 'NEIGHBOR-TWO', 'AFTER-MERGE', 'MERGE-LAST-CELL'])
        expect(text).toContain(marker);
    } else {
      for (const marker of ['HORIZONTAL-MERGE-COMPLETE', 'AFTER-HORIZONTAL', 'SECOND-CELL'])
        expect(text).toContain(marker);
    }
  }
}, 90_000);

test('unsupported appearance, unprepared Formula values and clipped exact rows return no bytes', async () => {
  const good = await docInput();
  const badImage = structuredClone(good);
  badImage.snapshot.documentStyle.background = {
    source: 'PRIVATE_SOURCE',
  } as typeof badImage.snapshot.documentStyle.background;
  const formula = await docInput(formulaDoc([]));
  const exact = tableDoc([['EXACT-ROW-MUST-NOT-LOSE-TEXT', 'SIDE']]);
  exact.tableSource!['native-table'].tableRows[0].trHeight = { val: { v: 4, u: 3 }, hRule: 2 };
  const missingGlyph = await docInput(textDoc([String.fromCodePoint(0x10ffff)]));
  const results = await runDocJobs(
    [badImage, formula, await docInput(exact), missingGlyph, good].map((input) => ({ input })),
  );
  for (const result of results.slice(0, 4)) {
    expect(result, JSON.stringify(result)).toMatchObject({
      ok: false,
      restored: true,
      remainingFonts: 0,
    });
    expect(result.bytes).toBeUndefined();
    expect(result.message).not.toContain('PRIVATE');
  }
  expect(results.at(-1)).toMatchObject({ ok: true, restored: true, remainingFonts: 0 });
  await retainDocPdf('after-unsupported-content', results.at(-1)!.bytes!);
}, 90_000);

test('resource limits and cancellation publish no partial bytes and restore the shared native runtime', async () => {
  const input = await docInput(
    textDoc(Array.from({ length: 80 }, (_, index) => `RESOURCE-PARAGRAPH-${index}`)),
  );
  const cases: { name: string; job: DocNativeJob; code: string }[] = [
    { name: 'snapshot', job: { input, options: { limits: { snapshotBytes: 1 } } }, code: 'limit' },
    { name: 'fonts', job: { input, options: { limits: { fontBytes: 1 } } }, code: 'limit' },
    { name: 'text', job: { input, options: { limits: { textCharacters: 1 } } }, code: 'limit' },
    { name: 'layout', job: { input, options: { limits: { gridCells: 1 } } }, code: 'limit' },
    { name: 'pages', job: { input, options: { limits: { pages: 1 } } }, code: 'limit' },
    { name: 'output', job: { input, options: { limits: { outputBytes: 1 } } }, code: 'limit' },
    { name: 'time', job: { input, options: { limits: { durationMs: 1 } } }, code: 'limit' },
    { name: 'cancel-before', job: { input, abort: true }, code: 'cancelled' },
    { name: 'cancel-preparation', job: { input, abortDuringPrepare: true }, code: 'cancelled' },
    { name: 'cancel-cleanup', job: { input, abortDuringCleanup: true }, code: 'cancelled' },
  ];
  const results = await runDocJobs([...cases.map((item) => item.job), { input }]);
  await mkdir(docEvidenceDirectory, { recursive: true });
  await writeFile(
    resolve(docEvidenceDirectory, 'doc-resource-measurements.json'),
    JSON.stringify(
      {
        note: 'Synthetic admission and cleanup measurements, not production process capacity.',
        node: process.version,
        cases: results.map(({ bytes, ...result }, index) => ({
          name: cases[index]?.name ?? 'recovery',
          ...result,
          publishedBytes: bytes?.length ?? 0,
        })),
      },
      null,
      2,
    ),
  );
  for (const [index, item] of cases.entries()) {
    expect(results[index], item.name).toMatchObject({
      ok: false,
      code: item.code,
      restored: true,
      remainingFonts: 0,
    });
    expect(results[index].bytes).toBeUndefined();
    expect(results[index].message).not.toContain('RESOURCE-PARAGRAPH');
  }
  expect(results.at(-1)).toMatchObject({ ok: true, restored: true, remainingFonts: 0 });
  await retainDocPdf('after-resource-failures', results.at(-1)!.bytes!);
}, 90_000);

test('Doc and Sheet operations share one native registry lock', async () => {
  const input = await docInput();
  const sheet: SheetPrintInput = {
    ...input,
    snapshot: {
      id: 'sheet',
      name: 'Synthetic overlap',
      appVersion: '1.1.0',
      locale: LocaleType.EN_US,
      styles: {},
      sheetOrder: ['s'],
      sheets: {
        s: { id: 's', rowCount: 1, columnCount: 1, cellData: { 0: { 0: { v: 'Sheet overlap' } } } },
      },
    },
  };
  const [result] = await runDocJobs([{ input, overlapSheet: sheet }]);
  expect(
    result,
    JSON.stringify(result, (key, value) => (key === 'bytes' ? '<bytes>' : value)),
  ).toMatchObject({ ok: true, overlapCode: 'limit', restored: true, remainingFonts: 0 });
  await retainDocPdf('shared-native-lock', result.bytes!);
}, 60_000);

test('tall image-only and captioned anchors continue completely and invalid native anchors fail without bytes', async () => {
  const canvas = createCanvas(12, 90),
    context = canvas.getContext('2d');
  for (const [index, color] of ['#d02040', '#20a040', '#2040d0'].entries()) {
    context.fillStyle = color;
    context.fillRect(0, index * 30, 12, 30);
  }
  const inputs: DocPrintInput[] = [];
  for (const inline of [true, false]) {
    const snapshot = textDoc(
      ['Before image', inline ? '\b' : '\bAnchor caption', 'AFTER-IMAGE-SENTINEL'],
      {
        pageSize: { width: 600, height: 400 },
      },
    );
    snapshot.body!.customBlocks = [{ startIndex: 'Before image\r'.length, blockId: 'image' }];
    snapshot.drawingsOrder = ['image'];
    snapshot.drawings = {
      image: {
        drawingId: 'image',
        unitId: snapshot.id,
        subUnitId: snapshot.id,
        drawingType: 0,
        source: 'opaque-authorized-image',
        layoutType: inline ? 0 : 6,
        docTransform: {
          size: { width: 48, height: 900 },
          positionH: { relativeFrom: 3, posOffset: 12 },
          positionV: { relativeFrom: 1, posOffset: 0 },
          angle: 0,
        },
      },
    } as typeof snapshot.drawings;
    const input = await docInput(snapshot);
    input.images = [{ source: 'opaque-authorized-image', bytes: await canvas.encode('png') }];
    inputs.push(input);
  }
  const anchorVariant = (text: string) => {
    const input = structuredClone(inputs[1]);
    input.snapshot.body = textDoc(['Before image', text, 'AFTER-IMAGE-SENTINEL']).body;
    const stream = input.snapshot.body!.dataStream;
    input.snapshot.body!.customBlocks = [{ startIndex: stream.indexOf('\b'), blockId: 'image' }];
    return input;
  };
  const bare = anchorVariant('\b');
  // Match the public editor's buildDocTransform defaults (page horizontal,
  // paragraph vertical, zero wrap distances), then switch only the wrap mode.
  bare.snapshot.drawings!.image.docTransform.positionH = {
    relativeFrom: ObjectRelativeFromH.PAGE,
    posOffset: 60,
  };
  const overlapping = structuredClone(bare);
  overlapping.snapshot.drawings!.image.docTransform.positionV.posOffset = -10;
  const invisible = anchorVariant('\b\u200b');
  const line = anchorVariant('\bAnchor caption');
  line.snapshot.drawings!.image.docTransform.positionV.relativeFrom = ObjectRelativeFromV.LINE;
  const nonLeading = anchorVariant('Leading text\bAnchor caption');
  const multiple = anchorVariant('\bAnchor caption\b');
  multiple.snapshot.body!.customBlocks!.push({
    startIndex: multiple.snapshot.body!.dataStream.lastIndexOf('\b'),
    blockId: 'second-image',
  });
  multiple.snapshot.drawings!['second-image'] = {
    ...structuredClone(multiple.snapshot.drawings!.image),
    drawingId: 'second-image',
  };
  multiple.snapshot.drawingsOrder!.push('second-image');
  const fullColumn = anchorVariant('\b');
  fullColumn.snapshot.drawings!.image.layoutType = PositionedObjectLayoutType.WRAP_SQUARE;
  fullColumn.snapshot.drawings!.image.docTransform.size.width = 480;
  fullColumn.snapshot.drawings!.image.distL = 20;
  fullColumn.snapshot.drawings!.image.distR = 20;
  const square = anchorVariant('\b');
  square.snapshot.drawings!.image.layoutType = PositionedObjectLayoutType.WRAP_SQUARE;
  const bareLine = structuredClone(bare);
  bareLine.snapshot.drawings!.image.docTransform.positionV.relativeFrom = ObjectRelativeFromV.LINE;
  inputs.push(square, bare, nonLeading, fullColumn, bareLine, line, multiple, overlapping);
  const badAnchors = [invisible];
  const allResults = await runDocJobs(
    [...badAnchors, ...inputs].map((input) => ({
      input,
      nativeGeometry: input === overlapping,
    })),
  );
  for (const rejected of allResults.slice(0, badAnchors.length)) {
    const { bytes, ...diagnostic } = rejected;
    expect(diagnostic, JSON.stringify(diagnostic)).toMatchObject({
      ok: false,
      code: 'unsupported',
      restored: true,
      remainingFonts: 0,
    });
    expect(bytes).toBeUndefined();
  }
  const results = allResults.slice(badAnchors.length);
  for (const [index, result] of results.entries()) {
    expect(
      result,
      JSON.stringify(result, (key, value) => (key === 'bytes' ? '<bytes>' : value)),
    ).toMatchObject({ ok: true, restored: true, remainingFonts: 0 });
    const pages = await retainDocPdf(
      [
        'tall-inline-image',
        'tall-floating-image',
        'tall-square-image',
        'tall-image-only-top-bottom',
        'tall-nonleading-top-bottom',
        'tall-full-column-square',
        'tall-line-relative-image-only',
        'tall-line-relative-caption',
        'tall-interleaved-multiple-images',
        'tall-negative-native-image',
      ][index],
      result.bytes!,
    );
    expect(pages.length).toBeGreaterThanOrEqual(3);
    expect(pages.map((page) => page.text).join(' ')).toContain('AFTER-IMAGE-SENTINEL');
    const text = pages.map((page) => page.text).join(' ');
    if ([1, 4, 7, 8].includes(index)) expect(text.split('Anchor caption')).toHaveLength(2);
    if (index === 8) {
      expect(pages.length).toBeGreaterThanOrEqual(6);
      expect(pages.at(-1)!.text).toContain('AFTER-IMAGE-SENTINEL');
    }
    if (index === 4) {
      expect(text.split('Leading text')).toHaveLength(2);
      expect(pages[0].text).toContain('Leading text');
      expect(pages.at(-1)!.text).toContain('Anchor caption');
    }
    // Default and corrected anchors cannot manufacture empty pages. A negative
    // offset can itself move the native exclusion backwards into earlier flow;
    // that exact source layout is checked independently below, including its gap.
    if (!result.nativeGeometry)
      expect(
        pages.every((page) => page.pixels.some((value, i) => i % 4 !== 3 && value < 250)),
      ).toBe(true);
    const colors = [0, 0, 0];
    const bands: number[] = [];
    let firstImage: { page: number; x: number; y: number } | undefined;
    for (const [pageIndex, page] of pages.entries())
      for (let y = 0; y < page.height; y++) {
        const row = [0, 0, 0];
        for (let x = 0; x < page.width; x++) {
          const n = (y * page.width + x) * 4;
          const [r, g, b] = page.pixels.slice(n, n + 3);
          if (r > 150 && g < 80 && b < 100) {
            row[0]++;
            firstImage ??= { page: pageIndex, x, y };
          }
          if (g > 100 && r < 80 && b < 100) row[1]++;
          if (b > 150 && r < 80 && g < 100) row[2]++;
        }
        for (const [color, count] of row.entries()) colors[color] += count;
        const dominant = row.indexOf(Math.max(...row));
        if (row[dominant] > 3 && bands.at(-1) !== dominant) bands.push(dominant);
      }
    // Each band retains its complete authored width and one third of its height.
    // A repeated/clipped source slice changes this area, even if all colors occur.
    const size = inputs[index].snapshot.drawings!.image.docTransform.size;
    const count = inputs[index].snapshot.body!.customBlocks!.length;
    const bandArea = size.width! * (size.height! / 3) * 0.75 ** 2 * count;
    for (const count of colors) expect(Math.abs(count - bandArea)).toBeLessThan(200);
    expect(bands).toEqual(Array.from({ length: count }, () => [0, 1, 2]).flat());
    if (result.nativeGeometry) {
      const native = result.nativeGeometry;
      await writeFile(
        resolve(docEvidenceDirectory, 'negative-tall-native-geometry.json'),
        JSON.stringify(native, null, 2),
      );
      expect(native.sourceFlavor).toBeNull(); // This saved fixture has no explicit flavor.
      expect(native.layoutFlavor).toBe(DocumentFlavor.TRADITIONAL);
      expect(native.logical).toHaveLength(1);
      const source = native.logical[0];
      const image = source.images.find((drawing) => drawing.id === 'image')!;
      const before = source.lines.find((line) => line.text.includes('Before image'))!;
      const after = source.lines.find((line) => line.text.includes('AFTER-IMAGE-SENTINEL'))!;
      const capacity = native.frame.height - native.frame.top - native.frame.bottom;
      expect(image).toMatchObject({ left: 60, width: 48, height: 900 });
      expect(native.finite.flatMap((page) => page.images)).toEqual([image]);
      expect(image.top - (before.top + before.height)).toBeGreaterThan(capacity * 2);
      expect(after.top).toBeGreaterThanOrEqual(image.top + image.height - 0.01);
      // No source ink exists between the first text paragraph and the native
      // image. Its absolute logical origin therefore maps through full, empty
      // paper bodies without any text seam adjustment.
      const imagePage = Math.floor((image.top - native.frame.top) / capacity);
      expect(firstImage!.page).toBe(imagePage);
      expect(Math.abs(firstImage!.x - image.left * 0.75)).toBeLessThanOrEqual(1);
      expect(
        Math.abs(firstImage!.y - (image.top - imagePage * capacity) * 0.75),
      ).toBeLessThanOrEqual(1);
      for (const page of pages.slice(1, imagePage))
        expect(page.pixels.every((value, offset) => offset % 4 === 3 || value === 255)).toBe(true);
      // The final plain line is the sole atomic text interval after the image.
      // Native glyph metrics determine whether its ink crosses the next paper
      // edge; keep the whole line at its native baseline relative to that ink.
      const candidatePage = Math.floor((after.ink!.top - native.frame.top) / capacity);
      const crosses = after.ink!.bottom > native.frame.top + (candidatePage + 1) * capacity;
      const afterPage = candidatePage + Number(crosses);
      const afterBaseline = crosses
        ? native.frame.top + after.baseline - after.ink!.top
        : after.baseline - candidatePage * capacity;
      const item = pages[afterPage].items.find((item) =>
        item.str.includes('AFTER-IMAGE-SENTINEL'),
      )!;
      expect(item).toBeDefined();
      expect(Math.abs(item.transform[4] - native.frame.left * 0.75)).toBeLessThan(0.001);
      // The native PDF font painter snaps its baseline within one source pixel.
      // Measure that shared font offset on the unaffected first paragraph;
      // compare the final line's relative position without relaxing its bound.
      const firstText = pages[0].items.find((item) => item.str.includes('Before image'))!;
      const paintOffset = pages[0].height - firstText.transform[5] - before.baseline * 0.75;
      expect(Math.abs(paintOffset)).toBeLessThan(0.75);
      expect(
        Math.abs(pages[afterPage].height - item.transform[5] - afterBaseline * 0.75 - paintOffset),
      ).toBeLessThan(0.001);
      expect(pages.findIndex((page) => page.text.includes('AFTER-IMAGE-SENTINEL'))).toBe(afterPage);
      expect(pages.length).toBe(afterPage + 1);
    }
  }
}, 90_000);

test('nonleading Top-and-bottom and LINE captions retain complete flow and measured origins with repeated headers', async () => {
  const canvas = createCanvas(12, 12);
  const context = canvas.getContext('2d');
  context.fillStyle = '#2040d0';
  context.fillRect(0, 0, 12, 12);
  const snapshot = textDoc([
    'BEFORE-IMAGE',
    'PREFIX-BEFORE-IMAGE\bCAPTION-AFTER-IMAGE',
    'AFTER-IMAGE-SENTINEL',
  ]);
  snapshot.headers = {
    header: { headerId: 'header', body: textDoc(['REPEATED-HEADER']).body! },
  };
  snapshot.documentStyle.defaultHeaderId = 'header';
  snapshot.documentStyle.marginHeader = 12;
  snapshot.body!.customBlocks = [
    { startIndex: snapshot.body!.dataStream.indexOf('\b'), blockId: 'image' },
  ];
  snapshot.drawingsOrder = ['image'];
  snapshot.drawings = {
    image: {
      drawingId: 'image',
      unitId: snapshot.id,
      subUnitId: snapshot.id,
      drawingType: 0,
      source: 'authorized-image',
      layoutType: PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM,
      docTransform: {
        size: { width: 48, height: 90 },
        positionH: { relativeFrom: ObjectRelativeFromH.PAGE, posOffset: 60 },
        positionV: { relativeFrom: ObjectRelativeFromV.PARAGRAPH, posOffset: 0 },
        angle: 0,
      },
    },
  } as typeof snapshot.drawings;
  const inputs = await Promise.all(
    [undefined, 0, 20, -90].map(async (offset) => {
      const source = structuredClone(snapshot);
      if (offset !== undefined)
        source.drawings!.image.docTransform.positionV = {
          relativeFrom: ObjectRelativeFromV.LINE,
          posOffset: offset,
        };
      const input = await docInput(source);
      input.images = [{ source: 'authorized-image', bytes: await canvas.encode('png') }];
      return input;
    }),
  );
  const originals = inputs.map((input) => structuredClone(input.snapshot));
  const results = await runDocJobs(inputs.map((input) => ({ input })));
  const pages: Awaited<ReturnType<typeof retainDocPdf>> = [];
  const tops: number[] = [];
  for (const [index, result] of results.entries()) {
    expect(
      result,
      JSON.stringify(result, (key, value) => (key === 'bytes' ? '<bytes>' : value)),
    ).toMatchObject({ ok: true, pages: 1, restored: true, remainingFonts: 0 });
    const [page] = await retainDocPdf(
      [
        'nonleading-image-physical-header',
        'line-zero-physical-header',
        'line-offset-physical-header',
        'line-compensated-physical-header',
      ][index],
      result.bytes!,
    );
    pages.push(page);
    for (const marker of [
      'REPEATED-HEADER',
      'BEFORE-IMAGE',
      'PREFIX-BEFORE-IMAGE',
      'CAPTION-AFTER-IMAGE',
      'AFTER-IMAGE-SENTINEL',
    ])
      expect(
        page.items.filter((item) => item.str === marker),
        marker,
      ).toHaveLength(1);
    let top = page.height;
    let bottom = 0;
    let area = 0;
    for (let offset = 0; offset < page.pixels.length; offset += 4) {
      const [red, green, blue] = page.pixels.slice(offset, offset + 3);
      if (blue > 150 && red < 80 && green < 100) {
        const y = Math.floor(offset / 4 / page.width);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        area++;
      }
    }
    tops.push(top);
    const prefix = page.items.find((item) => item.str === 'PREFIX-BEFORE-IMAGE')!;
    const caption = page.items.find((item) => item.str === 'CAPTION-AFTER-IMAGE')!;
    expect(page.height - prefix.transform[5]).toBeLessThan(top);
    expect(page.height - caption.transform[5] - caption.height).toBeGreaterThan(bottom - 1);
    expect(Math.abs(area - 48 * 90 * 0.75 ** 2)).toBeLessThan(100);
  }
  expect(Buffer.from(pages[1].pixels).equals(Buffer.from(pages[0].pixels))).toBe(true);
  expect(tops[2] - tops[0]).toBe(20 * 0.75);
  // The public native LINE reference-switch compensation resolves -90 to a
  // measured +2.586665px offset in this saved fixture, not -90px above its line.
  expect(Math.abs(tops[3] - tops[0] - 2.586665 * 0.75)).toBeLessThan(1);
  expect(inputs.map((input) => input.snapshot)).toEqual(originals);
}, 60_000);

test('image-only Top-and-bottom flow retains native origins, relative paragraph spacing and small-image struts', async () => {
  const canvas = createCanvas(12, 12);
  const context = canvas.getContext('2d');
  context.fillStyle = '#2040d0';
  context.fillRect(0, 0, 12, 12);
  const bytes = await canvas.encode('png');
  const make = async (height: number, offset = 0) => {
    const snapshot = textDoc(['Before image', '\b', 'AFTER-IMAGE-SENTINEL']);
    snapshot.body!.customBlocks = [{ startIndex: 'Before image\r'.length, blockId: 'image' }];
    snapshot.drawingsOrder = ['image'];
    snapshot.drawings = {
      image: {
        drawingId: 'image',
        unitId: snapshot.id,
        subUnitId: snapshot.id,
        drawingType: 0,
        source: 'authorized-image',
        layoutType: PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM,
        docTransform: {
          size: { width: 48, height },
          positionH: { relativeFrom: 3, posOffset: 12 },
          positionV: { relativeFrom: ObjectRelativeFromV.PARAGRAPH, posOffset: offset },
          angle: 0,
        },
      },
    } as typeof snapshot.drawings;
    const input = await docInput(snapshot);
    input.images = [{ source: 'authorized-image', bytes }];
    return input;
  };
  const normal = await docInput(textDoc(['Before image', 'AFTER-IMAGE-SENTINEL']));
  const spaced = await make(90, 20);
  spaced.snapshot.body!.paragraphs![1].paragraphStyle = {
    spaceAbove: { v: 15, u: NumberUnitType.PIXEL },
    spaceBelow: { v: 2, u: NumberUnitType.LINE },
  };
  const small = await make(10);
  const smallReference = structuredClone(small);
  smallReference.snapshot.drawings!.image.layoutType = PositionedObjectLayoutType.WRAP_NONE;
  const exact = await make(90);
  exact.snapshot.body!.paragraphs![1].paragraphStyle = {
    lineSpacing: 180,
    spacingRule: SpacingRule.EXACT,
    spaceBelow: { v: 24, u: NumberUnitType.PIXEL },
  };
  const exactReference = structuredClone(exact);
  exactReference.snapshot.drawings!.image.layoutType = PositionedObjectLayoutType.WRAP_NONE;
  const inputs = [normal, spaced, small, smallReference, exact, exactReference];
  const originals = structuredClone(inputs);
  const results = await runDocJobs(inputs.map((input) => ({ input })));
  const pages: Awaited<ReturnType<typeof retainDocPdf>> = [];
  for (const [index, result] of results.entries()) {
    expect(
      result,
      JSON.stringify(result, (key, value) => (key === 'bytes' ? '<bytes>' : value)),
    ).toMatchObject({ ok: true, pages: 1, restored: true, remainingFonts: 0 });
    pages.push(
      (
        await retainDocPdf(
          [
            'anchor-normal-strut',
            'anchor-relative-spacing',
            'anchor-small-image',
            'anchor-small-reference',
            'anchor-exact-spacing',
            'anchor-exact-reference',
          ][index],
          result.bytes!,
        )
      )[0],
    );
  }
  const baselineGap = (page: (typeof pages)[number]) => {
    const before = page.items.find((item) => item.str.includes('Before image'))!;
    const after = page.items.find((item) => item.str.includes('AFTER-IMAGE-SENTINEL'))!;
    expect(before).toBeDefined();
    expect(after).toBeDefined();
    return before.transform[5] - after.transform[5];
  };
  const strut = baselineGap(pages[0]);
  // The saved two-line after-spacing is based on the original paragraph strut,
  // not on the image's enlarged 110px flow reservation.
  expect(baselineGap(pages[1])).toBeCloseTo(strut * 3 + 110 * 0.75, 2);
  expect(baselineGap(pages[2])).toBeCloseTo(baselineGap(pages[3]), 5);
  expect(baselineGap(pages[4])).toBeCloseTo(baselineGap(pages[5]), 5);
  expect(Buffer.from(pages[2].pixels).equals(Buffer.from(pages[3].pixels))).toBe(true);
  expect(Buffer.from(pages[4].pixels).equals(Buffer.from(pages[5].pixels))).toBe(true);
  const blue = (page: (typeof pages)[number]) => {
    let count = 0,
      top = page.height,
      left = page.width;
    for (let index = 0; index < page.pixels.length; index += 4) {
      const [r, g, b] = page.pixels.slice(index, index + 3);
      if (b > 150 && r < 80 && g < 100) {
        count++;
        top = Math.min(top, Math.floor(index / 4 / page.width));
        left = Math.min(left, (index / 4) % page.width);
      }
    }
    return { count, top, left };
  };
  expect(Math.abs(blue(pages[1]).count - 48 * 90 * 0.75 ** 2)).toBeLessThan(100);
  expect(blue(pages[1]).left).toBe(45);
  expect(Math.abs(blue(pages[1]).top - (48 + 20) * 0.75 - strut)).toBeLessThan(1);
  expect(inputs.map((input) => input.snapshot)).toEqual(originals.map((input) => input.snapshot));
  for (const [index, input] of inputs.entries()) {
    for (const [imageIndex, image] of input.images.entries())
      expect(
        Buffer.from(image.bytes).equals(Buffer.from(originals[index].images[imageIndex].bytes)),
      ).toBe(true);
    for (const [fontIndex, font] of input.fonts.entries())
      expect(
        Buffer.from(font.bytes).equals(Buffer.from(originals[index].fonts[fontIndex].bytes)),
      ).toBe(true);
  }
}, 90_000);

test('cropped translucent floating images use authorized raster pixels and physical anchors', async () => {
  const canvas = createCanvas(40, 20),
    context = canvas.getContext('2d');
  context.fillStyle = '#d02040';
  context.fillRect(0, 0, 20, 20);
  context.fillStyle = '#2040d0';
  context.fillRect(20, 0, 20, 20);
  const snapshot = textDoc(['Cropped authorized image', '\b']);
  snapshot.body!.customBlocks = [
    { startIndex: 'Cropped authorized image\r'.length, blockId: 'crop' },
  ];
  snapshot.drawingsOrder = ['crop'];
  snapshot.drawings = {
    crop: {
      drawingId: 'crop',
      unitId: snapshot.id,
      subUnitId: snapshot.id,
      drawingType: 0,
      source: 'https://not-fetched.invalid/authorized-image',
      layoutType: 1,
      docTransform: {
        size: { width: 100, height: 80 },
        positionH: { relativeFrom: 3, posOffset: 20 },
        positionV: { relativeFrom: 1, posOffset: 30 },
        angle: 0,
      },
      opacity: 0.5,
      srcRect: { left: 100, top: 0, right: 0, bottom: 0 },
    },
  } as typeof snapshot.drawings;
  const input = await docInput(snapshot);
  input.images = [
    { source: 'https://not-fetched.invalid/authorized-image', bytes: await canvas.encode('png') },
  ];
  const [result] = await runDocJobs([{ input }]);
  expect(
    result,
    JSON.stringify(result, (key, value) => (key === 'bytes' ? '<bytes>' : value)),
  ).toMatchObject({ ok: true, pages: 1 });
  const [page] = await retainDocPdf('cropped-translucent-image', result.bytes!);
  let blue = 0,
    red = 0,
    firstX = page.width;
  for (let i = 0; i < page.pixels.length; i += 4) {
    const [r, g, b] = page.pixels.slice(i, i + 3);
    if (Math.abs(r - 144) <= 1 && Math.abs(g - 160) <= 1 && Math.abs(b - 232) <= 1) {
      blue++;
      firstX = Math.min(firstX, (i / 4) % page.width);
    }
    if (r > 180 && g < 160 && b < 180) red++;
  }
  expect(blue).toBeGreaterThan(4000);
  expect(red).toBe(0);
  // Stored page margin48px plus margin-relative offset20px, at0.75pt/px.
  expect(firstX).toBe(51);
}, 60_000);
