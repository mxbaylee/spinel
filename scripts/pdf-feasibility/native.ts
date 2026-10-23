/** Bounded feasibility only: public native layout -> public Canvas PDF context. */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DocumentDataModel, DocumentFlavor, LocaleService } from '@univerjs/core';
import type { IDocumentData, ITable } from '@univerjs/core';
import {
  Documents,
  DocumentSkeleton,
  DocumentViewModel,
  UniverPrintingContext,
} from '@univerjs/engine-render';
import { PDFDocument, GlobalFonts, createCanvas } from '@napi-rs/canvas';

// Univer's public worker layout uses the standard OffscreenCanvas measurement surface.
// Node has none; provide that surface using the installed public Canvas API.
Object.defineProperty(globalThis, 'OffscreenCanvas', {
  value: class {
    constructor(width: number, height: number) {
      return createCanvas(width, height);
    }
  },
});
class PdfContext extends UniverPrintingContext {
  // Univer emits [0] for solid borders; Skia's PDF backend rejects a zero-total
  // dash pattern. Normalize that public Canvas call to the equivalent solid [].
  override setLineDash(segments: number[]) {
    super.setLineDash(segments.every((value) => value === 0) ? [] : segments);
  }
}

const output = resolve(process.argv[2] ?? 'output/pdf/spn-097');
const pageCap = Number(
  process.argv.find((value) => value.startsWith('--page-cap='))?.split('=')[1] ?? 8,
);
if (!Number.isInteger(pageCap) || pageCap < 1 || pageCap > 8)
  throw new Error('Use a page cap from 1 to 8.');
await mkdir(output, { recursive: true });
await rm(resolve(output, 'native-doc.pdf'), { force: true });
const started = performance.now();
GlobalFonts.registerFromPath('src/ui/fonts/AtkinsonHyperlegible-Bold.ttf', 'Probe');
const lines = [
  'SPN-097 native Doc layout',
  ...Array.from(
    { length: 22 },
    (_, i) =>
      `Paragraph ${String(i + 1).padStart(2, '0')}: Native public layout must preserve every word and paginate this bounded document.`,
  ),
  'EXPLICIT BREAK - final paragraph',
];
let cursor = 0;
const paragraphs = lines.map((text, i) => {
  cursor += text.length;
  const paragraph = {
    paragraphId: `paragraph-${i}`,
    startIndex: cursor,
    paragraphStyle: i === lines.length - 1 ? { pageBreakBefore: 1 as const } : {},
  };
  cursor++;
  return paragraph;
});
// A prepared, already-authorized Formula result becomes a normal native table.
// This does not evaluate formulas, authorize sources or modify persisted content.
const tableStart = lines.slice(0, -1).join('\r').length + 1;
let tableText = '\x1a';
const tableParagraphs: { startIndex: number; paragraphId: string }[] = [];
for (let row = 1; row <= 30; row++) {
  tableText += '\x1b';
  for (const value of [`ROW-${String(row).padStart(2, '0')}`, `Prepared value ${row * 7}`]) {
    tableText += `\x1c${value}`;
    tableParagraphs.push({
      startIndex: tableStart + tableText.length,
      paragraphId: `cell-${tableParagraphs.length}`,
    });
    tableText += '\r\n\x1d';
  }
  tableText += '\x0e';
}
tableText += '\x0f';
const border = { color: { rgb: '#775276' }, width: { v: 1, u: 3 as const }, dashStyle: 1 as const };
const table: ITable = {
  tableId: 'prepared-result',
  align: 0,
  indent: { v: 0 },
  textWrap: 0,
  position: { positionH: { relativeFrom: 3 }, positionV: { relativeFrom: 1 } },
  dist: { distT: 0, distB: 0, distL: 0, distR: 0 },
  size: { type: 1, width: { v: 480, u: 3 } },
  layout: 1,
  tableColumns: [160, 320].map((v) => ({ size: { type: 1, width: { v, u: 3 } } })),
  tableRows: Array.from({ length: 30 }, () => ({
    trHeight: { val: { v: 30, u: 3 }, hRule: 1 },
    tableCells: [160, 320].map((v) => ({
      size: { type: 1, width: { v, u: 3 } },
      margin: {
        start: { v: 5, u: 3 },
        end: { v: 5, u: 3 },
        top: { v: 5, u: 3 },
        bottom: { v: 5, u: 3 },
      },
      borderTop: border,
      borderBottom: border,
      borderLeft: border,
      borderRight: border,
    })),
  })),
};
const snapshot: IDocumentData = {
  id: 'synthetic-doc',
  body: {
    dataStream: `${lines.slice(0, -1).join('\r')}\r${tableText}\f${lines.at(-1)}\r\n`,
    paragraphs: [
      ...paragraphs.slice(0, -1),
      ...tableParagraphs,
      {
        paragraphId: 'final-break',
        startIndex: tableStart + tableText.length + 1 + lines.at(-1)!.length,
        paragraphStyle: { pageBreakBefore: 1 },
      },
    ],
    tables: [
      { startIndex: tableStart, endIndex: tableStart + tableText.length, tableId: table.tableId },
    ],
    textRuns: [{ st: 0, ed: lines[0].length, ts: { fs: 20, bl: 1, cl: { rgb: '#775276' } } }],
  },
  tableSource: { [table.tableId]: table },
  documentStyle: {
    documentFlavor: DocumentFlavor.TRADITIONAL,
    pageSize: { width: 600, height: 700 },
    marginTop: 48,
    marginBottom: 48,
    marginLeft: 48,
    marginRight: 48,
    textStyle: { ff: 'Probe', fs: 14 },
  },
};
await writeFile(resolve(output, 'native-fixture.json'), JSON.stringify(snapshot, null, 2));
const locale = new LocaleService();
const model = new DocumentDataModel(snapshot);
const view = new DocumentViewModel(model);
const skeleton = new DocumentSkeleton(view, locale);
const document = new Documents('synthetic-render', skeleton, {
  pageMarginLeft: 0,
  pageMarginTop: 0,
  hasEditor: false,
  pageFillColor: '#ffffff',
});
const pdf = new PDFDocument({
  title: 'Synthetic native layout feasibility',
  author: '',
  creator: 'SPN-097 probe',
});
const failures: string[] = [];
let pages = 0;
try {
  skeleton.calculate();
  const data = skeleton.getSkeletonData();
  if (!data?.pages.length) throw new Error('No pages materialized.');
  if (data.pages.length > pageCap) throw new Error(`Probe exceeded its ${pageCap}-page cap.`);
  let top = 0;
  for (const page of data.pages) {
    const raw = pdf.beginPage(page.pageWidth * 0.75, page.pageHeight * 0.75);
    raw.scale(0.75, 0.75);
    raw.fillStyle = '#ffffff';
    raw.fillRect(0, 0, page.pageWidth, page.pageHeight);
    raw.translate(0, -top);
    // Both are public Canvas 2D APIs; compatibility is what this probe measures.
    const context = new PdfContext(raw as unknown as CanvasRenderingContext2D);
    document.draw(context);
    pdf.endPage();
    pages++;
    top += page.pageHeight;
  }
} catch (cause) {
  failures.push(cause instanceof Error ? (cause.stack ?? cause.message) : String(cause));
}
const bytes = pdf.close();
if (!failures.length) await writeFile(resolve(output, 'native-doc.pdf'), bytes);
await writeFile(
  resolve(output, 'native-metrics.json'),
  JSON.stringify(
    {
      pages,
      failures,
      bytes: bytes.length,
      durationMs: performance.now() - started,
      maxRssKiB: process.resourceUsage().maxRSS,
      memory: process.memoryUsage(),
      limitation:
        'Synthetic paragraphs, explicit break and prepared 30-row table; no native image or Sheet proof in this file. All text uses the one bundled bold font.',
    },
    null,
    2,
  ),
);
document.dispose();
skeleton.dispose();
view.dispose();
model.dispose();
locale.dispose();
console.log(
  JSON.stringify({
    pages,
    failures,
    bytes: bytes.length,
    durationMs: performance.now() - started,
    maxRssKiB: process.resourceUsage().maxRSS,
  }),
);
if (failures.length) process.exitCode = 1;
