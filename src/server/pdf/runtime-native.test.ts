import { expect, test } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { getDocsEmptySnapshot } from '@univerjs/core';
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

test('the standard modern Doc exports complete link text without its private destination', async () => {
  const snapshot = getDocsEmptySnapshot('modern-doc');
  snapshot.body = {
    dataStream: 'Reference and complete document text.\r\n',
    paragraphs: [{ startIndex: 37, paragraphId: 'one' }],
    customRanges: [{
      rangeId: 'link', rangeType: 0, startIndex: 0, endIndex: 8,
      properties: { url: 'https://example.invalid/PRIVATE-DESTINATION' },
    }],
  };
  // Paragraph terminators follow the native dataStream, including its final CRLF.
  snapshot.body.paragraphs![0].startIndex = snapshot.body.dataStream.length - 2;
  const prepared = preparePdfSnapshot('doc', snapshot.id, snapshot, {
    readImage: () => { throw new Error('This fixture contains no image.'); },
  });
  const result = await runPdf({ kind: 'doc', input: prepared });
  const loading = getDocument({ data: new Uint8Array(result.bytes), useSystemFonts: false });
  try {
    const pdf = await loading.promise;
    const page = await pdf.getPage(1);
    const text = (await page.getTextContent()).items.map((item) => 'str' in item ? item.str : '').join(' ');
    expect(text).toContain('Reference and complete document text.');
    expect(await page.getAnnotations()).toEqual([]);
    expect(result.bytes.toString('latin1')).not.toContain('PRIVATE-DESTINATION');
  } finally { await loading.destroy(); }
}, 45_000);

test('runtime worker supports worksheet selection and starts fresh after an unsupported job', async () => {
  const snapshot: IWorkbookData = {
    id: 'sheet',
    name: 'Private workbook title',
    appVersion: '1.1.0',
    locale: 'enUS' as IWorkbookData['locale'],
    styles: {},
    sheetOrder: ['first', 'second'],
    sheets: {
      first: { id: 'first', name: 'First', rowCount: 10, columnCount: 4, cellData: { 0: { 0: { v: 'UNSELECTED' } } } },
      second: { id: 'second', name: 'Second', rowCount: 10, columnCount: 4, cellData: {
        0: { 0: { v: 'Selected' } },
        1: { 0: { f: '=SUM(12,34)', v: 'STALE-CACHED-VALUE' } },
      } },
    },
  };
  const unsupported = structuredClone(snapshot);
  unsupported.styles = { broken: { ff: 'Unknown unbundled font' } };
  await expect(
    runPdf({ kind: 'sheet', input: { snapshot: unsupported, images: [] } }),
  ).rejects.toMatchObject({ code: 'unsupported' });
  const result = await runPdf({
    kind: 'sheet',
    input: { snapshot, images: [] },
    worksheetIds: ['second'],
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
    expect(text).not.toContain('STALE-CACHED-VALUE');
  } finally {
    await loading.destroy();
  }
}, 45_000);
