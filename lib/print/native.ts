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
  UniverPrintingContext,
  invalidateDocumentFontMetrics,
} from '@univerjs/engine-render';
import type { IViewportInfo } from '@univerjs/engine-render';
import { createCanvas, GlobalFonts, Image, Path2D, PDFDocument } from '@napi-rs/canvas';
import type { FontKey, SKRSContext2D } from '@napi-rs/canvas';
import { PrintError, printCheckpoint, printLimits } from './contract.ts';
import type { PreparedFont, PreparedImage, PrintBox, SheetPrintOptions } from './contract.ts';
import { PreparedFonts } from './fonts.ts';
import { prepareSheetLayout, replanSheetPages } from './layout.ts';
import { drawPreparedImage } from './image-render.ts';
import { unionBox } from './preflight.ts';
import { measureSheetInk, prepareCellText, PrintSkeleton } from './text.ts';
import { PrintWorksheet } from './worksheet.ts';

// Skia's public PDF backend quantizes the requested A4 MediaBox to integer points
// (SPN-097). Use that same actual frame for every clip/margin calculation. This
// candidate still needs reopened-PDF evidence before becoming a production API.
const FRAME = { width: 595, height: 842 };
const MARGIN = 36;
let rendering = false;

export interface NativeSheetInput {
  snapshot: IWorkbookData;
  images: readonly PreparedImage[];
  fonts: readonly PreparedFont[];
  defaultFamily: string;
  fallbackFamilies?: readonly string[];
}

class PdfContext extends UniverPrintingContext {
  override setLineDash(segments: number[]) {
    // Canvas permits an all-zero dash array; the native PDF backend rejects it.
    super.setLineDash(segments.every((value) => value === 0) ? [] : segments);
  }
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

/** Install only for the serialized native operation and restore exact descriptors. */
function canvasGlobals(pixelLimit: number, check: () => void) {
  const names = ['OffscreenCanvas', 'Image', 'Path2D'] as const;
  const saved = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  const restore = () => {
    names.forEach((name, index) => {
      if (saved[index]) Object.defineProperty(globalThis, name, saved[index]!);
      else Reflect.deleteProperty(globalThis, name);
    });
  };
  const nativeSource = Object.getOwnPropertyDescriptor(Image.prototype, 'src');
  if (!nativeSource?.set || !nativeSource.get)
    throw new PrintError('unsupported', 'The native PDF image adapter is unavailable.');
  class LocalImage extends Image {
    constructor() {
      super();
      Object.defineProperty(this, 'src', {
        get: () => nativeSource!.get!.call(this),
        set: (value: unknown) => {
          check();
          // The native Font extension creates a fixed inline SVG fallback even
          // without cell images. Decode inline bytes only; never pass a string
          // (which the canvas API can interpret as a file/URL) to native Image.
          if (
            typeof value === 'string' &&
            value.length <= 16_384 &&
            /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/.test(value)
          ) {
            nativeSource!.set!.call(
              this,
              Buffer.from(value.slice(value.indexOf(',') + 1), 'base64'),
            );
          } else if (value instanceof Uint8Array) nativeSource!.set!.call(this, value);
          else throw new PrintError('unsupported', 'Native PDF images require prepared bytes.');
        },
      });
    }
  }
  class BoundedCanvas {
    constructor(width: number, height: number) {
      check();
      if (
        !Number.isSafeInteger(width) ||
        !Number.isSafeInteger(height) ||
        width < 0 ||
        height < 0 ||
        !Number.isSafeInteger(width * height) ||
        width * height > pixelLimit
      )
        throw new PrintError('limit', 'PDF canvas exceeds its pixel budget.');
      return createCanvas(width, height);
    }
  }
  try {
    for (const [name, value] of Object.entries({
      OffscreenCanvas: BoundedCanvas,
      Image: LocalImage,
      Path2D,
    }))
      Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  } catch {
    restore();
    throw new PrintError('unsupported', 'The native PDF canvas environment is unavailable.');
  }
  return restore;
}

/**
 * Call only inside the host's isolated worker/process. Never stream partial bytes.
 * All selected content, complete native text layout, pages and cleanup must succeed.
 */
export async function renderSheetPdfCandidate(
  input: NativeSheetInput,
  options: SheetPrintOptions = {},
) {
  if (rendering)
    throw new PrintError('limit', 'A native PDF render is already active in this worker.');
  rendering = true;
  const started = performance.now();
  const keys: FontKey[] = [];
  let fontAliases: string[] = [];
  let restore: (() => void) | undefined;
  let pdf: PDFDocument | undefined;
  let closed = false;
  let locale: LocaleService | undefined, context: ContextService | undefined;
  let config: ConfigService | undefined, injector: Injector | undefined;
  let result:
    { bytes: Uint8Array; pages: number; mediaBox: typeof FRAME; durationMs: number } | undefined;
  let failure: PrintError | undefined;
  let cleanupFailed = false;
  try {
    const limits = printLimits(options);
    const deadline = started + limits.durationMs;
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
    // Require a dedicated worker started with DISABLE_SYSTEM_FONTS_LOAD=1 before
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
      const worksheet = new FontWorksheet(layout.book, sheetConfig, styles);
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
        spreadsheet.parent = undefined;
        group.dispose();
        skeleton.dispose();
      }
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
      durationMs: performance.now() - started,
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
    try {
      locale?.dispose();
      context?.dispose();
      config?.dispose();
      injector?.dispose();
    } catch {
      cleanupFailed = true;
    }
    try {
      if (keys.length && GlobalFonts.removeBatch(keys) !== keys.length) cleanupFailed = true;
      invalidateDocumentFontMetrics((style) => fontAliases.some((alias) => style.includes(alias)));
    } catch {
      cleanupFailed = true;
    }
    try {
      restore?.();
    } catch {
      cleanupFailed = true;
    }
    rendering = false;
  }
  if (failure) throw failure;
  if (cleanupFailed) throw new PrintError('invalid-input', 'Native PDF cleanup failed.');
  return result!;
}
