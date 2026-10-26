import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import {
  CustomRangeType,
  DocumentFlavor,
  DocStyleType,
  ListGlyphType,
  LocaleType,
  ObjectRelativeFromV,
  PositionedObjectLayoutType,
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

test('supported tall image anchors continue completely and broken native anchors fail without bytes', async () => {
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
  fullColumn.snapshot.drawings!.image.distL = 600;
  fullColumn.snapshot.drawings!.image.distR = 600;
  const square = anchorVariant('\b');
  square.snapshot.drawings!.image.layoutType = PositionedObjectLayoutType.WRAP_SQUARE;
  inputs.push(square);
  const badAnchors = [bare, invisible, line, nonLeading, multiple, fullColumn];
  const allResults = await runDocJobs([...badAnchors, ...inputs].map((input) => ({ input })));
  for (const rejected of allResults.slice(0, badAnchors.length)) {
    expect(rejected, JSON.stringify(rejected)).toMatchObject({
      ok: false,
      code: 'unsupported',
      restored: true,
      remainingFonts: 0,
    });
    expect(rejected.bytes).toBeUndefined();
  }
  const results = allResults.slice(badAnchors.length);
  for (const [index, result] of results.entries()) {
    expect(
      result,
      JSON.stringify(result, (key, value) => (key === 'bytes' ? '<bytes>' : value)),
    ).toMatchObject({ ok: true, restored: true, remainingFonts: 0 });
    const pages = await retainDocPdf(
      ['tall-inline-image', 'tall-floating-image', 'tall-square-image'][index],
      result.bytes!,
    );
    expect(pages.length).toBeGreaterThanOrEqual(3);
    expect(pages.map((page) => page.text).join(' ')).toContain('AFTER-IMAGE-SENTINEL');
    if (index === 1) expect(pages.map((page) => page.text).join(' ')).toContain('Anchor caption');
    // An omitted or displaced anchor can retain every pixel while adding blank pages.
    expect(pages.every((page) => page.pixels.some((value, i) => i % 4 !== 3 && value < 250))).toBe(
      true,
    );
    const colors = [0, 0, 0];
    for (const page of pages)
      for (let n = 0; n < page.pixels.length; n += 4) {
        const [r, g, b] = page.pixels.slice(n, n + 3);
        if (r > 150 && g < 80 && b < 100) colors[0]++;
        if (g > 100 && r < 80 && b < 100) colors[1]++;
        if (b > 150 && r < 80 && g < 100) colors[2]++;
      }
    // Each band is 48×300 source px at 0.75 pt/px: 8,100 colored pixels.
    // A repeated/clipped source slice changes this area, even if all colors occur.
    for (const count of colors) expect(Math.abs(count - 8100)).toBeLessThan(200);
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
