/** Public-model flow projection for a floating image in an otherwise empty paragraph. */
import {
  NumberUnitType,
  ObjectRelativeFromV,
  PositionedObjectLayoutType,
  SpacingRule,
} from '@univerjs/core';
import type { IDocDrawingBase, IDocumentBody, IDocumentData, IParagraph } from '@univerjs/core';
import { getNumberUnitValue } from '@univerjs/engine-render';
import type {
  IDocumentSkeletonCached,
  IDocumentSkeletonLine,
  IDocumentSkeletonPage,
} from '@univerjs/engine-render';
import { PrintError } from './contract.ts';
import type { PrintLimits } from './contract.ts';
import { imageBounds } from './image-render.ts';

interface FlowEntry {
  drawing: IDocDrawingBase;
  paragraph: IParagraph;
  baseline?: {
    left: number;
    top: number;
    width: number;
    height: number;
    angle: number;
    spaceBelow: number;
    span: number;
  };
}

export type ImageParagraphFlow = Map<string, FlowEntry>;

function unsupported(): never {
  throw new PrintError(
    'unsupported',
    'PDF image paragraph flow could not be preserved completely.',
  );
}

/**
 * The native Traditional layout reflows an image-only Top-and-bottom anchor
 * below its own image, then uses that displaced line as the image origin. A
 * caption avoids the bug, but adding text or hiding the paragraph mark changes
 * the saved document (hiding the mark also drops paragraph-after spacing).
 *
 * For this exact source shape, first measure the real, unchanged paragraph
 * strut with the image positioned without wrapping. reserveImageParagraphFlow
 * then gives that existing empty paragraph the equivalent vertical reservation.
 * No text, image transform, source index, or before/after spacing is removed.
 * The source snapshot passed by the caller has already been privately cloned.
 */
export function prepareImageParagraphFlow(
  snapshot: IDocumentData,
  check: () => void,
): ImageParagraphFlow {
  const result: ImageParagraphFlow = new Map();
  const bodies: IDocumentBody[] = [
    snapshot.body!,
    ...Object.values(snapshot.headers ?? {}).map((story) => story.body),
    ...Object.values(snapshot.footers ?? {}).map((story) => story.body),
  ];
  for (const body of bodies) {
    const paragraphs = new Map(
      (body.paragraphs ?? []).map((paragraph) => [paragraph.startIndex, paragraph]),
    );
    for (const block of body.customBlocks ?? []) {
      check();
      const drawing = snapshot.drawings?.[block.blockId];
      if (drawing?.layoutType !== PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM) continue;
      const anchor = block.startIndex;
      const paragraph = paragraphs.get(anchor + 1);
      if (
        !paragraph ||
        body.dataStream[anchor + 1] !== '\r' ||
        (anchor > 0 && !['\r', '\n', '\x1c', '\x0f'].includes(body.dataStream[anchor - 1])) ||
        drawing.docTransform.positionV.relativeFrom !== ObjectRelativeFromV.PARAGRAPH
      )
        continue;
      // A list marker or a paragraph border has its own painted line geometry;
      // it is not an empty image paragraph and must keep the normal native path.
      if (
        paragraph.bullet ||
        Object.keys(paragraph.paragraphStyle ?? {}).some((key) => key.startsWith('border'))
      )
        continue;
      drawing.layoutType = PositionedObjectLayoutType.WRAP_NONE;
      result.set(block.blockId, { drawing, paragraph });
    }
  }
  return result;
}

interface NativeAnchor {
  page: IDocumentSkeletonPage;
  line: IDocumentSkeletonLine;
  top: number;
}

function anchors(
  data: IDocumentSkeletonCached,
  flow: ImageParagraphFlow,
  check: () => void,
): Map<string, NativeAnchor[]> {
  const result = new Map<string, NativeAnchor[]>();
  const visited = new Set<IDocumentSkeletonPage>();
  const walk = (page: IDocumentSkeletonPage, depth: number) => {
    check();
    if (visited.has(page)) return;
    visited.add(page);
    if (depth > 32 || page.isLayoutPlaceholder || page.isMaterializationPlaceholder) unsupported();
    for (const section of page.sections)
      for (const column of section.columns)
        for (const line of column.lines) {
          check();
          const ids = new Set(
            line.divides.flatMap((divide) => divide.glyphGroup.map((glyph) => glyph.drawingId)),
          );
          for (const id of ids)
            if (id && flow.has(id)) {
              const values = result.get(id) ?? [];
              values.push({ page, line, top: section.top + line.top });
              result.set(id, values);
            }
        }
    for (const table of page.skeTables.values())
      for (const row of table.rows) for (const cell of row.cells) walk(cell, depth + 1);
    for (const group of page.skeColumnGroups.values())
      for (const column of group.columns) walk(column.page, depth + 1);
  };
  for (const page of data.pages) walk(page, 0);
  for (const stories of [data.skeHeaders, data.skeFooters])
    for (const layouts of stories.values()) for (const page of layouts.values()) walk(page, 0);
  return result;
}

function geometry(entry: FlowEntry, anchor: NativeAnchor) {
  const drawing = anchor.page.skeDrawings.get(entry.drawing.drawingId);
  if (!drawing) unsupported();
  const appearance = {
    left: drawing.aLeft,
    top: drawing.aTop,
    width: drawing.width,
    height: drawing.height,
    angle: drawing.angle ?? 0,
    flipX: entry.drawing.docTransform.flipX ?? false,
    flipY: entry.drawing.docTransform.flipY ?? false,
  };
  const bounds = imageBounds(appearance);
  if (!bounds) unsupported();
  return { appearance, bounds };
}

/** Return true only when another complete native layout is required. */
export function reserveImageParagraphFlow(
  flow: ImageParagraphFlow,
  data: IDocumentSkeletonCached,
  limits: Readonly<PrintLimits>,
  check: () => void,
): boolean {
  if (!flow.size) return false;
  const found = anchors(data, flow, check);
  let changed = false;
  for (const [id, entry] of flow) {
    check();
    const values = found.get(id);
    if (!values?.length) unsupported();
    let span = 0;
    let baselineSpan = 0;
    for (const anchor of values) {
      const { line, top } = anchor;
      const { appearance, bounds } = geometry(entry, anchor);
      const originalSpan = line.contentHeight + line.paddingTop + line.paddingBottom;
      const requiredSpan = bounds.bottom + (entry.drawing.distB ?? 0) - top - line.marginTop;
      if (![originalSpan, requiredSpan].every(Number.isFinite) || originalSpan < 0) unsupported();
      span = Math.max(span, originalSpan, requiredSpan);
      baselineSpan = Math.max(baselineSpan, originalSpan);
      const baseline = {
        left: appearance.left,
        top: appearance.top - top,
        width: appearance.width,
        height: appearance.height,
        angle: appearance.angle,
        spaceBelow: line.spaceBelowApply,
        span: originalSpan,
      };
      if (
        entry.baseline &&
        Object.keys(baseline).some(
          (key) =>
            Math.abs(
              baseline[key as keyof typeof baseline] -
                entry.baseline![key as keyof typeof baseline],
            ) > 0.01,
        )
      )
        unsupported();
      entry.baseline = baseline;
    }
    const maximum = Math.max(...data.pages.map((page) => page.pageHeight)) * limits.pages;
    if (!Number.isFinite(span) || span > maximum)
      throw new PrintError('limit', 'PDF image flow exceeds its page budget.');
    if (span <= baselineSpan + 0.001) continue;
    const style = entry.paragraph.paragraphStyle ?? {};
    // Relative paragraph spacing is measured against the original native strut,
    // not the enlarged image reservation. Resolve it before changing line height.
    const absolute = (value: typeof style.spaceAbove) =>
      value == null
        ? undefined
        : {
            v: getNumberUnitValue(value, baselineSpan),
            u: NumberUnitType.PIXEL,
          };
    entry.paragraph.paragraphStyle = {
      ...style,
      lineSpacing: span,
      spacingRule: SpacingRule.EXACT,
      ...(style.spaceAbove == null ? {} : { spaceAbove: absolute(style.spaceAbove) }),
      ...(style.spaceBelow == null ? {} : { spaceBelow: absolute(style.spaceBelow) }),
    };
    changed = true;
  }
  return changed;
}

/** The final native model must retain the measured origin, spacing and full image reservation. */
export function verifyImageParagraphFlow(
  flow: ImageParagraphFlow,
  data: IDocumentSkeletonCached,
  check: () => void,
): void {
  if (!flow.size) return;
  const found = anchors(data, flow, check);
  for (const [id, entry] of flow) {
    const baseline = entry.baseline;
    const values = found.get(id);
    if (!baseline || !values?.length) unsupported();
    for (const anchor of values) {
      check();
      const { appearance, bounds } = geometry(entry, anchor);
      const actual = [
        appearance.left,
        appearance.top - anchor.top,
        appearance.width,
        appearance.height,
        appearance.angle,
        anchor.line.spaceBelowApply,
      ];
      const expected = [
        baseline.left,
        baseline.top,
        baseline.width,
        baseline.height,
        baseline.angle,
        baseline.spaceBelow,
      ];
      if (actual.some((value, index) => Math.abs(value - expected[index]) > 0.01)) unsupported();
      const bottom = anchor.top + anchor.line.lineHeight - (anchor.line.marginBottom ?? 0);
      if (bottom + 0.01 < bounds.bottom + (entry.drawing.distB ?? 0)) unsupported();
      // A negative offset or top-wrap distance can reach earlier text. Forward
      // reservation cannot reproduce that collision's required backward reflow;
      // never quietly turn it into an overlapping non-wrapping image.
      for (const section of anchor.page.sections)
        for (const column of section.columns) {
          if (bounds.right <= column.left || bounds.left >= column.left + column.width) continue;
          for (const line of column.lines) {
            check();
            if (line === anchor.line) continue;
            const top = section.top + line.top;
            if (
              top + line.lineHeight <= bounds.top - (entry.drawing.distT ?? 0) + 0.01 ||
              top >= bounds.bottom + (entry.drawing.distB ?? 0) - 0.01
            )
              continue;
            if (
              line.divides.some((divide) =>
                divide.glyphGroup.some((glyph) => /[^\s\p{C}]/u.test(glyph.content)),
              )
            )
              unsupported();
          }
        }
    }
  }
}
