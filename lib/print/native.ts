/** Internal, incomplete native bridge. Not exported by the package entry point. */
import { randomUUID } from 'node:crypto';
import {
  ConfigService,
  ContextService,
  Injector,
  LocaleService,
  Styles,
  ThemeService,
  WrapStrategy,
  getDisplayValueFromCell,
} from '@univerjs/core';
import type { ICellDataForSheetInterceptor, IStyleData, IWorkbookData } from '@univerjs/core';
import {
  DEFAULT_PADDING_DATA,
  Group,
  Spreadsheet,
  SpreadsheetSkeleton,
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
import { prepareSheetLayout } from './layout.ts';
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
  override getCell(row: number, column: number): ICellDataForSheetInterceptor | null {
    const cell = super.getCell(row, column);
    if (!cell) return null;
    if (cell.p)
      throw new PrintError('unsupported', 'PDF rich-cell rendering is not implemented yet.');
    const style = cell.s as IStyleData;
    if (style.fs !== undefined && (!Number.isFinite(style.fs) || style.fs <= 0 || style.fs > 512))
      throw new PrintError('limit', 'PDF font size exceeds its layout budget.');
    const text = getDisplayValueFromCell(cell);
    if (
      /[\r\n\u2028\u2029]/u.test(text) ||
      style.tr?.a ||
      style.tr?.v ||
      style.tb === WrapStrategy.WRAP
    )
      throw new PrintError('unsupported', 'PDF multiline or rotated text is not implemented yet.');
    const runs = this.fonts.runs(text || ' ', style.ff, style.bl === 1, style.it === 1);
    const families = new Set(runs.map((run) => run.family));
    if (families.size !== 1)
      throw new PrintError('unsupported', 'PDF mixed-font cell shaping is not implemented yet.');
    return { ...cell, s: { ...style, ff: runs[0].family } };
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
 * Candidate renderer for the currently supported axis-aligned/plain-cell subset.
 * Call only inside the host's isolated worker/process. Never stream partial bytes.
 * Final rich text, overflow and complete image acceptance remain unfinished.
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
    const measurement = createCanvas(1, 1).getContext('2d');
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
      const skeleton = new SpreadsheetSkeleton(
        worksheet,
        styles,
        locale,
        context,
        config,
        injector,
      );
      const spreadsheet = new HeadlessSpreadsheet(`print-${sheet.id}`, skeleton, false);
      const group = new Group(`print-group-${sheet.id}`, spreadsheet);
      spreadsheet.isPrinting = true;
      try {
        skeleton.calculate();
        for (const page of layout.pages.filter((page) => page.sheetId === sheet.id)) {
          check();
          const view = viewport(page.source);
          skeleton.updateVisibleRange(view);
          skeleton.setStylesCache(view);
          // textFitsCurrentCell is only a native width hint (and is unset for
          // some numeric cells). Independently admit both dimensions of plain
          // text using the registered face; complex layout remains unsupported.
          skeleton.stylesCache.fontMatrix.forValue((row, column, font) => {
            check();
            if (
              font.documentSkeleton ||
              font.vertexAngle ||
              font.centerAngle ||
              font.wrapStrategy === WrapStrategy.WRAP
            )
              throw new PrintError('unsupported', 'PDF text continuation is not implemented yet.');
            measurement.font = font.fontString;
            const metrics = measurement.measureText(
              font.displayText ?? getDisplayValueFromCell(font.cellData),
            );
            const padding = font.style?.pd;
            const top = padding?.t ?? DEFAULT_PADDING_DATA.t;
            const bottom = padding?.b ?? DEFAULT_PADDING_DATA.b;
            const left = padding?.l ?? DEFAULT_PADDING_DATA.l;
            const right = padding?.r ?? DEFAULT_PADDING_DATA.r;
            const height = Math.max(
              metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent,
              metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
            );
            const width = Math.max(
              metrics.width,
              metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight,
            );
            const bounds = skeleton.getCellWithCoordByIndex(row, column);
            if (
              ![top, bottom, left, right, width, height].every(
                (value) => Number.isFinite(value) && value >= 0,
              ) ||
              width + left + right + 2 > bounds.endX - bounds.startX ||
              height + top + bottom + 2 > bounds.endY - bounds.startY
            )
              throw new PrintError('unsupported', 'PDF text exceeds its supported cell bounds.');
            return null;
          });
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
            const raster = decoded.get(image.source)!;
            const crop = image.crop,
              clip = image.clip;
            raw.globalAlpha = image.opacity;
            imageContext.drawImage(
              raster,
              crop.left * raster.width,
              crop.top * raster.height,
              (crop.right - crop.left) * raster.width,
              (crop.bottom - crop.top) * raster.height,
              clip.left,
              clip.top,
              clip.right - clip.left,
              clip.bottom - clip.top,
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
    return {
      bytes,
      pages: layout.pages.length,
      mediaBox: { ...FRAME },
      durationMs: performance.now() - started,
    };
  } catch (error) {
    if (error instanceof PrintError) throw error;
    throw new PrintError('invalid-input', 'Native PDF rendering failed.');
  } finally {
    // close() is the backend's only public finalizer. Failure output is discarded;
    // the host must terminate the worker for hard native-time/memory enforcement.
    try {
      if (pdf && !closed) pdf.close();
    } catch {
      /* Preserve the original failure. */
    }
    try {
      locale?.dispose();
      context?.dispose();
      config?.dispose();
      injector?.dispose();
    } finally {
      try {
        if (keys.length && GlobalFonts.removeBatch(keys) !== keys.length)
          throw new PrintError('invalid-input', 'Native PDF font cleanup failed.');
        invalidateDocumentFontMetrics((style) =>
          fontAliases.some((alias) => style.includes(alias)),
        );
      } finally {
        try {
          restore?.();
        } finally {
          rendering = false;
        }
      }
    }
  }
}
