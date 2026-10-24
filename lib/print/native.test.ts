import { fork } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { HorizontalAlign, WrapStrategy } from '@univerjs/core';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fixtureFonts } from './font-fixtures.ts';
import type { NativeSheetInput } from './native.ts';
import type { NativeJob } from './native-fixture.ts';

interface Result {
  ok: boolean;
  bytes?: Uint8Array;
  pages?: number;
  code?: string;
  message?: string;
  restored: boolean;
  remainingFonts: number;
}

async function run(jobs: NativeJob[]): Promise<Result[]> {
  const worker = fork(new URL('./native-fixture.ts', import.meta.url), [], {
    env: { ...process.env, DISABLE_SYSTEM_FONTS_LOAD: '1' },
    serialization: 'advanced',
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<Result[]>((accept, reject) => {
      worker.once('message', (message) => accept(message as Result[]));
      worker.once('error', reject);
      worker.once('exit', (code) =>
        reject(new Error(`Native fixture exited without a result (${code}).`)),
      );
      timeout = setTimeout(
        () => reject(new Error('Native fixture exceeded its process deadline.')),
        40_000,
      );
      worker.send(jobs);
    });
  } finally {
    clearTimeout(timeout);
    worker.kill('SIGKILL');
  }
}

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
          body: { dataStream: 'Unimplemented rich text\r\n' },
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
    expect(result.message).not.toContain('Unimplemented rich text');
  }
  expect(results.every((result) => result.restored && result.remainingFonts === 0)).toBe(true);
  expect(results[4]).toMatchObject({ ok: true, pages: 4 });
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
      locale: 'enUS',
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

test('large single-line ink must fit the row; multiline and rotated cells publish nothing', async () => {
  const short = await singleCell('X', 24);
  short.snapshot.sheets.sheet.cellData![0][0]!.s = { fs: 64 };
  const tall = structuredClone(short);
  tall.snapshot.sheets.sheet.defaultRowHeight = 120;
  const multiline = await singleCell('A\nB');
  const rotated = await singleCell('Rotated');
  rotated.snapshot.sheets.sheet.cellData![0][0]!.s = { tr: { a: 90 } };
  const results = await run([short, multiline, rotated, tall].map((input) => ({ input })));
  for (const result of results.slice(0, 3)) {
    expect(result).toMatchObject({
      ok: false,
      code: 'unsupported',
      restored: true,
      remainingFonts: 0,
    });
    expect(result.bytes).toBeUndefined();
  }
  expect(results[3]).toMatchObject({ ok: true, pages: 1, restored: true, remainingFonts: 0 });
  expect((await renderedGeometry(results[3].bytes!)).text.map((item) => item.text).join('')).toBe(
    'X',
  );
}, 60_000);

async function renderedGeometry(bytes: Uint8Array, filename?: string) {
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  try {
    const pdf = await loading.promise;
    expect(pdf.numPages).toBe(1);
    const page = await pdf.getPage(1);
    const text = (await page.getTextContent()).items.flatMap((item) =>
      'str' in item
        ? [{ text: item.str, transform: item.transform, width: item.width, height: item.height }]
        : [],
    );
    const canvas = createCanvas(595, 842),
      context = canvas.getContext('2d');
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport: page.getViewport({ scale: 1 }),
    }).promise;
    if (filename)
      await writeFile(
        resolve('output/pdf/spn-101-candidate', filename),
        await canvas.encode('png'),
      );
    return { text, pixels: Buffer.from(context.getImageData(0, 0, 595, 842).data) };
  } finally {
    await loading.destroy();
  }
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
  const original = await renderedGeometry(sequential[0].bytes!);
  const reused = await renderedGeometry(sequential[1].bytes!);
  const isolated = await renderedGeometry(fresh.bytes!);
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
    const geometry = await renderedGeometry(result.bytes!, `wrapped-${index}.png`);
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

test('wrapped overflow and ordinary or merged page-crossing text fail atomically before a later valid render', async () => {
  const text =
    'Every word must survive complete paragraph admission, including this final sentinel.';
  const short = await singleCell(text, 24);
  short.snapshot.sheets.sheet.defaultColumnWidth = 100;
  short.snapshot.sheets.sheet.cellData![0][0]!.s = { fs: 16, tb: WrapStrategy.WRAP };
  const tall = await singleCell('Page crossing sentinel', 2400);
  // A non-final tall row exercises the native printing end-row exclusion.
  tall.snapshot.sheets.sheet.rowCount = 2;
  tall.snapshot.sheets.sheet.rowData = { 1: { h: 24 } };
  tall.snapshot.sheets.sheet.cellData![1] = { 0: { v: 'Tail', s: { fs: 12 } } };
  const merged = structuredClone(tall);
  merged.snapshot.sheets.sheet.defaultRowHeight = 800;
  merged.snapshot.sheets.sheet.rowCount = 4;
  merged.snapshot.sheets.sheet.rowData = { 3: { h: 24 } };
  merged.snapshot.sheets.sheet.cellData = {
    0: { 0: { v: 'Merged crossing sentinel', s: { fs: 16, tb: WrapStrategy.WRAP } } },
    3: { 0: { v: 'Tail', s: { fs: 12 } } },
  };
  merged.snapshot.sheets.sheet.mergeData = [
    { startRow: 0, endRow: 2, startColumn: 0, endColumn: 0 },
  ];
  const good = await singleCell('Still works');
  const results = await run([short, tall, merged, good].map((input) => ({ input })));
  for (const result of results.slice(1, 3))
    expect(result.message).toBe('PDF text page continuation is not implemented yet.');
  for (const result of results.slice(0, 3)) {
    expect(result).toMatchObject({
      ok: false,
      code: 'unsupported',
      restored: true,
      remainingFonts: 0,
    });
    expect(result.bytes).toBeUndefined();
    expect(result.message).not.toContain('sentinel');
  }
  expect(results[3]).toMatchObject({ ok: true, pages: 1, restored: true, remainingFonts: 0 });
}, 60_000);
