/** Public-model image anchor projection using measured native geometry. */
import {
  NumberUnitType,
  ObjectRelativeFromH,
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
import { moveImageAnchor } from './doc-image-anchor.ts';
import { inspectSnapshot } from './preflight.ts';

interface FlowEntry {
  drawing: IDocDrawingBase;
  paragraph: IParagraph;
  body: IDocumentBody;
  snapshot: IDocumentData;
  layoutType: PositionedObjectLayoutType;
  kind: 'empty' | 'line-caption' | 'square-caption';
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
 * below its own image, then uses that displaced line as the image origin. An
 * image-only Square anchor also drifts when its wrap rectangle covers the
 * whole column. A caption avoids the first bug, but adding text or hiding the
 * paragraph mark changes the saved document (hiding the mark also drops
 * paragraph-after spacing).
 *
 * For this exact source shape, first measure the real, unchanged paragraph
 * strut with the image positioned without wrapping. reserveImageParagraphFlow
 * then gives that existing empty paragraph the equivalent vertical reservation.
 * No authored text or paragraph spacing is removed. The source snapshot passed
 * by the caller has already been privately cloned, and every final image must
 * retain the measured appearance after equivalent positioning references change.
 * Captioned LINE references retain their original first-pass model so the
 * editor's compensated offsets can be measured before reference conversion.
 * Full-column Square text uses its existing image control as a leading native
 * Top-and-bottom anchor, retaining visible character order and style ranges.
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
      if (
        !drawing ||
        ![
          PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM,
          PositionedObjectLayoutType.WRAP_SQUARE,
        ].includes(drawing.layoutType)
      )
        continue;
      const anchor = block.startIndex;
      const end = body.dataStream.indexOf('\r', anchor);
      const paragraph = paragraphs.get(end);
      if (
        !paragraph ||
        ![ObjectRelativeFromV.PARAGRAPH, ObjectRelativeFromV.LINE].includes(
          drawing.docTransform.positionV.relativeFrom,
        ) ||
        drawing.docTransform.positionV.align !== undefined ||
        drawing.docTransform.positionV.percent !== undefined
      )
        continue;
      const empty =
        end === anchor + 1 &&
        (anchor === 0 || ['\r', '\n', '\x1c', '\x0f'].includes(body.dataStream[anchor - 1]));
      if (!empty) {
        const suffix = body.dataStream.slice(anchor + 1, end);
        let start = anchor;
        while (start > 0 && !['\r', '\n', '\x1c', '\x0f'].includes(body.dataStream[start - 1])) {
          check();
          start--;
        }
        if (
          drawing.layoutType === PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM &&
          drawing.docTransform.positionV.relativeFrom === ObjectRelativeFromV.LINE &&
          !suffix.includes('\b') &&
          /[^\s\p{C}\uFFFC]/u.test(suffix)
        )
          result.set(block.blockId, {
            drawing,
            paragraph,
            body,
            snapshot,
            layoutType: drawing.layoutType,
            kind: 'line-caption',
          });
        else if (
          drawing.layoutType === PositionedObjectLayoutType.WRAP_SQUARE &&
          /[^\s\p{C}\uFFFC]/u.test(body.dataStream.slice(start, end)) &&
          (body.customBlocks ?? []).filter(
            (entry) => entry.startIndex >= start && entry.startIndex < end,
          ).length === 1
        ) {
          const layoutType = drawing.layoutType;
          drawing.layoutType = PositionedObjectLayoutType.WRAP_NONE;
          result.set(block.blockId, {
            drawing,
            paragraph,
            body,
            snapshot,
            layoutType,
            kind: 'square-caption',
          });
        }
        continue;
      }
      // A list marker or a paragraph border has its own painted line geometry;
      // it is not an empty image paragraph and must keep the normal native path.
      if (
        paragraph.bullet ||
        Object.keys(paragraph.paragraphStyle ?? {}).some((key) => key.startsWith('border'))
      )
        continue;
      const layoutType = drawing.layoutType;
      drawing.layoutType = PositionedObjectLayoutType.WRAP_NONE;
      result.set(block.blockId, { drawing, paragraph, body, snapshot, layoutType, kind: 'empty' });
    }
  }
  return result;
}

/** These native LINE anchors need their first complete layout before normalization. */
export function pendingImageLineAnchors(flow: ImageParagraphFlow): ReadonlySet<string> {
  return new Set([...flow].filter(([, entry]) => entry.kind === 'line-caption').map(([id]) => id));
}

interface NativeLine {
  page: IDocumentSkeletonPage;
  line: IDocumentSkeletonLine;
  top: number;
  columnLeft: number;
  columnWidth: number;
}

interface NativeAnchor extends NativeLine {
  paragraphFirst: NativeLine;
  paragraphLast: NativeLine;
}

function anchors(
  data: IDocumentSkeletonCached,
  flow: ImageParagraphFlow,
  check: () => void,
): Map<string, NativeAnchor[]> {
  const result = new Map<string, NativeAnchor[]>();
  const paragraphs = new Map<string, NativeLine[]>();
  const scopes = new Map<NativeAnchor, string>();
  const visited = new Set<IDocumentSkeletonPage>();
  const walk = (page: IDocumentSkeletonPage, depth: number, scope: string) => {
    check();
    if (visited.has(page)) return;
    visited.add(page);
    if (depth > 32 || page.isLayoutPlaceholder || page.isMaterializationPlaceholder) unsupported();
    for (const section of page.sections)
      for (const column of section.columns)
        for (const line of column.lines) {
          check();
          const point: NativeLine = {
            page,
            line,
            top: section.top + line.top,
            columnLeft: column.left,
            columnWidth: column.width,
          };
          const key = `${scope}:${line.paragraphIndex}`;
          const lines = paragraphs.get(key) ?? [];
          lines.push(point);
          paragraphs.set(key, lines);
          const ids = new Set(
            line.divides.flatMap((divide) => divide.glyphGroup.map((glyph) => glyph.drawingId)),
          );
          for (const id of ids)
            if (id && flow.has(id)) {
              const values = result.get(id) ?? [];
              const anchor = { ...point, paragraphFirst: point, paragraphLast: point };
              values.push(anchor);
              scopes.set(anchor, key);
              result.set(id, values);
            }
        }
    for (const table of page.skeTables.values())
      for (const row of table.rows) for (const cell of row.cells) walk(cell, depth + 1, scope);
    for (const group of page.skeColumnGroups.values())
      for (const column of group.columns) walk(column.page, depth + 1, scope);
  };
  for (const page of data.pages) walk(page, 0, 'body');
  for (const [kind, stories] of [data.skeHeaders, data.skeFooters].entries())
    for (const [id, layouts] of stories)
      for (const [width, page] of layouts) walk(page, 0, JSON.stringify([kind, id, width]));
  for (const [id, values] of result)
    for (const anchor of values) {
      const lines = paragraphs.get(scopes.get(anchor)!)!;
      anchor.paragraphFirst = lines[0];
      anchor.paragraphLast =
        lines.findLast(({ line }) =>
          line.divides.some((divide) =>
            divide.glyphGroup.some((glyph) => (glyph.raw ?? glyph.streamType) === '\r'),
          ),
        ) ?? lines.at(-1)!;
      if (flow.get(id)!.kind === 'square-caption') Object.assign(anchor, anchor.paragraphFirst);
    }
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

function rememberBaseline(entry: FlowEntry, baseline: NonNullable<FlowEntry['baseline']>) {
  if (!Object.values(baseline).every(Number.isFinite)) unsupported();
  if (
    entry.baseline &&
    Object.keys(baseline).some(
      (key) =>
        Math.abs(
          baseline[key as keyof typeof baseline] - entry.baseline![key as keyof typeof baseline],
        ) > 0.01,
    )
  )
    unsupported();
  entry.baseline = baseline;
}

/** Return true only when another complete native layout is required. */
export function reserveImageParagraphFlow(
  flow: ImageParagraphFlow,
  data: IDocumentSkeletonCached,
  limits: Readonly<PrintLimits>,
  check: () => void,
): boolean {
  if (!flow.size) return false;
  const snapshot = flow.values().next().value!.snapshot;
  const found = anchors(data, flow, check);
  let changed = false;
  for (const [id, entry] of flow) {
    check();
    const values = found.get(id);
    if (!values?.length) unsupported();
    if (entry.kind === 'line-caption') {
      let horizontal: number | undefined;
      for (const anchor of values) {
        const { appearance } = geometry(entry, anchor);
        // Top-and-bottom puts its block on a separate zero-height native line.
        // LINE zero therefore shares that line's paragraph anchor. The pinned
        // native LINE relayout can retain a stale, lower drawing.lineTop after
        // moving the caption; use the actual source anchor for this exact zero
        // case. Nonzero offsets can include the editor's compensation when its
        // reference menu changes, so preserve their measured image origin.
        const top =
          entry.drawing.docTransform.positionV.posOffset === 0 ? 0 : appearance.top - anchor.top;
        const baseline = {
          left: appearance.left,
          top,
          width: appearance.width,
          height: appearance.height,
          angle: appearance.angle,
          spaceBelow: anchor.line.spaceBelowApply,
          span: anchor.line.contentHeight + anchor.line.paddingTop + anchor.line.paddingBottom,
        };
        rememberBaseline(entry, baseline);
        const pageLeft = appearance.left + anchor.page.marginLeft;
        if (horizontal !== undefined && Math.abs(pageLeft - horizontal) > 0.01) unsupported();
        horizontal = pageLeft;
      }
      const transform = entry.drawing.docTransform;
      if (transform.positionH.relativeFrom === ObjectRelativeFromH.COLUMN)
        transform.positionH = {
          relativeFrom: ObjectRelativeFromH.PAGE,
          posOffset: horizontal!,
        };
      transform.positionV = {
        relativeFrom: ObjectRelativeFromV.PARAGRAPH,
        posOffset: entry.baseline!.top,
      };
      changed = true;
      continue;
    }
    if (entry.layoutType === PositionedObjectLayoutType.WRAP_SQUARE) {
      const covers = values.map((anchor) => {
        const { bounds } = geometry(entry, anchor);
        return (
          bounds.left - (entry.drawing.distL ?? 0) <= anchor.columnLeft + 0.01 &&
          bounds.right + (entry.drawing.distR ?? 0) >= anchor.columnLeft + anchor.columnWidth - 0.01
        );
      });
      // Only a wrap rectangle covering both column edges is equivalent to a
      // full vertical reservation. A narrow Square image keeps native side
      // wrapping after this measurement pass, including its original strut.
      if (covers.every((value) => !value)) {
        entry.drawing.layoutType = entry.layoutType;
        flow.delete(id);
        changed = true;
        continue;
      }
      if (!covers.every(Boolean)) unsupported();
    }
    if (entry.kind === 'square-caption') {
      let horizontal: number | undefined;
      for (const anchor of values) {
        const { appearance } = geometry(entry, anchor);
        const span = anchor.line.contentHeight + anchor.line.paddingTop + anchor.line.paddingBottom;
        rememberBaseline(entry, {
          left: appearance.left,
          top: appearance.top - anchor.top,
          width: appearance.width,
          height: appearance.height,
          angle: appearance.angle,
          spaceBelow: anchor.paragraphLast.line.spaceBelowApply,
          span,
        });
        const left = appearance.left + anchor.page.marginLeft;
        if (horizontal !== undefined && Math.abs(left - horizontal) > 0.01) unsupported();
        horizontal = left;
      }
      let start = entry.paragraph.startIndex;
      while (
        start > 0 &&
        !['\r', '\n', '\x1c', '\x0f'].includes(entry.body.dataStream[start - 1])
      ) {
        check();
        start--;
      }
      moveImageAnchor(entry.body, id, start, check);
      const style = entry.paragraph.paragraphStyle ?? {};
      if (style.spaceAbove != null)
        entry.paragraph.paragraphStyle = {
          ...style,
          spaceAbove: {
            v: getNumberUnitValue(style.spaceAbove, entry.baseline!.span),
            u: NumberUnitType.PIXEL,
          },
        };
      entry.drawing.layoutType = PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM;
      entry.drawing.docTransform.positionH = {
        relativeFrom: ObjectRelativeFromH.PAGE,
        posOffset: horizontal!,
      };
      entry.drawing.docTransform.positionV = {
        relativeFrom: ObjectRelativeFromV.PARAGRAPH,
        posOffset: entry.baseline!.top,
      };
      changed = true;
      continue;
    }
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
      rememberBaseline(entry, baseline);
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
  if (changed) inspectSnapshot(snapshot, limits, check);
  return changed;
}

/** Top-level body image paragraphs eligible for finite-page source continuation. */
export function bodyImageFlowParagraphs(
  snapshot: IDocumentData,
  check: () => void,
): readonly number[] {
  const body = snapshot.body!;
  const paragraphs = new Set((body.paragraphs ?? []).map((entry) => entry.startIndex));
  const result = new Set<number>();
  for (const block of body.customBlocks ?? []) {
    check();
    if (!snapshot.drawings?.[block.blockId]) continue;
    if (
      body.tables?.some((range) => {
        check();
        return block.startIndex >= range.startIndex && block.startIndex < range.endIndex;
      })
    )
      continue;
    const end = body.dataStream.indexOf('\r', block.startIndex);
    if (paragraphs.has(end)) result.add(end);
  }
  return [...result].sort((a, b) => a - b);
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
        entry.kind === 'square-caption'
          ? anchor.paragraphLast.line.spaceBelowApply
          : anchor.line.spaceBelowApply,
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
      if (entry.kind === 'empty') {
        const bottom = anchor.top + anchor.line.lineHeight - (anchor.line.marginBottom ?? 0);
        if (bottom + 0.01 < bounds.bottom + (entry.drawing.distB ?? 0)) unsupported();
      }
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
