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
      const margin = context.getImageData(5, 5, 1, 1).data;
      expect([...margin]).toEqual([255, 255, 255, 255]);
      const pixels = context.getImageData(0, 0, 595, 842).data;
      let red = 0;
      for (let n = 0; n < pixels.length; n += 4)
        if (pixels[n] > 170 && pixels[n + 1] < 80 && pixels[n + 2] < 110) red++;
      if (index <= 3) expect(red).toBeGreaterThan(100);
      else expect(red).toBe(0);
      await writeFile(resolve(output, `candidate-${index}.png`), await canvas.encode('png'));
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

test('large single-line ink must fit the row; multiline, wrapped and rotated cells publish nothing', async () => {
  const short = await singleCell('X', 24);
  short.snapshot.sheets.sheet.cellData![0][0]!.s = { fs: 64 };
  const tall = structuredClone(short);
  tall.snapshot.sheets.sheet.defaultRowHeight = 120;
  const multiline = await singleCell('A\nB');
  const wrapped = await singleCell('Wrapped');
  wrapped.snapshot.sheets.sheet.cellData![0][0]!.s = { tb: WrapStrategy.WRAP };
  const rotated = await singleCell('Rotated');
  rotated.snapshot.sheets.sheet.cellData![0][0]!.s = { tr: { a: 90 } };
  const results = await run([short, multiline, wrapped, rotated, tall].map((input) => ({ input })));
  for (const result of results.slice(0, 4)) {
    expect(result).toMatchObject({
      ok: false,
      code: 'unsupported',
      restored: true,
      remainingFonts: 0,
    });
    expect(result.bytes).toBeUndefined();
  }
  expect(results[4]).toMatchObject({ ok: true, pages: 1, restored: true, remainingFonts: 0 });
  expect((await renderedGeometry(results[4].bytes!)).text.map((item) => item.text).join('')).toBe(
    'X',
  );
}, 60_000);

async function renderedGeometry(bytes: Uint8Array) {
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
