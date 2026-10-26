import { createCanvas, Image, PDFDocument } from '@napi-rs/canvas';
import {
  DocumentDataModel,
  DocumentFlavor,
  DrawingTypeEnum,
  ICommandService,
  IUniverInstanceService,
  ObjectRelativeFromH,
  ObjectRelativeFromV,
  PositionedObjectLayoutType,
} from '@univerjs/core';
import type { IDocDrawingBase, IDocumentData, ITransformState } from '@univerjs/core';
import { GroupDocDrawingCommand } from '@univerjs/docs-drawing-ui';
import { DrawingGroupObject, Image as NativeImage, getGroupState } from '@univerjs/engine-render';
import { expect, test } from 'vitest';
import type { DocPrintInput } from './index.ts';
import { PRINT_LIMITS, PrintError } from './contract.ts';
import { prepareDocSnapshot } from './doc-preparation.ts';
import { docInput, retainDocPdf, runDocJobs, textDoc } from './doc-native-test-support.ts';
import { PdfContext } from './native-runtime.ts';
import { disposeImageGroup } from './image-groups.ts';

function picture(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
): IDocDrawingBase {
  return {
    drawingId: id,
    unitId: 'private-account-sentinel',
    subUnitId: 'private-account-sentinel',
    drawingType: DrawingTypeEnum.DRAWING_IMAGE,
    source: `source-${id}`,
    layoutType: PositionedObjectLayoutType.WRAP_NONE,
    transform: { left, top, width, height },
    docTransform: {
      size: { width, height },
      angle: 0,
      positionH: { relativeFrom: ObjectRelativeFromH.PAGE, posOffset: left },
      positionV: { relativeFrom: ObjectRelativeFromV.PAGE, posOffset: top },
    },
  } as IDocDrawingBase;
}

function fixture(third = false) {
  const snapshot = textDoc(['BEFORE-GROUP', `${third ? '\b\b\b' : '\b\b'}CAPTION`, 'AFTER-GROUP'], {
    documentFlavor: DocumentFlavor.TRADITIONAL,
    pageSize: { width: 600, height: 400 },
  });
  snapshot.drawings = {
    a: picture('a', 100, 100, 60, 40),
    b: picture('b', 180, 100, 60, 70),
    ...(third ? { c: picture('c', 300, 130, 50, 80) } : {}),
  };
  snapshot.drawingsOrder = Object.keys(snapshot.drawings);
  let cursor = snapshot.body!.dataStream.indexOf('\b');
  snapshot.body!.customBlocks = snapshot.drawingsOrder.map((blockId) => ({
    blockId,
    startIndex: cursor++,
  }));
  return snapshot;
}

/** Execute the editor's exported grouping command and its real public JSONX mutation. */
function group(snapshot: IDocumentData, ids: string[], id = 'group') {
  const model = new DocumentDataModel(structuredClone(snapshot));
  try {
    const children = ids.map((drawingId) => ({
      ...model.getSnapshot().drawings![drawingId],
      transform: { ...model.getSnapshot().drawings![drawingId].transform },
    }));
    const transform = getGroupState(
      0,
      0,
      children.map((drawing) => drawing.transform),
    );
    let mutations = 0;
    const accessor = {
      get(token: unknown) {
        if (token === IUniverInstanceService) return { getUnit: () => model };
        if (token === ICommandService)
          return {
            syncExecuteCommand: (
              _id: string,
              params: { actions: Parameters<DocumentDataModel['apply']>[0] },
            ) => {
              mutations++;
              model.apply(params.actions);
              return true;
            },
          };
        throw new Error('Unexpected public grouping dependency.');
      },
    };
    const applied = GroupDocDrawingCommand.handler(accessor as never, [
      {
        parent: {
          unitId: snapshot.id,
          subUnitId: snapshot.id,
          drawingId: id,
          drawingType: DrawingTypeEnum.DRAWING_GROUP,
          transform,
          groupBaseBound: {
            left: transform.left,
            top: transform.top,
            width: transform.width,
            height: transform.height,
          },
        },
        children,
      },
    ]);
    expect(applied).toBe(true);
    expect(mutations).toBe(1);
    return structuredClone(model.getSnapshot());
  } finally {
    model.dispose();
  }
}

test('public flat and nested groups retain their single anchor, sources and strict hierarchy admission', () => {
  const source = group(group(fixture(true), ['a', 'b'], 'inner'), ['inner', 'c']);
  const original = structuredClone(source);
  expect(source.body!.dataStream).toBe('BEFORE-GROUP\r\bCAPTION\rAFTER-GROUP\r\n');
  expect(source.body!.customBlocks).toHaveLength(1);
  expect(source.drawings!.a.groupId).toBe('inner');
  expect(source.drawings!.inner.groupId).toBe('group');
  expect(source.drawings!.a.docTransform.positionH).toEqual({ relativeFrom: 0, posOffset: 0 });
  expect(source.drawings!.b.docTransform.positionH).toEqual({ relativeFrom: 0, posOffset: 80 });
  const prepared = prepareDocSnapshot(source, [], PRINT_LIMITS, () => {});
  expect(Object.keys(prepared.snapshot.drawings!)).toEqual(['group']);
  expect(prepared.imageSources).toEqual(['source-a', 'source-b', 'source-c']);
  expect(prepared.imageGroups.size).toBe(1);
  expect(source).toEqual(original);
  expect(() => prepareDocSnapshot(source, [], { ...PRINT_LIMITS, images: 4 }, () => {})).toThrow(
    PrintError,
  );
  const malformed = [
    (input: IDocumentData) => {
      input.drawings!.a.groupId = 'missing';
    },
    (input: IDocumentData) => {
      input.drawings!.inner.groupId = 'inner';
    },
    (input: IDocumentData) => {
      input.drawings!.group.groupBaseBound!.width = 0;
    },
    (input: IDocumentData) => {
      input.drawings!.a.drawingType = DrawingTypeEnum.DRAWING_SHAPE;
    },
    (input: IDocumentData) => {
      input.drawings!.a.transform!.skewX = 12;
    },
  ];
  for (const mutate of malformed) {
    const bad = structuredClone(source);
    mutate(bad);
    expect(() => prepareDocSnapshot(bad, [], PRINT_LIMITS, () => {})).toThrow(PrintError);
  }
  const hidden = structuredClone(source);
  hidden.drawings!.inner.hidden = true;
  expect(prepareDocSnapshot(hidden, [], PRINT_LIMITS, () => {}).imageSources).toEqual(['source-c']);
  const inactive = structuredClone(source);
  inactive.headers = { unused: { headerId: 'unused', body: inactive.body! } };
  inactive.body = textDoc(['ACTIVE-BODY']).body;
  // Even malformed or unavailable descendants of an unselected story have no
  // visible content and must not request image bytes or veto the active body.
  inactive.drawings!.a.docTransform.size.width = 0;
  expect(prepareDocSnapshot(inactive, [], PRINT_LIMITS, () => {}).imageSources).toEqual([]);
  const collision = structuredClone(source);
  Object.assign(collision.drawings!.a, { source: 'print-image-group-0' });
  const collided = prepareDocSnapshot(collision, [], PRINT_LIMITS, () => {});
  expect(collided.imageGroups.has('print-image-group-0')).toBe(false);
  expect(collided.imageSources).toContain('print-image-group-0');
  const deep = structuredClone(source);
  for (let index = 0; index < 33; index++) {
    const id = `level-${index}`;
    deep.drawings![id] = {
      ...structuredClone(deep.drawings!.inner),
      drawingId: id,
      groupId: index ? `level-${index - 1}` : 'group',
    };
    deep.drawingsOrder!.push(id);
  }
  deep.drawings!.c.groupId = 'level-32';
  expect(() => prepareDocSnapshot(deep, [], PRINT_LIMITS, () => {})).toThrow('nesting budget');
});

async function images() {
  const values = [];
  for (const [id, colors] of [
    ['a', ['#e02020', '#20c040', '#2040d0']],
    ['b', ['#e09020', '#a020c0', '#20a0c0']],
    ['c', ['#d04080', '#80b020', '#4050b0']],
  ] as const) {
    const canvas = createCanvas(30, 30);
    const context = canvas.getContext('2d');
    for (const [index, color] of colors.entries()) {
      context.fillStyle = color;
      context.fillRect(index * 10, 0, 10, 30);
    }
    values.push({ source: `source-${id}`, bytes: await canvas.encode('png') });
  }
  return values;
}

function decoratedGroup() {
  const result = group(group(fixture(true), ['a', 'b'], 'inner'), ['inner', 'c']);
  const root = result.drawings!.group.docTransform;
  root.size = { width: 300, height: 160 };
  root.angle = 22;
  root.flipX = true;
  root.flipY = true;
  const inner = result.drawings!.inner.docTransform;
  inner.size = { width: 170, height: 100 };
  inner.angle = 37;
  inner.flipY = true;
  result.drawings!.a.docTransform.angle = 35;
  result.drawings!.a.docTransform.flipX = true;
  Object.assign(result.drawings!.a, { srcRect: { left: 6, right: 2, top: 4, bottom: 0 } });
  result.drawings!.b.docTransform.angle = -20;
  Object.assign(result.drawings!.b, { opacity: 0.55 });
  // The public command preserves stale scene caches. These valid cache values
  // deliberately disagree with authoritative saved child-local transforms.
  result.drawings!.a.transform = { left: 900, top: 900, width: 1, height: 1 };
  return result;
}

/** Independent native scene authored from known geometry, without print projections. */
async function referencePixels(
  sources: Awaited<ReturnType<typeof images>>,
  decorated: boolean,
  overflow = false,
  shift = 0,
) {
  const rasters = new Map<string, Image>();
  for (const source of sources) {
    const raster = new Image();
    raster.src = source.bytes;
    await raster.decode();
    rasters.set(source.source, raster);
  }
  const pdf = new PDFDocument({});
  const raw = pdf.beginPage(450, 600);
  raw.fillStyle = '#fff';
  raw.fillRect(0, 0, 450, 600);
  raw.scale(0.75, 0.75);
  raw.translate(0, shift);
  const context = new PdfContext(raw as unknown as CanvasRenderingContext2D);
  const image = (id: string, transform: ITransformState, extra: Record<string, unknown> = {}) =>
    new NativeImage(id, {
      ...transform,
      ...extra,
      image: rasters.get(`source-${id}`) as unknown as HTMLImageElement,
    });
  const root = new DrawingGroupObject('native-reference');
  if (decorated) {
    root.setBaseBound({ left: 0, top: 0, width: 250, height: 110 });
    root.transformByState({
      left: 100,
      top: 100,
      width: 300,
      height: 160,
      angle: 22,
      flipX: true,
      flipY: true,
    });
    const inner = new DrawingGroupObject('native-inner');
    inner.setBaseBound({ left: 0, top: 0, width: 140, height: 70 });
    inner.transformByState({ left: 0, top: 0, width: 170, height: 100, angle: 37, flipY: true });
    inner.addObjects(
      image(
        'a',
        { left: 0, top: 0, width: 60, height: 40, angle: 35, flipX: true },
        { srcRect: { left: 6, right: 2, top: 4, bottom: 0 } },
      ),
      image('b', { left: 80, top: 0, width: 60, height: 70, angle: -20 }, { opacity: 0.55 }),
    );
    root.addObjects(inner, image('c', { left: 200, top: 30, width: 50, height: 80 }));
  } else if (overflow) {
    root.setBaseBound({ left: 0, top: 0, width: 200, height: 40 });
    root.transformByState({ left: 100, top: 300, width: 200, height: 40 });
    root.addObjects(
      image('a', { left: 0, top: 0, width: 120, height: 20, angle: 60 }),
      image('b', { left: 150, top: 0, width: 50, height: 40 }),
    );
  } else {
    root.setBaseBound({ left: 0, top: 0, width: 140, height: 70 });
    root.transformByState({ left: 100, top: 100, width: 140, height: 70 });
    root.addObjects(
      image('a', { left: 0, top: 0, width: 60, height: 40 }),
      image('b', { left: 80, top: 0, width: 60, height: 70 }),
    );
  }
  try {
    root.render(context, undefined!);
  } finally {
    disposeImageGroup(root);
  }
  pdf.endPage();
  // Compare the same native PDF backend and decoder. Canvas bitmap sampling at
  // stripe edges differs from PDF image sampling even for an ungrouped image.
  const [page] = await retainDocPdf(
    `image-group-native-${decorated ? 'nested' : overflow ? (shift ? 'overflow-whole' : 'overflow') : 'simple'}`,
    pdf.close(),
  );
  return page.pixels;
}

function color(pixel: ArrayLike<number>, at: number) {
  return (
    Math.max(pixel[at], pixel[at + 1], pixel[at + 2]) -
      Math.min(pixel[at], pixel[at + 1], pixel[at + 2]) >
    35
  );
}

test('group PDFs match native images, nested transforms and complete physical continuation', async () => {
  const sources = await images();
  const flat = fixture();
  const simple = group(flat, ['a', 'b']);
  const decorated = decoratedGroup();
  const overflowSource = fixture();
  overflowSource.drawings!.a = picture('a', 100, 300, 120, 20);
  overflowSource.drawings!.a.docTransform.angle = 60;
  overflowSource.drawings!.a.transform!.angle = 60;
  overflowSource.drawings!.b = picture('b', 250, 300, 50, 40);
  const overflow = group(overflowSource, ['a', 'b']);
  const modern = [simple, decorated, overflow].map((source) => {
    const snapshot = structuredClone(source);
    snapshot.documentStyle.documentFlavor = DocumentFlavor.MODERN;
    return snapshot;
  });
  const inputs: DocPrintInput[] = [];
  for (const snapshot of [flat, simple, decorated, overflow, ...modern]) {
    const input = await docInput(snapshot);
    input.images = sources;
    inputs.push(input);
  }
  const originals = inputs.map((input) => structuredClone(input.snapshot));
  const results = await runDocJobs(inputs.map((input) => ({ input })));
  const pages: Awaited<ReturnType<typeof retainDocPdf>>[] = [];
  for (const [index, result] of results.entries()) {
    const { bytes, ...diagnostic } = result;
    expect(diagnostic, `${index}: ${JSON.stringify(diagnostic)}`).toMatchObject({
      ok: true,
      restored: true,
      remainingFonts: 0,
    });
    pages.push(await retainDocPdf(`image-group-${index}`, bytes!));
    expect(inputs[index].snapshot).toEqual(originals[index]);
    const text = pages[index].map((page) => page.text).join(' ');
    for (const sentinel of ['BEFORE-GROUP', 'CAPTION', 'AFTER-GROUP'])
      expect(text.split(sentinel)).toHaveLength(2);
  }
  expect(pages[1]).toHaveLength(1);
  expect(pages[0][0].pixels).toEqual(pages[1][0].pixels);
  const simplePixels = await referencePixels(sources, false);
  const nestedPixels = await referencePixels(sources, true);
  const overflowPixels = await referencePixels(sources, false, true);
  // Continuous pagination keeps a group whole if its actual ink fits one body.
  // Derive this seam from the known rotated child's center/half-extents, without
  // consulting the print planner or its native group-bounds helper.
  const rotatedTop = 310 - 60 * Math.sin(Math.PI / 3) - 10 * Math.cos(Math.PI / 3);
  const wholeOverflowPixels = await referencePixels(sources, false, true, 48 - rotatedTop);
  for (const [index, expected] of [
    [1, simplePixels],
    [2, nestedPixels],
    [3, overflowPixels],
    [4, simplePixels],
    [5, nestedPixels],
    [6, wholeOverflowPixels],
  ] as const) {
    let actualColor = 0,
      expectedColor = 0,
      mismatch = 0;
    const assembled = new Uint8ClampedArray(expected.length).fill(255);
    for (const [pageIndex, page] of pages[index].entries())
      for (let y = 0; y < page.height; y++)
        for (let x = 0; x < page.width; x++) {
          const at = (y * page.width + x) * 4;
          if (!color(page.pixels, at)) continue;
          actualColor++;
          const sourceY = index === 6 ? y : y + pageIndex * 228;
          const destination = (sourceY * 450 + x) * 4;
          assembled.set(page.pixels.subarray(at, at + 4), destination);
        }
    for (let at = 0; at < expected.length; at += 4) {
      if (color(expected, at)) expectedColor++;
      if (!color(expected, at) && !color(assembled, at)) continue;
      if (
        [0, 1, 2].some((channel) => Math.abs(expected[at + channel] - assembled[at + channel]) > 8)
      )
        mismatch++;
    }
    expect(actualColor, `${index}: complete native color area`).toBeGreaterThan(
      expectedColor * 0.98,
    );
    expect(actualColor).toBeLessThan(expectedColor * 1.02 + 2);
    expect(mismatch, `${index}: native pixel placement`).toBeLessThan(expectedColor * 0.025 + 3);
  }
  // Its nominal group frame ends at340px, inside the352px body edge. The
  // rotated child extends past that edge and therefore requires page two.
  expect(pages[3]).toHaveLength(2);
  expect(pages[6]).toHaveLength(2);
  expect(pages[6][0].pixels.some((_, at) => at % 4 === 0 && color(pages[6][0].pixels, at))).toBe(
    false,
  );
  expect(pages[3][1].pixels.some((_, at) => at % 4 === 0 && color(pages[3][1].pixels, at))).toBe(
    true,
  );
}, 60_000);

test('header group copies share authorized leaves and wrapped groups keep one native reservation', async () => {
  const header = textDoc(['BODY-FIRST', 'BODY-SECOND'], {
    documentFlavor: DocumentFlavor.TRADITIONAL,
    pageSize: { width: 600, height: 400 },
    marginTop: 100,
    defaultHeaderId: 'header',
  });
  header.body!.dataStream = 'BODY-FIRST\r\nBODY-SECOND\r\n';
  header.body!.paragraphs = [
    { startIndex: 10, paragraphId: 'first' },
    { startIndex: 23, paragraphId: 'second' },
  ];
  header.body!.sectionBreaks = [
    { startIndex: 11, sectionId: 'first', marginLeft: 40, marginRight: 40, marginHeader: 10 },
    { startIndex: 24, sectionId: 'second', marginLeft: 140, marginRight: 140, marginHeader: 20 },
  ];
  const body = textDoc(['\b\bHEADER-GROUP']).body!;
  body.customBlocks = [
    { startIndex: 0, blockId: 'a' },
    { startIndex: 1, blockId: 'b' },
  ];
  header.headers = { header: { headerId: 'header', body } };
  header.drawings = { a: picture('a', 40, 10, 20, 15), b: picture('b', 65, 10, 20, 15) };
  header.drawingsOrder = ['a', 'b'];
  for (const drawing of Object.values(header.drawings)) {
    drawing.layoutType = PositionedObjectLayoutType.INLINE;
    drawing.isMultiTransform = 1;
    drawing.transforms = [{ left: 900, top: 900, width: 20, height: 15 }];
  }
  const groupedHeader = group(header, ['a', 'b']);
  expect(groupedHeader.headers!.header.body.customBlocks).toHaveLength(1);
  const prepared = prepareDocSnapshot(groupedHeader, [], PRINT_LIMITS, () => {});
  const ids = Object.values(prepared.snapshot.headers!).map(
    (story) => story.body.customBlocks![0].blockId,
  );
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
  expect(prepared.imageGroups.size).toBe(1);
  expect(prepared.imageSources).toEqual(['source-a', 'source-b']);
  expect(
    new Set(
      ids.map((id) => (prepared.snapshot.drawings![id] as unknown as { source: string }).source),
    ).size,
  ).toBe(1);

  const wrapped = group(fixture(), ['a', 'b']);
  wrapped.drawings!.group.layoutType = PositionedObjectLayoutType.WRAP_SQUARE;
  wrapped.drawings!.group.distT = 5;
  wrapped.drawings!.group.distB = 7;
  const reservation = structuredClone(wrapped);
  const carrier = {
    ...reservation.drawings!.group,
    drawingType: DrawingTypeEnum.DRAWING_IMAGE,
    source: 'source-a',
  };
  delete carrier.groupBaseBound;
  reservation.drawings = { group: carrier };
  reservation.drawingsOrder = ['group'];
  const sources = await images();
  const inputs = [];
  for (const snapshot of [groupedHeader, wrapped, reservation]) {
    const input = await docInput(snapshot);
    input.images = sources;
    inputs.push(input);
  }
  const results = await runDocJobs(inputs.map((input) => ({ input })));
  const pages: Awaited<ReturnType<typeof retainDocPdf>>[] = [];
  for (const [index, result] of results.entries()) {
    const { bytes, ...diagnostic } = result;
    expect(diagnostic, JSON.stringify(diagnostic)).toMatchObject({
      ok: true,
      restored: true,
      remainingFonts: 0,
    });
    pages.push(await retainDocPdf(`image-group-story-${index}`, bytes!));
  }
  expect(pages[0]).toHaveLength(2);
  const boxes = pages[0].map((page) => {
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity,
      count = 0;
    for (let y = 0; y < page.height; y++)
      for (let x = 0; x < page.width; x++) {
        if (!color(page.pixels, (y * page.width + x) * 4)) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
        count++;
      }
    expect(page.text.split('HEADER-GROUP')).toHaveLength(2);
    return { left, top, right, bottom, count };
  });
  expect(boxes[0].count).toBeGreaterThan(20 * 15 * 2 * 0.75 ** 2 * 0.95);
  expect(Math.abs(boxes[0].count - boxes[1].count)).toBeLessThan(30);
  expect(boxes[1].left - boxes[0].left).toBe(75);
  // The exact10px native shift becomes7.5 PDF pixels, rounded at the ink edge.
  expect(Math.abs(boxes[1].top - boxes[0].top - 7.5)).toBeLessThanOrEqual(0.5);
  const textGeometry = (output: (typeof pages)[number]) =>
    output.map((page) =>
      page.items.map(({ str, transform, width, height }) => ({ str, transform, width, height })),
    );
  expect(textGeometry(pages[1])).toEqual(textGeometry(pages[2]));
}, 60_000);

test('group failures publish no bytes and a following render recovers without decoding inactive leaves', async () => {
  const input = await docInput(group(fixture(), ['a', 'b']));
  input.images = await images();
  const missing = { ...input, images: input.images.filter(({ source }) => source !== 'source-b') };
  const tooTall = structuredClone(input);
  tooTall.snapshot.drawings!.group.docTransform.size.height = 700;
  const orphan = structuredClone(input);
  orphan.snapshot.drawings!.a.groupId = 'missing';
  const inactive = structuredClone(input);
  inactive.snapshot.headers = { unused: { headerId: 'unused', body: inactive.snapshot.body! } };
  inactive.snapshot.body = textDoc(['VISIBLE-BODY-ONLY']).body;
  inactive.snapshot.drawings!.a.docTransform.size.width = 0;
  inactive.images = [];
  const results = await runDocJobs([
    { input: missing },
    { input: tooTall, options: { limits: { pages: 1 } } },
    { input: orphan },
    { input, abortDuringPrepare: true },
    { input: inactive },
    { input },
  ]);
  for (const [index, code] of ['invalid-input', 'limit', 'unsupported', 'cancelled'].entries()) {
    expect(results[index]).toMatchObject({ ok: false, code, restored: true, remainingFonts: 0 });
    expect(results[index].bytes).toBeUndefined();
  }
  for (const [index, name] of [
    [4, 'inactive'],
    [5, 'recovery'],
  ] as const) {
    const { bytes, ...diagnostic } = results[index];
    expect(diagnostic, JSON.stringify(diagnostic)).toMatchObject({
      ok: true,
      restored: true,
      remainingFonts: 0,
    });
    const [page] = await retainDocPdf(`image-group-${name}`, bytes!);
    if (index === 4) {
      expect(page.text).toContain('VISIBLE-BODY-ONLY');
      expect(page.pixels.some((_, at) => at % 4 === 0 && color(page.pixels, at))).toBe(false);
    } else expect(page.text).toContain('CAPTION');
  }
}, 60_000);
