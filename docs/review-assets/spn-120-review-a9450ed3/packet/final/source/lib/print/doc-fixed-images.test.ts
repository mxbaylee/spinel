import { createCanvas } from '@napi-rs/canvas';
import {
  DocStyleType,
  DocumentFlavor,
  ObjectRelativeFromV,
  PositionedObjectLayoutType,
  resolveDocumentParagraphStyle,
} from '@univerjs/core';
import { expect, test } from 'vitest';
import type { DocPrintInput } from './index.ts';
import { docInput, retainDocPdf, runDocJobs, textDoc } from './doc-native-test-support.ts';

// Native side wrapping may insert a discretionary hyphen at a divide boundary.
const compact = (text: string) => text.replace(/[-\s]/gu, '');

test('fixed PAGE and MARGIN wrapping retains physical and continuous saved coordinates', async () => {
  const canvas = createCanvas(9, 7);
  const context = canvas.getContext('2d');
  context.fillStyle = '#d02020';
  context.fillRect(0, 0, 9, 7);
  const image = { source: 'fixed-picture', bytes: await canvas.encode('png') };
  const variants = [];
  const inputs: DocPrintInput[] = [];
  for (const flavor of [DocumentFlavor.TRADITIONAL, DocumentFlavor.MODERN])
    for (const count of [2, 25])
      for (const layoutType of [
        PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM,
        PositionedObjectLayoutType.WRAP_SQUARE,
      ])
        for (const relativeFrom of [ObjectRelativeFromV.PAGE, ObjectRelativeFromV.MARGIN]) {
          const snapshot = textDoc(
            [
              ...Array.from({ length: count }, (_, index) => `BEFORE-${index} ordinary text.`),
              '\bCAPTION beside a modest picture',
              'AFTER-SENTINEL',
            ],
            { documentFlavor: flavor, pageSize: { width: 600, height: 400 } },
          );
          // Measured public-native positions before the UI reference change.
          // The position UI saves PAGE=absoluteTop and MARGIN=absoluteTop-margin;
          // its resolver returns these values unchanged. The exported transform
          // command was independently exercised with these exact saved models.
          const absoluteTop =
            flavor === DocumentFlavor.MODERN
              ? count === 2
                ? 137.46666666666667
                : 951.6666666666663
              : count === 2
                ? 94.29333257675171
                : layoutType === PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM
                  ? 71.14666628837585
                  : 325.75999546051025;
          const editorMargin = flavor === DocumentFlavor.MODERN ? 50 / 0.75 : 48;
          const posOffset =
            absoluteTop - (relativeFrom === ObjectRelativeFromV.MARGIN ? editorMargin : 0);
          snapshot.body!.customBlocks = [
            { blockId: 'picture', startIndex: snapshot.body!.dataStream.indexOf('\b') },
          ];
          snapshot.drawingsOrder = ['picture'];
          snapshot.drawings = {
            picture: {
              drawingId: 'picture',
              unitId: snapshot.id,
              subUnitId: snapshot.id,
              drawingType: 0,
              source: image.source,
              layoutType,
              docTransform: {
                size: { width: 90, height: 70 },
                angle: 0,
                positionH: { relativeFrom: 0, posOffset: 80 },
                positionV: { relativeFrom, posOffset },
              },
            },
          } as typeof snapshot.drawings;
          const input = await docInput(snapshot);
          input.images = [image];
          inputs.push(input);
          variants.push({ flavor, count, layoutType, relativeFrom, absoluteTop, posOffset });
        }
  const originals = inputs.map((input) => structuredClone(input.snapshot));
  // A tall, finite native page is an independent source-coordinate oracle for
  // the four long continuous models. It needs no physical cut planner and keeps
  // the same explicit Modern paragraph defaults used by the print representation.
  const references = inputs.slice(12).map((input) => {
    const snapshot = structuredClone(input.snapshot);
    snapshot.documentStyle.defaultParagraphStyle = resolveDocumentParagraphStyle(
      snapshot.documentStyle,
      undefined,
    );
    snapshot.documentStyle.documentFlavor = DocumentFlavor.TRADITIONAL;
    snapshot.documentStyle.pageSize!.height = 4_000;
    return { ...input, snapshot };
  });
  const results = await runDocJobs([...inputs, ...references].map((input) => ({ input })));
  const outputs: Awaited<ReturnType<typeof retainDocPdf>>[] = [];
  for (const [index, result] of results.slice(0, inputs.length).entries()) {
    expect(
      result,
      `${index}: ${JSON.stringify(result, (key, value) => (key === 'bytes' ? '<bytes>' : value))}`,
    ).toMatchObject({ ok: true, restored: true, remainingFonts: 0 });
    outputs.push(await retainDocPdf(`fixed-image-${index}`, result.bytes!));
  }
  for (const [index, result] of results.slice(0, inputs.length).entries()) {
    const variant = variants[index];
    expect(
      result,
      `${index}: ${JSON.stringify(result, (key, value) => (key === 'bytes' ? '<bytes>' : value))}`,
    ).toMatchObject({ ok: true, restored: true, remainingFonts: 0 });
    const pages = outputs[index];
    const text = compact(pages.map((page) => page.text).join(''));
    for (const marker of [
      ...Array.from({ length: variant.count }, (_, index) => `BEFORE-${index}ordinarytext.`),
      'CAPTIONbesideamodestpicture',
      'AFTER-SENTINEL',
    ])
      expect(text.split(compact(marker)), `${index}: ${marker}`).toHaveLength(2);
    let colored = 0;
    const bounds = [];
    for (const [pageIndex, page] of pages.entries()) {
      let left = page.width,
        top = page.height,
        right = -1,
        bottom = -1;
      for (let y = 0; y < page.height; y++)
        for (let x = 0; x < page.width; x++) {
          const at = (y * page.width + x) * 4;
          if (page.pixels[at] > 150 && page.pixels[at + 1] < 80 && page.pixels[at + 2] < 80) {
            colored++;
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x);
            bottom = Math.max(bottom, y);
          }
        }
      if (right >= 0) bounds.push({ pageIndex, left, top, right, bottom });
    }
    expect(colored, `${index}: complete original image`).toBeGreaterThan(3_400);
    expect(colored).toBeLessThan(3_650);
    expect(bounds).toHaveLength(1);
    expect(bounds[0].left).toBe(60);
    if (variant.flavor === DocumentFlavor.TRADITIONAL) {
      expect(bounds[0].top).toBeCloseTo(variant.absoluteTop * 0.75, 0);
      expect(bounds[0].pageIndex).toBe(
        variant.count === 2
          ? 0
          : variant.layoutType === PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM
            ? 2
            : 1,
      );
    } else if (variant.count === 25) expect(bounds[0].pageIndex).toBeGreaterThanOrEqual(2);
    expect(inputs[index].snapshot).toEqual(originals[index]);
  }
  for (let index = 12; index < inputs.length; index++) {
    const result = results[inputs.length + index - 12];
    expect(result).toMatchObject({ ok: true, pages: 1, restored: true, remainingFonts: 0 });
    const [reference] = await retainDocPdf(
      `fixed-image-continuous-reference-${index}`,
      result.bytes!,
    );
    const source = reference.items.filter((item) => item.str.trim());
    let cursor = 0;
    for (const page of outputs[index]) {
      const items = page.items.filter((item) => {
        if (!item.str.trim()) return false;
        const baseline = page.height - item.transform[5];
        if (baseline >= 36) return true;
        // PDF text extraction can report a fully clipped preceding descender.
        // It is excluded only after the raster proves that its body intersection
        // is completely white; a real split glyph still fails this oracle.
        for (let y = 36; y < Math.min(page.height, Math.ceil(baseline + item.height)); y++)
          for (
            let x = Math.max(0, Math.floor(item.transform[4]));
            x < Math.min(page.width, Math.ceil(item.transform[4] + item.width));
            x++
          ) {
            const at = (y * page.width + x) * 4;
            expect(Math.min(page.pixels[at], page.pixels[at + 1], page.pixels[at + 2])).toBe(255);
          }
        return false;
      });
      expect(items.length).toBeGreaterThan(0);
      const shift =
        reference.height - source[cursor].transform[5] - page.height + items[0].transform[5];
      for (const item of items) {
        const expected = source[cursor++];
        expect(item.str).toBe(expected.str);
        expect(item.transform[4]).toBeCloseTo(expected.transform[4], 4);
        expect(page.height - item.transform[5] + shift).toBeCloseTo(
          reference.height - expected.transform[5],
          4,
        );
      }
      let first = -1;
      for (let at = 0; at < page.pixels.length; at += 4)
        if (page.pixels[at] > 150 && page.pixels[at + 1] < 80 && page.pixels[at + 2] < 80) {
          first = at / 4;
          break;
        }
      if (first >= 0) {
        const position = inputs[index].snapshot.drawings!.picture.docTransform.positionV;
        const savedTop =
          position.posOffset! + (position.relativeFrom === ObjectRelativeFromV.MARGIN ? 48 : 0);
        expect(Math.floor(first / page.width) + shift).toBeCloseTo(savedTop * 0.75, 0);
      }
    }
    expect(cursor).toBe(source.length);
  }
}, 60_000);

test('fixed offsets inside the physical paper retain image ink above the text margin', async () => {
  const canvas = createCanvas(9, 4);
  const context = canvas.getContext('2d');
  context.fillStyle = '#d02020';
  context.fillRect(0, 0, 9, 4);
  const image = { source: 'margin-picture', bytes: await canvas.encode('png') };
  const inputs: DocPrintInput[] = [];
  for (const flavor of [DocumentFlavor.TRADITIONAL, DocumentFlavor.MODERN])
    for (const margin of [false, true]) {
      const snapshot = textDoc(['\bCAPTION words', 'AFTER'], {
        documentFlavor: flavor,
        pageSize: { width: 600, height: 400 },
      });
      snapshot.body!.customBlocks = [{ blockId: 'picture', startIndex: 0 }];
      snapshot.drawingsOrder = ['picture'];
      snapshot.drawings = {
        picture: {
          drawingId: 'picture',
          unitId: snapshot.id,
          subUnitId: snapshot.id,
          drawingType: 0,
          source: image.source,
          layoutType: margin
            ? PositionedObjectLayoutType.WRAP_SQUARE
            : PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM,
          docTransform: {
            size: { width: 90, height: 40 },
            angle: 0,
            positionH: { relativeFrom: 0, posOffset: 80 },
            positionV: {
              relativeFrom: margin ? ObjectRelativeFromV.MARGIN : ObjectRelativeFromV.PAGE,
              posOffset: margin ? -20 : 20,
            },
          },
        },
      } as typeof snapshot.drawings;
      const input = await docInput(snapshot);
      input.images = [image];
      inputs.push(input);
    }
  const originals = inputs.map((input) => structuredClone(input.snapshot));
  const results = await runDocJobs(inputs.map((input) => ({ input })));
  for (const [index, result] of results.entries()) {
    expect(
      result,
      JSON.stringify(result, (key, value) => (key === 'bytes' ? '<bytes>' : value)),
    ).toMatchObject({ ok: true, pages: 1, restored: true, remainingFonts: 0 });
    const [page] = await retainDocPdf(`fixed-image-margin-${index}`, result.bytes!);
    expect(compact(page.text)).toBe('CAPTIONwordsAFTER');
    let count = 0,
      top = page.height;
    for (let at = 0; at < page.pixels.length; at += 4)
      if (page.pixels[at] > 150 && page.pixels[at + 1] < 80 && page.pixels[at + 2] < 80) {
        count++;
        top = Math.min(top, Math.floor(at / 4 / page.width));
      }
    expect(top).toBe(index % 2 ? 21 : 15);
    expect(count).toBeGreaterThan(1_950);
    expect(count).toBeLessThan(2_100);
    expect(inputs[index].snapshot).toEqual(originals[index]);
  }
}, 60_000);

test('continuous fixed locations map to retained header and column flow independently of a distant anchor', async () => {
  const canvas = createCanvas(9, 7);
  const context = canvas.getContext('2d');
  context.fillStyle = '#d02020';
  context.fillRect(0, 0, 9, 7);
  const image = { source: 'fixed-picture', bytes: await canvas.encode('png') };
  const inputs: DocPrintInput[] = [];
  const variants = [
    {
      layoutType: PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM,
      relativeFrom: ObjectRelativeFromV.PAGE,
      horizontal: { relativeFrom: 0, posOffset: 80 },
    },
    {
      layoutType: PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM,
      relativeFrom: ObjectRelativeFromV.MARGIN,
      horizontal: { relativeFrom: 3, posOffset: 12 },
    },
    {
      layoutType: PositionedObjectLayoutType.WRAP_SQUARE,
      relativeFrom: ObjectRelativeFromV.PAGE,
      horizontal: { relativeFrom: 1, posOffset: -12 },
    },
    {
      layoutType: PositionedObjectLayoutType.WRAP_SQUARE,
      relativeFrom: ObjectRelativeFromV.MARGIN,
      horizontal: { relativeFrom: 0, posOffset: 80 },
    },
    {
      layoutType: PositionedObjectLayoutType.WRAP_NONE,
      relativeFrom: ObjectRelativeFromV.PAGE,
      horizontal: { relativeFrom: 0, posOffset: 80 },
    },
    {
      layoutType: PositionedObjectLayoutType.WRAP_NONE,
      relativeFrom: ObjectRelativeFromV.MARGIN,
      horizontal: { relativeFrom: 3, posOffset: 12 },
    },
    {
      layoutType: PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM,
      relativeFrom: ObjectRelativeFromV.PAGE,
      horizontal: { relativeFrom: 0, posOffset: 80 },
      forward: true,
    },
    {
      layoutType: PositionedObjectLayoutType.WRAP_SQUARE,
      relativeFrom: ObjectRelativeFromV.PAGE,
      horizontal: { relativeFrom: 0, posOffset: 80 },
      forward: true,
    },
    {
      layoutType: PositionedObjectLayoutType.WRAP_NONE,
      relativeFrom: ObjectRelativeFromV.PAGE,
      horizontal: { relativeFrom: 0, posOffset: 80 },
      forward: true,
    },
  ];
  for (const variant of variants)
    for (const reference of [false, true]) {
      const lines = [
        ...Array.from(
          { length: variant.forward ? 2 : 25 },
          (_, index) => `${reference && index === 2 ? '\b' : ''}BEFORE-${index} ordinary text.`,
        ),
        `${reference ? '' : '\b'}CAPTION beside a modest picture`,
        `AFTER-SENTINEL${reference && variant.forward ? '\b' : ''}`,
      ];
      const snapshot = textDoc(lines, {
        documentFlavor: DocumentFlavor.MODERN,
        pageSize: { width: 600, height: 400 },
        defaultHeaderId: 'header',
        marginHeader: 12,
      });
      snapshot.headers = {
        header: { headerId: 'header', body: textDoc(['RETAINED-HEADER']).body! },
      };
      snapshot.body!.sectionBreaks = [
        {
          startIndex: snapshot.body!.dataStream.length - 1,
          sectionId: 'section',
          columnProperties: [
            { width: 242, paddingEnd: 20 },
            { width: 242, paddingEnd: 0 },
          ],
        },
      ];
      snapshot.styles = {
        emphasis: {
          name: 'Retained named emphasis',
          type: DocStyleType.character,
          textStyle: { bl: 1, cl: { rgb: '#206020' } },
        },
      };
      const start = snapshot.body!.dataStream.indexOf('BEFORE-2 ordinary');
      if (start >= 0)
        snapshot.body!.textRuns = [
          { st: start, ed: start + 'BEFORE-2 ordinary text.'.length, sId: 'emphasis' },
        ];
      snapshot.body!.customBlocks = [
        { blockId: 'picture', startIndex: snapshot.body!.dataStream.indexOf('\b') },
      ];
      snapshot.drawingsOrder = ['picture'];
      // The picture was fixed after paragraph1, then23paragraphs were inserted
      // ahead of its original control. Native continuous layout leaves its Y at
      // 137.467. The independent authored reference places its existing control
      // at that visible source location using an ordinary paragraph anchor.
      snapshot.drawings = {
        picture: {
          drawingId: 'picture',
          unitId: snapshot.id,
          subUnitId: snapshot.id,
          drawingType: 0,
          source: image.source,
          layoutType:
            reference && variant.forward
              ? PositionedObjectLayoutType.WRAP_NONE
              : variant.layoutType,
          docTransform: {
            size: { width: 90, height: 70 },
            angle: 0,
            positionH: variant.horizontal,
            positionV: reference
              ? {
                  relativeFrom: ObjectRelativeFromV.PARAGRAPH,
                  posOffset: variant.forward
                    ? variant.layoutType === PositionedObjectLayoutType.WRAP_NONE
                      ? 778.8
                      : 778.79
                    : 0,
                }
              : {
                  relativeFrom: variant.relativeFrom,
                  posOffset: variant.forward
                    ? 951.6666666666663
                    : variant.relativeFrom === ObjectRelativeFromV.PAGE
                      ? 137.46666666666667
                      : 70.8,
                },
          },
        },
      } as typeof snapshot.drawings;
      const input = await docInput(snapshot);
      input.images = [image];
      inputs.push(input);
    }
  const originals = inputs.map((input) => structuredClone(input.snapshot));
  const results = await runDocJobs([
    ...inputs.map((input) => ({ input })),
    { input: inputs[0], options: { limits: { pages: 1 } } },
    { input: inputs[0], options: { limits: { gridCells: 80 } } },
  ]);
  const outputs: Awaited<ReturnType<typeof retainDocPdf>>[] = [];
  for (const [index, result] of results.slice(0, inputs.length).entries()) {
    expect(
      result,
      `${index}: ${JSON.stringify(result, (key, value) => (key === 'bytes' ? '<bytes>' : value))}`,
    ).toMatchObject({ ok: true, restored: true, remainingFonts: 0 });
    outputs.push(await retainDocPdf(`fixed-retained-${index}`, result.bytes!));
  }
  for (let index = 0; index < inputs.length; index += 2) {
    const actual = outputs[index],
      reference = outputs[index + 1];
    expect(actual.length).toBe(reference.length);
    expect(actual.length).toBeGreaterThan(1);
    for (const [pageIndex, page] of actual.entries()) {
      expect(page.text).toContain('RETAINED-HEADER');
      const expected = reference[pageIndex];
      expect(page.pixels.length).toBe(expected.pixels.length);
      let difference = 0;
      for (let pixel = 0; pixel < page.pixels.length; pixel++)
        difference = Math.max(difference, Math.abs(page.pixels[pixel] - expected.pixels[pixel]));
      expect(
        difference,
        `${index}, page${pageIndex}: independent native reference`,
      ).toBeLessThanOrEqual(5);
    }
    const all = compact(actual.map((page) => page.text).join(''));
    for (const marker of [
      ...Array.from(
        { length: variants[index / 2].forward ? 2 : 25 },
        (_, index) => `BEFORE-${index}ordinarytext.`,
      ),
      'CAPTIONbesideamodestpicture',
      'AFTER-SENTINEL',
    ])
      expect(all.split(compact(marker))).toHaveLength(2);
  }
  for (const result of results.slice(inputs.length))
    expect(result).toMatchObject({ ok: false, code: 'limit', restored: true, remainingFonts: 0 });
  for (const [index, input] of inputs.entries()) expect(input.snapshot).toEqual(originals[index]);
}, 60_000);

test('image-only continuous fixed positions retain authored blank paragraphs and physical stories', async () => {
  const canvas = createCanvas(9, 7);
  const context = canvas.getContext('2d');
  context.fillStyle = '#d02020';
  context.fillRect(0, 0, 9, 7);
  const image = { source: 'fixed-blank-picture', bytes: await canvas.encode('png') };
  const inputs: DocPrintInput[] = [];
  for (const blanks of [false, true])
    for (const layoutType of [
      PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM,
      PositionedObjectLayoutType.WRAP_SQUARE,
      PositionedObjectLayoutType.WRAP_NONE,
    ])
      for (const relativeFrom of [ObjectRelativeFromV.PAGE, ObjectRelativeFromV.MARGIN])
        for (const reference of [false, true]) {
          const snapshot = textDoc(blanks ? ['', '', '\b', '', ''] : ['\b'], {
            documentFlavor: DocumentFlavor.MODERN,
            pageSize: { width: 600, height: 400 },
            defaultHeaderId: 'header',
            marginHeader: 12,
          });
          snapshot.headers = {
            header: { headerId: 'header', body: textDoc(['RETAINED-HEADER']).body! },
          };
          snapshot.body!.sectionBreaks = [
            {
              startIndex: snapshot.body!.dataStream.length - 1,
              sectionId: 'section',
              columnProperties: [
                { width: 242, paddingEnd: 20 },
                { width: 242, paddingEnd: 0 },
              ],
            },
          ];
          snapshot.body!.customBlocks = [
            { blockId: 'picture', startIndex: snapshot.body!.dataStream.indexOf('\b') },
          ];
          snapshot.drawingsOrder = ['picture'];
          // The independent native source measurement has a 66.667px Modern
          // margin and two 35.4px blank paragraph advances. PAGE 137.467 and
          // MARGIN 70.8 therefore coincide with this ordinary paragraph anchor.
          // No caption, paragraph, space or other visible content is invented.
          snapshot.drawings = {
            picture: {
              drawingId: 'picture',
              unitId: snapshot.id,
              subUnitId: snapshot.id,
              drawingType: 0,
              source: image.source,
              layoutType,
              docTransform: {
                size: { width: 90, height: 70 },
                angle: 0,
                positionH: { relativeFrom: 0, posOffset: 80 },
                positionV: reference
                  ? { relativeFrom: ObjectRelativeFromV.PARAGRAPH, posOffset: blanks ? 0 : 70.8 }
                  : {
                      relativeFrom,
                      posOffset:
                        relativeFrom === ObjectRelativeFromV.PAGE ? 137.46666666666667 : 70.8,
                    },
              },
            },
          } as typeof snapshot.drawings;
          const input = await docInput(snapshot);
          input.images = [image];
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
    outputs.push(await retainDocPdf(`fixed-blank-${index}`, result.bytes!));
    expect(inputs[index].snapshot).toEqual(originals[index]);
  }
  for (let index = 0; index < inputs.length; index += 2) {
    const [actual] = outputs[index],
      [reference] = outputs[index + 1];
    expect(compact(actual.text)).toBe('RETAINEDHEADER');
    let difference = 0,
      colored = 0;
    for (let pixel = 0; pixel < actual.pixels.length; pixel++)
      difference = Math.max(difference, Math.abs(actual.pixels[pixel] - reference.pixels[pixel]));
    for (let at = 0; at < actual.pixels.length; at += 4)
      if (actual.pixels[at] > 150 && actual.pixels[at + 1] < 80 && actual.pixels[at + 2] < 80)
        colored++;
    expect(
      difference,
      `${index}: independent native blank-paragraph reference`,
    ).toBeLessThanOrEqual(5);
    expect(colored, `${index}: complete image`).toBeGreaterThan(3_400);
    expect(colored).toBeLessThan(3_650);
  }
}, 60_000);
