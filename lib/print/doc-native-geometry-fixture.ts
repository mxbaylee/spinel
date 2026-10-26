/** Test-only native oracle: no print image-flow projection or pagination code. */
import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { DocumentDataModel, LocaleService } from '@univerjs/core';
import {
  DocumentSkeleton,
  DocumentViewModel,
  invalidateDocumentFontMetrics,
} from '@univerjs/engine-render';
import type { DocPrintInput } from './index.ts';
import { PRINT_LIMITS } from './contract.ts';
import { PreparedFonts } from './fonts.ts';
import { canvasGlobals } from './native-runtime.ts';
import { prepareDocFonts, prepareDocSnapshot } from './doc-preparation.ts';

export async function measureOriginalDocGeometry(input: DocPrintInput) {
  const deadline = performance.now() + 5_000;
  let work = 0;
  const check = () => {
    if (performance.now() > deadline || ++work > PRINT_LIMITS.gridCells)
      throw new Error('Native reference exceeded its bounded work budget.');
  };
  if (GlobalFonts.families.length) throw new Error('Native reference requires isolated fonts.');
  const fonts = new PreparedFonts(
    input.fonts,
    input.defaultFamily,
    input.fallbackFamilies ?? [],
    PRINT_LIMITS,
  );
  const namespace = `NativeReference${randomUUID().replaceAll('-', '')}`;
  for (const face of fonts.faces) face.alias = `${namespace}_${face.alias}`;
  const prepared = prepareDocSnapshot(
    input.snapshot,
    input.formulas ?? [],
    PRINT_LIMITS,
    check,
  ).snapshot;
  prepareDocFonts(prepared, fonts, PRINT_LIMITS, check);
  const style = prepared.documentStyle;
  const frame = {
    width: style.pageSize!.width!,
    height: style.pageSize!.height!,
    top: style.marginTop!,
    bottom: style.marginBottom!,
    left: style.marginLeft!,
    right: style.marginRight!,
  };
  const restore = canvasGlobals(PRINT_LIMITS.decodedImagePixels, check);
  const aliases = fonts.faces.map(({ alias }) => alias);
  const keys: NonNullable<ReturnType<typeof GlobalFonts.register>>[] = [];
  const measureAll = async () => {
    for (const face of fonts.faces) {
      const key = GlobalFonts.register(face.bytes, face.alias);
      if (!key) throw new Error('Native reference font could not be registered.');
      keys.push(key);
    }
    const measure = async (virtual: boolean) => {
      const source = structuredClone(prepared);
      if (virtual) {
        // A bounded logical page exposes the complete source image and following
        // text; finite layout is measured separately to identify native overflow.
        const height =
          (frame.height - frame.top - frame.bottom) * PRINT_LIMITS.pages + frame.top + frame.bottom;
        source.documentStyle.pageSize = { width: frame.width, height };
        for (const section of source.body!.sectionBreaks ?? [])
          if (section.pageSize) section.pageSize = { width: frame.width, height };
      }
      const model = new DocumentDataModel(source);
      const view = new DocumentViewModel(model);
      const locale = new LocaleService();
      const skeleton = new DocumentSkeleton(view, locale);
      try {
        const generation = skeleton.startIncrementalLayout({
          reason: 'initial',
          waitForHyphenationPatterns: true,
        });
        for (;;) {
          check();
          const progress = skeleton.stepIncrementalLayout(generation, 8, 64);
          if (progress.cancelled || progress.pageCount > PRINT_LIMITS.pages)
            throw new Error('Native reference layout did not complete within its page budget.');
          if (progress.complete) break;
          await setImmediate();
        }
        if (!skeleton.hasCompleteLayout())
          throw new Error('Native reference layout is incomplete.');
        const metrics = createCanvas(1, 1).getContext('2d');
        return skeleton.getSkeletonData()!.pages.map((page, pageIndex) => ({
          pageIndex,
          pageHeight: page.pageHeight,
          marginTop: page.marginTop,
          lines: page.sections.flatMap((section) =>
            section.columns.flatMap((column) =>
              column.lines.map((line) => {
                check();
                const glyphs = line.divides.flatMap((divide) => divide.glyphGroup);
                const visible = glyphs.filter((glyph) =>
                  [...glyph.content].some((character) => character.codePointAt(0)! >= 32),
                );
                const baseline =
                  page.marginTop +
                  section.top +
                  line.top +
                  line.marginTop +
                  line.paddingTop +
                  line.asc;
                let inkTop = Infinity,
                  inkBottom = -Infinity;
                for (const glyph of visible) {
                  check();
                  if (!glyph.fontStyle?.fontString)
                    throw new Error('Native reference glyph font is unavailable.');
                  metrics.font = glyph.fontStyle.fontString;
                  const measured = metrics.measureText(glyph.content);
                  inkTop = Math.min(inkTop, baseline - measured.actualBoundingBoxAscent);
                  inkBottom = Math.max(inkBottom, baseline + measured.actualBoundingBoxDescent);
                }
                return {
                  paragraph: line.paragraphIndex,
                  text: glyphs.map((glyph) => glyph.content).join(''),
                  top: page.marginTop + section.top + line.top,
                  height: line.lineHeight,
                  baseline,
                  ink: visible.length ? { top: inkTop, bottom: inkBottom } : null,
                };
              }),
            ),
          ),
          images: [...page.skeDrawings].map(([id, drawing]) => {
            check();
            return {
              id,
              left: page.marginLeft + drawing.aLeft,
              top: page.marginTop + drawing.aTop,
              width: drawing.width,
              height: drawing.height,
            };
          }),
        }));
      } finally {
        skeleton.dispose();
        view.dispose();
        model.dispose();
        locale.dispose();
      }
    };
    return {
      sourceFlavor: input.snapshot.documentStyle.documentFlavor ?? null,
      layoutFlavor: prepared.documentStyle.documentFlavor!,
      frame,
      finite: await measure(false),
      logical: await measure(true),
    };
  };
  let result: Awaited<ReturnType<typeof measureAll>>;
  try {
    result = await measureAll();
  } finally {
    invalidateDocumentFontMetrics((name) => aliases.some((alias) => name.includes(alias)));
    GlobalFonts.removeBatch(keys);
    restore();
  }
  if (GlobalFonts.families.length) throw new Error('Native reference font cleanup failed.');
  return result;
}

export type OriginalDocGeometry = Awaited<ReturnType<typeof measureOriginalDocGeometry>>;
