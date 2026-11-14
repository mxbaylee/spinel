import { createCanvas } from '@napi-rs/canvas';
import {
  ObjectRelativeFromH,
  ObjectRelativeFromV,
  PositionedObjectLayoutType,
} from '@univerjs/core';
import { expect, test } from 'vitest';
import { docInput, retainDocPdf, runDocJobs, textDoc } from './doc-native-test-support.ts';

const summary = (value: unknown) =>
  JSON.stringify(value, (key, item) => (key === 'bytes' ? '<bytes>' : item));
const compact = (value: string) => value.replace(/\s|-/gu, '');

test('physical headers and columns preserve tall image paragraphs, captions, source area and final content', async () => {
  const colors = [
    [190, 30, 50],
    [30, 150, 80],
    [40, 80, 190],
  ];
  const canvas = createCanvas(48, 900);
  const ctx = canvas.getContext('2d');
  for (const [index, color] of colors.entries()) {
    ctx.fillStyle = `rgb(${color.join(',')})`;
    ctx.fillRect(0, index * 300, 48, 300);
  }
  const bytes = await canvas.encode('png');
  const definitions = [
    {
      name: 'float-header',
      inline: false,
      columns: false,
      caption: false,
      height: 900,
      only: false,
    },
    {
      name: 'inline-columns',
      inline: true,
      columns: true,
      caption: false,
      height: 900,
      only: false,
    },
    {
      name: 'caption-columns',
      inline: false,
      columns: true,
      caption: true,
      height: 900,
      only: false,
    },
    {
      name: 'line-caption-columns',
      inline: false,
      columns: true,
      caption: true,
      height: 900,
      only: false,
    },
    {
      name: 'image-only-exact-pages',
      inline: false,
      columns: false,
      caption: false,
      height: 608,
      only: true,
    },
  ];
  const inputs = await Promise.all(
    definitions.map(async (definition) => {
      const paragraph = `\b${definition.caption ? 'ANCHOR-CAPTION' : ''}`;
      const snapshot = textDoc(
        definition.only ? [paragraph] : ['BEFORE-IMAGE', paragraph, 'AFTER-IMAGE-SENTINEL'],
        {
          pageSize: { width: 600, height: 400 },
          marginHeader: 10,
          marginFooter: 10,
          defaultHeaderId: 'header',
          defaultFooterId: 'footer',
        },
      );
      snapshot.headers = {
        header: { headerId: 'header', body: textDoc(['REPEATED-HEADER']).body! },
      };
      snapshot.footers = {
        footer: { footerId: 'footer', body: textDoc(['REPEATED-FOOTER']).body! },
      };
      if (definition.columns)
        snapshot.body!.sectionBreaks = [
          {
            sectionId: 'two-columns',
            startIndex: snapshot.body!.dataStream.length - 1,
            columnProperties: [
              { width: 240, paddingEnd: 24 },
              { width: 240, paddingEnd: 0 },
            ],
          },
        ];
      snapshot.body!.customBlocks = [
        { startIndex: snapshot.body!.dataStream.indexOf('\b'), blockId: 'image' },
      ];
      snapshot.drawingsOrder = ['image'];
      snapshot.drawings = {
        image: {
          drawingId: 'image',
          unitId: snapshot.id,
          subUnitId: snapshot.id,
          drawingType: 0,
          source: 'authorized-image',
          layoutType: definition.inline
            ? PositionedObjectLayoutType.INLINE
            : PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM,
          docTransform: {
            size: { width: 48, height: definition.height },
            positionH: { relativeFrom: ObjectRelativeFromH.PAGE, posOffset: 60 },
            positionV: {
              relativeFrom:
                definition.name === 'line-caption-columns'
                  ? ObjectRelativeFromV.LINE
                  : ObjectRelativeFromV.PARAGRAPH,
              posOffset: 0,
            },
            angle: 0,
          },
        },
      } as typeof snapshot.drawings;
      const input = await docInput(snapshot);
      input.images = [{ source: 'authorized-image', bytes }];
      return input;
    }),
  );
  const results = await runDocJobs(inputs.map((input) => ({ input })));
  for (const [index, result] of results.entries()) {
    const definition = definitions[index];
    expect(result, `${definition.name}: ${summary(result)}`).toMatchObject({
      ok: true,
      restored: true,
      remainingFonts: 0,
    });
    const pages = await retainDocPdf(`physical-image-${definition.name}`, result.bytes!);
    expect(pages.length).toBeGreaterThan(1);
    if (definition.only) expect(pages).toHaveLength(2);
    const text = compact(pages.map((page) => page.text).join(''));
    if (!definition.only)
      for (const marker of ['BEFORE-IMAGE', 'AFTER-IMAGE-SENTINEL'])
        expect(text.split(compact(marker)), marker).toHaveLength(2);
    if (definition.caption) expect(text.split('ANCHORCAPTION')).toHaveLength(2);
    const counts = colors.map(() => 0);
    for (const [pageIndex, page] of pages.entries()) {
      expect(page.text).toContain('REPEATED-HEADER');
      expect(page.text).toContain('REPEATED-FOOTER');
      let painted = 0;
      let outsideBody = 0;
      for (let offset = 0; offset < page.pixels.length; offset += 4) {
        const color = colors.findIndex((color) =>
          color.every((value, channel) => Math.abs(page.pixels[offset + channel] - value) < 2),
        );
        if (color < 0) continue;
        counts[color]++;
        painted++;
        const top = Math.floor(offset / 4 / page.width);
        if (top < 36 || top >= 264) outsideBody++;
      }
      expect(outsideBody).toBe(0);
      if (pageIndex === 0)
        expect(painted, 'the first image band uses the available body space').toBeGreaterThan(0);
      expect(painted > 0 || /BEFORE|AFTER|CAPTION/.test(page.text)).toBe(true);
    }
    for (const count of counts) {
      const expected = ((48 * definition.height) / 3) * 0.75 ** 2;
      expect(count).toBeGreaterThan(expected * 0.96);
      expect(count).toBeLessThan(expected * 1.02);
    }
  }
}, 60_000);
