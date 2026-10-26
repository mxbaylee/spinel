import { createCanvas } from '@napi-rs/canvas';
import { CustomRangeType, DocumentFlavor } from '@univerjs/core';
import type { IDocumentBody, IDocumentData, ISectionBreak } from '@univerjs/core';
import { expect, test } from 'vitest';
import { PRINT_LIMITS, PrintError } from './contract.ts';
import { prepareDocSnapshot } from './doc-preparation.ts';
import {
  docInput,
  retainDocPdf,
  runDocJobs,
  tableDoc,
  textDoc,
} from './doc-native-test-support.ts';

const summary = (value: unknown) =>
  JSON.stringify(value, (key, item) => (key === 'bytes' ? '<bytes>' : item));
const compact = (value: string) => value.replace(/\s+/gu, '');
const body = (text: string): IDocumentBody => ({
  dataStream: `${text}\r\n`,
  paragraphs: [...`${text}\r\n`.matchAll(/\r/g)].map((match, index) => ({
    startIndex: match.index,
    paragraphId: `p-${index}`,
  })),
});

function footerFields(): IDocumentBody {
  const result = body('Page \x1f88\x1e of \x1f88\x1e · Saved \x1f2026-10-26\x1e');
  const starts: number[] = [];
  for (let index = 0; index < result.dataStream.length; index++)
    if (result.dataStream.charCodeAt(index) === 31) starts.push(index);
  result.customRanges = starts.map(
    (start, index) => ({
      rangeType: CustomRangeType.FIELD,
      rangeId: `field-${index}`,
      startIndex: start,
      endIndex: result.dataStream.indexOf('\x1e', start + 1),
      wholeEntity: false,
      properties: {
        fieldType: ['PAGE', 'NUMPAGES', 'DATE'][index],
        instruction: 'PRIVATE INSTRUCTION',
        cachedResult: 'PRIVATE CACHE',
      },
    }),
  );
  return result;
}

function sections(
  parts: { text: string; style: Omit<ISectionBreak, 'startIndex' | 'sectionId'> }[],
) {
  const snapshot = textDoc([], { documentFlavor: DocumentFlavor.TRADITIONAL });
  let stream = '';
  const sectionBreaks: ISectionBreak[] = [];
  for (const [index, part] of parts.entries()) {
    stream += `${part.text}\r\n`;
    sectionBreaks.push({
      ...part.style,
      sectionId: `section-${index}`,
      startIndex: stream.length - 1,
    });
  }
  snapshot.body = {
    ...body(''),
    dataStream: stream,
    paragraphs: [...stream.matchAll(/\r/g)].map((match, index) => ({
      startIndex: match.index,
      paragraphId: `p-${index}`,
    })),
    sectionBreaks,
  };
  return snapshot;
}

test('story admission owns fields, resources and per-section dimensions without retaining source metadata', () => {
  const snapshot = sections([
    { text: 'FIRST', style: {} },
    {
      text: 'SECOND',
      style: {
        pageSize: { width: 800.5, height: 500.25 },
        marginLeft: 32,
        marginRight: 32,
        sectionType: 5,
        columnProperties: [
          { width: 350, paddingEnd: 20 },
          { width: 350, paddingEnd: 0 },
        ],
      },
    },
  ]);
  snapshot.footers = { footer: { footerId: 'footer', body: footerFields() } };
  snapshot.documentStyle.defaultFooterId = 'footer';
  const original = structuredClone(snapshot);
  const prepared = prepareDocSnapshot(snapshot, [], PRINT_LIMITS, () => {}).snapshot;
  expect(snapshot).toEqual(original);
  expect(prepared.body!.sectionBreaks![1]).toMatchObject({
    pageSize: { width: 800.5, height: 500.25 },
    sectionType: 5,
  });
  expect(JSON.stringify(prepared)).not.toContain('PRIVATE');
  expect(prepared.footers!.footer.body.customRanges).toHaveLength(3);
  const malformed = structuredClone(snapshot);
  malformed.footers!.footer.body.customRanges![0].endIndex--;
  expect(() => prepareDocSnapshot(malformed, [], PRINT_LIMITS, () => {})).toThrow(PrintError);
  const unprepared = structuredClone(snapshot);
  unprepared.footers!.footer.body.customRanges![0].rangeType = CustomRangeType.CUSTOM;
  expect(() => prepareDocSnapshot(unprepared, [], PRINT_LIMITS, () => {})).toThrow(PrintError);
});

test('repeats first, even and default stories with actual page fields and saved date text', async () => {
  const snapshot = textDoc(['BODY-ONE', '\fBODY-TWO', '\fBODY-THREE'], {
    documentFlavor: DocumentFlavor.TRADITIONAL,
    pageSize: { width: 601.5, height: 401.25 },
    defaultHeaderId: 'normal',
    firstPageHeaderId: 'first',
    evenPageHeaderId: 'even',
    defaultFooterId: 'footer',
    firstPageFooterId: 'footer',
    evenPageFooterId: 'footer',
    useFirstPageHeaderFooter: 1,
    evenAndOddHeaders: 1,
    marginHeader: 12,
    marginFooter: 14,
  });
  snapshot.headers = Object.fromEntries(
    ['normal', 'first', 'even'].map((id) => [
      id,
      {
        headerId: id,
        body: body(`HEADER-${id.toUpperCase()}`),
      },
    ]),
  );
  snapshot.headers.first.body.textRuns = [{ st: 0, ed: 12, ts: { bl: 1 } }];
  snapshot.footers = { footer: { footerId: 'footer', body: footerFields() } };
  const [result] = await runDocJobs([{ input: await docInput(snapshot) }]);
  expect(result, summary(result)).toMatchObject({
    ok: true,
    pages: 3,
    restored: true,
    remainingFonts: 0,
  });
  const pages = await retainDocPdf('header-footer-fields-variants', result.bytes!);
  for (const [index, page] of pages.entries()) {
    expect(page.view).toEqual([0, 0, 451.125, 300.9375]);
    expect(compact(page.text)).toContain(`Page${index + 1}of3·Saved2026-10-26`);
    expect(page.text).toContain(`HEADER-${['FIRST', 'EVEN', 'NORMAL'][index]}`);
    expect(page.text).toContain(`BODY-${['ONE', 'TWO', 'THREE'][index]}`);
    expect(page.text).not.toMatch(/PRIVATE|88/u);
  }
}, 60_000);

test('header tables and authorized inline images repeat within their own native reservation', async () => {
  const snapshot = textDoc(['BODY-FIRST', '\fBODY-LAST'], {
    documentFlavor: DocumentFlavor.TRADITIONAL,
    pageSize: { width: 600, height: 400 },
    defaultHeaderId: 'header',
    marginHeader: 8,
  });
  const header = tableDoc([['HEADER-TABLE', 'HEADER-RIGHT']], ['\bLOGO'], 30);
  header.body!.customBlocks = [{ startIndex: 0, blockId: 'logo' }];
  snapshot.headers = {
    header: { headerId: 'header', body: header.body!, tableSource: header.tableSource },
  };
  snapshot.drawings = {
    logo: {
      drawingId: 'logo',
      unitId: 'private',
      subUnitId: 'private',
      drawingType: 0,
      source: 'authorized-header-image',
      layoutType: 0,
      isMultiTransform: 1,
      // Public header insertion persists viewport positions as a repeated-image
      // cache. Screen coordinates must not replace native story geometry.
      transform: { left: 400, top: 1_000, width: 24, height: 20, angle: 0 },
      transforms: [{ left: 400, top: 1_000, width: 24, height: 20, angle: 0 }],
      docTransform: {
        size: { width: 24, height: 20 },
        angle: 0,
        positionH: { relativeFrom: 0, posOffset: 0 },
        positionV: { relativeFrom: 0, posOffset: 0 },
      },
    },
  } as IDocumentData['drawings'];
  snapshot.headerFooterDrawingsOrder = ['logo'];
  const canvas = createCanvas(24, 20);
  const context = canvas.getContext('2d');
  context.fillStyle = '#d02040';
  context.fillRect(0, 0, 24, 20);
  const input = await docInput(snapshot);
  input.images = [{ source: 'authorized-header-image', bytes: canvas.toBuffer('image/png') }];
  const [result] = await runDocJobs([{ input }]);
  expect(result, summary(result)).toMatchObject({ ok: true, pages: 2 });
  const pages = await retainDocPdf('header-table-image', result.bytes!);
  for (const page of pages) {
    expect(page.text).toContain('HEADER-TABLE');
    expect(page.text).toContain('HEADER-RIGHT');
    expect(page.text).toContain('LOGO');
    // Header layout uses a content-width page. The native painter must not
    // subtract the document margins a second time and clip a blank table edge.
    let rightBorder = 0;
    for (let y = 25; y < 52; y++) for (let x = 394; x <= 398; x++) {
      const offset = (y * page.width + x) * 4;
      if (page.pixels[offset] < 220 && page.pixels[offset + 1] < 180 && page.pixels[offset + 2] < 220) rightBorder++;
    }
    expect(rightBorder).toBeGreaterThan(10);
    let red = 0;
    for (let index = 0; index < page.pixels.length; index += 4)
      if (
        page.pixels[index] === 208 &&
        page.pixels[index + 1] === 32 &&
        page.pixels[index + 2] === 64
      )
        red++;
    expect(red).toBeGreaterThan(200);
  }
}, 60_000);

test('native section columns use every physical column and retain every source paragraph once', async () => {
  const lines = Array.from(
    { length: 42 },
    (_, index) =>
      `COLUMN-${String(index).padStart(3, '0')} complete saved content with enough words to wrap.`,
  );
  const snapshot = sections([
    {
      text: lines.join('\r'),
      style: {
        pageSize: { width: 601.5, height: 330.25 },
        marginLeft: 36,
        marginRight: 36,
        marginTop: 36,
        marginBottom: 36,
        columnProperties: [
          { width: 254, paddingEnd: 21.5 },
          { width: 254, paddingEnd: 0 },
        ],
        columnSeparatorType: 2,
      },
    },
  ]);
  const [result] = await runDocJobs([{ input: await docInput(snapshot) }]);
  expect(result, summary(result)).toMatchObject({ ok: true, restored: true, remainingFonts: 0 });
  const pages = await retainDocPdf('section-columns-complete', result.bytes!);
  expect(pages.length).toBeGreaterThan(1);
  const text = compact(pages.map((page) => page.text).join(''));
  for (const line of lines) expect(text.split(compact(line))).toHaveLength(2);
  expect(
    pages[0].items.some((item) => item.str.includes('COLUMN-') && item.transform[4] > 230),
  ).toBe(true);
  expect(pages.every((page) => page.view[2] === 451.125 && page.view[3] === 247.6875)).toBe(true);
}, 60_000);

test('heterogeneous section dimensions, margins and odd-page starts remain exact', async () => {
  const snapshot = sections([
    {
      text: 'PORTRAIT-SECTION',
      style: { pageSize: { width: 600.5, height: 400.25 }, marginLeft: 31, marginTop: 24 },
    },
    {
      text: 'LANDSCAPE-SECTION',
      style: {
        pageSize: { width: 800.25, height: 500.5 },
        marginLeft: 65,
        marginTop: 52,
        sectionType: 5,
      },
    },
  ]);
  const [result] = await runDocJobs([{ input: await docInput(snapshot) }]);
  expect(result, summary(result)).toMatchObject({
    ok: true,
    pages: 3,
    restored: true,
    remainingFonts: 0,
  });
  const pages = await retainDocPdf('heterogeneous-section-parity', result.bytes!);
  expect(pages[0].view).toEqual([0, 0, 450.375, 300.1875]);
  expect(pages[2].view).toEqual([0, 0, 600.1875, 375.375]);
  expect(pages[0].text).toContain('PORTRAIT-SECTION');
  expect(pages[1].text).toBe('');
  expect(pages[2].text).toContain('LANDSCAPE-SECTION');
  expect(pages[0].items.find((item) => item.str.includes('PORTRAIT'))!.transform[4]).toBeCloseTo(
    31 * 0.75,
    1,
  );
  expect(pages[2].items.find((item) => item.str.includes('LANDSCAPE'))!.transform[4]).toBeCloseTo(
    65 * 0.75,
    1,
  );
}, 60_000);

test('continuous and next-column section transitions preserve complete source order', async () => {
  const columns = [
    { width: 240, paddingEnd: 24 },
    { width: 240, paddingEnd: 0 },
  ];
  const snapshot = sections([
    { text: 'FULL-WIDTH-OPENING', style: {} },
    { text: 'COLUMN-START', style: { sectionType: 1, columnProperties: columns } },
    { text: 'NEXT-COLUMN-END', style: { sectionType: 2, columnProperties: columns } },
  ]);
  const [result] = await runDocJobs([{ input: await docInput(snapshot) }]);
  expect(result, summary(result)).toMatchObject({ ok: true, pages: 1 });
  const pages = await retainDocPdf('continuous-next-column-sections', result.bytes!);
  for (const marker of ['FULL-WIDTH-OPENING', 'COLUMN-START', 'NEXT-COLUMN-END'])
    expect(pages[0].text.split(marker)).toHaveLength(2);
  const first = pages[0].items.find((item) => item.str.includes('COLUMN-START'))!;
  const next = pages[0].items.find((item) => item.str.includes('NEXT-COLUMN-END'))!;
  expect(next.transform[4]).toBeGreaterThan(first.transform[4] + 150);
}, 60_000);

test('headers and section columns retain a saved oversized row rather than clamping its blank geometry', async () => {
  const snapshots = ['header', 'columns'].map((kind) => {
    const snapshot = tableDoc([['TALL-ROW-SOURCE', 'NEIGHBOR']], [], 700);
    snapshot.documentStyle.pageSize = { width: 600, height: 400 };
    const table = snapshot.tableSource!['native-table'];
    table.tableRows[0].trHeight.hRule = 2;
    table.tableRows[0].tableCells[0].backgroundColor = { rgb: '#ccddaa' };
    if (kind === 'header') {
      snapshot.headers = { header: { headerId: 'header', body: body('REPEATED-HEADER') } };
      snapshot.documentStyle.defaultHeaderId = 'header';
      snapshot.documentStyle.marginHeader = 12;
    } else {
      table.size.width.v = 200;
      for (const column of table.tableColumns) column.size.width.v = 100;
      for (const cell of table.tableRows[0].tableCells) cell.size!.width.v = 100;
      snapshot.body!.sectionBreaks = [{
        sectionId: 'two-columns', startIndex: snapshot.body!.dataStream.length - 1,
        columnProperties: [{ width: 240, paddingEnd: 24 }, { width: 240, paddingEnd: 0 }],
      }];
    }
    return snapshot;
  });
  const results = await runDocJobs(await Promise.all(snapshots.map(async (snapshot) => ({ input: await docInput(snapshot) }))));
  for (const [index, result] of results.entries()) {
    expect(result, summary(result)).toMatchObject({ ok: true, restored: true, remainingFonts: 0 });
    const pages = await retainDocPdf(`tall-row-${index ? 'columns' : 'header'}`, result.bytes!);
    const text = compact(pages.map((page) => page.text).join('')).replaceAll('-', '');
    for (const marker of ['TALL-ROW-SOURCE', 'NEIGHBOR', 'TABLE-END-SENTINEL'])
      expect(text.split(marker.replaceAll('-', '')), marker).toHaveLength(2);
    if (index === 0) expect(pages.every((page) => page.text.includes('REPEATED-HEADER'))).toBe(true);
    let pixels = 0;
    for (const page of pages) for (let offset = 0; offset < page.pixels.length; offset += 4)
      if (Math.abs(page.pixels[offset] - 204) < 2 && Math.abs(page.pixels[offset + 1] - 221) < 2 && Math.abs(page.pixels[offset + 2] - 170) < 2) pixels++;
    expect(pixels).toBeGreaterThan(700 * (index ? 100 : 240) * 0.75 ** 2 * 0.96);
  }
}, 60_000);

test('auto-height wrapped rows retain every word through header and column reservations', async () => {
  const words = Array.from({ length: 100 }, (_, index) => `AUTO${String(index).padStart(3, '0')}`);
  const snapshots = ['header-footer', 'columns'].map((kind) => {
    const snapshot = tableDoc([[words.join(' '), 'WRAPPED-NEIGHBOR'], ['AFTER-WRAPPED-ROW', 'LAST-CELL']]);
    snapshot.documentStyle.pageSize = { width: 600, height: 400 };
    for (const row of snapshot.tableSource!['native-table'].tableRows) row.trHeight.hRule = 0;
    snapshot.headers = { header: { headerId: 'header', body: body('REPEATED-HEADER') } };
    snapshot.footers = { footer: { footerId: 'footer', body: footerFields() } };
    Object.assign(snapshot.documentStyle, { defaultHeaderId: 'header', defaultFooterId: 'footer', marginHeader: 10, marginFooter: 10 });
    if (kind === 'columns') {
      const table = snapshot.tableSource!['native-table'];
      table.size.width.v = 200;
      for (const column of table.tableColumns) column.size.width.v = 100;
      for (const row of table.tableRows) for (const cell of row.tableCells) cell.size!.width.v = 100;
      snapshot.body!.sectionBreaks = [{
        sectionId: 'two-columns', startIndex: snapshot.body!.dataStream.length - 1,
        columnProperties: [{ width: 240, paddingEnd: 24 }, { width: 240, paddingEnd: 0 }],
      }];
    }
    return snapshot;
  });
  const results = await runDocJobs(await Promise.all(snapshots.map(async (snapshot) => ({ input: await docInput(snapshot) }))));
  for (const [index, result] of results.entries()) {
    expect(result, summary(result)).toMatchObject({ ok: true, restored: true, remainingFonts: 0 });
    const pages = await retainDocPdf(`auto-row-${index ? 'columns' : 'header-footer'}`, result.bytes!);
    expect(pages.length).toBeGreaterThan(1);
    const text = compact(pages.map((page) => page.text).join('')).replaceAll('-', '');
    for (const marker of [...words, 'WRAPPED-NEIGHBOR', 'AFTER-WRAPPED-ROW', 'LAST-CELL', 'TABLE-END-SENTINEL'])
      expect(text.split(marker.replaceAll('-', '')), marker).toHaveLength(2);
    for (const [pageIndex, page] of pages.entries()) {
      expect(page.text).toContain('REPEATED-HEADER');
      expect(compact(page.text)).toContain(`Page${pageIndex + 1}of${pages.length}`);
      const header = page.items.find((item) => item.str.includes('REPEATED-HEADER'))!;
      const footer = page.items.find((item) => item.str.includes('Page'))!;
      const content = page.items.filter((item) => /AUTO|NEIGHBOR|WRAPPED-ROW|LAST-CELL|TABLE-END/.test(item.str));
      expect(content.length).toBeGreaterThan(0);
      for (const item of content) {
        expect(item.transform[5]).toBeLessThan(header.transform[5] - 5);
        expect(item.transform[5]).toBeGreaterThan(footer.transform[5] + 5);
      }
    }
  }
}, 60_000);
