/** Isolated native renderer using only public open-source model and drawing APIs. */
import { randomUUID } from 'node:crypto';
import {
  ConfigService,
  ContextService,
  Injector,
  LocaleService,
  Styles,
  ThemeService,
} from '@univerjs/core';
import type { ICellDataForSheetInterceptor, IWorkbookData } from '@univerjs/core';
import {
  Group,
  Spreadsheet,
  Transform,
  invalidateDocumentFontMetrics,
} from '@univerjs/engine-render';
import type { IViewportInfo } from '@univerjs/engine-render';
import { GlobalFonts, Image, PDFDocument } from '@napi-rs/canvas';
import type { FontKey, SKRSContext2D } from '@napi-rs/canvas';
import { PrintError, printCheckpoint, printLimits } from './contract.ts';
import type { PreparedFont, PreparedImage, PrintBox, SheetPrintOptions } from './contract.ts';
import { PreparedFonts } from './fonts.ts';
import { prepareSheetLayout, replanSheetPages } from './layout.ts';
import { drawPreparedImage } from './image-render.ts';
import { unionBox } from './preflight.ts';
import { measureSheetInk, prepareCellText, PrintSkeleton } from './text.ts';
import { PrintWorksheet } from './worksheet.ts';
import { canvasGlobals, PdfContext, acquireNativeRender } from './native-runtime.ts';

// Skia's public PDF backend quantizes the requested A4 MediaBox to integer points
// (SPN-097). Use that same actual frame for every clip/margin calculation.
const FRAME = { width: 595, height: 842 };
const MARGIN = 36;

export interface NativeSheetInput {
  snapshot: IWorkbookData;
  images: readonly PreparedImage[];
  fonts: readonly PreparedFont[];
  defaultFamily: string;
  fallbackFamilies?: readonly string[];
}

class HeadlessSpreadsheet extends Spreadsheet {
  // Public telemetry hooks require the editor's Scene; this isolated renderer
  // owns no editor Scene or interactive frame statistics.
  override addRenderFrameTimeMetricToScene() {}
  override addRenderTagToScene() {}
}

class FontWorksheet extends PrintWorksheet {
  fonts!: PreparedFonts;
  private prepared = new Map<string, ICellDataForSheetInterceptor | null>();
  override getCell(row: number, column: number): ICellDataForSheetInterceptor | null {
    this.textBudget?.check();
    const key = `${row}:${column}`;
    if (this.prepared.has(key)) return this.prepared.get(key)!;
    const raw = super.getCell(row, column);
    const cell = raw ? prepareCellText(raw, this.fonts) : null;
    this.prepared.set(key, cell);
    return cell;
  }
}

function viewport(bounds: PrintBox): IViewportInfo {
  return {
    viewBound: bounds,
    diffBounds: [],
    diffX: 0,
    diffY: 0,
    viewPortPosition: bounds,
    viewportKey: 'print',
    isForceDirty: true,
    allowCache: false,
    cacheBound: bounds,
    diffCacheBounds: [],
    cacheViewPortPosition: bounds,
    shouldCacheUpdate: 0,
    sceneTrans: new Transform(),
    leftOrigin: 0,
    topOrigin: 0,
    bufferEdgeX: 0,
    bufferEdgeY: 0,
  };
}

/**
 * Call only inside the host's isolated process. Never stream partial bytes.
 * All selected content, complete native text layout, pages and cleanup must succeed.
 */
export async function renderSheetPdfCandidate(
  input: NativeSheetInput,
  options: SheetPrintOptions = {},
) {
  const release = acquireNativeRender();
  const started = performance.now();
  let deadline = started;
  const keys: FontKey[] = [];
  let fontAliases: string[] = [];
  let restore: (() => void) | undefined;
  let pdf: PDFDocument | undefined;
  let closed = false;
  let locale: LocaleService | undefined, context: ContextService | undefined;
  let config: ConfigService | undefined, injector: Injector | undefined;
  let result: { bytes: Uint8Array; pages: number; mediaBox: typeof FRAME } | undefined;
  let failure: PrintError | undefined;
  let cleanupFailed = false;
  try {
    const limits = printLimits(options);
    deadline = started + limits.durationMs;
    const check = () => printCheckpoint(options.signal, deadline);
    check();
    // Admission owns the font bytes before any await; metadata validation cannot
    // observe later caller edits. This registers no system font directories.
    const fonts = new PreparedFonts(
      input.fonts,
      input.defaultFamily,
      input.fallbackFamilies ?? [],
      limits,
    );
    // Native text-layout caches also key by font string. The public document
    // metrics invalidator does not clear every cache, so never reuse an alias
    // for different owned font bytes in a later operation in this process.
    const fontNamespace = `Print${randomUUID().replaceAll('-', '')}`;
    for (const face of fonts.faces) face.alias = `${fontNamespace}_${face.alias}`;
    check();
    const layout = await prepareSheetLayout(input.snapshot, input.images, FRAME, options, deadline);
    check();
    // Require a dedicated process started with DISABLE_SYSTEM_FONTS_LOAD=1 before
    // importing this module. Never remove or implicitly fall back to host fonts.
    if (GlobalFonts.families.length)
      throw new PrintError(
        'unsupported',
        'Native PDF rendering requires an empty isolated font registry.',
      );
    fontAliases = [...new Set(fonts.faces.map((face) => face.alias))];
    invalidateDocumentFontMetrics((style) => fontAliases.some((alias) => style.includes(alias)));
    restore = canvasGlobals(limits.decodedImagePixels, check);
    for (const face of fonts.faces) {
      check();
      const key = GlobalFonts.register(face.bytes, face.alias);
      if (!key)
        throw new PrintError('invalid-input', 'A prepared PDF font could not be registered.');
      keys.push(key);
      if (!GlobalFonts.has(face.alias))
        throw new PrintError('invalid-input', 'A prepared PDF font alias is unavailable.');
    }
    const decoded = new Map<string, Image>();
    for (const [source, admitted] of layout.images) {
      check();
      const image = new Image();
      image.src = admitted.bytes;
      await image.decode();
      check();
      if (!image.complete || image.width !== admitted.width || image.height !== admitted.height)
        throw new PrintError('invalid-input', 'Decoded PDF image dimensions changed.');
      decoded.set(source, image);
    }
    locale = new LocaleService();
    context = new ContextService();
    config = new ConfigService();
    injector = new Injector([[ThemeService]]);
    const styles = new Styles(layout.book.styles);
    pdf = new PDFDocument({ title: '', author: '', creator: '@spinel/print' });
    for (const sheet of layout.sheets) {
      check();
      const sheetConfig = {
        ...layout.book.sheets[sheet.id],
        rowHeader: { width: 0, hidden: 1 as const },
        columnHeader: { height: 0, hidden: 1 as const },
        zoomRatio: 1,
        scrollTop: 0,
        scrollLeft: 0,
      };
      const worksheet = new FontWorksheet(layout.book, sheetConfig, styles, layout.textBudget);
      worksheet.fonts = fonts;
      const skeleton = new PrintSkeleton(worksheet, styles, locale, context, config, injector);
      const spreadsheet = new HeadlessSpreadsheet(`print-${sheet.id}`, skeleton, false);
      const group = new Group(`print-group-${sheet.id}`, spreadsheet);
      spreadsheet.isPrinting = true;
      try {
        skeleton.calculate();
        if (sheet.bounds) {
          const ink = measureSheetInk(
            spreadsheet,
            skeleton,
            viewport(sheet.bounds),
            layout.limits,
            check,
          );
          if (ink) sheet.bounds = unionBox(sheet.bounds, ink);
        }
        // Native overflow and outer border ink can extend beyond occupied cells.
        // Recheck aggregate grid/page/tile budgets before allocating their pages.
        layout.pages = replanSheetPages(layout, FRAME, check);
        for (const page of layout.pages.filter((page) => page.sheetId === sheet.id)) {
          check();
          const view = viewport(page.source);
          skeleton.setStylesCache(view);
          const raw = pdf.beginPage(FRAME.width, FRAME.height);
          raw.fillStyle = '#ffffff';
          raw.fillRect(0, 0, FRAME.width, FRAME.height);
          raw.save();
          raw.beginPath();
          raw.rect(
            MARGIN,
            MARGIN,
            (page.source.right - page.source.left) * page.scale,
            (page.source.bottom - page.source.top) * page.scale,
          );
          raw.clip();
          raw.translate(MARGIN, MARGIN);
          raw.scale(page.scale, page.scale);
          raw.translate(-page.source.left, -page.source.top);
          // Published PDF context typing omits drawImage; the public runtime has
          // it. Feature-check rather than passing through an unchecked string URL.
          const imageContext = raw as unknown as SKRSContext2D;
          if (typeof imageContext.drawImage !== 'function')
            throw new PrintError('unsupported', 'PDF image composition is unavailable.');
          if (page.background) {
            const background = page.background;
            const image = decoded.get(background.source)!;
            raw.save();
            raw.beginPath();
            raw.rect(
              background.clip.left,
              background.clip.top,
              background.clip.right - background.clip.left,
              background.clip.bottom - background.clip.top,
            );
            raw.clip();
            const left =
              Math.floor(background.clip.left / background.tileWidth) * background.tileWidth;
            const top =
              Math.floor(background.clip.top / background.tileHeight) * background.tileHeight;
            for (let y = top; y < background.clip.bottom; y += background.tileHeight)
              for (let x = left; x < background.clip.right; x += background.tileWidth) {
                check();
                imageContext.drawImage(image, x, y, background.tileWidth, background.tileHeight);
              }
            raw.restore();
          }
          spreadsheet.draw(new PdfContext(raw as unknown as CanvasRenderingContext2D), view);
          for (const image of page.images) {
            check();
            drawPreparedImage(
              new PdfContext(raw as unknown as CanvasRenderingContext2D),
              decoded.get(image.source)!,
              image,
            );
          }
          raw.globalAlpha = 1;
          raw.restore();
          pdf.endPage();
        }
      } finally {
        try {
          spreadsheet.parent = undefined;
          group.dispose();
        } catch {
          cleanupFailed = true;
        }
        try {
          skeleton.dispose();
        } catch {
          cleanupFailed = true;
        }
      }
      if (cleanupFailed) throw new PrintError('cleanup', 'Native PDF cleanup failed.');
    }
    check();
    const bytes = pdf.close();
    closed = true;
    check();
    if (bytes.length > limits.outputBytes)
      throw new PrintError('limit', 'PDF output exceeds its byte budget.');
    result = {
      bytes,
      pages: layout.pages.length,
      mediaBox: { ...FRAME },
    };
  } catch (error) {
    failure =
      error instanceof PrintError
        ? error
        : new PrintError('invalid-input', 'Native PDF rendering failed.');
  } finally {
    // close() is the backend's public finalizer. Failed output is discarded; the
    // host terminates its process for hard native-time/memory enforcement.
    try {
      if (pdf && !closed) pdf.close();
    } catch {
      cleanupFailed = true;
    }
    for (const service of [locale, context, config, injector]) {
      try {
        service?.dispose();
      } catch {
        cleanupFailed = true;
      }
    }
    try {
      if (keys.length && GlobalFonts.removeBatch(keys) !== keys.length) cleanupFailed = true;
    } catch {
      cleanupFailed = true;
    }
    try {
      invalidateDocumentFontMetrics((style) => fontAliases.some((alias) => style.includes(alias)));
    } catch {
      cleanupFailed = true;
    }
    try {
      restore?.();
    } catch {
      cleanupFailed = true;
    }
    release();
  }
  if (cleanupFailed) throw new PrintError('cleanup', 'Native PDF cleanup failed.');
  if (failure) throw failure;
  // Cleanup is part of the operation. A late cancellation/deadline still
  // discards the completed bytes, and reported duration includes that cleanup.
  printCheckpoint(options.signal, deadline);
  return { ...result!, durationMs: performance.now() - started };
}
