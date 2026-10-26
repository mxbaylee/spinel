import { expect, test, vi } from 'vitest';
import { getDocsEmptySnapshot, ImageSourceType, LocaleType } from '@univerjs/core';
import type { ICellData, IDocumentData, IWorkbookData } from '@univerjs/core';
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

function sheetCellPicture(source: string): ICellData {
  return {
    p: {
      id: 'cell',
      documentStyle: {},
      body: { dataStream: '\b\r\n', customBlocks: [{ startIndex: 0, blockId: 'picture' }] },
      drawingsOrder: ['picture'],
      drawings: {
        picture: {
          drawingId: 'picture',
          unitId: 'cell',
          subUnitId: 'cell',
          drawingType: 0,
          layoutType: 0,
          imageSourceType: ImageSourceType.URL,
          source,
          docTransform: {
            size: { width: 10, height: 10 },
            positionH: { relativeFrom: 1, posOffset: 0 },
            positionV: { relativeFrom: 1, posOffset: 0 },
            angle: 0,
          },
        },
      },
    },
  } as ICellData;
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

test('a restored Sheet accepts only its explicitly proved generation or stable identity', () => {
  const snapshot = plainBook();
  const generation = 'verified-restored-unit';
  for (const id of [snapshot.id, generation]) {
    snapshot.resources = capturedSheetResources(id);
    expect(
      preparePdfSnapshot('sheet', itemId, snapshot, { readImage, sourceUnitId: generation })
        .snapshot.resources,
    ).toEqual([]);
  }
  snapshot.resources = capturedSheetResources('unrelated-unit');
  expect(() =>
    preparePdfSnapshot('sheet', itemId, snapshot, { readImage, sourceUnitId: generation }),
  ).toThrow(PdfError);
  snapshot.resources = capturedSheetResources(generation);
  expect(() => preparePdfSnapshot('sheet', itemId, snapshot, { readImage })).toThrow(PdfError);
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

test.each(['missing', 'existing'])(
  'omitted Sheet sources do not read %s blobs or consume the encoded-byte budget',
  (mode) => {
    const snapshot = plainBook();
    const unused = ['b', 'c', 'd'].map(
      (digit) => `/api/items/${itemId}/images/${digit.repeat(64)}`,
    );
    snapshot.sheets.one.rowData = { 1: { hd: 1 }, 2: { hd: 1 }, 3: { hd: 1 } };
    snapshot.sheets.one.mergeData = [{ startRow: 4, endRow: 5, startColumn: 0, endColumn: 1 }];
    snapshot.sheets.one.cellData = {
      0: { 1: sheetCellPicture(imagePath) },
      1: { 1: sheetCellPicture(unused[0]) },
      2: { 1: sheetCellPicture(unused[1]) },
      3: { 1: sheetCellPicture(unused[2]) },
      4: { 1: sheetCellPicture(unused[0]) },
    };
    snapshot.sheets.two.columnData = { 0: { hd: 1 }, 1: { hd: 1 }, 2: { hd: 1 } };
    snapshot.sheets.two.backgroundImage = {
      source: unused[1],
      imageSourceType: ImageSourceType.URL,
    };
    const base = {
      unitId: itemId,
      subUnitId: 'one',
      anchorType: '2',
      transform: { left: 0, top: 0, width: 20, height: 20 },
    };
    const data = {
      group: {
        ...base,
        drawingId: 'group',
        drawingType: 6,
        groupBaseBound: { left: 0, top: 0, width: 20, height: 20 },
      },
      active: { ...base, drawingId: 'active', drawingType: 0, groupId: 'group', source: imagePath },
      hidden: {
        ...base,
        drawingId: 'hidden',
        drawingType: 6,
        groupId: 'group',
        hidden: true,
        groupBaseBound: { left: 0, top: 0, width: 20, height: 20 },
      },
      hiddenChild: {
        ...base,
        drawingId: 'hiddenChild',
        drawingType: 0,
        groupId: 'hidden',
        source: unused[2],
      },
      collapsed: {
        ...base,
        drawingId: 'collapsed',
        drawingType: 0,
        source: unused[0],
        anchorType: '1',
        sheetTransform: {
          from: { row: 1, column: 0, rowOffset: 0, columnOffset: 0 },
          to: { row: 2, column: 1, rowOffset: 0, columnOffset: 0 },
        },
      },
    };
    snapshot.resources = [
      {
        name: 'SHEET_DRAWING_PLUGIN',
        data: JSON.stringify({ one: { data, order: Object.keys(data) } }),
      },
    ];
    const original = structuredClone(snapshot);
    // All references are valid same-item ownership identities. Raw ownership
    // validation remains in CollaborationStore.load; this step selects blobs.
    const read = vi.fn((id: string) => {
      if (mode === 'missing' && id !== imageId) throw new Error('Inactive blob was read.');
      return { mime: 'image/png', data: new Uint8Array(3 * 1024 * 1024) };
    });
    const prepared = preparePdfSnapshot('sheet', itemId, snapshot, { readImage: read });
    expect(read).toHaveBeenCalledExactlyOnceWith(imageId);
    expect(prepared.images.map(({ source }) => source)).toEqual([imagePath]);
    expect(prepared.imageIds).toEqual([imageId]);
    expect(prepared.snapshot).toEqual(original);
    expect(snapshot).toEqual(original);
  },
);

test('formula recalculation can reveal a filtered image after host byte selection', async () => {
  const snapshot = plainBook();
  snapshot.sheets.one.cellData = {
    0: { 0: { v: 'Header' } },
    1: { 0: { f: '=1', v: 0 }, 1: sheetCellPicture(imagePath) },
  };
  snapshot.resources = [
    {
      name: 'SHEET_FILTER_PLUGIN',
      data: JSON.stringify({
        one: {
          ref: { startRow: 0, endRow: 9, startColumn: 0, endColumn: 1 },
          filterColumns: [{ colId: 0, filters: { filters: ['1'] } }],
        },
      }),
    },
  ];
  const { default: sharp } = await import('sharp');
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#8020f0' } })
    .png()
    .toBuffer();
  const read = vi.fn(() => ({ mime: 'image/png', data: bytes }));
  const prepared = preparePdfSnapshot('sheet', itemId, snapshot, { readImage: read });
  expect(prepared.imageIds).toEqual([imageId]);
  const { prepareSheetFormulas } = await import('./sheet-formulas.ts');
  const calculated = await prepareSheetFormulas(prepared.snapshot);
  expect(calculated.sheets.one.cellData![1][0]?.v).toBe(1);
  const { runPdf } = await import('./runner.ts');
  const rendered = await runPdf({
    kind: 'sheet',
    input: { snapshot: prepared.snapshot, images: prepared.images },
    worksheetIds: ['one'],
  });
  expect(rendered.pages).toBe(1);
  expect(Buffer.from(rendered.bytes).subarray(0, 5).toString()).toBe('%PDF-');
  expect(Buffer.from(rendered.bytes).toString('latin1')).toMatch(/\/Subtype\s*\/Image/);
  expect(read).toHaveBeenCalledExactlyOnceWith(imageId);
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
  snapshot.documentStyle.defaultHeaderId = 'header';
  snapshot.documentStyle.defaultFooterId = 'footer';
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

test('inactive Doc story groups never read blobs or consume the active image budget', () => {
  const snapshot = doc();
  const data: Record<string, unknown> = {
    active: { drawingId: 'active', drawingType: 0, source: imagePath },
    unused: { drawingId: 'unused', drawingType: 6 },
  };
  for (let index = 0; index <= PDF_LIMITS.images; index++)
    data[`unused-${index}`] = {
      drawingId: `unused-${index}`,
      drawingType: 0,
      groupId: 'unused',
      source: `/api/items/${itemId}/images/${index.toString(16).padStart(64, '0')}`,
    };
  snapshot.drawings = data as IDocumentData['drawings'];
  snapshot.headers = {
    unused: {
      headerId: 'unused',
      body: { dataStream: '\b\r\n', customBlocks: [{ startIndex: 0, blockId: 'unused' }] },
    },
  };
  const original = structuredClone(snapshot);
  const read = vi.fn((id: string) => {
    if (id !== imageId) throw new Error('Inactive image bytes were requested.');
    return readImage();
  });
  const prepared = preparePdfSnapshot('doc', itemId, snapshot, { readImage: read });
  expect(read).toHaveBeenCalledExactlyOnceWith(imageId);
  expect(prepared.images.map(({ source }) => source)).toEqual([imagePath]);
  expect(prepared.imageIds).toEqual([imageId]);
  expect(prepared.snapshot.headers).toEqual(original.headers);
  expect(snapshot).toEqual(original);
});

test('active group sources deduplicate while hidden groups and leaves stay out of final image revalidation IDs', () => {
  const snapshot = doc();
  const secondId = 'b'.repeat(64);
  const secondPath = `/api/items/${itemId}/images/${secondId}`;
  // Raw source ownership is checked separately by CollaborationStore.load.
  // This boundary selects blob reads and does not make hidden URLs authorized.
  snapshot.drawings = {
    group: { drawingId: 'group', drawingType: 6 },
    first: { drawingId: 'first', drawingType: 0, groupId: 'group', source: imagePath },
    duplicate: { drawingId: 'duplicate', drawingType: 0, groupId: 'group', source: imagePath },
    nested: { drawingId: 'nested', drawingType: 6, groupId: 'group' },
    second: { drawingId: 'second', drawingType: 0, groupId: 'nested', source: secondPath },
    hidden: { drawingId: 'hidden', drawingType: 6, hidden: true },
    'hidden-child': {
      drawingId: 'hidden-child',
      drawingType: 0,
      groupId: 'hidden',
      source: 'https://unused.invalid/child',
    },
    'hidden-leaf': {
      drawingId: 'hidden-leaf',
      drawingType: 0,
      hidden: true,
      source: 'https://unused.invalid/leaf',
    },
  } as unknown as IDocumentData['drawings'];
  const original = structuredClone(snapshot);
  const read = vi.fn((id: string) => {
    if (![imageId, secondId].includes(id)) throw new Error('Hidden image bytes were requested.');
    return readImage();
  });
  const prepared = preparePdfSnapshot('doc', itemId, snapshot, { readImage: read });
  expect(read.mock.calls.map(([id]) => id)).toEqual([imageId, secondId]);
  expect(prepared.images.map(({ source }) => source)).toEqual([imagePath, secondPath]);
  // PdfService rechecks this exact list before returning complete bytes.
  expect(prepared.imageIds).toEqual([imageId, secondId]);
  expect(snapshot).toEqual(original);
  for (const edit of [
    (source: IDocumentData) => {
      source.drawings!.first.groupId = 'missing';
    },
    (source: IDocumentData) => {
      source.drawings!.group.groupId = 'nested';
    },
    (source: IDocumentData) => {
      Object.assign(source.drawings!.second, { source: 17 });
    },
  ]) {
    const bad = structuredClone(snapshot);
    edit(bad);
    const forbidden = vi.fn(() => {
      throw new Error('Malformed source must not read bytes.');
    });
    expect(() => preparePdfSnapshot('doc', itemId, bad, { readImage: forbidden })).toThrow(
      PdfError,
    );
    expect(forbidden).not.toHaveBeenCalled();
  }
});
