import { expect, test } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { DocStyleType, getDocsEmptySnapshot } from '@univerjs/core';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { runPdf } from './runner.ts';
import { PDF_WORKER_RSS_BYTES } from './limits.ts';
import { preparePdfSnapshot } from './prepare.ts';

test('the disposable production worker renders all Doc pages with runtime fonts and private metadata', async () => {
  const lines = Array.from({ length: 22 }, (_, index) => `Complete paragraph ${index + 1}.`);
  let offset = 0;
  const snapshot: IDocumentData = {
    id: 'PRIVATE-ACCOUNT-ID',
    title: 'PRIVATE-OWNER-TITLE',
    body: {
      dataStream: `${lines.join('\r')}\r\n`,
      paragraphs: lines.map((line, index) => {
        offset += line.length;
        return { startIndex: offset++, paragraphId: `p${index}` };
      }),
      textRuns: [{ st: 0, ed: lines[0].length, ts: { bl: 1 } }],
    },
    documentStyle: {
      pageSize: { width: 450, height: 280 },
      marginTop: 32,
      marginBottom: 32,
      marginLeft: 32,
      marginRight: 32,
      textStyle: { ff: 'Arial', fs: 16 },
    },
  };
  const result = await runPdf({ kind: 'doc', input: { snapshot, images: [] } });
  expect(result.pages).toBeGreaterThan(1);
  expect(result.peakRssBytes).toBeLessThan(PDF_WORKER_RSS_BYTES);
  const loading = getDocument({ data: new Uint8Array(result.bytes), useSystemFonts: false });
  try {
    const pdf = await loading.promise;
    expect(pdf.numPages).toBe(result.pages);
    let text = '';
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      const content = await page.getTextContent();
      text += content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
      page.cleanup();
    }
    for (const line of lines) expect(text).toContain(line);
    const metadata = await pdf.getMetadata();
    expect(JSON.stringify(metadata)).not.toContain('PRIVATE');
    expect(result.bytes.toString('latin1')).not.toContain('PRIVATE');
  } finally {
    await loading.destroy();
  }
}, 45_000);

test('an actual worker cancelled after fork publishes no PDF and a fresh worker recovers', async () => {
  const lines = Array.from({ length: 60 }, (_, index) => `Cancelled paragraph ${index + 1}.`);
  let offset = 0;
  const snapshot: IDocumentData = {
    id: 'cancel-native',
    documentStyle: { textStyle: { ff: 'Arial', fs: 14 } },
    body: {
      dataStream: `${lines.join('\r')}\r\n`,
      paragraphs: lines.map((line, index) => {
        offset += line.length;
        return { startIndex: offset++, paragraphId: `p${index}` };
      }),
    },
  };
  const controller = new AbortController();
  // runPdf forks synchronously before its first await. Attach rejection handling
  // immediately, then cancel while the real child is starting native modules.
  const pending = runPdf({ kind: 'doc', input: { snapshot, images: [] } }, controller.signal).then(
    (result) => ({ result, error: undefined }),
    (error: unknown) => ({ result: undefined, error }),
  );
  await delay(50);
  controller.abort();
  const cancelled = await pending;
  expect(cancelled.result).toBeUndefined();
  expect(cancelled.error).toMatchObject({ code: 'cancelled' });
  expect(cancelled.error).not.toHaveProperty('bytes');
  const recovery = 'Complete PDF from the recovered worker.';
  snapshot.body = {
    dataStream: `${recovery}\r\n`,
    paragraphs: [{ startIndex: recovery.length, paragraphId: 'recovery' }],
  };
  const result = await runPdf({ kind: 'doc', input: { snapshot, images: [] } });
  const loading = getDocument({ data: new Uint8Array(result.bytes), useSystemFonts: false });
  try {
    const pdf = await loading.promise;
    expect(pdf.numPages).toBe(1);
    const content = await (await pdf.getPage(1)).getTextContent();
    expect(content.items.map((item) => ('str' in item ? item.str : '')).join(' ')).toContain(
      recovery,
    );
  } finally {
    await loading.destroy();
  }
}, 45_000);

test('the standard modern Doc exports complete link text without its private destination', async () => {
  const snapshot = getDocsEmptySnapshot('modern-doc');
  snapshot.body = {
    dataStream: 'Reference and complete document text.\r\n',
    paragraphs: [{ startIndex: 37, paragraphId: 'one' }],
    customRanges: [
      {
        rangeId: 'link',
        rangeType: 0,
        startIndex: 0,
        endIndex: 8,
        properties: { url: 'https://example.invalid/PRIVATE-DESTINATION' },
      },
    ],
  };
  // Paragraph terminators follow the native dataStream, including its final CRLF.
  snapshot.body.paragraphs![0].startIndex = snapshot.body.dataStream.length - 2;
  const prepared = preparePdfSnapshot('doc', snapshot.id, snapshot, {
    readImage: () => {
      throw new Error('This fixture contains no image.');
    },
  });
  const result = await runPdf({ kind: 'doc', input: prepared });
  const loading = getDocument({ data: new Uint8Array(result.bytes), useSystemFonts: false });
  try {
    const pdf = await loading.promise;
    const page = await pdf.getPage(1);
    const text = (await page.getTextContent()).items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ');
    expect(text).toContain('Reference and complete document text.');
    expect(await page.getAnnotations()).toEqual([]);
    expect(result.bytes.toString('latin1')).not.toContain('PRIVATE-DESTINATION');
  } finally {
    await loading.destroy();
  }
}, 45_000);

test('runtime font admission follows visible worksheet content and starts fresh after a used unsupported family', async () => {
  const snapshot: IWorkbookData = {
    id: 'sheet',
    name: 'Private workbook title',
    appVersion: '1.1.0',
    locale: 'enUS' as IWorkbookData['locale'],
    styles: {
      unused: { ff: 'Unknown unused style' },
      excluded: { ff: 'Unknown excluded content' },
      supported: { ff: 'Arial' },
    },
    sheetOrder: ['first', 'second', 'hidden'],
    sheets: {
      first: {
        id: 'first',
        name: 'First',
        rowCount: 10,
        columnCount: 4,
        cellData: { 0: { 0: { v: 'UNSELECTED', s: 'excluded' } } },
      },
      second: {
        id: 'second',
        name: 'Second',
        rowCount: 10,
        columnCount: 4,
        defaultStyle: 'supported',
        rowData: { 2: { hd: 1 } },
        columnData: { 1: { hd: 1 } },
        cellData: {
          0: { 0: { v: 'Selected' }, 1: { v: 'HIDDEN-COLUMN', s: 'excluded' } },
          1: { 0: { f: '=SUM(12,34)', v: 'STALE-CACHED-VALUE' } },
          2: { 0: { v: 'HIDDEN-ROW', s: 'excluded' } },
        },
      },
      hidden: {
        id: 'hidden',
        name: 'Hidden',
        hidden: 1,
        rowCount: 10,
        columnCount: 4,
        defaultStyle: 'excluded',
        cellData: { 0: { 0: { v: 'HIDDEN-SHEET' } } },
      },
    },
  };
  const unsupported = structuredClone(snapshot);
  unsupported.sheets.second.cellData![0][0]!.s = { ff: 'Unknown actively used font' };
  await expect(
    runPdf({
      kind: 'sheet',
      input: { snapshot: unsupported, images: [] },
      worksheetIds: ['second'],
    }),
  ).rejects.toMatchObject({ code: 'unsupported' });
  const result = await runPdf({
    kind: 'sheet',
    input: { snapshot, images: [] },
    worksheetIds: ['second', 'hidden'],
  });
  const loading = getDocument({ data: new Uint8Array(result.bytes), useSystemFonts: false });
  try {
    const pdf = await loading.promise;
    expect(pdf.numPages).toBe(1);
    const content = await (await pdf.getPage(1)).getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    expect(text).toContain('Selected');
    expect(text).toContain('46');
    expect(text).not.toContain('UNSELECTED');
    expect(text).not.toContain('HIDDEN-');
    expect(text).not.toContain('STALE-CACHED-VALUE');
  } finally {
    await loading.destroy();
  }
}, 45_000);

test('runtime Doc font admission ignores unused named styles and unreferenced stories but rejects used families', async () => {
  const text = 'Visible document with supported text.';
  const header = 'Unused header with unsupported font.';
  const snapshot: IDocumentData = {
    id: 'font-scope-doc',
    documentStyle: { textStyle: { ff: 'Arial', fs: 14 } },
    styles: {
      unusedCharacter: {
        type: DocStyleType.character,
        name: 'Unused character',
        textStyle: { ff: 'Unknown unused character family' },
      },
      unusedParagraph: {
        type: DocStyleType.paragraph,
        name: 'Unused paragraph',
        paragraphStyle: { textStyle: { ff: 'Unknown unused paragraph family' } },
      },
    },
    body: {
      dataStream: `${text}\r\n`,
      paragraphs: [{ startIndex: text.length, paragraphId: 'body' }],
    },
    headers: {
      unused: {
        headerId: 'unused',
        body: {
          dataStream: `${header}\r\n`,
          paragraphs: [{ startIndex: header.length, paragraphId: 'unused-header' }],
          textRuns: [{ st: 0, ed: header.length, ts: { ff: 'Unknown unused header family' } }],
        },
      },
    },
  };
  const result = await runPdf({ kind: 'doc', input: { snapshot, images: [] } });
  const loading = getDocument({ data: new Uint8Array(result.bytes), useSystemFonts: false });
  try {
    const pdf = await loading.promise;
    const content = await (await pdf.getPage(1)).getTextContent();
    const printed = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    expect(printed).toContain(text);
    expect(printed).not.toContain(header);
  } finally {
    await loading.destroy();
  }
  const active = structuredClone(snapshot);
  active.body!.textRuns = [
    { st: 0, ed: text.length, ts: { ff: 'Unknown actively used Doc family' } },
  ];
  await expect(
    runPdf({ kind: 'doc', input: { snapshot: active, images: [] } }),
  ).rejects.toMatchObject({ code: 'unsupported' });
  const activeHeader = structuredClone(snapshot);
  activeHeader.documentStyle.defaultHeaderId = 'unused';
  await expect(
    runPdf({ kind: 'doc', input: { snapshot: activeHeader, images: [] } }),
  ).rejects.toMatchObject({ code: 'unsupported' });
}, 45_000);
