import { expect, test } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { HorizontalAlign, ImageSourceType, VerticalAlign } from '@univerjs/core';
import type { ICellData, IWorkbookData } from '@univerjs/core';
import { fixtureFonts } from './font-fixtures.ts';
import type { NativeSheetInput } from './native.ts';
import { retainPdf, runNativeJobs } from './native-test-support.ts';

type Page = Awaited<ReturnType<typeof retainPdf>>[number];
const colors = ['#d62828', '#2563eb', '#16a34a', '#eab308', '#9333ea', '#ea580c'];
const pageHeight = 770 / 0.75;

function colorAt(page: Page, x: number, y: number, expected: string) {
  const offset = (Math.floor(y) * page.width + Math.floor(x)) * 4;
  const channels = [1, 3, 5].map((start) => parseInt(expected.slice(start, start + 2), 16));
  for (let channel = 0; channel < 3; channel++)
    expect(Math.abs(page.pixels[offset + channel] - channels[channel])).toBeLessThanOrEqual(14);
  expect(page.pixels[offset + 3]).toBe(255);
}

function atSource(pages: Page[], x: number, y: number, expected: string) {
  const index = Math.floor(y / pageHeight);
  colorAt(pages[index], 36 + x * 0.75, 36 + (y - index * pageHeight) * 0.75, expected);
}

function floating(id: string, source: string, transform: Record<string, unknown>, extra = {}) {
  return {
    drawingId: id,
    unitId: 'book',
    subUnitId: 'first',
    drawingType: 0,
    anchorType: '2',
    source,
    transform,
    ...extra,
  };
}

async function input(snapshot: IWorkbookData, bytes: Uint8Array): Promise<NativeSheetInput> {
  return {
    snapshot,
    images: [{ source: 'prepared-pattern', bytes }],
    fonts: await fixtureFonts(),
    defaultFamily: 'Atkinson Hyperlegible',
    fallbackFamilies: ['Noto Sans Symbols 2'],
  };
}

function book(): IWorkbookData {
  return {
    id: 'book',
    name: 'Synthetic image evidence',
    appVersion: '1.1.0',
    locale: 'enUS',
    styles: {},
    sheetOrder: ['first'],
    sheets: {
      first: {
        id: 'first',
        rowCount: 120,
        columnCount: 1,
        defaultRowHeight: 24,
        defaultColumnWidth: 400,
        showGridlines: 0,
        cellData: {},
      },
    },
  } as IWorkbookData;
}

test('every page preserves banded floating image phase, both break edges, corners and the late tail', async () => {
  const raster = createCanvas(60, 300),
    context = raster.getContext('2d');
  for (let band = 0; band < colors.length; band++) {
    context.fillStyle = colors[band];
    context.fillRect(0, band * 50, 60, 50);
  }
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 8, 8);
  context.fillRect(52, 292, 8, 8);
  const snapshot = book();
  snapshot.sheets.first.cellData = { 0: { 0: { v: 'Banded picture' } }, 100: { 0: { v: 'TAIL' } } };
  snapshot.resources = [
    {
      name: 'SHEET_DRAWING_PLUGIN',
      data: JSON.stringify({
        first: {
          order: ['bands'],
          data: {
            bands: floating('bands', 'prepared-pattern', {
              left: 80,
              top: 50,
              width: 120,
              height: 2500,
            }),
          },
        },
      }),
    },
  ];
  const [result] = await runNativeJobs([
    { input: await input(snapshot, await raster.encode('png')) },
  ]);
  expect(result).toMatchObject({ ok: true, pages: 3, restored: true, remainingFonts: 0 });
  const pages = await retainPdf('banded-image-continuation', result.bytes!);
  expect(pages).toHaveLength(3);
  for (const page of pages) {
    expect(page.view).toEqual([0, 0, 595, 842]);
    colorAt(page, 5, 5, '#ffffff');
    expect(page.text).not.toMatch(/watermark|univer/i);
  }
  for (let band = 0; band < colors.length; band++)
    atSource(pages, 140, 50 + ((band + 0.5) * 2500) / colors.length, colors[band]);
  for (const boundary of [pageHeight, pageHeight * 2]) {
    for (const y of [boundary - 5, boundary + 5]) {
      const band = Math.floor(((y - 50) / 2500) * colors.length);
      atSource(pages, 140, y, colors[band]);
    }
  }
  atSource(pages, 140, 2540, colors[5]);
  atSource(pages, 88, 80, '#ffffff');
  atSource(pages, 192, 2520, '#ffffff');
  expect(pages[2].text).toContain('TAIL');
}, 70_000);

test.each([false, true])(
  'background tiles retain worksheet phase through hidden axes and every page (mixed=%s)',
  async (mixed) => {
    const raster = createCanvas(100, 80),
      context = raster.getContext('2d');
    for (let index = 0; index < 4; index++) {
      context.fillStyle = colors[index];
      context.fillRect((index % 2) * 50, Math.floor(index / 2) * 40, 50, 40);
    }
    const snapshot = book();
    Object.assign(snapshot.sheets.first, {
      rowCount: 100,
      columnCount: 2,
      defaultColumnWidth: 120,
      rowData: { 1: { hd: 1 } },
      columnData: { 1: { hd: 1 } },
      backgroundImage: { source: 'prepared-pattern', imageSourceType: ImageSourceType.UUID },
      cellData: mixed ? { 0: { 0: { v: 'Pattern' } }, 99: { 0: { v: 'LAST' } } } : {},
    });
    const [result] = await runNativeJobs([
      { input: await input(snapshot, await raster.encode('png')) },
    ]);
    expect(result).toMatchObject({ ok: true, pages: 3, restored: true, remainingFonts: 0 });
    const pages = await retainPdf(`background-${mixed ? 'mixed' : 'only'}`, result.bytes!);
    for (let index = 0; index < pages.length; index++) {
      for (const offset of [35, 75]) {
        const y = index * pageHeight + offset;
        const band = Math.floor((y % 80) / 40);
        atSource(pages, 25, y, colors[band * 2]);
        atSource(pages, 75, y, colors[band * 2 + 1]);
      }
      colorAt(pages[index], 130, 75, '#ffffff'); // no surplus background grid after 120px
    }
    for (const boundary of [pageHeight, pageHeight * 2])
      for (const y of [boundary - 5, boundary + 5])
        atSource(pages, 25, y, colors[Math.floor((y % 80) / 40) * 2]);
    // Sample inside the final band; an exact color boundary can floor to the
    // preceding pixel after the fractional page translation.
    atSource(pages, 75, 2368, colors[3]);
    // 99 visible 24px rows end at source y2376, exactly PDF y278 on page 3.
    colorAt(pages[2], 92, 277, colors[3]);
    colorAt(pages[2], 92, 278, '#ffffff');
    if (mixed) expect(pages[2].text).toContain('LAST');
    else expect(pages.every((page) => !page.text)).toBe(true);
  },
  70_000,
);

test('rotated image retains corners across negative worksheet extents and the final edge', async () => {
  const raster = createCanvas(120, 80),
    context = raster.getContext('2d');
  for (let index = 0; index < 4; index++) {
    context.fillStyle = colors[index];
    context.fillRect((index % 2) * 60, Math.floor(index / 2) * 40, 60, 40);
  }
  const snapshot = book();
  snapshot.resources = [
    {
      name: 'SHEET_DRAWING_PLUGIN',
      data: JSON.stringify({
        first: {
          order: ['negative-extents'],
          data: {
            'negative-extents': floating('negative-extents', 'prepared-pattern', {
              left: 0,
              top: 0,
              width: 240,
              height: 160,
              angle: 45,
            }),
          },
        },
      }),
    },
  ];
  const [result] = await runNativeJobs([
    { input: await input(snapshot, await raster.encode('png')) },
  ]);
  expect(result).toMatchObject({ ok: true, pages: 1, restored: true, remainingFonts: 0 });
  const pages = await retainPdf('negative-extent-rotated-image', result.bytes!);
  expect(pages).toHaveLength(1);
  const page = pages[0];
  expect(page.view).toEqual([0, 0, 595, 842]);
  expect(page.text).toBe('');
  // Rotation alone extends the image to x=-21.42 and y=-61.42. The complete
  // rotated rectangle starts at the 36pt margins, retaining all four corners.
  colorAt(page, 123, 47, colors[0]);
  colorAt(page, 237, 161, colors[1]);
  colorAt(page, 47, 123, colors[2]);
  colorAt(page, 161, 237, colors[3]);
  colorAt(page, 163, 244, colors[3]); // the final tip ends at PDF y248.13
  colorAt(page, 121, 35, '#ffffff');
  colorAt(page, 35, 121, '#ffffff');
  colorAt(page, 249, 163, '#ffffff');
  colorAt(page, 163, 249, '#ffffff');
}, 70_000);

function cellPicture(id: string, angle = 0): ICellData {
  return {
    s: { ht: HorizontalAlign.CENTER, vt: VerticalAlign.MIDDLE, pd: { l: 8, r: 8, t: 8, b: 8 } },
    p: {
      id,
      body: { dataStream: '\b\r\n', customBlocks: [{ startIndex: 0, blockId: id }] },
      documentStyle: {},
      drawingsOrder: [id],
      drawings: {
        [id]: {
          drawingId: id,
          unitId: id,
          subUnitId: id,
          drawingType: 0,
          source: 'prepared-pattern',
          imageSourceType: ImageSourceType.UUID,
          layoutType: 0,
          docTransform: { size: { width: 120, height: 80 }, angle },
        },
      },
    },
  } as unknown as ICellData;
}

test('cell pictures fit merged hidden anchors and common floating crop/flip/rotation preserves source pixels', async () => {
  const raster = createCanvas(120, 80),
    context = raster.getContext('2d');
  for (let index = 0; index < 4; index++) {
    context.fillStyle = colors[index];
    context.fillRect((index % 2) * 60, Math.floor(index / 2) * 40, 60, 40);
  }
  const snapshot = book();
  Object.assign(snapshot.sheets.first, {
    rowCount: 4,
    columnCount: 1,
    defaultRowHeight: 160,
    defaultColumnWidth: 160,
    rowData: { 1: { hd: 1 } },
    mergeData: [{ startRow: 1, endRow: 2, startColumn: 0, endColumn: 0 }],
    cellData: {
      0: { 0: cellPicture('ordinary') },
      1: { 0: cellPicture('merged', 90) },
      3: { 0: { v: 'Pictures complete' } },
    },
  });
  snapshot.sheetOrder.push('floating');
  snapshot.sheets.floating = {
    ...book().sheets.first,
    id: 'floating',
    rowCount: 12,
    cellData: { 0: { 0: { v: 'Flipped and cropped' } } },
  };
  const flip = {
    ...floating('flip', 'prepared-pattern', {
      left: 30,
      top: 40,
      width: 120,
      height: 80,
      flipX: true,
    }),
    subUnitId: 'floating',
  };
  const crop = {
    ...floating(
      'crop',
      'prepared-pattern',
      { left: 200, top: 100, width: 100, height: 80, angle: 90 },
      { srcRect: { left: 100 } },
    ),
    subUnitId: 'floating',
  };
  snapshot.resources = [
    {
      name: 'SHEET_DRAWING_PLUGIN',
      data: JSON.stringify({ floating: { order: ['flip', 'crop'], data: { flip, crop } } }),
    },
  ];
  const [result] = await runNativeJobs([
    { input: await input(snapshot, await raster.encode('png')) },
  ]);
  expect(result).toMatchObject({ ok: true, pages: 2, restored: true, remainingFonts: 0 });
  const pages = await retainPdf('cell-and-transformed-images', result.bytes!);
  const point = (page: number, x: number, y: number, color: string) =>
    colorAt(pages[page], 36 + x * 0.75, 36 + y * 0.75, color);
  point(0, 44, 56, colors[0]);
  point(0, 116, 56, colors[1]);
  point(0, 44, 104, colors[2]);
  point(0, 116, 104, colors[3]);
  // Positive native rotation is clockwise: original top-left moves to top-right.
  point(0, 104, 204, colors[0]);
  point(0, 104, 276, colors[1]);
  point(0, 56, 204, colors[2]);
  point(0, 56, 276, colors[3]);
  point(1, 60, 60, colors[1]);
  point(1, 120, 60, colors[0]);
  point(1, 60, 100, colors[3]);
  point(1, 120, 100, colors[2]);
  point(1, 270, 140, colors[1]);
  point(1, 230, 140, colors[3]);
  expect(pages[0].text).toContain('Pictures complete');
}, 70_000);
