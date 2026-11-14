/** Bounded Sheet public-model/rendering probe, not a production export adapter. */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  ConfigService,
  ContextService,
  Injector,
  LocaleService,
  Styles,
  ThemeService,
  Worksheet,
} from '@univerjs/core';
import type { IWorkbookData } from '@univerjs/core';
import {
  Group,
  Spreadsheet,
  SpreadsheetSkeleton,
  Transform,
  UniverPrintingContext,
} from '@univerjs/engine-render';
import type { IViewportInfo } from '@univerjs/engine-render';
import { createCanvas, GlobalFonts, Image, Path2D, PDFDocument } from '@napi-rs/canvas';

Object.defineProperty(globalThis, 'OffscreenCanvas', {
  value: class {
    constructor(width: number, height: number) {
      return createCanvas(width, height);
    }
  },
});
Object.defineProperty(globalThis, 'Image', { value: Image });
Object.defineProperty(globalThis, 'Path2D', { value: Path2D });
class PdfContext extends UniverPrintingContext {
  override setLineDash(segments: number[]) {
    super.setLineDash(segments.every((value) => value === 0) ? [] : segments);
  }
}
class HeadlessSpreadsheet extends Spreadsheet {
  // Public telemetry hooks normally publish to the editor Scene's Engine.
  // No editor Scene or frame metrics are needed in this one-shot export probe.
  override addRenderFrameTimeMetricToScene() {}
  override addRenderTagToScene() {}
}
const output = resolve(process.argv[2] ?? 'output/pdf/spn-097');
const pageCap = Number(
  process.argv.find((value) => value.startsWith('--page-cap='))?.split('=')[1] ?? 6,
);
if (!Number.isInteger(pageCap) || pageCap < 1 || pageCap > 6)
  throw new Error('Use a page cap from 1 to 6.');
await mkdir(output, { recursive: true });
await rm(resolve(output, 'native-sheet.pdf'), { force: true });
const started = performance.now();
GlobalFonts.registerFromPath('src/ui/fonts/AtkinsonHyperlegible-Bold.ttf', 'Probe');
const snapshot: IWorkbookData = {
  id: 'synthetic-sheet',
  name: 'Synthetic sheets',
  appVersion: '1.1.0',
  locale: 'enUS' as IWorkbookData['locale'],
  styles: {
    base: { ff: 'Probe', fs: 12, cl: { rgb: '#222222' } },
    heading: { ff: 'Probe', fs: 16, bg: { rgb: '#efd9e9' } },
  },
  sheetOrder: ['wide', 'hidden', 'narrow'],
  sheets: {
    wide: {
      id: 'wide',
      name: 'Wide with image extent',
      rowCount: 80,
      columnCount: 8,
      defaultRowHeight: 28,
      defaultColumnWidth: 180,
      defaultStyle: 'base',
      rowHeader: { width: 0, hidden: 1 },
      columnHeader: { height: 0, hidden: 1 },
      rowData: { 4: { hd: 1 } },
      columnData: { 2: { hd: 1 } },
      mergeData: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 3 }],
      cellData: Object.fromEntries(
        Array.from({ length: 66 }, (_, row) => [
          row,
          Object.fromEntries(
            Array.from({ length: 6 }, (_, col) => [
              col,
              {
                v: row === 0 ? (col === 0 ? 'Merged heading' : '') : `R${row + 1} C${col + 1}`,
                s: row === 0 ? 'heading' : 'base',
              },
            ]),
          ),
        ]),
      ),
    },
    hidden: {
      id: 'hidden',
      name: 'HIDDEN-SENTINEL',
      hidden: 1,
      rowCount: 1,
      columnCount: 1,
      cellData: { 0: { 0: { v: 'HIDDEN-SENTINEL' } } },
    },
    narrow: {
      id: 'narrow',
      name: 'Narrow - never enlarged',
      rowCount: 2,
      columnCount: 2,
      defaultRowHeight: 28,
      defaultColumnWidth: 100,
      defaultStyle: 'base',
      rowHeader: { width: 0, hidden: 1 },
      columnHeader: { height: 0, hidden: 1 },
      cellData: { 0: { 0: { v: 'NARROW-END' } } },
    },
  },
};
const imageExtent = { left: 750, top: 1900, width: 150, height: 100 };
const image = createCanvas(150, 100),
  imageContext = image.getContext('2d');
imageContext.fillStyle = '#775276';
imageContext.fillRect(0, 0, 150, 100);
imageContext.fillStyle = '#f5c85d';
imageContext.fillRect(12, 12, 126, 76);
imageContext.fillStyle = '#222222';
imageContext.font = '18px Probe';
imageContext.fillText('IMAGE-END', 14, 55);
await writeFile(
  resolve(output, 'sheet-fixture.json'),
  JSON.stringify({ snapshot, imageExtent }, null, 2),
);
const pdf = new PDFDocument({
  title: 'Synthetic Sheet feasibility',
  author: '',
  creator: 'SPN-097 probe',
});
const locale = new LocaleService(),
  contextService = new ContextService(),
  config = new ConfigService(),
  injector = new Injector([[ThemeService]]);
const styles = new Styles(snapshot.styles);
const pageWidth = (210 / 25.4) * 72,
  pageHeight = (297 / 25.4) * 72,
  margin = 36;
const pages: { sheet: string; slice: number; scale: number }[] = [],
  failures: string[] = [];
for (const id of snapshot.sheetOrder.filter((id) => !snapshot.sheets[id].hidden)) {
  const sheet = new Worksheet(snapshot.id, snapshot.sheets[id], styles);
  const skeleton = new SpreadsheetSkeleton(sheet, styles, locale, contextService, config, injector);
  const spreadsheet = new HeadlessSpreadsheet(`render-${id}`, skeleton, false);
  const group = new Group(`group-${id}`, spreadsheet);
  spreadsheet.isPrinting = true;
  // Explicit fixture geometry only. A production used-range/image/hidden-axis
  // adapter must compute these from authorized native resources, not constants.
  const width = id === 'wide' ? 900 : 200;
  const height = id === 'wide' ? 2000 : 56;
  const scale = Math.min(1, (pageWidth - 2 * margin) / (width * 0.75));
  const sliceHeight = Math.floor((pageHeight - 2 * margin) / (0.75 * scale) / 28) * 28;
  try {
    skeleton.calculate();
    for (let top = 0, slice = 0; top < height; top += sliceHeight, slice++) {
      if (pages.length >= pageCap) throw new Error(`Probe exceeded its ${pageCap}-page cap.`);
      const raw = pdf.beginPage(pageWidth, pageHeight);
      raw.fillStyle = '#ffffff';
      raw.fillRect(0, 0, pageWidth, pageHeight);
      raw.save();
      raw.beginPath();
      raw.rect(
        margin,
        margin,
        width * 0.75 * scale,
        Math.min(sliceHeight, height - top) * 0.75 * scale,
      );
      raw.clip();
      raw.translate(margin, margin);
      raw.scale(scale * 0.75, scale * 0.75);
      raw.translate(0, -top);
      const bound = { left: 0, top, right: width, bottom: Math.min(height, top + sliceHeight) };
      const viewport: IViewportInfo = {
        viewBound: bound,
        diffBounds: [],
        diffX: 0,
        diffY: 0,
        viewPortPosition: bound,
        viewportKey: 'probe',
        isForceDirty: true,
        allowCache: false,
        cacheBound: bound,
        diffCacheBounds: [],
        cacheViewPortPosition: bound,
        shouldCacheUpdate: 0,
        sceneTrans: new Transform(),
        leftOrigin: 0,
        topOrigin: 0,
        bufferEdgeX: 0,
        bufferEdgeY: 0,
      };
      skeleton.updateVisibleRange(viewport);
      skeleton.setStylesCache(viewport);
      spreadsheet.draw(new PdfContext(raw as unknown as CanvasRenderingContext2D), viewport);
      if (id === 'wide') {
        // The PDF context's published return type omits SKRS drawImage, while
        // the runtime exposes it. Feature-check it rather than assuming support.
        if (!('drawImage' in raw) || typeof raw.drawImage !== 'function')
          throw new Error('PDF image composition is unavailable.');
        raw.drawImage(
          image,
          imageExtent.left,
          imageExtent.top,
          imageExtent.width,
          imageExtent.height,
        );
      }
      raw.restore();
      pdf.endPage();
      pages.push({ sheet: id, slice, scale });
    }
  } catch (cause) {
    failures.push(cause instanceof Error ? (cause.stack ?? cause.message) : String(cause));
    break;
  } finally {
    spreadsheet.parent = undefined;
    group.dispose();
    skeleton.dispose();
  }
}
const bytes = pdf.close();
if (!failures.length) await writeFile(resolve(output, 'native-sheet.pdf'), bytes);
const metrics = {
  pages,
  failures,
  bytes: bytes.length,
  durationMs: performance.now() - started,
  maxRssKiB: process.resourceUsage().maxRSS,
  memory: process.memoryUsage(),
  limitation:
    'Fixture uses explicit extent and fixed-height row-aligned page slices; image is composited from prepared bytes, not parsed drawing anchors. Variable heights and page-spanning merges/images remain unproven.',
};
await writeFile(resolve(output, 'sheet-metrics.json'), JSON.stringify(metrics, null, 2));
console.log(JSON.stringify(metrics));
locale.dispose();
contextService.dispose();
config.dispose();
injector.dispose();
if (failures.length) process.exitCode = 1;
