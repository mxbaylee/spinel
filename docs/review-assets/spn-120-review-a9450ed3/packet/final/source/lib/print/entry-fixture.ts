/** Test process: importing metadata must not initialize a native rendering runtime. */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DocPrintInput, SheetPrintInput } from './index.ts';
import { fixtureFonts } from './font-fixtures.ts';

const hook = registerHooks({
  load(url, context, next) {
    if (
      /\/(?:native|doc-native|native-runtime)\.ts$/.test(url) ||
      url.includes('/@napi-rs/') ||
      url.includes('/@univerjs/engine-render/') ||
      url.includes('/sharp/')
    )
      throw new Error('Metadata import attempted to load a native rendering dependency.');
    return next(url, context);
  },
});
let api: typeof import('./index.ts');
try {
  api = await import('@spinel/print');
  assert.deepEqual(
    api.selectDocImageSources({
      id: 'metadata',
      documentStyle: {},
      body: { dataStream: 'Only active text\r\n' },
      headers: {
        unused: {
          headerId: 'unused',
          body: { dataStream: '\r\n' },
          drawings: {
            unused: { drawingId: 'unused', source: 'never-decode-unused' },
          },
        },
      },
    } as never),
    [],
  );
  const cellPicture = {
    p: {
      id: 'cell',
      documentStyle: {},
      body: { dataStream: '\b\r\n', customBlocks: [{ startIndex: 0, blockId: 'image' }] },
      drawingsOrder: ['image'],
      drawings: {
        image: {
          drawingId: 'image',
          unitId: 'cell',
          subUnitId: 'cell',
          drawingType: 0,
          source: 'never-decode-omitted',
          docTransform: { size: { width: 10, height: 10 } },
        },
      },
    },
  };
  assert.deepEqual(
    api.selectSheetImageSources({
      id: 'metadata-sheet',
      name: 'Metadata',
      appVersion: '1.1.0',
      locale: 'enUS',
      styles: {},
      sheetOrder: ['one'],
      sheets: {
        one: {
          id: 'one',
          rowCount: 3,
          columnCount: 2,
          rowData: { 2: { hd: 1 } },
          cellData: {
            0: { 0: { v: 'Header' } },
            1: { 0: { v: 'Drop' }, 1: cellPicture },
            2: { 0: { v: 'Keep' }, 1: cellPicture },
          },
        },
      },
      resources: [
        {
          name: 'SHEET_FILTER_PLUGIN',
          data: JSON.stringify({
            one: {
              ref: { startRow: 0, endRow: 2, startColumn: 0, endColumn: 1 },
              filterColumns: [{ colId: 0, filters: { filters: ['Keep'] } }],
            },
          }),
        },
      ],
    } as never),
    [],
  );
} finally {
  hook.deregister();
}

const doc: DocPrintInput = {
  snapshot: {
    id: 'owned-doc',
    body: {
      dataStream: 'ORIGINAL-DOC\r\n',
      paragraphs: [{ startIndex: 12, paragraphId: 'first' }],
    },
    documentStyle: {
      pageSize: { width: 600, height: 400 },
      marginTop: 48,
      marginBottom: 48,
      marginLeft: 48,
      marginRight: 48,
    },
  },
  images: [],
  fonts: await fixtureFonts(),
  defaultFamily: 'Atkinson Hyperlegible',
};
const sheet: SheetPrintInput = {
  snapshot: {
    id: 'owned-sheet',
    name: 'Fixture',
    appVersion: '1.1.0',
    locale: 'enUS',
    styles: {},
    sheetOrder: ['one'],
    sheets: {
      one: {
        id: 'one',
        rowCount: 2,
        columnCount: 2,
        cellData: { 0: { 0: { v: 'ORIGINAL-SHEET' } } },
      },
    },
  } as SheetPrintInput['snapshot'],
  images: [],
  fonts: await fixtureFonts(),
  defaultFamily: 'Atkinson Hyperlegible',
};
queueMicrotask(() => {
  doc.snapshot.body!.dataStream = 'EARLIER-QUEUE\r\n';
  doc.fonts[0].bytes.fill(0);
});
const pendingDoc = api.renderDocPdf(doc);
// Calls must enter synchronous ownership and the common lock before returning
// their promise, including the very first lazily loaded native invocation.
doc.snapshot.body!.dataStream = 'MUTATED-DOC!\r\n';
doc.fonts[0].bytes.fill(0);
let overlapCode = '';
await api.renderSheetPdf(sheet).catch((error: unknown) => {
  overlapCode = (error as { code: string }).code;
});
const renderedDoc = await pendingDoc;
assert.equal(overlapCode, 'limit');
const pendingSheet = api.renderSheetPdf(sheet);
sheet.snapshot.sheets.one.cellData![0][0]!.v = 'MUTATED-SHEET';
sheet.fonts[0].bytes.fill(0);
const renderedSheet = await pendingSheet;
const { GlobalFonts } = await import('@napi-rs/canvas');
assert.equal(GlobalFonts.families.length, 0);
const directory = resolve(process.argv[2]);
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, 'entry-owned-doc.pdf'), renderedDoc.bytes);
await writeFile(resolve(directory, 'entry-owned-sheet.pdf'), renderedSheet.bytes);
const completed = JSON.stringify({
  pureMetadata: true,
  overlapCode,
  docPages: renderedDoc.pages,
  sheetPages: renderedSheet.pages,
  remainingFonts: GlobalFonts.families.length,
});
// A fresh awaited artifact also survives test runners that drop child streams.
await writeFile(resolve(directory, 'entry-result.json'), completed);
process.stdout.write(completed);
