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

test('full-column Square preserves styled paragraph text and image geometry through equivalent native flow', async () => {
  const canvas = createCanvas(12, 12);
  const context = canvas.getContext('2d');
  context.fillStyle = '#2040d0';
  context.fillRect(0, 0, 12, 12);
  const bytes = await canvas.encode('png');
  const prefix = 'Styled prefix ';
  const suffix = 'authored caption';
  const make = async (reference: boolean, physical: boolean, height: number, spaced: boolean) => {
    const paragraph = reference ? `\b${prefix}${suffix}` : `${prefix}\b${suffix}`;
    const snapshot = textDoc(['BEFORE-SQUARE', paragraph, 'AFTER-SQUARE-SENTINEL'], {
      pageSize: { width: 600, height: 400 },
    });
    const start = 'BEFORE-SQUARE\r'.length;
    snapshot.body!.customBlocks = [
      { startIndex: start + (reference ? 0 : prefix.length), blockId: 'image' },
    ];
    snapshot.styles = {
      prefix: {
        name: 'Prefix emphasis',
        type: DocStyleType.character,
        textStyle: { it: 1, cl: { rgb: '#c02020' } },
      },
      caption: {
        name: 'Caption emphasis',
        type: DocStyleType.character,
        textStyle: { bl: 1, cl: { rgb: '#208020' } },
      },
    };
    snapshot.body!.textRuns = [
      {
        st: start + (reference ? 1 : 0),
        ed: start + prefix.length + (reference ? 1 : 0),
        sId: 'prefix',
      },
      { st: start + prefix.length + 1, ed: start + paragraph.length, sId: 'caption' },
    ];
    if (spaced) {
      snapshot.body!.paragraphs![0].paragraphStyle = {
        spaceBelow: { v: 24, u: NumberUnitType.PIXEL },
      };
      snapshot.body!.paragraphs![1].paragraphStyle = {
        spaceAbove: { v: 15, u: NumberUnitType.PIXEL },
        spaceBelow: { v: 2, u: NumberUnitType.LINE },
      };
    }
    if (physical) {
      snapshot.headers = {
        header: { headerId: 'header', body: textDoc(['REPEATED-HEADER']).body! },
      };
      snapshot.documentStyle.defaultHeaderId = 'header';
      snapshot.documentStyle.marginHeader = 12;
    }
    snapshot.drawingsOrder = ['image'];
    snapshot.drawings = {
      image: {
        drawingId: 'image',
        unitId: snapshot.id,
        subUnitId: snapshot.id,
        drawingType: 0,
        source: 'authorized-square',
        layoutType: reference
          ? PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM
          : PositionedObjectLayoutType.WRAP_SQUARE,
        distL: 20,
        distR: 20,
        docTransform: {
          size: { width: 480, height },
          positionH: { relativeFrom: ObjectRelativeFromH.PAGE, posOffset: 60 },
          positionV: { relativeFrom: ObjectRelativeFromV.PARAGRAPH, posOffset: 0 },
          angle: 0,
        },
      },
    } as typeof snapshot.drawings;
    const input = await docInput(snapshot);
    input.images = [{ source: 'authorized-square', bytes }];
    return input;
  };
  const variants = [
    { physical: false, height: 90, spaced: false },
    { physical: false, height: 90, spaced: true },
    { physical: true, height: 900, spaced: false },
  ];
  const inputs: DocPrintInput[] = [];
  for (const variant of variants)
    for (const reference of [false, true])
      inputs.push(await make(reference, variant.physical, variant.height, variant.spaced));
  const originals = inputs.map((input) => structuredClone(input.snapshot));
  const results = await runDocJobs(inputs.map((input) => ({ input })));
  const outputs: Awaited<ReturnType<typeof retainDocPdf>>[] = [];
  for (const [index, result] of results.entries()) {
    expect(
      result,
      JSON.stringify(result, (key, value) => (key === 'bytes' ? '<bytes>' : value)),
    ).toMatchObject({ ok: true, restored: true, remainingFonts: 0 });
    const pages = await retainDocPdf(`square-paragraph-${index}`, result.bytes!);
    outputs.push(pages);
    const text = pages.map((page) => page.text).join(' ');
    for (const marker of [prefix.trim(), suffix, 'AFTER-SQUARE-SENTINEL'])
      expect(text.split(marker)).toHaveLength(2);
    let blue = 0;
    for (const page of pages)
      for (let offset = 0; offset < page.pixels.length; offset += 4)
        if (
          page.pixels[offset + 2] > 150 &&
          page.pixels[offset] < 80 &&
          page.pixels[offset + 1] < 100
        )
          blue++;
    expect(Math.abs(blue - 480 * variants[Math.floor(index / 2)].height * 0.75 ** 2)).toBeLessThan(
      500,
    );
    if (variants[Math.floor(index / 2)].physical)
      expect(pages.every((page) => page.text.includes('REPEATED-HEADER'))).toBe(true);
  }
  for (let index = 0; index < outputs.length; index += 2) {
    expect(outputs[index].length).toBe(outputs[index + 1].length);
    for (const [page, value] of outputs[index].entries())
      expect(Buffer.from(value.pixels).equals(Buffer.from(outputs[index + 1][page].pixels))).toBe(
        true,
      );
  }
  expect(inputs.map((input) => input.snapshot)).toEqual(originals);
}, 60_000);
