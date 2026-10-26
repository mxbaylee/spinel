import { createCanvas } from '@napi-rs/canvas';
import {
  DocStyleType,
  NumberUnitType,
  ObjectRelativeFromH,
  ObjectRelativeFromV,
  PositionedObjectLayoutType,
} from '@univerjs/core';
import { expect, test } from 'vitest';
import type { DocPrintInput } from './index.ts';
import { docInput, retainDocPdf, runDocJobs, textDoc } from './doc-native-test-support.ts';

test('same-paragraph image groups preserve both images, styled text and native stacked flow', async () => {
  const images = [];
  for (const [source, color] of [
    ['first', '#d02020'],
    ['second', '#2040d0'],
  ]) {
    const canvas = createCanvas(6, 7);
    const context = canvas.getContext('2d');
    context.fillStyle = color;
    context.fillRect(0, 0, 6, 7);
    images.push({ source, bytes: await canvas.encode('png') });
  }
  const variants = [
    { caption: true, prefix: false, header: false, line: false, group: false, middle: false },
    { caption: false, prefix: false, header: true, line: false, group: false, middle: false },
    { caption: true, prefix: true, header: true, line: false, group: false, middle: false },
    { caption: true, prefix: false, header: true, line: true, group: false, middle: false },
    { caption: false, prefix: false, header: true, line: false, group: true, middle: false },
    { caption: true, prefix: false, header: false, line: false, group: true, middle: false },
    { caption: true, prefix: true, header: true, line: false, group: true, middle: false },
    { caption: true, prefix: true, header: true, line: false, group: true, middle: true },
    { caption: false, prefix: true, header: true, line: false, group: true, middle: false },
    { caption: false, prefix: true, header: true, line: false, group: true, middle: true },
    {
      caption: false,
      prefix: true,
      header: true,
      line: false,
      group: true,
      middle: false,
      single: true,
      spacing: true,
    },
    {
      caption: false,
      prefix: false,
      header: true,
      line: false,
      group: true,
      middle: false,
      reverse: true,
    },
    {
      caption: false,
      prefix: true,
      header: true,
      line: false,
      group: true,
      middle: false,
      reverse: true,
      spacing: true,
    },
  ];
  const inputs: DocPrintInput[] = [];
  for (const variant of variants)
    for (const reference of [false, true]) {
      const prefix = variant.prefix ? 'STYLED-PREFIX ' : '';
      const caption = variant.caption ? 'STYLED-CAPTION' : '';
      const middle = variant.middle ? 'BETWEEN-IMAGES ' : '';
      const ids = variant.single ? ['first'] : ['first', 'second'];
      // The independent authored reference uses two ordinary inline image
      // paragraphs. Native flow gives the same complete stacked image geometry as
      // the original paragraph; production never adds these paragraphs.
      const lines = reference
        ? variant.reverse
          ? ['BEFORE', `${prefix}\b`, '\b', 'AFTER-SENTINEL']
          : [
              'BEFORE',
              ...(prefix ? [prefix] : []),
              '\b',
              ...(middle ? [middle] : []),
              ...(variant.single
                ? []
                : variant.group
                  ? ['\b', ...(caption ? [caption] : [])]
                  : [`\b${caption}`]),
              'AFTER-SENTINEL',
            ]
        : [
            'BEFORE',
            `${prefix}\b${middle}${variant.single ? '' : '\b'}${caption}`,
            'AFTER-SENTINEL',
          ];
      const snapshot = textDoc(lines, { pageSize: { width: 600, height: 400 } });
      const stream = snapshot.body!.dataStream;
      const markers: number[] = [];
      for (let index = 0; index < stream.length; index++)
        if (stream[index] === '\b') markers.push(index);
      snapshot.body!.customBlocks = markers.map((startIndex, index) => ({
        startIndex,
        blockId: ids[index],
      }));
      snapshot.styles = {
        prefix: {
          name: 'Prefix emphasis',
          type: DocStyleType.character,
          textStyle: { it: 1, cl: { rgb: '#206020' } },
        },
        caption: {
          name: 'Caption emphasis',
          type: DocStyleType.character,
          textStyle: { bl: 1, cl: { rgb: '#208020' } },
        },
      };
      snapshot.body!.textRuns = [
        ...(prefix
          ? [
              {
                st: stream.indexOf(prefix),
                ed: stream.indexOf(prefix) + prefix.length,
                sId: 'prefix',
              },
            ]
          : []),
        ...(caption
          ? [
              {
                st: stream.indexOf(caption),
                ed: stream.indexOf(caption) + caption.length,
                sId: 'caption',
              },
            ]
          : []),
      ];
      snapshot.drawingsOrder = ids;
      snapshot.drawings = Object.fromEntries(
        ids.map((id, index) => [
          id,
          {
            drawingId: id,
            unitId: snapshot.id,
            subUnitId: snapshot.id,
            drawingType: 0,
            source: id,
            layoutType:
              reference || (variant.reverse ? !index : index && !variant.group)
                ? PositionedObjectLayoutType.INLINE
                : PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM,
            docTransform: {
              size: { width: 60, height: index ? 70 : 40 },
              angle: 0,
              positionH: { relativeFrom: ObjectRelativeFromH.PAGE, posOffset: 60 },
              positionV: {
                relativeFrom:
                  !index && variant.line ? ObjectRelativeFromV.LINE : ObjectRelativeFromV.PARAGRAPH,
                posOffset: 0,
              },
            },
          },
        ]),
      ) as typeof snapshot.drawings;
      if (variant.spacing) {
        const first = snapshot.body!.paragraphs![1];
        first.paragraphStyle = {
          lineSpacing: 1.5,
          spaceAbove: { v: 15, u: NumberUnitType.PIXEL },
          ...(reference ? {} : { spaceBelow: { v: 20, u: NumberUnitType.PIXEL } }),
        };
        if (reference)
          snapshot.body!.paragraphs![2].paragraphStyle = {
            spaceBelow: { v: 20, u: NumberUnitType.PIXEL },
          };
      }
      if (reference) {
        for (const [index, block] of snapshot.body!.customBlocks.entries()) {
          if (variant.reverse ? index === 0 : !variant.group && index !== 0) continue;
          snapshot.body!.paragraphs!.find(
            (paragraph) => paragraph.startIndex === block.startIndex + 1,
          )!.paragraphStyle = {
            ...snapshot.body!.paragraphs!.find(
              (paragraph) => paragraph.startIndex === block.startIndex + 1,
            )!.paragraphStyle,
            indentStart: { v: 12, u: NumberUnitType.PIXEL },
          };
        }
      }
      if (variant.header) {
        snapshot.headers = {
          header: { headerId: 'header', body: textDoc(['REPEATED-HEADER']).body! },
        };
        snapshot.documentStyle.defaultHeaderId = 'header';
        snapshot.documentStyle.marginHeader = 12;
      }
      const input = await docInput(snapshot);
      input.images = images;
      inputs.push(input);
    }
  const originals = inputs.map((input) => structuredClone(input.snapshot));
  const results = await runDocJobs(inputs.map((input) => ({ input })));
  const outputs: Awaited<ReturnType<typeof retainDocPdf>>[] = [];
  for (const [index, result] of results.entries()) {
    expect(
      result,
      `${index}: ${JSON.stringify(result, (key, value) => (key === 'bytes' ? '<bytes>' : value))}`,
    ).toMatchObject({ ok: true, pages: 1, restored: true, remainingFonts: 0 });
    const pages = await retainDocPdf(`mixed-image-paragraph-${index}`, result.bytes!);
    outputs.push(pages);
    const page = pages[0];
    const variant = variants[Math.floor(index / 2)];
    for (const marker of [
      'BEFORE',
      'AFTER-SENTINEL',
      ...(variant.caption ? ['STYLED-CAPTION'] : []),
      ...(variant.prefix ? ['STYLED-PREFIX'] : []),
      ...(variant.middle ? ['BETWEEN-IMAGES'] : []),
      ...(variant.header ? ['REPEATED-HEADER'] : []),
    ])
      expect(page.text.split(marker)).toHaveLength(2);
    let red = 0,
      blue = 0,
      redBottom = 0,
      blueTop = page.height,
      blueBottom = 0;
    for (let y = 0; y < page.height; y++)
      for (let x = 0; x < page.width; x++) {
        const offset = (y * page.width + x) * 4;
        if (
          page.pixels[offset] > 150 &&
          page.pixels[offset + 1] < 80 &&
          page.pixels[offset + 2] < 80
        ) {
          red++;
          redBottom = Math.max(redBottom, y);
        }
        if (
          page.pixels[offset] < 80 &&
          page.pixels[offset + 1] < 100 &&
          page.pixels[offset + 2] > 150
        ) {
          blue++;
          blueTop = Math.min(blueTop, y);
          blueBottom = Math.max(blueBottom, y);
        }
      }
    expect(Math.abs(red - 60 * 40 * 0.75 ** 2)).toBeLessThan(60);
    expect(Math.abs(blue - (variant.single ? 0 : 60 * 70 * 0.75 ** 2))).toBeLessThan(60);
    expect(blueTop).toBeGreaterThanOrEqual(redBottom);
    const after = page.items.find((item) => item.str.includes('AFTER-SENTINEL'))!;
    expect(page.height - after.transform[5] - after.height).toBeGreaterThan(
      Math.max(redBottom, blueBottom),
    );
  }
  for (let index = 0; index < outputs.length; index += 2) {
    const actual = outputs[index][0].pixels,
      reference = outputs[index + 1][0].pixels;
    let difference = 0;
    for (let pixel = 0; pixel < actual.length; pixel++)
      difference = Math.max(difference, Math.abs(actual[pixel] - reference[pixel]));
    expect(difference, `Variant ${index / 2}`).toBeLessThanOrEqual(5);
  }
  expect(inputs.map((input) => input.snapshot)).toEqual(originals);
}, 60_000);
