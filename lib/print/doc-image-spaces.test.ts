import { createCanvas } from '@napi-rs/canvas';
import {
  DocumentFlavor,
  NumberUnitType,
  ObjectRelativeFromH,
  ObjectRelativeFromV,
  PositionedObjectLayoutType,
} from '@univerjs/core';
import type { IDocImage } from '@univerjs/docs-drawing';
import { expect, test } from 'vitest';
import type { DocPrintInput, PreparedImage } from './index.ts';
import { prepareImageParagraphFlow } from './doc-image-flow.ts';
import { docInput, retainDocPdf, runDocJobs, textDoc } from './doc-native-test-support.ts';

interface Variant {
  name: string;
  text: string;
  styled?: boolean;
  line?: boolean;
  tall?: boolean;
  spacing?: boolean;
  modern?: boolean;
}

function model(variant: Variant, reference = false) {
  const snapshot = textDoc(['BEFORE', variant.text, 'AFTER-SENTINEL'], {
    pageSize: { width: 600, height: 400 },
    ...(variant.modern ? { documentFlavor: DocumentFlavor.MODERN } : {}),
  });
  const stream = snapshot.body!.dataStream;
  const blocks = [];
  for (let index = 0; index < stream.length; index++)
    if (stream[index] === '\b')
      blocks.push({ startIndex: index, blockId: `space-image-${blocks.length}` });
  snapshot.body!.customBlocks = blocks;
  snapshot.body!.textRuns = [];
  if (variant.styled)
    for (let index = 7; index < 7 + variant.text.length; index++)
      if ([' ', '\t', '\u00a0'].includes(stream[index]))
        snapshot.body!.textRuns.push({
          st: index,
          ed: index + 1,
          ts: { ul: { s: 1, cl: { rgb: '#802080' } }, bg: { rgb: '#ffff00' } },
        });
  if (variant.spacing)
    snapshot.body!.paragraphs![1].paragraphStyle = {
      spaceAbove: { v: 15, u: NumberUnitType.PIXEL },
      spaceBelow: { v: 20, u: NumberUnitType.PIXEL },
    };
  snapshot.drawingsOrder = blocks.map(({ blockId }) => blockId);
  snapshot.drawings = Object.fromEntries(
    blocks.map(({ blockId }, index) => [
      blockId,
      {
        drawingId: blockId,
        unitId: snapshot.id,
        subUnitId: snapshot.id,
        drawingType: 0,
        source: `${blockId}-${reference ? 'padded' : 'plain'}-${variant.tall ? 'tall' : 'short'}`,
        layoutType: reference
          ? PositionedObjectLayoutType.INLINE
          : PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM,
        docTransform: {
          size: { width: reference ? 504 : 60, height: variant.tall ? 900 : index ? 70 : 40 },
          angle: 0,
          positionH: { relativeFrom: ObjectRelativeFromH.PAGE, posOffset: 60 },
          positionV: {
            relativeFrom:
              variant.line && index === 0
                ? ObjectRelativeFromV.LINE
                : ObjectRelativeFromV.PARAGRAPH,
            posOffset: 0,
          },
        },
      },
    ]),
  ) as typeof snapshot.drawings;
  snapshot.headers = { header: { headerId: 'header', body: textDoc(['HEADER']).body! } };
  snapshot.documentStyle.defaultHeaderId = 'header';
  snapshot.documentStyle.marginHeader = 12;
  return snapshot;
}

test('whitespace image preparation retains every authored character, run and source index', () => {
  for (const text of ['\b ', ' \b', '\b\t', '\u00a0\b', ' \b \b ', '\b\u200b']) {
    const snapshot = model({ name: 'ownership', text, styled: true });
    const before = structuredClone(snapshot.body);
    const flow = prepareImageParagraphFlow(snapshot, () => {});
    expect(snapshot.body).toEqual(before);
    expect(flow.size).toBe(text.endsWith('\u200b') ? 0 : 1);
  }
});

test('ordinary spaces, tabs and nonbreaking spaces retain native image flow and decorated paint', async () => {
  const variants: Variant[] = [
    { name: 'space-after', text: '\b ' },
    { name: 'space-before', text: ' \b' },
    { name: 'space-around', text: ' \b ' },
    { name: 'space-between', text: '\b \b' },
    { name: 'space-group-around', text: ' \b \b ' },
    { name: 'tab-after', text: '\b\t' },
    { name: 'tab-before', text: '\t\b' },
    { name: 'tab-between', text: '\b\t\b' },
    { name: 'nbsp-after', text: '\b\u00a0' },
    { name: 'nbsp-before', text: '\u00a0\b' },
    { name: 'nbsp-between', text: '\b\u00a0\b' },
    { name: 'styled-space', text: ' \b ', styled: true },
    { name: 'styled-whitespace', text: ' \u00a0\b\t\b\u00a0 ', styled: true },
    { name: 'line-space-group', text: '\b \b ', line: true },
    { name: 'prefix-space', text: 'PREFIX \b ' },
    { name: 'spacing', text: ' \b ', spacing: true },
    { name: 'modern-space', text: ' \b ', modern: true },
    { name: 'tall-space', text: ' \b ', tall: true },
  ];
  const inputs: DocPrintInput[] = [];
  for (const variant of variants)
    for (const reference of [false, true]) {
      const input = await docInput(model(variant, reference));
      const images: PreparedImage[] = [];
      for (const [index, id] of input.snapshot.drawingsOrder!.entries()) {
        const drawing = input.snapshot.drawings![id] as IDocImage;
        const size = drawing.docTransform.size;
        const canvas = createCanvas(size.width!, size.height!);
        const context = canvas.getContext('2d');
        context.fillStyle = index ? '#2040d0' : '#d02020';
        context.fillRect(reference ? 12 : 0, 0, 60, size.height!);
        // Independent authored native reference: a normal full-column INLINE
        // raster has transparent side padding, without any effectExtent or
        // print-specific flow reservation. All original whitespace and styles
        // remain in its same source paragraph and use native line breaking.
        images.push({ source: drawing.source, bytes: await canvas.encode('png') });
      }
      input.images = images;
      inputs.push(input);
    }
  const originals = inputs.map((input) => structuredClone(input.snapshot));
  const zeroWidth = await docInput(model({ name: 'zero-width', text: '\b\u200b' }));
  zeroWidth.images = inputs[0].images;
  const results = await runDocJobs([...inputs.map((input) => ({ input })), { input: zeroWidth }]);
  const outputs: (Awaited<ReturnType<typeof retainDocPdf>> | undefined)[] = [];
  for (const [index, result] of results.slice(0, inputs.length).entries()) {
    const variant = variants[Math.floor(index / 2)];
    outputs.push(
      result.ok
        ? await retainDocPdf(
            `image-whitespace-${variant.name}${index % 2 ? '-reference' : ''}`,
            result.bytes!,
          )
        : undefined,
    );
  }
  for (const [index, variant] of variants.entries()) {
    const actual = results[index * 2],
      reference = results[index * 2 + 1];
    for (const result of [actual, reference]) {
      const { bytes, ...summary } = result;
      expect(summary, `${variant.name}: ${JSON.stringify(summary)}`).toMatchObject({
        ok: true,
        restored: true,
        remainingFonts: 0,
      });
      expect(bytes?.length).toBeGreaterThan(0);
    }
    const actualPages = outputs[index * 2]!;
    const referencePages = outputs[index * 2 + 1]!;
    expect(actualPages.length).toBe(referencePages.length);
    const allText = actualPages.map((page) => page.text).join(' ');
    for (const marker of [
      'BEFORE',
      'AFTER-SENTINEL',
      ...(variant.text.includes('PREFIX') ? ['PREFIX'] : []),
    ])
      expect(allText.split(marker)).toHaveLength(2);
    let red = 0,
      blue = 0,
      decoration = 0;
    for (const [pageIndex, page] of actualPages.entries()) {
      expect(page.text).toContain('HEADER');
      const expected = referencePages[pageIndex];
      expect(page.view).toEqual(expected.view);
      let difference = 0;
      for (let offset = 0; offset < page.pixels.length; offset += 4) {
        const [r, g, b] = page.pixels.slice(offset, offset + 3);
        if (r > 150 && g < 80 && b < 80) red++;
        if (r < 80 && g < 100 && b > 150) blue++;
        if ((r > 200 && g > 200 && b < 100) || (r > 80 && r < 180 && g < 100 && b > 80 && b < 180))
          decoration++;
        for (let channel = 0; channel < 4; channel++)
          difference = Math.max(
            difference,
            Math.abs(page.pixels[offset + channel] - expected.pixels[offset + channel]),
          );
      }
      expect(difference, `${variant.name} page${pageIndex + 1}`).toBeLessThanOrEqual(5);
    }
    const count = inputs[index * 2].snapshot.body!.customBlocks!.length;
    expect(Math.abs(red - 60 * (variant.tall ? 900 : 40) * 0.75 ** 2)).toBeLessThan(100);
    expect(Math.abs(blue - (count > 1 ? 60 * 70 * 0.75 ** 2 : 0))).toBeLessThan(100);
    if (variant.styled) expect(decoration).toBeGreaterThan(0);
  }
  const { bytes, ...rejected } = results.at(-1)!;
  expect(rejected).toMatchObject({
    ok: false,
    code: 'unsupported',
    restored: true,
    remainingFonts: 0,
  });
  expect(bytes).toBeUndefined();
  expect(inputs.map((input) => input.snapshot)).toEqual(originals);
}, 90_000);
