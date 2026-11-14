import { createCanvas, Image, PDFDocument } from '@napi-rs/canvas';
import { ICommandService, IUndoRedoService } from '@univerjs/core';
import type { IGroupBaseBound, ITransformState, IWorkbookData } from '@univerjs/core';
import { IDrawingManagerService } from '@univerjs/drawing';
import { DrawingGroupObject, Image as NativeImage, getGroupState } from '@univerjs/engine-render';
import {
  ISheetDrawingService,
  SetDrawingApplyMutation,
  SheetDrawingService,
} from '@univerjs/sheets-drawing';
import { GroupSheetDrawingCommand } from '@univerjs/sheets-drawing-ui';
import { expect, test } from 'vitest';
import { fixtureFonts } from './font-fixtures.ts';
import { prepareSheetLayout } from './layout.ts';
import { disposeImageGroup } from './image-groups.ts';
import { PdfContext } from './native-runtime.ts';
import { retainPdf, runNativeJobs } from './native-test-support.ts';
import type { PreparedImage } from './contract.ts';

interface Drawing {
  drawingId: string;
  unitId: string;
  subUnitId: string;
  drawingType: number;
  transform: ITransformState;
  groupId?: string;
  groupBaseBound?: IGroupBaseBound;
  source?: string;
  anchorType?: string;
  sheetTransform?: Record<string, unknown>;
  hidden?: boolean;
  opacity?: number;
  srcRect?: { left: number; top: number; right: number; bottom: number };
}
interface Registry {
  data: Record<string, Drawing>;
  order: string[];
}
const frame = { width: 595, height: 842 };

function registry(snapshot: IWorkbookData): Registry {
  return JSON.parse(snapshot.resources![0].data).first;
}
function save(snapshot: IWorkbookData, value: Registry) {
  snapshot.resources = [{ name: 'SHEET_DRAWING_PLUGIN', data: JSON.stringify({ first: value }) }];
}
function anchors(left: number, top: number, width: number, height: number) {
  const marker = (x: number, y: number) => ({
    column: Math.floor(x / 80),
    columnOffset: x % 80,
    row: Math.floor(y / 24),
    rowOffset: y % 24,
  });
  return { from: marker(left, top), to: marker(left + width, top + height) };
}
function book(third = false): IWorkbookData {
  const snapshot = {
    id: 'book',
    name: 'Private grouping fixture',
    appVersion: '1.1.0',
    locale: 'enUS',
    styles: {},
    sheetOrder: ['first'],
    sheets: {
      first: {
        id: 'first',
        rowCount: 140,
        columnCount: 8,
        defaultRowHeight: 24,
        defaultColumnWidth: 80,
        showGridlines: 0,
        cellData: {
          0: { 0: { v: 'GROUP-ORIGIN' } },
          // Authored white cells keep the page clip outside the image's
          // antialiased fractional edge in the independent raster comparison.
          15: { 6: { s: { bg: { rgb: '#ffffff' } } } },
        },
      },
    },
  } as IWorkbookData;
  const picture = (
    id: string,
    left: number,
    top: number,
    width: number,
    height: number,
  ): Drawing => ({
    drawingId: id,
    unitId: 'book',
    subUnitId: 'first',
    drawingType: 0,
    transform: { left, top, width, height },
    anchorType: '2',
    source: `source-${id}`,
    sheetTransform: anchors(left, top, width, height),
  });
  const data = {
    a: picture('a', 80, 72, 100, 80),
    b: picture('b', 210, 90, 80, 100),
    ...(third ? { c: picture('c', 340, 100, 50, 90) } : {}),
  };
  save(snapshot, { data, order: Object.keys(data) });
  return snapshot;
}

/** The exported grouping command applies its real JSON1 mutation and serializer. */
function group(snapshot: IWorkbookData, ids: string[], id = 'group') {
  const result = structuredClone(snapshot),
    current = registry(result);
  const sheet = new SheetDrawingService(),
    manager = new SheetDrawingService();
  sheet.registerDrawingData('book', { first: structuredClone(current) } as never);
  manager.registerDrawingData('book', { first: structuredClone(current) } as never);
  let mutations = 0,
    undo = 0;
  const accessor = {
    get(token: unknown): unknown {
      if (token === ISheetDrawingService) return sheet;
      if (token === IDrawingManagerService) return manager;
      if (token === IUndoRedoService) return { pushUndoRedo: () => undo++ };
      if (token === ICommandService)
        return {
          syncExecuteCommand(
            command: string,
            params: Parameters<typeof SetDrawingApplyMutation.handler>[1],
          ) {
            expect(command).toBe(SetDrawingApplyMutation.id);
            mutations++;
            return SetDrawingApplyMutation.handler(accessor as never, params);
          },
        };
      throw new Error('Unexpected grouping dependency.');
    },
  };
  try {
    const transform = getGroupState(
      0,
      0,
      ids.map((key) => current.data[key].transform),
    );
    const { left, top, width, height } = transform;
    expect(
      GroupSheetDrawingCommand.handler(
        accessor as never,
        [
          {
            parent: {
              drawingId: id,
              unitId: 'book',
              subUnitId: 'first',
              drawingType: 6,
              transform,
              groupBaseBound: { left, top, width, height },
              sheetTransform: anchors(left!, top!, width!, height!),
            },
            children: ids.map((key) => ({ ...current.data[key], groupId: id })),
          },
        ] as never,
      ),
    ).toBe(true);
    expect(mutations).toBe(1);
    expect(undo).toBe(1);
    expect(manager.getDrawingDataForUnit('book')).toEqual(sheet.getDrawingDataForUnit('book'));
    result.resources = [
      {
        name: 'SHEET_DRAWING_PLUGIN',
        data: JSON.stringify(sheet.getDrawingDataForUnit('book')),
      },
    ];
    return result;
  } finally {
    sheet.dispose();
    manager.dispose();
  }
}

async function images(): Promise<PreparedImage[]> {
  const result = [];
  for (const [id, colors] of [
    ['a', ['#d62828', '#2563eb', '#16a34a', '#eab308']],
    ['b', ['#9333ea', '#ea580c', '#0891b2', '#be123c']],
    ['c', ['#15803d', '#1d4ed8', '#c2410c', '#7e22ce']],
  ] as const) {
    const canvas = createCanvas(40, 40),
      context = canvas.getContext('2d');
    colors.forEach((color, index) => {
      context.fillStyle = color;
      context.fillRect((index % 2) * 20, Math.floor(index / 2) * 20, 20, 20);
    });
    result.push({ source: `source-${id}`, bytes: await canvas.encode('png') });
  }
  return result;
}

test('actual Sheet grouping retains raw child coordinates, selected sources and bounded hierarchy', async () => {
  const snapshot = group(group(book(true), ['a', 'b'], 'inner'), ['inner', 'c']);
  const data = registry(snapshot);
  expect(data.data.inner.groupBaseBound).toEqual({ left: 80, top: 72, width: 210, height: 118 });
  expect(data.data.a.transform).toEqual({ left: 80, top: 72, width: 100, height: 80 });
  expect(data.data.a.groupId).toBe('inner');
  // These child anchors are not consulted by the native editor while grouped.
  data.data.a.sheetTransform = { from: { row: 99999 }, to: { column: 99999 } };
  save(snapshot, data);
  const original = structuredClone(snapshot),
    prepared = await images();
  const layout = await prepareSheetLayout(snapshot, prepared, frame);
  expect(layout.sheets[0].images).toHaveLength(1);
  expect(layout.sheets[0].images[0].bounds).toEqual({ left: 80, top: 72, right: 390, bottom: 190 });
  expect([...layout.images.keys()]).toEqual(['source-a', 'source-b', 'source-c']);
  expect(snapshot).toEqual(original);
  await expect(
    prepareSheetLayout(snapshot, prepared, frame, { limits: { images: 4 } }),
  ).rejects.toMatchObject({ code: 'limit' });
  for (const mutate of [
    (value: Registry) => {
      value.data.a.groupId = 'missing';
    },
    (value: Registry) => {
      value.data.group.groupId = 'inner';
    },
    (value: Registry) => {
      value.data.inner.groupBaseBound!.width = 0;
    },
    (value: Registry) => {
      value.data.a.transform.skewX = 12;
    },
    (value: Registry) => {
      value.data.a.drawingType = 1;
    },
  ]) {
    const bad = structuredClone(snapshot),
      value = registry(bad);
    mutate(value);
    save(bad, value);
    await expect(prepareSheetLayout(bad, prepared, frame)).rejects.toMatchObject({
      name: 'PrintError',
    });
  }
  const hidden = structuredClone(snapshot),
    hiddenData = registry(hidden);
  hiddenData.data.inner.hidden = true;
  save(hidden, hiddenData);
  expect([
    ...(
      await prepareSheetLayout(
        hidden,
        prepared.filter((image) => image.source === 'source-c'),
        frame,
      )
    ).images.keys(),
  ]).toEqual(['source-c']);
  hiddenData.data.group.hidden = true;
  save(hidden, hiddenData);
  expect((await prepareSheetLayout(hidden, [], frame)).images.size).toBe(0);
  const collision = structuredClone(snapshot),
    collisionData = registry(collision);
  collisionData.data.a.source = 'print-sheet-image-group-0';
  save(collision, collisionData);
  const collisionBytes = prepared.map((image) =>
    image.source === 'source-a' ? { ...image, source: 'print-sheet-image-group-0' } : image,
  );
  const safe = await prepareSheetLayout(collision, collisionBytes, frame);
  expect(safe.images.has('print-sheet-image-group-0')).toBe(true);
  expect(safe.imageGroups.has('print-sheet-image-group-0')).toBe(false);
});

type Variant = 'flat' | 'nested' | 'anchored' | 'tall';
function fixture(kind: Variant) {
  const nested = kind === 'nested';
  const snapshot = nested
    ? group(group(book(true), ['a', 'b'], 'inner'), ['inner', 'c'])
    : group(book(), ['a', 'b']);
  const value = registry(snapshot),
    root = value.data.group;
  if (nested) {
    root.anchorType = '2';
    root.transform = { left: 80, top: 80, width: 330, height: 180, angle: 8, flipX: true };
    value.data.inner.transform = {
      left: 80,
      top: 72,
      width: 220,
      height: 140,
      angle: 20,
      flipY: true,
    };
    value.data.a.transform.angle = -25;
    value.data.a.transform.flipX = true;
    value.data.a.srcRect = { left: 10, top: 5, right: 0, bottom: 0 };
    value.data.b.opacity = 0.65;
  } else if (kind === 'anchored') {
    root.anchorType = '1';
    root.sheetTransform = { ...anchors(240, 96, 210, 118), angle: 13, flipY: true };
    root.transform = { left: 999, top: 999, width: 999, height: 999, angle: 75 };
    snapshot.sheets.first.columnData = { 0: { hd: 1 }, 4: { hd: 1 } };
    snapshot.sheets.first.rowData = { 0: { hd: 1 }, 5: { hd: 1 } };
    // Keep the source origin visible after collapsing row/column zero.
    delete snapshot.sheets.first.cellData![0];
    snapshot.sheets.first.cellData![1] = { 1: { v: 'GROUP-ORIGIN' } };
  } else if (kind === 'tall') {
    root.anchorType = '2';
    root.transform = { left: 80, top: 48, width: 240, height: 2500 };
    snapshot.sheets.first.cellData![110] = { 6: { s: { bg: { rgb: '#ffffff' } } } };
  }
  save(snapshot, value);
  return snapshot;
}

/** Literal native scene, independent of Sheet carrier, anchors, bounds and pagination. */
async function reference(kind: Variant, sources: PreparedImage[]) {
  const rasters = new Map<string, Image>();
  for (const source of sources) {
    const raster = new Image();
    raster.src = source.bytes;
    await raster.decode();
    rasters.set(source.source, raster);
  }
  const picture = (id: string, transform: ITransformState, extra: Record<string, unknown> = {}) =>
    new NativeImage(id, {
      ...transform,
      ...extra,
      image: rasters.get(`source-${id}`) as unknown as HTMLImageElement,
    });
  const scene = () => {
    const root = new DrawingGroupObject('reference-root');
    root.setBaseBound({ left: 80, top: 72, width: kind === 'nested' ? 310 : 210, height: 118 });
    root.transformByState(
      kind === 'nested'
        ? { left: 80, top: 80, width: 330, height: 180, angle: 8, flipX: true }
        : kind === 'anchored'
          ? { left: 160, top: 72, width: 130, height: 94, angle: 13, flipY: true }
          : kind === 'tall'
            ? { left: 80, top: 48, width: 240, height: 2500 }
            : { left: 80, top: 72, width: 210, height: 118 },
    );
    const parent = kind === 'nested' ? new DrawingGroupObject('reference-inner') : root;
    if (kind === 'nested') {
      parent.setBaseBound({ left: 80, top: 72, width: 210, height: 118 });
      parent.transformByState({
        left: 80,
        top: 72,
        width: 220,
        height: 140,
        angle: 20,
        flipY: true,
      });
    }
    parent.addObjects(
      picture(
        'a',
        {
          left: 80,
          top: 72,
          width: 100,
          height: 80,
          ...(kind === 'nested' ? { angle: -25, flipX: true } : {}),
        },
        kind === 'nested' ? { srcRect: { left: 10, top: 5, right: 0, bottom: 0 } } : {},
      ),
      picture(
        'b',
        { left: 210, top: 90, width: 80, height: 100 },
        kind === 'nested' ? { opacity: 0.65 } : {},
      ),
    );
    if (kind === 'nested')
      root.addObjects(parent, picture('c', { left: 340, top: 100, width: 50, height: 90 }));
    return root;
  };
  const pdf = new PDFDocument({});
  // The 2500px group exceeds a whole page. Its contiguous slices retain the
  // regular 24px native row seams at 1008 and 2016, rather than restarting it.
  for (const top of kind === 'tall' ? [0, 1008, 2016] : [0]) {
    const raw = pdf.beginPage(595, 842);
    raw.fillStyle = '#fff';
    raw.fillRect(0, 0, 595, 842);
    raw.save();
    raw.beginPath();
    raw.rect(36, 36, 523, kind === 'tall' && top < 2016 ? 756 : 770);
    raw.clip();
    raw.translate(36, 36);
    raw.scale(0.75, 0.75);
    raw.translate(0, -top);
    const root = scene();
    try {
      root.render(new PdfContext(raw as unknown as CanvasRenderingContext2D), undefined!);
    } finally {
      disposeImageGroup(root);
    }
    raw.restore();
    pdf.endPage();
  }
  return retainPdf(`sheet-group-native-${kind}`, pdf.close());
}

test('grouped Sheets match independent native scenes across saved anchors, nested effects and every continuation', async () => {
  const sources = await images(),
    fonts = await fixtureFonts();
  const kinds: Variant[] = ['flat', 'nested', 'anchored', 'tall'];
  const inputs = kinds.map((kind) => ({
    snapshot: fixture(kind),
    images: sources,
    fonts,
    defaultFamily: 'Atkinson Hyperlegible',
    fallbackFamilies: ['Noto Sans Symbols 2'],
  }));
  const originals = inputs.map((input) => structuredClone(input.snapshot));
  const results = await runNativeJobs(inputs.map((input) => ({ input })));
  for (const [index, kind] of kinds.entries()) {
    const { bytes, ...status } = results[index];
    expect(status, kind).toMatchObject({
      ok: true,
      pages: kind === 'tall' ? 3 : 1,
      restored: true,
      remainingFonts: 0,
    });
    const actual = await retainPdf(`sheet-group-${kind}`, bytes!);
    const expected = await reference(kind, sources);
    expect(actual.map((page) => page.text).join('')).toContain('GROUP-ORIGIN');
    for (const [pageIndex, page] of actual.entries()) {
      expect(page.view).toEqual([0, 0, 595, 842]);
      const oracle = expected[pageIndex];
      let ink = 0,
        maximum = 0;
      for (let offset = 0; offset < page.pixels.length; offset += 4) {
        const y = Math.floor(offset / 4 / page.width);
        // Only the separately asserted text marker is absent from the native
        // image-only reference. Every image and surrounding paper pixel counts.
        if (pageIndex === 0 && y >= 36 && y < 56) continue;
        if (Math.min(...page.pixels.slice(offset, offset + 3)) < 240) ink++;
        for (let channel = 0; channel < 4; channel++)
          maximum = Math.max(
            maximum,
            Math.abs(page.pixels[offset + channel] - oracle.pixels[offset + channel]),
          );
      }
      expect(ink, `${kind} page ${pageIndex + 1}`).toBeGreaterThan(100);
      expect(maximum, `${kind} page ${pageIndex + 1}`).toBeLessThanOrEqual(5);
    }
    expect(inputs[index].snapshot).toEqual(originals[index]);
  }
}, 70_000);

test('Sheet group failures release no bytes and a complete export recovers', async () => {
  const input = {
    snapshot: fixture('tall'),
    images: await images(),
    fonts: await fixtureFonts(),
    defaultFamily: 'Atkinson Hyperlegible',
    fallbackFamilies: ['Noto Sans Symbols 2'],
  };
  const jobs = [
    { input, options: { limits: { pages: 1 } } },
    { input: { ...input, images: input.images.slice(1) } },
    { input, abort: true },
    { input },
  ];
  const results = await runNativeJobs(jobs);
  for (const [index, code] of ['limit', 'invalid-input', 'cancelled'].entries()) {
    const { bytes, ...status } = results[index];
    expect(status).toMatchObject({ ok: false, code, restored: true, remainingFonts: 0 });
    expect(bytes).toBeUndefined();
  }
  const { bytes, ...status } = results[3];
  expect(status).toMatchObject({ ok: true, pages: 3, restored: true, remainingFonts: 0 });
  await retainPdf('sheet-group-recovery', bytes!);
}, 70_000);
