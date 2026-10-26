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
import type { IDocumentSkeletonCached, IDocumentSkeletonPage } from '@univerjs/engine-render';
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
import { paginateDocument, validateDocImageAnchors, virtualDocFrame } from './doc-layout.ts';
import { preservePdfPageGeometries } from './pdf-geometry.ts';
import { docStories, needsPhysicalDocPages } from './doc-stories.ts';
import { bodyOnlyPage, prepareDocStoryPaints } from './doc-story-layout.ts';
import type { DocInk } from './doc-story-layout.ts';
import {
  pendingImageLineAnchors,
  prepareImageParagraphFlow,
  reserveImageParagraphFlow,
  verifyImageParagraphFlow,
} from './doc-image-flow.ts';
import { prepareNativeTableFlow, withoutTableReservations } from './doc-table-render.ts';
import type { DocTablePaint } from './doc-table-render.ts';
import { reserveGeneratedDocHyphens } from './doc-hyphen-flow.ts';

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
  renderedResources: Pick<IDocumentSkeletonCached, 'skeHeaders' | 'skeFooters'> | undefined;
  override getSkeletonData() {
    const data = super.getSkeletonData();
    return data && this.renderedPage
      ? { ...data, ...this.renderedResources, pages: [this.renderedPage] }
      : data;
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
    const imageFlow = prepareImageParagraphFlow(prepared.snapshot, check);
    const deferredLineAnchors = pendingImageLineAnchors(imageFlow);
    for (const story of docStories(prepared.snapshot, false))
      validateDocImageAnchors(story.snapshot, deferredLineAnchors);
    const physical = needsPhysicalDocPages(prepared.snapshot);
    const stored = prepared.snapshot.documentStyle;
    const frame = physical
      ? {
          width: stored.pageSize!.width!,
          height: stored.pageSize!.height!,
          top: stored.marginTop!,
          bottom: stored.marginBottom!,
          left: stored.marginLeft!,
          right: stored.marginRight!,
        }
      : virtualDocFrame(prepared.snapshot, limits, deferredLineAnchors);
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
    // Public incremental layout creates bounded checkpoints between native work
    // units. Both image-reservation passes share the same work/deadline budget.
    let work = 0;
    const visit = () => {
      check();
      if (++work > limits.gridCells)
        throw new PrintError('limit', 'PDF document layout exceeds its work budget.');
    };
    const layout = async (snapshot = prepared.snapshot) => {
      for (let attempt = 0; attempt < Math.max(2, limits.pages); attempt++) {
        for (const item of [document, skeleton, view, model]) item?.dispose();
        document = undefined;
        skeleton = undefined;
        view = undefined;
        model = undefined;
        model = new DocumentDataModel(snapshot);
        view = new DocumentViewModel(model);
        skeleton = new PrintDocumentSkeleton(view, locale!);
        const generation = skeleton.startIncrementalLayout({
          reason: 'initial',
          waitForHyphenationPatterns: true,
        });
        let complete = false;
        while (!complete) {
          visit();
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
        let data = skeleton.getSkeletonData();
        if (!data) throw new PrintError('unsupported', 'PDF document layout is unavailable.');
        if (reserveGeneratedDocHyphens(snapshot, data, visit)) {
          data = undefined;
          await yieldTurn();
          continue;
        }
        document = new Documents('print-doc', skeleton, {
          pageMarginLeft: 0,
          pageMarginTop: 0,
          hasEditor: false,
          pageFillColor: '#ffffff',
        });
        return data;
      }
      throw new PrintError('limit', 'PDF hyphen layout exceeds its bounded relayout budget.');
    };
    let data: IDocumentSkeletonCached | undefined = await layout();
    if (reserveImageParagraphFlow(imageFlow, data, limits, check)) {
      data = undefined;
      data = await layout();
    }
    verifyImageParagraphFlow(imageFlow, data, check);
    // The same native painter is measured before publishing. In particular,
    // source coverage alone cannot detect ink clipped by an authored exact row.
    const measure = (
      page: IDocumentSkeletonPage,
      resources?: PrintDocumentSkeleton['renderedResources'],
    ): DocInk => {
      check();
      skeleton!.renderedPage = page;
      skeleton!.renderedResources = resources;
      const text: PrintBox[] = [];
      const horizontal: PrintBox[] = [];
      const ink = new InkContext(
        createCanvas(1, 1).getContext('2d'),
        check,
        (box) => {
          if (text.length >= limits.textCharacters * 4)
            throw new PrintError('limit', 'PDF glyph paint exceeds its work budget.');
          text.push(box);
        },
        (box) => {
          check();
          if (horizontal.length >= limits.gridCells)
            throw new PrintError('limit', 'PDF border paint exceeds its work budget.');
          horizontal.push(box);
        },
      );
      document!.draw(ink);
      return { bounds: ink.bounds, text, horizontal };
    };
    const budget = { nodes: 0, paintWork: 0 };
    let renderedSnapshot = prepared.snapshot;
    let tablePaints = new Map<IDocumentSkeletonPage, DocTablePaint[]>();
    let reservationIds = new Set<string>();
    if (physical) {
      const pending = prepareNativeTableFlow(
        renderedSnapshot,
        data,
        fonts,
        limits,
        check,
        budget,
        { layout, measure },
        new Set(imageFlow.keys()),
      );
      data = undefined;
      const flow = await pending;
      data = flow.data;
      renderedSnapshot = flow.snapshot;
      tablePaints = flow.paints;
      reservationIds = flow.reservationIds;
    }
    const inkBounds = new Map<IDocumentSkeletonPage, DocInk>();
    for (const page of data.pages) {
      const ink = measure(bodyOnlyPage(withoutTableReservations(page, reservationIds)));
      if (
        ink.bounds &&
        (ink.bounds.left < -0.01 ||
          ink.bounds.right > (physical ? page.pageWidth : frame.width) + 0.01 ||
          ink.bounds.top < (physical ? 0 : frame.top) - 0.01 ||
          (physical && ink.bounds.bottom > page.pageHeight + 0.01))
      )
        throw new PrintError('unsupported', 'PDF document ink exceeds its prepared page bounds.');
      if (
        physical &&
        ink.text.some(
          (box) =>
            box.top < page.marginTop - 0.01 ||
            box.bottom > page.pageHeight - page.marginBottom + 0.01,
        )
      )
        throw new PrintError('unsupported', 'PDF document text exceeds its body reservation.');
      inkBounds.set(page, ink);
    }
    const pages = paginateDocument(
      docStories(renderedSnapshot, false)[0].snapshot,
      data,
      frame,
      fonts,
      limits,
      check,
      inkBounds,
      physical,
      budget,
    );
    const stories = prepareDocStoryPaints(
      renderedSnapshot,
      data,
      fonts,
      limits,
      check,
      measure,
      budget,
    );
    const mediaBoxes = pages.map(({ frame }) => ({
      width: frame.width * 0.75,
      height: frame.height * 0.75,
    }));
    const mediaBox = mediaBoxes[0];
    pdf = new PDFDocument({
      title: '',
      author: '',
      subject: '',
      keywords: '',
      creator: '@spinel/print',
    });
    for (const [index, page] of pages.entries()) {
      check();
      skeleton!.renderedPage = bodyOnlyPage(withoutTableReservations(page.page, reservationIds));
      skeleton!.renderedResources = undefined;
      const frame = page.frame;
      const mediaBox = mediaBoxes[index];
      const canvasWidth = Math.ceil(mediaBox.width);
      const canvasHeight = Math.ceil(mediaBox.height);
      const raw = pdf.beginPage(canvasWidth, canvasHeight);
      raw.fillStyle = '#ffffff';
      raw.fillRect(0, 0, canvasWidth, canvasHeight);
      raw.save();
      // Native Canvas allocates integer pages. Its top-left must move down by
      // the rounding excess before the final exact MediaBox is restored.
      raw.translate(0, canvasHeight - mediaBox.height);
      raw.scale(0.75, 0.75);
      raw.beginPath();
      if (physical) raw.rect(0, 0, frame.width, frame.height);
      else raw.rect(0, frame.top, frame.width, Math.max(0, page.bottom - page.top));
      raw.clip();
      raw.translate(0, frame.top - page.top);
      const ctx = new PdfContext(raw as unknown as CanvasRenderingContext2D, check);
      const compositions = tablePaints.get(page.page) ?? [];
      const order = new Map(
        (prepared.snapshot.drawingsOrder ?? []).map((id, index) => [id, index]),
      );
      const drawings = [
        ...page.images.map((image) => ({ image, table: undefined as DocTablePaint | undefined })),
        ...compositions.flatMap((table) => table.slice.images.map((image) => ({ image, table }))),
      ].sort(
        (a, b) =>
          (order.get(a.image.id) ?? a.image.order) - (order.get(b.image.id) ?? b.image.order),
      );
      const layer = (behind: boolean) => {
        for (const { image, table } of drawings) {
          check();
          if (image.behind !== behind) continue;
          raw.save();
          if (table) {
            raw.beginPath();
            raw.rect(table.left, table.top, table.width, table.slice.bottom - table.slice.top);
            raw.clip();
            raw.translate(table.left, table.top - table.slice.top);
          }
          drawPreparedImage(ctx, decoded.get(image.source)!, image);
          raw.restore();
        }
      };
      layer(true);
      document!.draw(ctx);
      for (const table of compositions) {
        check();
        raw.save();
        raw.beginPath();
        raw.rect(table.left, table.top, table.width, table.slice.bottom - table.slice.top);
        raw.clip();
        raw.translate(table.left, table.top - table.slice.top);
        skeleton!.renderedPage = table.slice.page;
        skeleton!.renderedResources = { skeHeaders: new Map(), skeFooters: new Map() };
        document!.draw(ctx);
        raw.restore();
      }
      layer(false);
      raw.restore();
      for (const story of stories.get(page.page) ?? []) {
        check();
        skeleton!.renderedPage = story.page;
        skeleton!.renderedResources = story.resources;
        raw.save();
        raw.translate(0, canvasHeight - mediaBox.height);
        raw.scale(0.75, 0.75);
        const ctx = new PdfContext(raw as unknown as CanvasRenderingContext2D, check);
        for (const image of story.images.filter((image) => image.behind))
          drawPreparedImage(ctx, decoded.get(image.source)!, image);
        document!.draw(ctx);
        for (const image of story.images.filter((image) => !image.behind))
          drawPreparedImage(ctx, decoded.get(image.source)!, image);
        raw.restore();
      }
      pdf.endPage();
    }
    check();
    const nativeBytes = pdf.close();
    closed = true;
    check();
    if (nativeBytes.length > limits.outputBytes)
      throw new PrintError('limit', 'PDF output exceeds its byte budget.');
    const bytes = preservePdfPageGeometries(nativeBytes, mediaBoxes, check);
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
