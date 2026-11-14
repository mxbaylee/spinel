import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import {
  BorderStyleTypes,
  HorizontalAlign,
  LocaleType,
  VerticalAlign,
  WrapStrategy,
} from '@univerjs/core';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { IStyleData } from '@univerjs/core';
import { fixtureFonts } from './font-fixtures.ts';
import type { NativeSheetInput } from './native.ts';
import { retainPdf, runNativeJobs as run } from './native-test-support.ts';

async function fixture(): Promise<NativeSheetInput> {
  const raster = createCanvas(3, 2),
    context = raster.getContext('2d');
  context.fillStyle = '#dd2244';
  context.fillRect(0, 0, 3, 2);
  return {
    fonts: await fixtureFonts(),
    defaultFamily: 'Atkinson Hyperlegible',
    fallbackFamilies: ['Noto Sans Symbols 2'],
    images: [{ source: 'prepared-raster', bytes: await raster.encode('png') }],
    snapshot: {
      id: 'book',
      name: 'Synthetic native renderer fixture',
      appVersion: '1.1.0',
      locale: 'enUS',
      styles: { base: { ff: 'Atkinson Hyperlegible', fs: 12, cl: { rgb: '#221832' } } },
      sheetOrder: ['first', 'hidden', 'second'],
      sheets: {
        first: {
          id: 'first',
          rowCount: 120,
          columnCount: 2,
          defaultRowHeight: 24,
          defaultColumnWidth: 180,
          defaultStyle: 'base',
          cellData: {
            0: { 0: { v: 'First' } },
            1: { 0: { v: 'Bold', s: { bl: 1 } } },
            2: { 0: { v: 'Italic', s: { it: 1 } } },
            3: { 0: { v: 2, s: { n: { pattern: '$0.00' } } } },
            110: { 0: { v: 'Tail' } },
          },
        },
        hidden: { id: 'hidden', hidden: 1, cellData: { 0: { 0: { v: 'HIDDEN-SENTINEL' } } } },
        second: {
          id: 'second',
          rowCount: 1,
          columnCount: 1,
          defaultRowHeight: 24,
          defaultColumnWidth: 180,
          defaultStyle: 'base',
          cellData: { 0: { 0: { v: 'Second' } } },
        },
      },
      resources: [
        {
          name: 'SHEET_DRAWING_PLUGIN',
          data: JSON.stringify({
            first: {
              order: ['picture'],
              data: {
                picture: {
                  drawingId: 'picture',
                  unitId: 'book',
                  subUnitId: 'first',
                  drawingType: 0,
                  anchorType: '2',
                  source: 'prepared-raster',
                  transform: { left: 250, top: 500, width: 40, height: 2200 },
                },
              },
            },
          }),
        },
      ],
    },
  } as NativeSheetInput;
}

test('candidate PDF reopens every page with ordered text, embedded fonts, image continuation and light margins', async () => {
  const input = await fixture();
  const [result] = await run([{ input }]);
  expect(result).toMatchObject({ ok: true, pages: 4, restored: true, remainingFonts: 0 });
  const bytes = Buffer.from(result.bytes!);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(bytes.toString('latin1')).toMatch(/\/FontFile[23]\s+\d+\s+0\s+R/);
  const output = resolve('output/pdf/spn-101-candidate');
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'candidate.pdf'), bytes);
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const pdf = await loading.promise;
  const text: string[] = [];
  try {
    expect(pdf.numPages).toBe(4);
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      expect(page.view).toEqual([0, 0, 595, 842]);
      text.push(
        (await page.getTextContent()).items
          .flatMap((item) => ('str' in item ? [item.str] : []))
          .join(' '),
      );
      const viewport = page.getViewport({ scale: 1 });
      const canvas = createCanvas(595, 842),
        context = canvas.getContext('2d');
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      // Keep the actual page even if a following pixel assertion fails in CI.
      await writeFile(resolve(output, `candidate-${index}.png`), await canvas.encode('png'));
      const margin = context.getImageData(5, 5, 1, 1).data;
      expect([...margin]).toEqual([255, 255, 255, 255]);
      const pixels = context.getImageData(0, 0, 595, 842).data;
      let red = 0;
      for (let n = 0; n < pixels.length; n += 4)
        if (pixels[n] > 170 && pixels[n + 1] < 80 && pixels[n + 2] < 110) red++;
      if (index <= 3) expect(red).toBeGreaterThan(100);
      else expect(red).toBe(0);
      page.cleanup();
    }
    expect(text.join(' ')).not.toContain('HIDDEN-SENTINEL');
    for (const marker of ['First', 'Bold', 'Italic', '$2.00', 'Tail', 'Second'])
      expect(text.join(' ').split(marker)).toHaveLength(2);
    expect(text[0]).toContain('First');
    expect(text[2]).toContain('Tail');
    expect(text[3]).toContain('Second');
  } finally {
    await loading.destroy();
  }
}, 45_000);

test('late failures publish no bytes, release native fonts/globals and allow a fresh operation', async () => {
  const good = await fixture();
  const rich = structuredClone(good);
  rich.snapshot.sheets.second.cellData = {
    0: {
      0: {
        p: {
          id: 'rich',
          documentStyle: { background: { source: 'unprepared-background' } },
          body: { dataStream: 'Unsupported rich paint\r\n' },
        },
      },
    },
  } as typeof rich.snapshot.sheets.second.cellData;
  const missing = structuredClone(good);
  missing.snapshot.sheets.second.cellData = { 0: { 0: { v: String.fromCodePoint(0x10ffff) } } };
  const results = await run([
    { input: good, options: { limits: { outputBytes: 1 } } },
    { input: rich },
    { input: missing },
    { input: good, abort: true },
    { input: good },
  ]);
  expect(results.slice(0, 4).map((result) => result.code)).toEqual([
    'limit',
    'unsupported',
    'unsupported',
    'cancelled',
  ]);
  for (const result of results.slice(0, 4)) {
    expect(result.ok).toBe(false);
    expect(result.bytes).toBeUndefined();
    expect(result.message).not.toContain('Unsupported rich paint');
  }
  expect(results.every((result) => result.restored && result.remainingFonts === 0)).toBe(true);
  expect(results[4]).toMatchObject({ ok: true, pages: 4 });
  await retainPdf('cleanup-recovery', results[4].bytes!);
}, 60_000);

async function singleCell(text: string, height = 120): Promise<NativeSheetInput> {
  const fonts = await fixtureFonts();
  return {
    fonts: [fonts[0]],
    defaultFamily: fonts[0].family,
    images: [],
    snapshot: {
      id: 'one',
      name: 'Geometry fixture',
      appVersion: '1.1.0',
      locale: LocaleType.EN_US,
      styles: {},
      sheetOrder: ['sheet'],
      sheets: {
        sheet: {
          id: 'sheet',
          rowCount: 1,
          columnCount: 1,
          defaultRowHeight: height,
          defaultColumnWidth: 360,
          cellData: { 0: { 0: { v: text, s: { fs: 24, ht: HorizontalAlign.CENTER } } } },
        },
      },
    },
  } as NativeSheetInput;
}

test('large ink rejects a short row while multiline and rotated text remain complete', async () => {
  const short = await singleCell('X', 24);
  short.snapshot.sheets.sheet.cellData![0][0]!.s = { fs: 64 };
  const tall = structuredClone(short);
  tall.snapshot.sheets.sheet.defaultRowHeight = 120;
  const multiline = await singleCell('First line\nFinal line');
  const rotated = await singleCell('Rotated', 260);
  rotated.snapshot.sheets.sheet.cellData![0][0]!.s = { fs: 16, tr: { a: 90 } };
  const results = await run([short, multiline, rotated, tall].map((input) => ({ input })));
  expect(results[0]).toMatchObject({
    ok: false,
    code: 'unsupported',
    restored: true,
    remainingFonts: 0,
  });
  expect(results[0].bytes).toBeUndefined();
  for (const [index, result] of results.slice(1).entries()) {
    expect(result).toMatchObject({ ok: true, pages: 1, restored: true, remainingFonts: 0 });
    const pages = await retainPdf(`native-text-${index}`, result.bytes!);
    expect(pages[0].text.replace(/\s+/g, ' ').trim()).toBe(
      ['First line Final line', 'Rotated', 'X'][index],
    );
    if (index === 0)
      expect(
        new Set(pages[0].items.filter((item) => item.str.trim()).map((item) => item.transform[5]))
          .size,
      ).toBeGreaterThan(1);
    if (index === 1)
      expect(
        pages[0].items.some((item) => Math.abs(item.transform[1]) > Math.abs(item.transform[0])),
      ).toBe(true);
  }
}, 90_000);

async function renderedGeometry(bytes: Uint8Array, name: string) {
  const pages = await retainPdf(name, bytes);
  expect(pages).toHaveLength(1);
  return {
    text: pages[0].items.map((item) => ({
      text: item.str,
      transform: item.transform,
      width: item.width,
      height: item.height,
    })),
    pixels: Buffer.from(pages[0].pixels),
  };
}

test('a different prepared font in the same process matches its fresh-process text geometry and pixels', async () => {
  const first = await singleCell('Budget');
  const second = structuredClone(first);
  // Keep the requested family, text, size and alignment identical while replacing
  // the actual licensed regular face. Reusing PrintFont0 would alias native caches.
  const fonts = await fixtureFonts();
  second.fonts = [{ ...fonts[4], family: first.defaultFamily }];
  const sequential = await run([{ input: first }, { input: second }]);
  const [fresh] = await run([{ input: second }]);
  for (const result of [...sequential, fresh])
    expect(result).toMatchObject({ ok: true, pages: 1, restored: true, remainingFonts: 0 });
  const original = await renderedGeometry(sequential[0].bytes!, 'font-original');
  const reused = await renderedGeometry(sequential[1].bytes!, 'font-sequential');
  const isolated = await renderedGeometry(fresh.bytes!, 'font-fresh');
  expect(reused.text.map((item) => item.text).join('')).toBe('Budget');
  expect(reused.text).toEqual(isolated.text);
  expect(reused.pixels.equals(isolated.pixels)).toBe(true);
  expect(original.text).not.toEqual(isolated.text);
  expect(original.pixels.equals(isolated.pixels)).toBe(false);
}, 90_000);

test('complete wrapped paragraphs fit ordinary and merged cells without dropping their final words', async () => {
  const text = 'First budget paragraph with several wrapped words and a final sentinel.';
  const ordinary = await singleCell(text, 260);
  ordinary.snapshot.sheets.sheet.defaultColumnWidth = 160;
  ordinary.snapshot.sheets.sheet.showGridlines = 0;
  ordinary.snapshot.sheets.sheet.cellData![0][0]!.s = { fs: 16, tb: WrapStrategy.WRAP };
  const merged = structuredClone(ordinary);
  merged.snapshot.sheets.sheet.columnCount = 2;
  merged.snapshot.sheets.sheet.defaultColumnWidth = 80;
  merged.snapshot.sheets.sheet.mergeData = [
    { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 },
  ];
  const results = await run([{ input: ordinary }, { input: merged }]);
  const output = resolve('output/pdf/spn-101-candidate');
  await mkdir(output, { recursive: true });
  for (const [index, result] of results.entries()) {
    expect(result).toMatchObject({ ok: true, pages: 1, restored: true, remainingFonts: 0 });
    await writeFile(resolve(output, `wrapped-${index}.pdf`), result.bytes!);
    const geometry = await renderedGeometry(result.bytes!, `wrapped-${index}`);
    expect(
      geometry.text
        .map((item) => item.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    ).toBe(text);
    // At least two actual baselines establish wrapping, not squeezed single-line text.
    expect(
      new Set(geometry.text.filter((item) => item.text.trim()).map((item) => item.transform[5]))
        .size,
    ).toBeGreaterThan(1);
    let inkPixels = 0;
    for (let n = 0; n < geometry.pixels.length; n += 4)
      if (geometry.pixels[n] < 100 && geometry.pixels[n + 1] < 100 && geometry.pixels[n + 2] < 100)
        inkPixels++;
    expect(inkPixels).toBeGreaterThan(100);
  }
}, 60_000);

test('overfull wrapping fails atomically but tall ordinary and merged glyphs continue through page seams', async () => {
  const short = await singleCell(
    'Every word must survive complete paragraph admission, including the final sentinel.',
    24,
  );
  short.snapshot.sheets.sheet.defaultColumnWidth = 100;
  short.snapshot.sheets.sheet.cellData![0][0]!.s = { fs: 16, tb: WrapStrategy.WRAP };
  const tall = await singleCell('M', 2052);
  const sheet = tall.snapshot.sheets.sheet;
  sheet.showGridlines = 0;
  sheet.rowCount = 2;
  sheet.rowData = { 1: { h: 24 } };
  sheet.cellData![0][0]!.s = { fs: 128, vt: VerticalAlign.MIDDLE, cl: { rgb: '#cc2266' } };
  sheet.cellData![1] = { 0: { v: 'Final tail', s: { fs: 12 } } };
  const merged = structuredClone(tall);
  const mergeSheet = merged.snapshot.sheets.sheet;
  mergeSheet.defaultRowHeight = 1026;
  mergeSheet.rowCount = 3;
  mergeSheet.rowData = { 2: { h: 24 } };
  mergeSheet.cellData = { 0: sheet.cellData![0], 2: sheet.cellData![1] };
  mergeSheet.mergeData = [{ startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 }];
  const good = await singleCell('Still works');
  const results = await run([short, tall, merged, good].map((input) => ({ input })));
  expect(results[0]).toMatchObject({
    ok: false,
    code: 'unsupported',
    restored: true,
    remainingFonts: 0,
  });
  expect(results[0].bytes).toBeUndefined();
  for (const [index, result] of results.slice(1, 3).entries()) {
    expect(result).toMatchObject({ ok: true, pages: 3, restored: true, remainingFonts: 0 });
    const pages = await retainPdf(`text-continuation-${index}`, result.bytes!);
    const magenta = (page: (typeof pages)[number], top: number, bottom: number) => {
      let count = 0;
      for (let y = top; y < bottom; y++)
        for (let x = 35; x < 310; x++) {
          const offset = (y * page.width + x) * 4;
          if (
            page.pixels[offset] > 140 &&
            page.pixels[offset + 1] < 90 &&
            page.pixels[offset + 2] > 70
          )
            count++;
        }
      return count;
    };
    // Actual glyph ink straddles the seam. The prior native print cache omitted
    // the partial non-final row entirely from the first page.
    expect(magenta(pages[0], 786, 806)).toBeGreaterThan(30);
    expect(magenta(pages[1], 36, 56)).toBeGreaterThan(30);
    expect(pages[2].text).toContain('Final tail');
    for (const page of pages) expect(page.view).toEqual([0, 0, 595, 842]);
  }
  expect(results[3]).toMatchObject({ ok: true, pages: 1, restored: true, remainingFonts: 0 });
  await retainPdf('continuation-recovery', results[3].bytes!);
}, 90_000);

test('rich formatting embeds all prepared faces and renders mixed-family Unicode fallback', async () => {
  const input = await singleCell('placeholder', 90);
  input.fonts = await fixtureFonts();
  input.fallbackFamilies = ['Noto Sans Symbols 2'];
  const sheet = input.snapshot.sheets.sheet;
  sheet.rowCount = 6;
  sheet.defaultColumnWidth = 560;
  sheet.showGridlines = 0;
  const rich = 'Regular café Bold Italic Both ♜';
  sheet.cellData = {
    0: { 0: { v: 'Regular café', s: { fs: 18 } } },
    1: { 0: { v: 'Bold', s: { fs: 18, bl: 1 } } },
    2: { 0: { v: 'Italic', s: { fs: 18, it: 1 } } },
    3: { 0: { v: 'Both', s: { fs: 18, bl: 1, it: 1 } } },
    4: { 0: { v: 'Latin café and fallback ♜', s: { fs: 18 } } },
    5: {
      0: {
        p: {
          id: 'rich-styles',
          documentStyle: {},
          body: {
            dataStream: `${rich}\r\n`,
            textRuns: [
              {
                st: rich.indexOf('Bold'),
                ed: rich.indexOf('Bold') + 4,
                ts: { bl: 1, cl: { rgb: '#9f205b' } },
              },
              {
                st: rich.indexOf('Italic'),
                ed: rich.indexOf('Italic') + 6,
                ts: { it: 1, ul: { s: 1 } },
              },
              { st: rich.indexOf('Both'), ed: rich.indexOf('Both') + 4, ts: { bl: 1, it: 1 } },
            ],
          },
        },
        s: { fs: 18, tb: WrapStrategy.WRAP },
      },
    },
  };
  const [result] = await run([{ input }]);
  expect(result).toMatchObject({ ok: true, pages: 1, restored: true, remainingFonts: 0 });
  const pages = await retainPdf('rich-unicode-faces', result.bytes!);
  expect(pages[0].text.replace(/\s+/g, ' ')).toContain('Latin café and fallback ♜');
  expect(pages[0].text.replace(/\s+/g, ' ')).toContain(rich);
  // Distinct embedded font resources prove that bold/italic/fallback did not
  // silently use synthetic styling or a machine's installed font.
  const pdf = Buffer.from(result.bytes!).toString('latin1');
  expect((pdf.match(/\/FontFile[23]\s+\d+\s+0\s+R/g) ?? []).length).toBeGreaterThanOrEqual(5);
  const embeddedNames = [...pdf.matchAll(/\/FontName\s+\/(?:[A-Z]{6}\+)?([^\s<>/]+)/g)].map(
    (match) => match[1],
  );
  expect(embeddedNames).toEqual(
    expect.arrayContaining([
      'AtkinsonHyperlegible-Regular',
      'AtkinsonHyperlegible-Bold',
      'AtkinsonHyperlegible-Italic',
      'AtkinsonHyperlegible-BoldItalic',
      'NotoSansSymbols2-Regular',
    ]),
  );
  expect(new Set(pages[0].items.map((item) => item.fontName)).size).toBeGreaterThanOrEqual(5);
  const styleItems = ['Regular café', 'Bold', 'Italic', 'Both'].map((text) =>
    pages[0].items.find((item) => item.str.trim() === text),
  );
  expect(styleItems.every(Boolean)).toBe(true);
  expect(new Set(styleItems.map((item) => item!.fontName)).size).toBe(4);
  const fallback = pages[0].items.find((item) => item.str.includes('♜'))!;
  expect(styleItems.map((item) => item!.fontName)).not.toContain(fallback.fontName);
}, 60_000);

test('native overflow includes its actual ink and outer thick borders stay inside the complete crop', async () => {
  const input = await singleCell('Overflow reaches beyond the occupied cell', 100);
  const sheet = input.snapshot.sheets.sheet;
  sheet.columnCount = 20;
  sheet.defaultColumnWidth = 80;
  sheet.showGridlines = 0;
  sheet.cellData![0][0]!.s = { fs: 16, vt: VerticalAlign.TOP };
  const bordered = await singleCell('Bordered', 100);
  bordered.snapshot.sheets.sheet.showGridlines = 0;
  const thick = { s: BorderStyleTypes.THICK, cl: { rgb: '#dd2244' } };
  bordered.snapshot.sheets.sheet.cellData![0][0]!.s = {
    fs: 16,
    bd: { t: thick, b: thick, l: thick, r: thick },
  };
  const results = await run([{ input }, { input: bordered }]);
  for (const result of results)
    expect(result).toMatchObject({ ok: true, pages: 1, restored: true, remainingFonts: 0 });
  const overflow = await retainPdf('text-overflow', results[0].bytes!);
  expect(overflow[0].text).toContain('Overflow reaches beyond the occupied cell');
  // Narrow content stays at native 96px/inch -> 72pt/inch, with no enlargement.
  expect(overflow[0].items.find((item) => item.str.includes('Overflow'))!.height).toBeCloseTo(
    16,
    1,
  );
  const border = await retainPdf('outer-thick-border', results[1].bytes!);
  const redColumns = new Set<number>(),
    redRows = new Set<number>();
  for (let y = 0; y < border[0].height; y++)
    for (let x = 0; x < border[0].width; x++) {
      const offset = (y * border[0].width + x) * 4;
      if (
        border[0].pixels[offset] > 150 &&
        border[0].pixels[offset + 1] < 90 &&
        border[0].pixels[offset + 2] < 120
      ) {
        redColumns.add(x);
        redRows.add(y);
      }
    }
  expect(Math.min(...redColumns)).toBeGreaterThanOrEqual(35);
  expect(Math.min(...redRows)).toBeGreaterThanOrEqual(35);
  expect(redColumns.size).toBeGreaterThan(265);
  expect(redRows.size).toBeGreaterThan(72);
}, 90_000);

test('a wide worksheet shrinks once across both vertical pages and retains its right edge and final row', async () => {
  const input = await singleCell('', 40);
  const sheet = input.snapshot.sheets.sheet;
  sheet.rowCount = 80;
  sheet.columnCount = 4;
  sheet.defaultColumnWidth = 350;
  sheet.showGridlines = 0;
  const rightStyle = {
    fs: 16,
    ht: HorizontalAlign.RIGHT,
    bd: { r: { s: BorderStyleTypes.THICK, cl: { rgb: '#dd2244' } } },
  };
  sheet.cellData = {};
  for (let row = 0; row < 80; row++) sheet.cellData[row] = { 3: { v: '', s: rightStyle } };
  sheet.cellData[0][0] = { v: 'TOP LEFT', s: { fs: 16 } };
  sheet.cellData[0][3]!.v = 'TOP RIGHT';
  sheet.cellData[79][0] = { v: 'FINAL LEFT', s: { fs: 16 } };
  sheet.cellData[79][3]!.v = 'FINAL RIGHT';

  const [result] = await run([{ input }]);
  expect(result).toMatchObject({ ok: true, pages: 2, restored: true, remainingFonts: 0 });
  const pages = await retainPdf('wide-sheet-vertical-continuation', result.bytes!);
  expect(pages).toHaveLength(2);
  const allText = pages.map((page) => page.text).join(' ');
  for (const marker of ['TOP LEFT', 'TOP RIGHT', 'FINAL LEFT', 'FINAL RIGHT'])
    expect(allText.split(marker)).toHaveLength(2);
  expect(pages[0].text).toContain('TOP LEFT');
  expect(pages[0].text).toContain('TOP RIGHT');
  expect(pages[1].text).toContain('FINAL LEFT');
  expect(pages[1].text).toContain('FINAL RIGHT');

  // An authored font size is CSS points at the native 96px/inch layout scale.
  // The 1400px sheet fits the 523pt printable width, giving about 7.97pt text;
  // the outside border adds less than 0.02pt to this independent expectation.
  const expectedPointSize = ((16 * 96) / 72) * (523 / 1400);
  for (const page of pages) {
    expect(page.view).toEqual([0, 0, 595, 842]);
    const left = page.items.find((item) => item.str.includes('LEFT'))!;
    const right = page.items.find((item) => item.str.includes('RIGHT'))!;
    expect(left.height).toBeCloseTo(expectedPointSize, 1);
    expect(right.height).toBeCloseTo(expectedPointSize, 1);
    expect(right.transform[4] + right.width).toBeGreaterThan(550);
    expect(right.transform[4] + right.width).toBeLessThanOrEqual(559.5);

    const redColumns = new Set<number>(),
      redRows = new Set<number>();
    let marginInk = 0;
    for (let y = 0; y < page.height; y++)
      for (let x = 0; x < page.width; x++) {
        const offset = (y * page.width + x) * 4;
        const r = page.pixels[offset],
          g = page.pixels[offset + 1],
          b = page.pixels[offset + 2];
        if (r > 150 && g < 100 && b < 130) {
          redColumns.add(x);
          redRows.add(y);
        }
        if ((x < 35 || x >= 560 || y < 35 || y >= 807) && Math.min(r, g, b) < 250) marginInk++;
      }
    expect(Math.min(...redColumns)).toBeGreaterThanOrEqual(556);
    expect(Math.max(...redColumns)).toBeGreaterThanOrEqual(557);
    expect(Math.max(...redColumns)).toBeLessThanOrEqual(559);
    expect(redRows.size).toBeGreaterThan(350);
    expect(marginInk).toBe(0);
    // Both sides of the cut include the same right border. The final page also
    // retains its bottom tail, rather than adding horizontal pages or spilling.
    if (page === pages[0]) {
      const scale = left.height / ((16 * 96) / 72);
      const rows = Math.floor(770 / scale / 40);
      // The full-width border now ends at a complete 40px row edge, leaving the
      // unused remainder of the printable frame white instead of cutting a row.
      expect(Math.abs(Math.max(...redRows) - (36 + rows * 40 * scale))).toBeLessThan(2);
    } else {
      expect(Math.min(...redRows)).toBeLessThanOrEqual(37);
      expect(Math.max(...redRows)).toBeGreaterThan(450);
    }
  }
}, 90_000);

test('rejects extreme text geometry before native layout and accepts a cleared font size', async () => {
  const base = await singleCell('Bounded geometry', 120);
  const rotation = structuredClone(base);
  rotation.snapshot.sheets.sheet.cellData![0][0]!.s = { tr: { a: 1e100 } };
  const padding = structuredClone(base);
  padding.snapshot.sheets.sheet.cellData![0][0]!.s = { pd: { l: 1e100 } };
  const paragraph = structuredClone(base);
  paragraph.snapshot.sheets.sheet.cellData![0][0]!.p = {
    id: 'bounded-rich',
    documentStyle: {},
    body: {
      dataStream: 'Bounded\r\n',
      paragraphs: [
        { startIndex: 7, paragraphId: 'bounded', paragraphStyle: { lineSpacing: 1e100 } },
      ],
    },
  };
  const spacing = structuredClone(paragraph);
  spacing.snapshot.sheets.sheet.cellData![0][0]!.p!.body!.paragraphs = [
    { startIndex: 7, paragraphId: 'bounded' },
  ];
  spacing.snapshot.sheets.sheet.cellData![0][0]!.p!.body!.textRuns = [
    { st: 0, ed: 7, ts: { sc: 1e100 } },
  ];
  const cleared = structuredClone(base);
  // Native nullable style clearing must resolve the prepared default face/size.
  cleared.snapshot.sheets.sheet.cellData![0][0]!.s = {
    fs: null,
    bl: null,
    it: null,
  } as unknown as IStyleData;
  const defaulted = structuredClone(base);
  defaulted.snapshot.sheets.sheet.cellData![0][0]!.s = {};
  const results = await run(
    [rotation, padding, paragraph, spacing, cleared, defaulted].map((input) => ({ input })),
  );
  for (const result of results.slice(0, 4)) {
    expect(result).toMatchObject({ ok: false, code: 'limit', restored: true, remainingFonts: 0 });
    expect(result.bytes).toBeUndefined();
    expect(result.message).toBe('PDF text geometry exceeds its layout budget.');
  }
  expect(results[4]).toMatchObject({ ok: true, pages: 1, restored: true, remainingFonts: 0 });
  const pages = await retainPdf('cleared-font-size', results[4].bytes!);
  expect(pages[0].text).toContain('Bounded geometry');
  expect(results[5]).toMatchObject({ ok: true, pages: 1, restored: true, remainingFonts: 0 });
  const defaultPages = await retainPdf('default-font-style', results[5].bytes!);
  expect(Buffer.from(pages[0].pixels).equals(Buffer.from(defaultPages[0].pixels))).toBe(true);
}, 90_000);

test.each(['explicit', 'omitted'])(
  'formatted display text has one aggregate limit across selected worksheets and cached reads (%s ids)',
  async (identity) => {
    const input = await singleCell('unused', 80);
    const label = 'DISPLAYVALUE';
    const sheet = input.snapshot.sheets.sheet;
    sheet.cellData = { 0: { 0: { v: 1, s: { fs: 12, n: { pattern: `"${label}"` } } } } };
    input.snapshot.sheetOrder.push('second');
    input.snapshot.sheets.second = { ...structuredClone(sheet), id: 'second' };
    if (identity === 'omitted')
      for (const sheet of Object.values(input.snapshot.sheets))
        delete (sheet as Partial<typeof sheet>).id;
    const results = await run([
      { input, options: { limits: { textCharacters: label.length * 2 - 1 } } },
      { input, options: { limits: { textCharacters: label.length * 2 } } },
    ]);
    expect(results[0]).toMatchObject({
      ok: false,
      code: 'limit',
      message: 'PDF formatted text exceeds its layout budget.',
      restored: true,
      remainingFonts: 0,
    });
    expect(results[0].bytes).toBeUndefined();
    expect(results[1]).toMatchObject({ ok: true, pages: 2, restored: true, remainingFonts: 0 });
    const pages = await retainPdf(`formatted-text-exact-budget-${identity}`, results[1].bytes!);
    expect(pages.map((page) => page.text.trim())).toEqual([label, label]);
  },
  90_000,
);

test('filter formatting and rendering share a display budget even for rows filtered out', async () => {
  const input = await singleCell('H', 80);
  const label = 'DISPLAYVALUE';
  const sheet = input.snapshot.sheets.sheet;
  sheet.rowCount = 3;
  sheet.cellData = {
    0: { 0: { v: 'H' } },
    1: { 0: { v: 1, s: { n: { pattern: `"${label}"` } } } },
    2: { 0: { v: 2, s: { n: { pattern: `"${label}"` } } } },
  };
  const filter = {
    ref: { startRow: 0, endRow: 2, startColumn: 0, endColumn: 0 },
    filterColumns: [{ colId: 0, filters: { filters: ['Absent'] } }],
  };
  input.snapshot.resources = [
    { name: 'SHEET_FILTER_PLUGIN', data: JSON.stringify({ sheet: filter }) },
  ];
  const visible = structuredClone(input);
  visible.snapshot.resources = [
    {
      name: 'SHEET_FILTER_PLUGIN',
      data: JSON.stringify({
        sheet: { ...filter, filterColumns: [{ colId: 0, filters: { filters: [label] } }] },
      }),
    },
  ];
  const exact = 1 + label.length * 2;
  const results = await run([
    { input, options: { limits: { textCharacters: label.length * 2 - 1 } } },
    { input, options: { limits: { textCharacters: exact } } },
    { input: visible, options: { limits: { textCharacters: exact } } },
  ]);
  expect(results[0]).toMatchObject({
    ok: false,
    code: 'limit',
    message: 'PDF formatted text exceeds its layout budget.',
    restored: true,
    remainingFonts: 0,
  });
  expect(results[0].bytes).toBeUndefined();
  for (const result of results.slice(1))
    expect(result).toMatchObject({ ok: true, pages: 1, restored: true, remainingFonts: 0 });
  const hiddenPages = await retainPdf('filter-hidden-exact-text-budget', results[1].bytes!);
  expect(hiddenPages[0].text.trim()).toBe('H');
  const visiblePages = await retainPdf('filter-visible-exact-text-budget', results[2].bytes!);
  expect(visiblePages[0].text.match(/DISPLAYVALUE/g)).toHaveLength(2);
}, 90_000);

test('rich highlights retain overflowing trailing spaces and ordinary tabs remain supported', async () => {
  const short = await singleCell('', 100);
  const sheet = short.snapshot.sheets.sheet;
  sheet.columnCount = 20;
  sheet.defaultColumnWidth = 40;
  sheet.showGridlines = 0;
  sheet.cellData = {
    0: {
      0: {
        s: { fs: 18, vt: VerticalAlign.TOP },
        p: {
          id: 'highlight',
          documentStyle: { textStyle: { bg: { rgb: '#ffdd00' } } },
          body: { dataStream: 'W\r\n' },
        },
      },
    },
  };
  const trailing = structuredClone(short);
  trailing.snapshot.sheets.sheet.cellData![0][0]!.p!.body!.dataStream = `W${' '.repeat(12)}\r\n`;
  const tabs = await singleCell('Left\tRight', 100);
  const results = await run([short, trailing, tabs].map((input) => ({ input })));
  for (const result of results)
    expect(result).toMatchObject({ ok: true, pages: 1, restored: true, remainingFonts: 0 });
  const shortPages = await retainPdf('highlight-short', results[0].bytes!);
  const trailingPages = await retainPdf('highlight-trailing-overflow', results[1].bytes!);
  const rightmostHighlight = (page: (typeof trailingPages)[number]) => {
    let right = -1;
    for (let y = 0; y < page.height; y++)
      for (let x = 0; x < page.width; x++) {
        const offset = (y * page.width + x) * 4;
        if (
          page.pixels[offset] > 200 &&
          page.pixels[offset + 1] > 150 &&
          page.pixels[offset + 2] < 80
        )
          right = Math.max(right, x);
      }
    return right;
  };
  // The only extra paint is native highlighting on trailing spaces. Measuring
  // glyph ink alone cropped this rectangle at the original 40px cell edge.
  expect(rightmostHighlight(trailingPages[0])).toBeGreaterThan(
    rightmostHighlight(shortPages[0]) + 30,
  );
  expect(trailingPages[0].text).toContain('W');
  const tabPages = await retainPdf('leader-free-tabs', results[2].bytes!);
  expect(tabPages[0].text).toContain('Left');
  expect(tabPages[0].text).toContain('Right');
}, 90_000);
