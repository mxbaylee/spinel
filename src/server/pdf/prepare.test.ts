import { expect, test, vi } from 'vitest';
import { getDocsEmptySnapshot, ImageSourceType, LocaleType } from '@univerjs/core';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { inspectPdfSnapshot, preparePdfSnapshot } from './prepare.ts';
import { PDF_LIMITS, PdfError } from './limits.ts';

const itemId = 'current-document';
const imageId = 'a'.repeat(64);
const imagePath = `/api/items/${itemId}/images/${imageId}`;
const readImage = () => ({ mime: 'image/png', data: new Uint8Array([1, 2, 3]) });
function doc(): IDocumentData {
  return { id: itemId, documentStyle: {}, body: { dataStream: 'Content\r\n' } };
}
function book(): IWorkbookData {
  return {
    id: itemId,
    name: 'Book',
    locale: LocaleType.EN_US,
    appVersion: '1.1.0',
    sheetOrder: ['one', 'two', 'hidden'],
    styles: {},
    sheets: Object.fromEntries(
      ['one', 'two', 'hidden'].map((id) => [
        id,
        {
          id,
          name: id,
          rowCount: 10,
          columnCount: 3,
          cellData: {},
          hidden: id === 'hidden' ? (1 as const) : (0 as const),
          backgroundImage: {
            imageSourceType: ImageSourceType.URL,
            source: id === 'one' ? imagePath : 'https://unprepared.invalid/image',
          },
        },
      ]),
    ),
  };
}

test('owns authorized image bytes, deduplicates native mirrors and never mutates the saved document', () => {
  const snapshot = doc();
  const drawing = { source: imagePath, drawingId: 'picture' } as unknown as NonNullable<
    IDocumentData['drawings']
  >[string];
  snapshot.drawings = { picture: drawing };
  snapshot.drawingsOrder = ['picture'];
  snapshot.resources = [
    {
      name: 'DOC_DRAWING_PLUGIN',
      data: JSON.stringify({ data: snapshot.drawings, order: ['picture'] }),
    },
  ];
  const stored = new Uint8Array([1, 2, 3]);
  const read = vi.fn(() => ({ mime: 'image/png', data: stored }));
  const before = structuredClone(snapshot);
  const prepared = preparePdfSnapshot('doc', itemId, snapshot, { readImage: read });
  expect(read).toHaveBeenCalledExactlyOnceWith(imageId);
  expect(prepared.imageIds).toEqual([imageId]);
  expect(prepared.images).toEqual([{ source: imagePath, bytes: stored }]);
  stored[0] = 9;
  expect(prepared.images[0].bytes[0]).toBe(1);
  expect(prepared.snapshot.drawings).toEqual(before.drawings);
  expect(prepared.snapshot.resources).toBeUndefined();
  expect(snapshot).toEqual(before);
});

test('rejects cross-item, remote, file and embedded references before attempting any image read', () => {
  for (const source of [
    `/api/items/other-document/images/${imageId}`,
    'https://example.invalid/private',
    '/etc/passwd',
    'file:///etc/passwd',
    'data:image/png;base64,AAAA',
    `${imagePath}?session=secret`,
  ]) {
    const snapshot = doc();
    snapshot.drawings = { picture: { source } } as unknown as IDocumentData['drawings'];
    const read = vi.fn(readImage);
    expect(() => preparePdfSnapshot('doc', itemId, snapshot, { readImage: read })).toThrow(
      PdfError,
    );
    expect(read).not.toHaveBeenCalled();
  }
});

test('selected visible worksheet images are the only sources prepared', () => {
  const source = book();
  const read = vi.fn(readImage);
  const prepared = preparePdfSnapshot('sheet', itemId, source, {
    readImage: read,
    worksheetIds: ['one'],
  });
  expect(prepared.imageIds).toEqual([imageId]);
  expect(prepared.snapshot.sheetOrder).toEqual(source.sheetOrder);
  expect(read).toHaveBeenCalledTimes(1);
  for (const worksheetIds of [[], ['hidden'], ['unknown'], ['one', 'one']])
    expect(() => preparePdfSnapshot('sheet', itemId, source, { readImage, worksheetIds })).toThrow(
      PdfError,
    );
});

test('normalizes the standard modern editor canvas and redundant links without losing content', () => {
  const snapshot = getDocsEmptySnapshot(itemId);
  snapshot.body!.dataStream = 'Reference\r\n';
  snapshot.body!.customRanges = [
    {
      rangeId: 'link',
      rangeType: 0,
      startIndex: 0,
      endIndex: 8,
      properties: { url: 'https://example.com/account/private' },
    },
  ];
  snapshot.resources = [
    {
      name: 'DOC_HYPER_LINK_PLUGIN',
      data: JSON.stringify({
        links: [{ id: 'link', payload: 'https://example.com/account/private' }],
      }),
    },
    { name: 'DOC_DRAWING_PLUGIN', data: '{"data":{},"order":[]}' },
    { name: 'EMPTY', data: '' },
  ];
  const prepared = preparePdfSnapshot('doc', itemId, snapshot, { readImage }).snapshot;
  expect(prepared.body).toEqual(snapshot.body);
  expect(prepared.documentStyle.renderConfig).toBeUndefined();
  expect(prepared.documentStyle.pageSize).toEqual(snapshot.documentStyle.pageSize);
  expect(prepared.resources).toBeUndefined();
  expect(snapshot.documentStyle.renderConfig).toBeDefined();
});

test('header and footer resources preserve links and prepare only this document’s images', () => {
  const snapshot = doc();
  const drawing = {
    source: imagePath,
    drawingId: 'picture',
    unitId: itemId,
    subUnitId: itemId,
    drawingType: 0,
    layoutType: 0,
    docTransform: {
      angle: 0,
      size: { width: 10, height: 10 },
      positionH: { relativeFrom: 0, posOffset: 0 },
      positionV: { relativeFrom: 0, posOffset: 0 },
    },
  };
  snapshot.headers = {
    header: {
      headerId: 'header',
      body: {
        dataStream: 'Header\r\n',
        customRanges: [{ rangeId: 'header-link', rangeType: 0, startIndex: 0, endIndex: 5 }],
      },
      drawings: { picture: drawing },
      drawingsOrder: ['picture'],
    },
  };
  snapshot.footers = {
    footer: {
      footerId: 'footer',
      body: {
        dataStream: 'Footer\r\n',
        customRanges: [{ rangeId: 'footer-link', rangeType: 0, startIndex: 0, endIndex: 5 }],
      },
    },
  };
  snapshot.resources = [
    {
      name: 'DOC_HYPER_LINK_PLUGIN',
      data: JSON.stringify({
        links: [
          { id: 'header-link', payload: 'https://example.com/private-header' },
          { id: 'footer-link', payload: 'https://example.com/private-footer' },
        ],
      }),
    },
  ];
  const read = vi.fn(readImage);
  const prepared = preparePdfSnapshot('doc', itemId, snapshot, { readImage: read });
  expect(read).toHaveBeenCalledExactlyOnceWith(imageId);
  expect(prepared.snapshot.headers).toEqual(snapshot.headers);
  expect(prepared.snapshot.footers).toEqual(snapshot.footers);
  expect(prepared.snapshot.resources).toBeUndefined();
  expect(prepared.imageIds).toEqual([imageId]);
  drawing.source = 'https://unprepared.invalid/header-image';
  expect(() => preparePdfSnapshot('doc', itemId, snapshot, { readImage: read })).toThrow(PdfError);
  expect(read).toHaveBeenCalledOnce();
});

test('conflicting drawing mirrors, malformed known resources and unknown appearance fail explicitly', () => {
  const snapshot = doc();
  snapshot.drawings = { picture: { source: imagePath } } as unknown as IDocumentData['drawings'];
  snapshot.resources = [{ name: 'DOC_DRAWING_PLUGIN', data: '{"data":{},"order":[]}' }];
  expect(() => preparePdfSnapshot('doc', itemId, snapshot, { readImage })).toThrow(PdfError);
  for (const resources of [
    [{ name: 'CUSTOM_APPEARANCE', data: '{"visible":"private"}' }],
    [{ name: 'DOC_HYPER_LINK_PLUGIN', data: '{"links":[{"id":"unknown","payload":"private"}]}' }],
    [{ name: 'DOC_DRAWING_PLUGIN', data: '{"data":[]}' }],
    [
      { name: 'EMPTY', data: '{}' },
      { name: 'EMPTY', data: '{}' },
    ],
    [{ name: 'EMPTY', data: '{invalid-json}' }],
  ]) {
    expect(() => preparePdfSnapshot('doc', itemId, { ...doc(), resources }, { readImage })).toThrow(
      PdfError,
    );
  }
});

test('snapshot and image limits reject whole preparations without evaluating getters', () => {
  const snapshot = doc();
  const getter = vi.fn(() => 'private');
  Object.defineProperty(snapshot, 'title', { get: getter, enumerable: true });
  expect(() => inspectPdfSnapshot(snapshot)).toThrow(PdfError);
  expect(getter).not.toHaveBeenCalled();
  expect(() => inspectPdfSnapshot({ text: 'x'.repeat(PDF_LIMITS.snapshotBytes + 1) })).toThrow(
    PdfError,
  );
  const withImage = doc();
  withImage.drawings = { picture: { source: imagePath } } as unknown as IDocumentData['drawings'];
  expect(() =>
    preparePdfSnapshot('doc', itemId, withImage, {
      readImage: () => ({
        mime: 'image/png',
        data: new Uint8Array(PDF_LIMITS.encodedImageBytes + 1),
      }),
    }),
  ).toThrow(PdfError);
});
