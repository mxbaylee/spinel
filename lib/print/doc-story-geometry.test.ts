import { createCanvas } from '@napi-rs/canvas';
import {
  DocumentFlavor,
  ObjectRelativeFromH,
  ObjectRelativeFromV,
  PositionedObjectLayoutType,
} from '@univerjs/core';
import type { IDocumentData } from '@univerjs/core';
import { expect, test, vi } from 'vitest';
import { PRINT_LIMITS } from './contract.ts';
import { prepareDocSnapshot } from './doc-preparation.ts';
import { docStories } from './doc-stories.ts';
import { inspectSnapshot } from './preflight.ts';
import { docInput, retainDocPdf, runDocJobs, textDoc } from './doc-native-test-support.ts';

function fixture(independent = false): IDocumentData {
  const snapshot = textDoc(['BODY-FIRST', 'BODY-SECOND'], {
    documentFlavor: DocumentFlavor.TRADITIONAL,
    pageSize: { width: 600, height: 420 },
    defaultHeaderId: 'header',
  });
  snapshot.body!.dataStream = 'BODY-FIRST\r\nBODY-SECOND\r\n';
  snapshot.body!.paragraphs = [
    { startIndex: 10, paragraphId: 'first' },
    { startIndex: 23, paragraphId: 'second' },
  ];
  snapshot.body!.sectionBreaks = [
    { startIndex: 11, sectionId: 'first', marginLeft: 40, marginRight: 40, marginHeader: 10 },
    {
      startIndex: 24,
      sectionId: 'second',
      marginLeft: 140,
      marginRight: 140,
      marginHeader: 20,
      ...(independent ? { defaultHeaderId: 'second-header' } : {}),
    },
  ];
  const header = textDoc(['\b', 'HEADER-AFTER']).body!;
  header.customBlocks = [{ startIndex: 0, blockId: 'logo' }];
  snapshot.headers = { header: { headerId: 'header', body: header } };
  snapshot.drawings = {
    logo: {
      drawingId: 'logo',
      unitId: snapshot.id,
      subUnitId: snapshot.id,
      drawingType: 0,
      source: 'shared-header-image',
      layoutType: PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM,
      docTransform: {
        size: { width: 100, height: 90 },
        angle: 0,
        positionH: { relativeFrom: ObjectRelativeFromH.COLUMN, posOffset: 0 },
        positionV: { relativeFrom: ObjectRelativeFromV.PARAGRAPH, posOffset: 0 },
      },
    },
  } as IDocumentData['drawings'];
  snapshot.drawingsOrder = [];
  snapshot.headerFooterDrawingsOrder = ['logo'];
  if (independent) {
    const second = structuredClone(header);
    second.customBlocks![0].blockId = 'second-logo';
    snapshot.headers['second-header'] = { headerId: 'second-header', body: second };
    snapshot.drawings!['second-logo'] = {
      ...structuredClone(snapshot.drawings!.logo),
      drawingId: 'second-logo',
    };
    snapshot.headerFooterDrawingsOrder.push('second-logo');
  }
  return snapshot;
}

test('geometry copies own image identities and charge additional story work before copying', () => {
  const source = fixture();
  const before = structuredClone(source);
  const prepared = prepareDocSnapshot(source, [], PRINT_LIMITS, () => {});
  const headers = Object.values(prepared.snapshot.headers!);
  const ids = headers.map((header) => header.body.customBlocks![0].blockId);
  expect(headers).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
  expect(prepared.imageSources).toEqual(['shared-header-image']);
  expect(prepared.snapshot.headerFooterDrawingsOrder).toEqual(ids);
  expect(prepared.snapshot.drawings![ids[0]].docTransform).not.toBe(
    prepared.snapshot.drawings![ids[1]].docTransform,
  );
  expect(prepared.snapshot.drawings![ids[0]].docTransform).toEqual(
    prepared.snapshot.drawings![ids[1]].docTransform,
  );
  expect(source).toEqual(before);
  // The authored model has one image. Its additional geometry view must consume
  // the same bounded projection budget before the duplicated story is allocated.
  expect(() => prepareDocSnapshot(source, [], { ...PRINT_LIMITS, images: 1 }, () => {})).toThrow(
    'stories exceed',
  );
  const characters = source.body!.dataStream.length + source.headers!.header.body.dataStream.length;
  expect(() =>
    prepareDocSnapshot(source, [], { ...PRINT_LIMITS, textCharacters: characters }, () => {}),
  ).toThrow('stories exceed');
  const copied = fixture(true);
  copied.headers!['second-header'].body.customBlocks![0].blockId = 'logo';
  delete copied.drawings!['second-logo'];
  copied.headerFooterDrawingsOrder = ['logo'];
  const separate = prepareDocSnapshot(copied, [], PRINT_LIMITS, () => {});
  expect(
    new Set(
      Object.values(separate.snapshot.headers!).map(
        (header) => header.body.customBlocks![0].blockId,
      ),
    ).size,
  ).toBe(2);
  expect(separate.imageSources).toEqual(['shared-header-image']);
});

test('shared style banks are admitted against all projected stories before any style payload is copied', () => {
  const source = fixture(true);
  source.styles = { unused: { name: 'x'.repeat(4_000), type: 0 } };
  const limits = { ...PRINT_LIMITS, snapshotBytes: 12_000 };
  expect(() => inspectSnapshot(source, limits, () => {})).not.toThrow();
  const clone = vi.spyOn(globalThis, 'structuredClone');
  try {
    expect(() => docStories(source, true, limits)).toThrow('byte budget');
    expect(clone).not.toHaveBeenCalled();
  } finally {
    clone.mockRestore();
  }
});

test('reused image-only headers reserve the complete image independently in each section geometry', async () => {
  const canvas = createCanvas(10, 9);
  const context = canvas.getContext('2d');
  context.fillStyle = '#2040d0';
  context.fillRect(0, 0, 10, 9);
  const bytes = await canvas.encode('png');
  const inputs = await Promise.all([fixture(), fixture(true)].map(docInput));
  for (const input of inputs) input.images = [{ source: 'shared-header-image', bytes }];
  const before = inputs.map((input) => structuredClone(input.snapshot));
  const results = await runDocJobs(inputs.map((input) => ({ input })));
  const outputs: Awaited<ReturnType<typeof retainDocPdf>>[] = [];
  for (const [index, result] of results.entries()) {
    expect(
      result,
      JSON.stringify(result, (key, value) => (key === 'bytes' ? '<bytes>' : value)),
    ).toMatchObject({ ok: true, pages: 2, restored: true, remainingFonts: 0 });
    const pages = await retainDocPdf(`header-image-section-geometry-${index}`, result.bytes!);
    outputs.push(pages);
    for (const [pageIndex, page] of pages.entries()) {
      expect(page.text).toContain(`BODY-${pageIndex ? 'SECOND' : 'FIRST'}`);
      expect(page.text.split('HEADER-AFTER')).toHaveLength(2);
      let blue = 0;
      let bottom = 0;
      let left = page.width;
      for (let y = 0; y < page.height; y++)
        for (let x = 0; x < page.width; x++) {
          const offset = (y * page.width + x) * 4;
          if (
            page.pixels[offset] < 80 &&
            page.pixels[offset + 1] < 100 &&
            page.pixels[offset + 2] > 150
          ) {
            blue++;
            bottom = Math.max(bottom, y);
            left = Math.min(left, x);
          }
        }
      expect(Math.abs(blue - 100 * 90 * 0.75 ** 2)).toBeLessThan(100);
      expect(left).toBeCloseTo((pageIndex ? 140 : 40) * 0.75, 0);
      const after = page.items.find((item) => item.str.includes('HEADER-AFTER'))!;
      expect(page.height - after.transform[5] - after.height).toBeGreaterThan(bottom);
      const body = page.items.find((item) => item.str.includes('BODY-'))!;
      expect(body.transform[5]).toBeLessThan(after.transform[5] - after.height);
    }
  }
  for (const [index, page] of outputs[0].entries())
    expect(Buffer.from(page.pixels).equals(Buffer.from(outputs[1][index].pixels))).toBe(true);
  expect(inputs.map((input) => input.snapshot)).toEqual(before);
}, 60_000);
