import { createCanvas } from '@napi-rs/canvas';
import { CustomRangeType, DocumentFlavor, PositionedObjectLayoutType } from '@univerjs/core';
import { expect, test, vi } from 'vitest';
import { PRINT_LIMITS } from './contract.ts';
import { appendFloatingDocPages } from './doc-floating-pages.ts';
import { docInput, retainDocPdf, runDocJobs, textDoc } from './doc-native-test-support.ts';

const summary = (value: unknown) =>
  JSON.stringify(value, (key, item) => (key === 'bytes' ? '<bytes>' : item));

function footer() {
  const body = textDoc(['Page \x1f88\x1e of \x1f88\x1e']).body!;
  const first = body.dataStream.indexOf('\x1f');
  const second = body.dataStream.indexOf('\x1f', first + 1);
  body.customRanges = [first, second].map((startIndex, index) => ({
    rangeId: `page-${index}`,
    rangeType: CustomRangeType.FIELD,
    wholeEntity: false,
    startIndex,
    endIndex: body.dataStream.indexOf('\x1e', startIndex),
    properties: { fieldType: index ? 'NUMPAGES' : 'PAGE' },
  }));
  return body;
}

test('floating page projection charges all prepared story characters before copying', () => {
  const snapshot = textDoc(['BODY']);
  snapshot.headers = { header: { headerId: 'header', body: textDoc(['HEADER']).body! } };
  snapshot.footers = { footer: { footerId: 'footer', body: textDoc(['FOOTER']).body! } };
  const characters =
    snapshot.body!.dataStream.length +
    snapshot.headers.header.body.dataStream.length +
    snapshot.footers.footer.body.dataStream.length;
  const clone = vi.spyOn(globalThis, 'structuredClone');
  try {
    expect(() =>
      appendFloatingDocPages(
        snapshot,
        1,
        { ...PRINT_LIMITS, textCharacters: characters + 1 },
        () => {},
      ),
    ).toThrow('character budget');
    expect(clone).not.toHaveBeenCalled();
  } finally {
    clone.mockRestore();
  }
});

test('authored nonwrapping images continue through physical bodies without moving text or losing front/behind order', async () => {
  const colors = [
    [190, 30, 50],
    [30, 150, 80],
    [40, 80, 190],
  ];
  const canvas = createCanvas(48, 500),
    context = canvas.getContext('2d');
  for (const [index, color] of colors.entries()) {
    context.fillStyle = `rgb(${color.join(',')})`;
    context.fillRect(0, (index * 500) / 3, 48, 500 / 3 + 1);
  }
  const bytes = await canvas.encode('png');
  const variants = [
    { columns: false, behind: false, long: false },
    { columns: false, behind: true, long: false },
    { columns: true, behind: false, long: false },
    { columns: true, behind: true, long: false },
    { columns: true, behind: true, long: true },
  ];
  const inputs = await Promise.all(
    variants.map(async ({ columns, behind, long }) => {
      const snapshot = textDoc(
        [
          'BEFORE',
          '\b',
          'AFTER',
          ...(long
            ? Array.from({ length: 30 }, (_, i) => `BODY${String(i).padStart(2, '0')}`)
            : []),
        ],
        {
          documentFlavor: DocumentFlavor.TRADITIONAL,
          pageSize: { width: 600, height: 400 },
          marginHeader: 10,
          marginFooter: 10,
          defaultHeaderId: 'header',
          firstPageHeaderId: 'first',
          evenPageHeaderId: 'even',
          useFirstPageHeaderFooter: 1,
          evenAndOddHeaders: 1,
          defaultFooterId: 'footer',
          firstPageFooterId: 'footer',
          evenPageFooterId: 'footer',
        },
      );
      snapshot.headers = {
        header: { headerId: 'header', body: textDoc(['HEADER']).body! },
        first: {
          headerId: 'first',
          body: textDoc(['FIRST ONE', 'FIRST TWO', 'FIRST THREE']).body!,
        },
        even: { headerId: 'even', body: textDoc(['EVEN ONE', 'EVEN TWO']).body! },
      };
      snapshot.footers = { footer: { footerId: 'footer', body: footer() } };
      if (columns)
        snapshot.body!.sectionBreaks = [
          {
            sectionId: 'columns',
            startIndex: snapshot.body!.dataStream.length - 1,
            useFirstPageHeaderFooter: 1,
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
          layoutType: PositionedObjectLayoutType.WRAP_NONE,
          behindDoc: behind ? 1 : 0,
          // The long-body case leaves the image beside its text for a full-area
          // proof. The four short cases deliberately overlap AFTER to prove layers.
          docTransform: {
            size: { width: 48, height: 500 },
            positionH: { relativeFrom: 0, posOffset: long ? 200 : 60 },
            positionV: { relativeFrom: 1, posOffset: 0 },
            angle: 0,
          },
        },
      } as typeof snapshot.drawings;
      const input = await docInput(snapshot);
      input.images = [{ source: 'authorized-image', bytes }];
      return input;
    }),
  );
  const originals = inputs.map((input) => structuredClone(input.snapshot));
  const references = inputs.map((input) => {
    const snapshot = structuredClone(input.snapshot);
    snapshot.drawings!.image.hidden = true;
    return { ...input, snapshot, images: [] };
  });
  const results = await runDocJobs([
    { input: inputs[0], options: { limits: { pages: 1 } } },
    ...inputs.map((input) => ({ input })),
    ...references.map((input) => ({ input })),
  ]);
  expect(results[0]).toMatchObject({ ok: false, code: 'limit', restored: true, remainingFonts: 0 });
  expect(results[0].bytes).toBeUndefined();
  for (const [index, variant] of variants.entries()) {
    const result = results[index + 1],
      reference = results[index + 1 + inputs.length];
    expect(result, summary(result)).toMatchObject({ ok: true, restored: true, remainingFonts: 0 });
    expect(reference, summary(reference)).toMatchObject({ ok: true });
    const pages = await retainDocPdf(`nonwrapping-physical-${index}`, result.bytes!);
    const body = await retainDocPdf(`nonwrapping-body-reference-${index}`, reference.bytes!);
    expect(pages).toHaveLength(2);
    if (variant.long) expect(pages).toHaveLength(body.length);
    const bodyItems = (page: (typeof pages)[number]) =>
      page.items
        .filter((item) => /^(BEFORE|AFTER|BODY)/.test(item.str))
        .map((item) => ({
          str: item.str,
          transform: item.transform,
          width: item.width,
          height: item.height,
        }));
    for (const [pageIndex, original] of body.entries())
      expect(bodyItems(pages[pageIndex])).toEqual(bodyItems(original));
    const counts = colors.map(() => 0);
    for (const [pageIndex, page] of pages.entries()) {
      expect(page.text.replace(/\s+/gu, '')).toContain(`Page${pageIndex + 1}of${pages.length}`);
      expect(page.text).toContain(pageIndex ? 'EVEN TWO' : 'FIRST THREE');
      const header = page.items.filter((item) => item.str.startsWith(pageIndex ? 'EVEN' : 'FIRST'));
      const footer = page.items.find((item) => item.str.includes('Page'))!;
      let painted = 0;
      let first = Infinity,
        last = -Infinity;
      for (let offset = 0; offset < page.pixels.length; offset += 4) {
        const color = colors.findIndex((color) =>
          color.every((value, channel) => Math.abs(page.pixels[offset + channel] - value) < 2),
        );
        if (color < 0) continue;
        counts[color]++;
        painted++;
        const y = Math.floor(offset / 4 / page.width);
        first = Math.min(first, y);
        last = Math.max(last, y);
      }
      expect(painted).toBeGreaterThan(0);
      expect(first).toBeGreaterThan(
        page.height - Math.min(...header.map((item) => item.transform[5])),
      );
      expect(last).toBeLessThan(page.height - footer.transform[5] - footer.height);
    }
    for (const count of counts) {
      const expected = ((48 * 500) / 3) * 0.75 ** 2;
      expect(count).toBeGreaterThan(expected * 0.94);
      expect(count).toBeLessThan(expected * 1.03);
    }
    const page = pages[0],
      after = page.items.find((item) => item.str === 'AFTER')!;
    let black = 0;
    for (
      let y = Math.ceil(page.height - after.transform[5] - after.height);
      y < Math.floor(page.height - after.transform[5]);
      y++
    )
      for (let x = 46; x < Math.min(80, after.transform[4] + after.width); x++) {
        const offset = (y * page.width + x) * 4;
        if ([0, 1, 2].every((channel) => page.pixels[offset + channel] < 60)) black++;
      }
    if (!variant.long) {
      if (variant.behind) expect(black).toBeGreaterThan(10);
      else expect(black).toBe(0);
    }
  }
  expect(inputs.map((input) => input.snapshot)).toEqual(originals);
}, 60_000);

test('appended floating-image pages preserve inherited terminal spacing, borders and page-break defaults', async () => {
  const canvas = createCanvas(32, 500);
  const context = canvas.getContext('2d');
  context.fillStyle = '#2a80b0';
  context.fillRect(0, 0, 32, 500);
  const bytes = await canvas.encode('png');
  const inputs = [];
  for (const bordered of [false, true]) {
    const snapshot = textDoc(['BEFORE', '\b', 'AUTHORED-TAIL'], {
      documentFlavor: DocumentFlavor.TRADITIONAL,
      pageSize: { width: 600, height: 500 },
      defaultHeaderId: 'header',
      marginHeader: 10,
      defaultParagraphStyle: bordered
        ? {
            contextualSpacing: 1,
            spaceBelow: { v: 37, u: 3 },
            borderBottom: { color: { rgb: '#352050' }, width: 3, padding: 9, dashStyle: 1 },
            borderBetween: { color: { rgb: '#352050' }, width: 1, padding: 2, dashStyle: 1 },
          }
        : { pageBreakBefore: 1 },
    });
    for (const paragraph of snapshot.body!.paragraphs!)
      paragraph.paragraphStyle = { pageBreakBefore: 0 };
    const header = textDoc(['HEADER']).body!;
    header.paragraphs![0].paragraphStyle = { pageBreakBefore: 0 };
    snapshot.headers = { header: { headerId: 'header', body: header } };
    snapshot.body!.customBlocks = [
      {
        startIndex: snapshot.body!.dataStream.indexOf('\b'),
        blockId: 'image',
      },
    ];
    snapshot.drawingsOrder = ['image'];
    snapshot.drawings = {
      image: {
        drawingId: 'image',
        unitId: snapshot.id,
        subUnitId: snapshot.id,
        drawingType: 0,
        source: 'authorized-image',
        layoutType: PositionedObjectLayoutType.WRAP_NONE,
        docTransform: {
          size: { width: 32, height: 500 },
          positionH: { relativeFrom: 0, posOffset: 200 },
          positionV: { relativeFrom: 1, posOffset: 0 },
          angle: 0,
        },
      },
    } as typeof snapshot.drawings;
    const input = await docInput(snapshot);
    input.images = [{ source: 'authorized-image', bytes }];
    inputs.push(input);
    const reference = structuredClone(snapshot);
    reference.drawings!.image.hidden = true;
    inputs.push({ ...input, snapshot: reference, images: [] });
  }
  const original = inputs.map((input) => structuredClone(input.snapshot));
  const results = await runDocJobs(inputs.map((input) => ({ input })));
  const outputs = [];
  for (const [index, result] of results.entries()) {
    expect(result, summary(result)).toMatchObject({ ok: true, restored: true, remainingFonts: 0 });
    outputs.push(await retainDocPdf(`nonwrapping-default-style-${index}`, result.bytes!));
  }
  for (let index = 0; index < outputs.length; index += 2) {
    const pages = outputs[index],
      reference = outputs[index + 1];
    expect(reference).toHaveLength(1);
    expect(pages).toHaveLength(2);
    const visibleText = (page: (typeof pages)[number]) =>
      page.items
        .filter((item) => item.str.length > 0)
        .map(({ str, dir, transform, width, height }) => ({ str, dir, transform, width, height }));
    expect(visibleText(pages[0])).toEqual(visibleText(reference[0]));
    let difference = 0;
    for (let y = 0; y < pages[0].height; y++)
      for (let x = 0; x < pages[0].width; x++) {
        // The saved overlay alone may cover original ink. Every other source
        // pixel, including the terminal bottom border, remains the native oracle.
        if (x >= 149 && x <= 175) continue;
        const pixel = (y * pages[0].width + x) * 4;
        for (let channel = 0; channel < 4; channel++)
          difference = Math.max(
            difference,
            Math.abs(pages[0].pixels[pixel + channel] - reference[0].pixels[pixel + channel]),
          );
      }
    expect(difference, `Unchanged authored pixels for variant ${index / 2}`).toBe(0);
  }
  const limited = await runDocJobs([{ input: inputs[0], options: { limits: { pages: 2 } } }]);
  expect(limited[0], summary(limited[0])).toMatchObject({ ok: true, pages: 2, restored: true });
  expect(inputs.map((input) => input.snapshot)).toEqual(original);
}, 60_000);
