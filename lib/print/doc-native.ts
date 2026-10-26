/** Standalone native Doc rendering with no source resolver, browser, or Pro code. */
import { randomUUID } from 'node:crypto';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { DocumentDataModel, LocaleService } from '@univerjs/core';
import type { IDocumentData } from '@univerjs/core';
import {
  DocumentSkeleton,
  Documents,
  DocumentViewModel,
  invalidateDocumentFontMetrics,
} from '@univerjs/engine-render';
import type { IDocumentSkeletonPage } from '@univerjs/engine-render';
import { createCanvas, GlobalFonts, Image, PDFDocument } from '@napi-rs/canvas';
import type { FontKey } from '@napi-rs/canvas';
import { PrintError, printCheckpoint, printLimits } from './contract.ts';
import type { PreparedFont, PreparedImage, PrintBox, SheetPrintOptions } from './contract.ts';
import { PreparedFonts } from './fonts.ts';
import { admitImages } from './images.ts';
import { drawPreparedImage } from './image-render.ts';
import { acquireNativeRender, canvasGlobals, PdfContext } from './native-runtime.ts';
import { InkContext } from './text.ts';
import { prepareDocSnapshot, prepareDocFonts } from './doc-preparation.ts';
import type { PreparedDocFormula } from './doc-preparation.ts';
import { paginateDocument, virtualDocFrame } from './doc-layout.ts';
import { preservePdfPageGeometry } from './pdf-geometry.ts';

export type DocPrintOptions = Pick<SheetPrintOptions, 'limits' | 'signal'>;
export interface NativeDocInput {
  snapshot: IDocumentData;
  formulas?: readonly PreparedDocFormula[];
  images: readonly PreparedImage[];
  fonts: readonly PreparedFont[];
  defaultFamily: string;
  fallbackFamilies?: readonly string[];
}

/** Use only the public skeleton presentation API; retain native flow untouched. */
class PrintDocumentSkeleton extends DocumentSkeleton {
  renderedPage: IDocumentSkeletonPage | undefined;
  override getSkeletonData() {
    const data = super.getSkeletonData();
    return data && this.renderedPage ? { ...data, pages: [this.renderedPage] } : data;
  }
}

/**
 * Complete native layout, bytes, fonts, images, caps and cleanup must all pass
 * before the caller receives bytes. Hard native isolation remains a host duty.
 */
export async function renderDocPdf(input: NativeDocInput, options: DocPrintOptions = {}) {
  const release = acquireNativeRender();
  const started = performance.now();
  let deadline = started;
  let restore: (() => void) | undefined;
  const keys: FontKey[] = [];
  let aliases: string[] = [];
  let pdf: PDFDocument | undefined;
  let closed = false;
  let locale: LocaleService | undefined;
  let model: DocumentDataModel | undefined;
  let view: DocumentViewModel | undefined;
  let skeleton: PrintDocumentSkeleton | undefined;
  let document: Documents | undefined;
  let result:
    { bytes: Uint8Array; pages: number; mediaBox: { width: number; height: number } } | undefined;
  let failure: PrintError | undefined;
  let cleanupFailed = false;
  try {
    const limits = printLimits(options);
    deadline = started + limits.durationMs;
    const check = () => printCheckpoint(options.signal, deadline);
    check();
    const fonts = new PreparedFonts(
      input.fonts,
      input.defaultFamily,
      input.fallbackFamilies ?? [],
      limits,
    );
    const namespace = `Print${randomUUID().replaceAll('-', '')}`;
    for (const face of fonts.faces) face.alias = `${namespace}_${face.alias}`;
    // Both prepared snapshot and fonts become owned synchronously, before image
    // header inspection can yield to a caller that still owns the original data.
    const prepared = prepareDocSnapshot(input.snapshot, input.formulas ?? [], limits, check);
    prepareDocFonts(prepared.snapshot, fonts, limits, check);
    const frame = virtualDocFrame(prepared.snapshot, limits);
    const admitted = await admitImages(
      prepared.imageSources,
      input.images,
      limits,
      deadline,
      options.signal,
    );
    check();
    if (GlobalFonts.families.length)
      throw new PrintError(
        'unsupported',
        'Native PDF rendering requires an empty isolated font registry.',
      );
    aliases = fonts.faces.map((face) => face.alias);
    invalidateDocumentFontMetrics((style) => aliases.some((alias) => style.includes(alias)));
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
    for (const [source, image] of admitted) {
      check();
      const native = new Image();
      native.src = image.bytes;
      await native.decode();
      check();
      if (!native.complete || native.width !== image.width || native.height !== image.height)
        throw new PrintError('invalid-input', 'Decoded PDF image dimensions changed.');
      decoded.set(source, native);
    }
    locale = new LocaleService();
    model = new DocumentDataModel(prepared.snapshot);
    view = new DocumentViewModel(model);
    skeleton = new PrintDocumentSkeleton(view, locale);
    // Public incremental layout creates bounded checkpoints between native work
    // units. An individual native step still needs a host process deadline.
    const generation = skeleton.startIncrementalLayout({ reason: 'initial' });
    let complete = false;
    let work = 0;
    while (!complete) {
      check();
      if (++work > limits.gridCells)
        throw new PrintError('limit', 'PDF document layout exceeds its work budget.');
      const progress = skeleton.stepIncrementalLayout(generation, 8, 64);
      check();
      if (progress.cancelled) throw new PrintError('cancelled', 'PDF rendering was cancelled.');
      if (progress.pageCount > limits.pages)
        throw new PrintError('limit', 'PDF document exceeds its page budget.');
      complete = progress.complete;
      if (!complete) await yieldTurn();
    }
    if (!skeleton.hasCompleteLayout())
      throw new PrintError('unsupported', 'PDF document layout is incomplete.');
    const data = skeleton.getSkeletonData();
    if (!data) throw new PrintError('unsupported', 'PDF document layout is unavailable.');
    document = new Documents('print-doc', skeleton, {
      pageMarginLeft: 0,
      pageMarginTop: 0,
      hasEditor: false,
      pageFillColor: '#ffffff',
    });
    // The same native painter is measured before publishing. In particular,
    // source coverage alone cannot detect ink clipped by an authored exact row.
    const inkBounds = new Map<
      IDocumentSkeletonPage,
      { bounds: PrintBox | null; text: PrintBox[] }
    >();
    for (const page of data.pages) {
      check();
      skeleton.renderedPage = page;
      const text: PrintBox[] = [];
      const ink = new InkContext(createCanvas(1, 1).getContext('2d'), check, (box) => {
        if (text.length >= limits.textCharacters * 4)
          throw new PrintError('limit', 'PDF glyph paint exceeds its work budget.');
        text.push(box);
      });
      document.draw(ink);
      if (
        ink.bounds &&
        (ink.bounds.left < -0.01 ||
          ink.bounds.right > frame.width + 0.01 ||
          ink.bounds.top < frame.top - 0.01)
      )
        throw new PrintError('unsupported', 'PDF document ink exceeds its prepared page bounds.');
      inkBounds.set(page, { bounds: ink.bounds, text });
    }
    const pages = paginateDocument(prepared.snapshot, data, frame, fonts, limits, check, inkBounds);
    const mediaBox = { width: frame.width * 0.75, height: frame.height * 0.75 };
    const canvasWidth = Math.ceil(mediaBox.width);
    const canvasHeight = Math.ceil(mediaBox.height);
    pdf = new PDFDocument({
      title: '',
      author: '',
      subject: '',
      keywords: '',
      creator: '@spinel/print',
    });
    for (const page of pages) {
      check();
      skeleton.renderedPage = page.page;
      const raw = pdf.beginPage(canvasWidth, canvasHeight);
      raw.fillStyle = '#ffffff';
      raw.fillRect(0, 0, canvasWidth, canvasHeight);
      raw.save();
      // Native Canvas allocates integer pages. Its top-left must move down by
      // the rounding excess before the final exact MediaBox is restored.
      raw.translate(0, canvasHeight - mediaBox.height);
      raw.scale(0.75, 0.75);
      raw.beginPath();
      raw.rect(0, frame.top, frame.width, Math.max(0, page.bottom - page.top));
      raw.clip();
      raw.translate(0, frame.top - page.top);
      const ctx = new PdfContext(raw as unknown as CanvasRenderingContext2D, check);
      for (const image of page.images.filter((image) => image.behind)) {
        check();
        drawPreparedImage(ctx, decoded.get(image.source)!, image);
      }
      document.draw(ctx);
      for (const image of page.images.filter((image) => !image.behind)) {
        check();
        drawPreparedImage(ctx, decoded.get(image.source)!, image);
      }
      raw.restore();
      pdf.endPage();
    }
    check();
    const nativeBytes = pdf.close();
    closed = true;
    check();
    if (nativeBytes.length > limits.outputBytes)
      throw new PrintError('limit', 'PDF output exceeds its byte budget.');
    const bytes = preservePdfPageGeometry(
      nativeBytes,
      mediaBox.width,
      mediaBox.height,
      pages.length,
      check,
    );
    check();
    if (bytes.length > limits.outputBytes)
      throw new PrintError('limit', 'PDF output exceeds its byte budget.');
    result = { bytes, pages: pages.length, mediaBox };
  } catch (error) {
    failure =
      error instanceof PrintError
        ? error
        : new PrintError('invalid-input', 'Native PDF rendering failed.');
  } finally {
    try {
      if (pdf && !closed) pdf.close();
    } catch {
      cleanupFailed = true;
    }
    try {
      skeleton?.cancelIncrementalLayout();
    } catch {
      cleanupFailed = true;
    }
    for (const item of [document, skeleton, view, model, locale]) {
      try {
        item?.dispose();
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
      invalidateDocumentFontMetrics((style) => aliases.some((alias) => style.includes(alias)));
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
  printCheckpoint(options.signal, deadline);
  return { ...result!, durationMs: performance.now() - started };
}
