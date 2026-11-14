import { createCanvas } from '@napi-rs/canvas';
import {
  ListGlyphType,
  NumberUnitType,
  ObjectRelativeFromH,
  ObjectRelativeFromV,
  PositionedObjectLayoutType,
} from '@univerjs/core';
import type { IDocumentData } from '@univerjs/core';
import { expect, test } from 'vitest';
import type { DocPrintInput } from './index.ts';
import { docInput, retainDocPdf, runDocJobs, textDoc } from './doc-native-test-support.ts';

interface Variant {
  name: string;
  text: string;
  layouts: PositionedObjectLayoutType[];
  references?: ObjectRelativeFromV[];
  behind?: number[];
  bullet?: boolean;
  offset?: number;
  topDistance?: number;
  header?: boolean;
  expectedTop?: number;
  reference?: Partial<Variant>;
  inlineReference?: boolean;
}

const TOP = PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM;
const NONE = PositionedObjectLayoutType.WRAP_NONE;
const SQUARE = PositionedObjectLayoutType.WRAP_SQUARE;
const INLINE = PositionedObjectLayoutType.INLINE;
const PARA = ObjectRelativeFromV.PARAGRAPH;
const LINE = ObjectRelativeFromV.LINE;

function model(variant: Variant): IDocumentData {
  const snapshot = textDoc(['BEFORE', variant.text, 'AFTER-END'], {
    pageSize: { width: 600, height: 400 },
  });
  const blocks: { startIndex: number; blockId: string }[] = [];
  for (let index = 0; index < snapshot.body!.dataStream.length; index++)
    if (snapshot.body!.dataStream[index] === '\b')
      blocks.push({ startIndex: index, blockId: `image-${blocks.length}` });
  snapshot.body!.customBlocks = blocks;
  snapshot.drawingsOrder = blocks.map(({ blockId }) => blockId);
  // These are the saved models emitted by the public multi-file insertion and
  // wrapping commands. Desktop wrapping changes layoutType only; changing to
  // Behind writes behindDoc=1 and changing back leaves that inactive flag.
  snapshot.drawings = Object.fromEntries(
    blocks.map(({ blockId }, index) => [
      blockId,
      {
        drawingId: blockId,
        unitId: snapshot.id,
        subUnitId: snapshot.id,
        drawingType: 0,
        source: blockId,
        layoutType: variant.layouts[index],
        ...(variant.behind?.[index] === undefined ? {} : { behindDoc: variant.behind[index] }),
        distT: variant.topDistance ?? 0,
        distB: 0,
        distL: 0,
        distR: 0,
        docTransform: {
          size: { width: 60, height: index ? 70 : 40 },
          angle: 0,
          positionH: {
            relativeFrom: ObjectRelativeFromH.PAGE,
            posOffset: variant.bullet ? 120 : 60 + index * 140,
          },
          positionV: {
            relativeFrom: variant.references?.[index] ?? PARA,
            posOffset: variant.offset ?? 0,
          },
        },
      },
    ]),
  ) as typeof snapshot.drawings;
  if (variant.inlineReference)
    snapshot.body!.paragraphs![1].paragraphStyle = {
      indentStart: { v: 12, u: NumberUnitType.PIXEL },
    };
  if (variant.bullet) {
    snapshot.lists = {
      numbered: {
        listType: 'numbered',
        nestingLevel: [
          {
            bulletAlignment: 0,
            glyphFormat: '%1.',
            startNumber: 0,
            glyphType: ListGlyphType.DECIMAL,
            paragraphProperties: {
              indentStart: { v: 36, u: NumberUnitType.PIXEL },
              hanging: { v: 24, u: NumberUnitType.PIXEL },
            },
            textStyle: { ff: 'Atkinson Hyperlegible' },
          },
        ],
      },
    };
    snapshot.body!.paragraphs![1].bullet = {
      listId: 'list',
      listType: 'numbered',
      nestingLevel: 0,
    };
  }
  if (variant.header !== false) {
    snapshot.headers = { header: { headerId: 'header', body: textDoc(['HEADER']).body! } };
    snapshot.documentStyle.defaultHeaderId = 'header';
    snapshot.documentStyle.marginHeader = 12;
  }
  return snapshot;
}

test('live wrapping combinations preserve all images, native markers and source flow', async () => {
  const images = [];
  for (const [index, color] of ['#d02020', '#2040d0'].entries()) {
    const canvas = createCanvas(6, 7),
      context = canvas.getContext('2d');
    context.fillStyle = color;
    context.fillRect(0, 0, 6, 7);
    images.push({ source: `image-${index}`, bytes: await canvas.encode('png') });
  }
  // Original unprojected public-native measurements: the preceding line is
  // 23.1466663px high. Square and captioned nonwrapping followers preserve that
  // origin; backward exclusions retain their actual native reflow. Independent
  // inline / paragraph-reference sources cover the repaired equivalent forms.
  const ordinaryTop = 48 + 23.146666288375854;
  const variants: Variant[] = [
    {
      name: 'square-caption',
      text: '\b\bCAPTION',
      layouts: [TOP, SQUARE],
      expectedTop: ordinaryTop,
    },
    {
      name: 'square-bare',
      text: '\b\b',
      layouts: [TOP, SQUARE],
      expectedTop: ordinaryTop,
      header: false,
    },
    {
      name: 'none-caption-front',
      text: '\b\bCAPTION',
      layouts: [TOP, NONE],
      behind: [0, 0],
      expectedTop: ordinaryTop,
    },
    {
      name: 'none-caption-behind',
      text: '\b\bCAPTION',
      layouts: [TOP, NONE],
      behind: [0, 1],
      expectedTop: ordinaryTop,
    },
    {
      name: 'none-bare-front',
      text: '\b\b',
      layouts: [TOP, NONE],
      behind: [0, 0],
      reference: { layouts: [INLINE, NONE], inlineReference: true },
    },
    {
      name: 'none-bare-behind',
      text: '\b\b',
      layouts: [TOP, NONE],
      behind: [0, 1],
      reference: { layouts: [INLINE, NONE], inlineReference: true },
    },
    {
      name: 'line-interleaved-caption',
      text: '\bCAPTION\bTAIL',
      layouts: [TOP, TOP],
      references: [LINE, PARA],
      reference: { references: [PARA, PARA] },
    },
    {
      name: 'line-bare-group',
      text: '\b\b',
      layouts: [TOP, TOP],
      references: [LINE, PARA],
      reference: { references: [PARA, PARA] },
    },
    {
      name: 'line-terminal-prefix',
      text: 'PREFIX\b',
      layouts: [TOP],
      references: [LINE],
      reference: { references: [PARA] },
    },
    {
      name: 'line-terminal-interleaved',
      text: 'PREFIX\bMIDDLE\b',
      layouts: [TOP, TOP],
      references: [PARA, LINE],
      reference: { references: [PARA, PARA] },
    },
    {
      name: 'bare-numbered-list',
      text: '\b',
      layouts: [TOP],
      bullet: true,
      expectedTop: ordinaryTop,
    },
    {
      name: 'stale-behind-group',
      text: '\b\b',
      layouts: [TOP, TOP],
      behind: [1, 1],
      reference: { behind: [0, 0] },
    },
    {
      name: 'negative-native-exclusion',
      text: '\b',
      layouts: [TOP],
      offset: -10,
      expectedTop: ordinaryTop + 20,
    },
    {
      name: 'top-native-exclusion',
      text: '\b',
      layouts: [TOP],
      topDistance: 10,
      expectedTop: ordinaryTop + 40,
    },
  ];
  const inputs: DocPrintInput[] = [];
  const cases: { variant: Variant; reference: boolean; pair: number }[] = [];
  for (const variant of variants) {
    const pair = inputs.length;
    for (const reference of variant.reference ? [false, true] : [false]) {
      const selected = reference ? { ...variant, ...variant.reference } : variant;
      const input = await docInput(model(selected));
      input.images = images.slice(0, variant.layouts.length);
      inputs.push(input);
      cases.push({ variant: selected, reference, pair });
    }
  }
  const originals = inputs.map((input) => structuredClone(input.snapshot));
  const results = await runDocJobs(inputs.map((input) => ({ input })));
  const outputs: Awaited<ReturnType<typeof retainDocPdf>>[] = [];
  for (const [index, result] of results.entries()) {
    const { bytes, ...diagnostic } = result;
    expect(diagnostic, `${cases[index].variant.name}: ${JSON.stringify(diagnostic)}`).toMatchObject(
      { ok: true, pages: 1, restored: true, remainingFonts: 0 },
    );
    outputs.push(
      await retainDocPdf(
        `image-cluster-${cases[index].variant.name}${cases[index].reference ? '-reference' : ''}`,
        bytes!,
      ),
    );
  }
  for (const [index, pages] of outputs.entries()) {
    const { variant, reference, pair } = cases[index];
    const page = pages[0];
    for (const marker of [
      'BEFORE',
      'AFTER-END',
      ...['PREFIX', 'CAPTION', 'MIDDLE', 'TAIL'].filter((text) => variant.text.includes(text)),
      ...(variant.header === false ? [] : ['HEADER']),
    ])
      expect(page.text.split(marker), `${variant.name}: ${marker}`).toHaveLength(2);
    const bounds = [0, 1].map(() => ({ count: 0, left: page.width, top: page.height, bottom: -1 }));
    for (let y = 0; y < page.height; y++)
      for (let x = 0; x < page.width; x++) {
        const n = (y * page.width + x) * 4;
        const red = page.pixels[n] > 150 && page.pixels[n + 1] < 80 && page.pixels[n + 2] < 80;
        const blue = page.pixels[n] < 80 && page.pixels[n + 1] < 100 && page.pixels[n + 2] > 150;
        if (!red && !blue) continue;
        const item = bounds[red ? 0 : 1];
        item.count++;
        item.left = Math.min(item.left, x);
        item.top = Math.min(item.top, y);
        item.bottom = Math.max(item.bottom, y);
      }
    for (const [image, item] of bounds.entries()) {
      const expected = image < variant.layouts.length ? 60 * (image ? 70 : 40) * 0.75 ** 2 : 0;
      expect(
        Math.abs(item.count - expected),
        `${variant.name}: complete image ${image}`,
      ).toBeLessThan(55);
      if (expected) expect(item.left).toBe((variant.bullet ? 120 : 60 + image * 140) * 0.75);
    }
    if (variant.expectedTop !== undefined)
      expect(Math.abs(bounds[0].top - variant.expectedTop * 0.75), variant.name).toBeLessThan(1);
    if (variant.bullet) {
      const marker = page.items.find((item) => item.str.trim() === '1.');
      expect(marker).toBeDefined();
      expect(marker!.transform[4]).toBeLessThan(bounds[0].left);
    }
    if (reference) {
      const actual = outputs[pair][0].pixels;
      let difference = 0;
      for (let n = 0; n < actual.length; n++)
        difference = Math.max(difference, Math.abs(actual[n] - page.pixels[n]));
      expect(difference, variant.name).toBeLessThanOrEqual(5);
    }
  }
  expect(inputs.map((input) => input.snapshot)).toEqual(originals);
}, 60_000);
