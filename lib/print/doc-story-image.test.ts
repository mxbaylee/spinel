import { expect, test } from 'vitest';
import type { IDocDrawingBase, IDocumentData } from '@univerjs/core';
import { PRINT_LIMITS, PrintError } from './contract.ts';
import { prepareDocSnapshot } from './doc-preparation.ts';

function fixture(): IDocumentData {
  const drawing = {
    drawingId: 'logo',
    unitId: 'source',
    subUnitId: 'source',
    drawingType: 0,
    source: 'authorized-logo',
    layoutType: 0,
    isMultiTransform: 1 as const,
    transform: { left: 400, top: 1_000, width: 100, height: 50 },
    transforms: [{ left: 400, top: 1_000, width: 100, height: 50 }],
    opacity: 0.6,
    srcRect: { left: 2, right: 3, top: 4, bottom: 5 },
    docTransform: {
      size: { width: 100, height: 50 },
      angle: 30,
      flipX: true,
      flipY: false,
      positionH: { relativeFrom: 0, posOffset: 0 },
      positionV: { relativeFrom: 1, posOffset: 0 },
    },
  } satisfies IDocDrawingBase & Record<string, unknown>;
  return {
    id: 'source',
    documentStyle: { defaultHeaderId: 'header' },
    body: { dataStream: 'Body\r\n', paragraphs: [{ startIndex: 4, paragraphId: 'body' }] },
    headers: {
      header: {
        headerId: 'header',
        body: {
          dataStream: '\b\r\n',
          paragraphs: [{ startIndex: 1, paragraphId: 'header' }],
          customBlocks: [{ startIndex: 0, blockId: 'logo' }],
        },
      },
    },
    drawings: { logo: drawing },
    drawingsOrder: [],
    headerFooterDrawingsOrder: ['logo'],
  };
}

test('header presentation caches normalize without changing authoritative image appearance or caller data', () => {
  const source = fixture();
  const original = structuredClone(source);
  const prepared = prepareDocSnapshot(source, [], PRINT_LIMITS, () => {});
  expect(prepared.imageSources).toEqual(['authorized-logo']);
  const drawing = prepared.snapshot.drawings!.logo;
  expect(drawing.isMultiTransform).toBeUndefined();
  expect(drawing.transforms).toBeUndefined();
  expect(drawing).toMatchObject({
    docTransform: original.drawings!.logo.docTransform,
    opacity: 0.6,
    srcRect: { left: 2, right: 3, top: 4, bottom: 5 },
    source: 'authorized-logo',
  });
  expect(prepared.snapshot.headerFooterDrawingsOrder).toEqual(['logo']);
  expect(source).toEqual(original);
});

test('story cache admission does not admit transformed groups or body multi-transform images', () => {
  const skewed = fixture();
  skewed.drawings!.logo.transforms![0].skewX = 10;
  const grouped = fixture();
  grouped.drawings!.logo.groupId = 'group';
  const body = fixture();
  body.body = body.headers!.header.body;
  delete body.headers;
  delete body.documentStyle.defaultHeaderId;
  delete body.headerFooterDrawingsOrder;
  body.drawingsOrder = ['logo'];
  for (const source of [skewed, grouped, body]) {
    try {
      prepareDocSnapshot(source, [], PRINT_LIMITS, () => {});
      throw new Error('Expected unsupported image model.');
    } catch (error) {
      expect(error).toBeInstanceOf(PrintError);
      expect(error).toMatchObject({ code: 'unsupported' });
    }
  }
});
