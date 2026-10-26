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

// Shapes captured from the public collaboration snapshot endpoint after loading
// ordinary documents with no embedded, pivot or external-reference content.
function capturedDocResources(): NonNullable<IDocumentData['resources']> {
  return [
    { name: 'UNIVER_EMBED_RESOURCE_PLUGIN', data: '{"version":1,"embeds":{}}' },
    { name: 'DOC_HYPER_LINK_PLUGIN', data: '{"links":[]}' },
    { name: 'DOC_OBJECT_PERMISSION_PLUGIN', data: '[]' },
    { name: 'DOC_WORD_STYLES_PLUGIN', data: '' },
    { name: 'DOC_NOTE_PLUGIN', data: '' },
    { name: 'DOC_DRAWING_PLUGIN', data: '{"data":{},"order":[]}' },
    { name: 'DOC_CALLOUT_PLUGIN', data: '{"callouts":{}}' },
    { name: 'DOC_CHART_PLUGIN', data: '{"dataSources":{},"charts":{}}' },
    { name: 'DOC_CODE_PLUGIN', data: '{"codes":{}}' },
    { name: 'DOC_LATEX_PLUGIN', data: '{"formulas":{}}' },
    { name: 'DOC_SHAPE_PLUGIN', data: '[]' },
    { name: 'DOC_TABLE_PLUGIN', data: '{"tables":{}}' },
    { name: 'DOC_UNIVER_THREAD_COMMENT_PLUGIN', data: '{}' },
    { name: 'UNIVER_EXTERNAL_REFERENCE_PLUGIN', data: '{"schemaVersion":1,"references":{}}' },
  ];
}

function capturedSheetResources(id: string): NonNullable<IWorkbookData['resources']> {
  return [
    { name: 'UNIVER_EMBED_RESOURCE_PLUGIN', data: '{"version":1,"embeds":{}}' },
    { name: 'SHEET_RANGE_PROTECTION_PLUGIN', data: '' },
    { name: 'SHEET_AuthzIoMockService_PLUGIN', data: '{}' },
    { name: 'SHEET_SPARKLINE_PLUGIN', data: '{}' },
    { name: 'SHEET_WORKSHEET_PROTECTION_PLUGIN', data: '{}' },
    { name: 'SHEET_WORKSHEET_PROTECTION_POINT_PLUGIN', data: '{}' },
    { name: 'SHEET_CONDITIONAL_FORMATTING_PLUGIN', data: '' },
    {
      name: 'SHEET_PIVOT_TABLE_PLUGIN',
      data: JSON.stringify({
        dataFieldManagerConfig: { [id]: { collections: {}, dataFields: {} } },
        pivotTableConfigs: {},
        pivotCacheConfigs: { [id]: {} },
      }),
    },
    { name: 'SHEET_OUTLINE_PLUGIN', data: '{}' },
    { name: 'SHEET_DRAWING_PLUGIN', data: '{}' },
    { name: 'SHEET_CHART_PLUGIN', data: '{}' },
    { name: 'SHEET_NOTE_PLUGIN', data: '' },
    { name: 'SHEET_SHAPE_PLUGIN', data: '{}' },
    { name: 'SHEET_PIVOT_CHART_PLUGIN', data: '{"charts":{}}' },
    { name: 'SHEET_UNIVER_THREAD_COMMENT_PLUGIN', data: '{}' },
    { name: 'SHEET_EXTERNAL_DATA_PLUGIN', data: '{"schemaVersion":1,"links":[]}' },
    { name: 'UNIVER_EXTERNAL_REFERENCE_PLUGIN', data: '{"schemaVersion":1,"references":{}}' },
    { name: 'SHEET_DEFINED_NAME_PLUGIN', data: '' },
    { name: 'SHEET_RANGE_THEME_MODEL_PLUGIN', data: '{}' },
    { name: 'SHEET_DATA_VALIDATION_PLUGIN', data: '{}' },
    { name: 'SHEET_FILTER_PLUGIN', data: '{}' },
    { name: 'SHEET_TABLE_PLUGIN', data: '{}' },
  ];
}

function plainBook(): IWorkbookData {
  const snapshot = book();
  for (const sheet of Object.values(snapshot.sheets)) delete sheet.backgroundImage;
  return snapshot;
}

test('accepts the exact empty resource wrappers emitted by public Doc and Sheet snapshots', () => {
  const document = getDocsEmptySnapshot(itemId);
  document.body!.dataStream = 'Saved document content\r\n';
  document.resources = capturedDocResources();
  const workbook = plainBook();
  workbook.sheets.one.cellData = { 0: { 0: { v: 'Saved sheet content' }, 1: { f: '=20+22' } } };
  workbook.resources = capturedSheetResources(workbook.id);
  workbook.calculationSettings = {
    iterativeCalculation: false,
    maxChange: 0.001,
    maxIterations: 100,
  };
  const beforeDoc = structuredClone(document);
  const beforeSheet = structuredClone(workbook);
  const read = vi.fn(readImage);
  const preparedDoc = preparePdfSnapshot('doc', itemId, document, { readImage: read });
  const preparedSheet = preparePdfSnapshot('sheet', itemId, workbook, { readImage: read });
  expect(preparedDoc.snapshot.resources).toBeUndefined();
  expect(preparedSheet.snapshot.resources).toEqual([]);
  expect(preparedDoc.snapshot.body).toEqual(document.body);
  const expectedStyle = structuredClone(document.documentStyle);
  delete expectedStyle.renderConfig;
  expect(preparedDoc.snapshot.documentStyle).toEqual(expectedStyle);
  expect(preparedSheet.snapshot.sheets).toEqual(workbook.sheets);
  expect(preparedSheet.snapshot.calculationSettings).toEqual(workbook.calculationSettings);
  expect(document).toEqual(beforeDoc);
  expect(workbook).toEqual(beforeSheet);
  expect(read).not.toHaveBeenCalled();
});

test('known empty wrappers reject nonempty content, schema changes and unobserved fields', () => {
  const cases = [
    ['doc', 'UNIVER_EMBED_RESOURCE_PLUGIN', { version: 1, embeds: { visible: {} } }],
    ['sheet', 'UNIVER_EMBED_RESOURCE_PLUGIN', { version: 2, embeds: {} }],
    ['doc', 'DOC_CALLOUT_PLUGIN', { callouts: { visible: {} } }],
    ['doc', 'DOC_CHART_PLUGIN', { dataSources: { source: {} }, charts: {} }],
    ['doc', 'DOC_CHART_PLUGIN', { dataSources: {}, charts: { visible: {} } }],
    ['doc', 'DOC_CODE_PLUGIN', { codes: { visible: {} } }],
    ['doc', 'DOC_LATEX_PLUGIN', { formulas: { visible: {} } }],
    ['doc', 'DOC_TABLE_PLUGIN', { tables: { visible: {} } }],
    ['doc', 'DOC_TABLE_PLUGIN', { tables: {}, newAppearance: {} }],
    ['doc', 'DOC_CODE_PLUGIN', { codes: [] }],
    ['doc', 'UNIVER_EXTERNAL_REFERENCE_PLUGIN', { schemaVersion: 2, references: {} }],
    ['sheet', 'UNIVER_EXTERNAL_REFERENCE_PLUGIN', { schemaVersion: 1, references: { source: {} } }],
    ['sheet', 'SHEET_PIVOT_CHART_PLUGIN', { charts: { visible: {} } }],
    ['sheet', 'SHEET_EXTERNAL_DATA_PLUGIN', { schemaVersion: 1, links: [{}] }],
    ['sheet', 'SHEET_EXTERNAL_DATA_PLUGIN', { schemaVersion: 2, links: [] }],
    ['sheet', 'SHEET_EXTERNAL_DATA_PLUGIN', { schemaVersion: 1, links: [], appearance: {} }],
    ['sheet', 'SHEET_PIVOT_CHART_PLUGIN', {}],
  ] as const;
  const read = vi.fn(readImage);
  for (const [kind, name, data] of cases) {
    const snapshot = kind === 'doc' ? doc() : plainBook();
    snapshot.resources = [{ name, data: JSON.stringify(data) }];
    expect(() => preparePdfSnapshot(kind, itemId, snapshot, { readImage: read })).toThrow(PdfError);
  }
  expect(read).not.toHaveBeenCalled();
});

test('empty pivot wrappers must have exactly the current workbook ID and no pivot state', () => {
  const empty = {
    dataFieldManagerConfig: { [itemId]: { collections: {}, dataFields: {} } },
    pivotTableConfigs: {},
    pivotCacheConfigs: { [itemId]: {} },
  };
  for (const data of [
    { ...empty, dataFieldManagerConfig: { other: { collections: {}, dataFields: {} } } },
    { ...empty, pivotCacheConfigs: { other: {} } },
    {
      ...empty,
      dataFieldManagerConfig: { [itemId]: { collections: { source: {} }, dataFields: {} } },
    },
    {
      ...empty,
      dataFieldManagerConfig: { [itemId]: { collections: {}, dataFields: { field: {} } } },
    },
    { ...empty, pivotTableConfigs: { visible: {} } },
    { ...empty, pivotCacheConfigs: { [itemId]: { cache: {} } } },
    { ...empty, newAppearance: {} },
    { pivotTableConfigs: {} },
  ]) {
    const snapshot = plainBook();
    snapshot.resources = [{ name: 'SHEET_PIVOT_TABLE_PLUGIN', data: JSON.stringify(data) }];
    expect(() => preparePdfSnapshot('sheet', itemId, snapshot, { readImage })).toThrow(PdfError);
  }
});

test('unrecognized nonempty wrappers are never inferred to be empty', () => {
  const resources = [{ name: 'FUTURE_APPEARANCE_PLUGIN', data: '{"schemaVersion":1,"shapes":{}}' }];
  const document = { ...doc(), resources };
  expect(() => preparePdfSnapshot('doc', itemId, document, { readImage })).toThrow(PdfError);
  const workbook = { ...plainBook(), resources };
  // Unknown Sheet state remains for the isolated renderer's unsupported-resource
  // rejection; preparation must not make that check pass by deleting its data.
  expect(preparePdfSnapshot('sheet', itemId, workbook, { readImage }).snapshot.resources).toEqual(
    resources,
  );
});

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
