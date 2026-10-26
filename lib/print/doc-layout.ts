/** Finite physical pagination over complete public native Doc geometry. */
import { ObjectRelativeFromV, PositionedObjectLayoutType } from '@univerjs/core';
import type { IDocDrawingBase, IDocumentData } from '@univerjs/core';
import type { IDocumentSkeletonCached, IDocumentSkeletonPage } from '@univerjs/engine-render';
import { PrintError } from './contract.ts';
import type { PrintBox, PrintLimits } from './contract.ts';
import { imageBounds } from './image-render.ts';
import type { ImageAppearance } from './image-render.ts';
import type { PlacedImage } from './layout.ts';
import type { PreparedFonts } from './fonts.ts';

export interface DocFrame {
  width: number;
  height: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface DocPlacedImage extends PlacedImage {
  id: string;
  behind: boolean;
  order: number;
}

export interface DocPageSlice {
  page: IDocumentSkeletonPage;
  /** Absolute coordinates within one complete native page; consecutive edges are identical. */
  top: number;
  bottom: number;
  images: DocPlacedImage[];
}

interface Interval {
  top: number;
  bottom: number;
}
interface DocImageSource extends IDocDrawingBase {
  source: string;
  opacity?: number;
  srcRect?: { left: number; top: number; right: number; bottom: number };
}

function invalid(): never {
  throw new PrintError('invalid-input', 'Invalid native PDF document geometry.');
}

function unsupported(): never {
  throw new PrintError('unsupported', 'The PDF document cannot preserve this layout completely.');
}

function finite(value: number, maximum: number, minimum = 0) {
  if (!Number.isFinite(value) || value < minimum) invalid();
  if (value > maximum) throw new PrintError('limit', 'PDF document layout exceeds its budget.');
}

/**
 * Native traditional layout clamps an atomic row to its page height. A finite
 * virtual page instead admits the whole row/merge before physical continuation.
 * Explicit native breaks still produce separate virtual pages. Stored geometry
 * is returned unchanged and is used for every final MediaBox and margin.
 */
export function virtualDocFrame(snapshot: IDocumentData, limits: Readonly<PrintLimits>): DocFrame {
  const style = snapshot.documentStyle;
  const frame = {
    width: style.pageSize!.width!,
    height: style.pageSize!.height!,
    top: style.marginTop!,
    bottom: style.marginBottom!,
    left: style.marginLeft!,
    right: style.marginRight!,
  };
  const contentHeight = frame.height - frame.top - frame.bottom;
  const virtualHeight = contentHeight * limits.pages + frame.top + frame.bottom;
  finite(virtualHeight, 10_000_000);
  for (const table of Object.values(snapshot.tableSource ?? {})) {
    let minimumHeight = 0;
    for (const row of table.tableRows) {
      if (row.trHeight.hRule !== 0) minimumHeight += row.trHeight.val.v;
      if (minimumHeight > contentHeight * limits.pages)
        throw new PrintError('limit', 'PDF saved table height exceeds its page budget.');
    }
  }
  snapshot.documentStyle.pageSize = { width: frame.width, height: virtualHeight };
  for (const section of snapshot.body?.sectionBreaks ?? []) {
    if (section.pageSize) section.pageSize = { width: frame.width, height: virtualHeight };
  }
  // A page-relative floating image is positioned after pagination. Text-wrapping
  // page-relative anchors require iterative flow and are explicitly unsupported.
  for (const drawing of Object.values(snapshot.drawings ?? {})) {
    const position = drawing.docTransform.positionV;
    if (
      drawing.layoutType !== PositionedObjectLayoutType.INLINE &&
      [ObjectRelativeFromV.PAGE, ObjectRelativeFromV.MARGIN].includes(position.relativeFrom)
    ) {
      if (
        drawing.layoutType !== PositionedObjectLayoutType.WRAP_NONE ||
        position.align !== undefined ||
        position.percent !== undefined
      )
        unsupported();
    }
  }
  return frame;
}

/**
 * Validate native completeness before emitting anything. Normal rows and lines
 * stay together when they fit; oversized objects use the exact shared source
 * coordinates on adjacent pages rather than being independently resized.
 */
export function paginateDocument(
  snapshot: IDocumentData,
  data: IDocumentSkeletonCached,
  frame: DocFrame,
  fonts: PreparedFonts,
  limits: Readonly<PrintLimits>,
  check: () => void,
  inks: ReadonlyMap<IDocumentSkeletonPage, { bounds: PrintBox | null; text: PrintBox[] }>,
): DocPageSlice[] {
  if (!data.pages.length || data.pages.length > limits.pages) {
    throw new PrintError('limit', 'PDF document exceeds its page budget.');
  }
  const contentHeight = frame.height - frame.top - frame.bottom;
  const maximum = contentHeight * limits.pages + frame.top + frame.bottom;
  const covered = new Uint8Array(snapshot.body!.dataStream.length);
  const result: DocPageSlice[] = [];
  const seenImages = new Set<string>();
  const rowHeights = new Map<string, Map<number, number>>();
  const sourceOrder = new Map((snapshot.drawingsOrder ?? []).map((id, i) => [id, i]));
  let nodes = 0;
  let paintWork = 0;
  const visit = () => {
    check();
    if (++nodes > limits.gridCells)
      throw new PrintError('limit', 'PDF layout exceeds its work budget.');
  };

  for (const root of data.pages) {
    check();
    const firstLayoutNode = nodes;
    const intervals: Interval[] = [...(inks.get(root)?.text ?? [])];
    const paragraphLines = new Map<number, Interval[]>();
    const images: DocPlacedImage[] = [];
    const drawingAnchors = new Map<string, number>();
    let bottom = Math.max(frame.top, inks.get(root)?.bounds?.bottom ?? frame.top);
    const walk = (page: IDocumentSkeletonPage, x: number, y: number, depth: number) => {
      visit();
      if (depth > 32 || page.isLayoutPlaceholder || page.isMaterializationPlaceholder)
        unsupported();
      for (const section of page.sections) {
        finite(section.top, maximum);
        for (const column of section.columns) {
          finite(column.left, frame.width);
          for (const line of column.lines) {
            visit();
            const top = y + section.top + line.top;
            const end = top + line.lineHeight;
            finite(top, maximum);
            finite(end, maximum);
            bottom = Math.max(bottom, end);
            if (line.lineHeight > 0) {
              const interval = { top, bottom: end };
              intervals.push(interval);
              const lines = paragraphLines.get(line.paragraphIndex) ?? [];
              lines.push(interval);
              paragraphLines.set(line.paragraphIndex, lines);
            }
            for (const divide of line.divides) {
              let offset = divide.st;
              for (const glyph of divide.glyphGroup) {
                visit();
                finite(glyph.width, frame.width);
                if (
                  !Number.isSafeInteger(glyph.count) ||
                  glyph.count < 0 ||
                  !Number.isSafeInteger(offset) ||
                  offset < 0 ||
                  offset + glyph.count > covered.length
                )
                  invalid();
                covered.fill(1, offset, offset + glyph.count);
                offset += glyph.count;
                if (glyph.drawingId) drawingAnchors.set(glyph.drawingId, top);
                if (glyph.content && /[^\x00-\x1f\s\ufffc]/u.test(glyph.content)) {
                  // Native shaping may prepend the explicitly identical East
                  // Asian face even to Latin glyphs. Permit that exact duplicate
                  // only; an unknown/default fallback is never admitted.
                  const families = glyph.fontStyle?.fontFamily
                    .split(',')
                    .map((name) => name.trim().replace(/^['"]|['"]$/g, ''));
                  const face =
                    families?.length && families.every((name) => name === families[0])
                      ? fonts.faces.find((candidate) => candidate.alias === families[0])
                      : undefined;
                  if (
                    !face ||
                    [...glyph.content].some((char) => {
                      const point = char.codePointAt(0)!;
                      return (
                        point >= 0x20 &&
                        point !== 0xfffc &&
                        !/\p{Default_Ignorable_Code_Point}/u.test(char) &&
                        !face.covers(point)
                      );
                    })
                  )
                    unsupported();
                }
              }
            }
          }
        }
      }
      for (const table of page.skeTables.values()) {
        visit();
        finite(table.left, frame.width, -frame.left);
        finite(table.top, maximum);
        finite(table.height, maximum);
        const tableLeft = x + table.left;
        if (tableLeft < -0.01 || tableLeft + table.width > frame.width + 0.01) unsupported();
        bottom = Math.max(bottom, y + table.top + table.height);
        const heights = rowHeights.get(table.tableSource.tableId) ?? new Map<number, number>();
        rowHeights.set(table.tableSource.tableId, heights);
        for (const row of table.rows) {
          visit();
          heights.set(row.index, (heights.get(row.index) ?? 0) + row.height);
          finite(row.height, maximum);
          const rowTop = y + table.top + row.top;
          if (row.height > 0 && row.height <= contentHeight)
            intervals.push({ top: rowTop, bottom: rowTop + row.height });
          for (const cell of row.cells) {
            if (cell.isMergedCellCovered) continue;
            if (cell.cellTextDirection) unsupported();
            const cellTop = rowTop + cell.marginTop;
            const cellLeft = tableLeft + cell.left + cell.marginLeft;
            if (cell.pageHeight <= contentHeight && cell.pageHeight > row.height)
              intervals.push({ top: rowTop, bottom: rowTop + cell.pageHeight });
            walk(cell, cellLeft, cellTop, depth + 1);
          }
        }
      }
      if (page.skeColumnGroups.size) unsupported();
      for (const drawing of page.skeDrawings.values()) {
        visit();
        const source = snapshot.drawings?.[drawing.drawingId] as DocImageSource | undefined;
        if (!source || typeof source.source !== 'string') invalid();
        if (source.hidden) continue;
        if (seenImages.has(drawing.drawingId)) unsupported();
        seenImages.add(drawing.drawingId);
        const appearance: ImageAppearance = {
          left: x + drawing.aLeft,
          top: y + drawing.aTop,
          width: drawing.width,
          height: drawing.height,
          angle: drawing.angle,
          flipX: source.docTransform.flipX ?? false,
          flipY: source.docTransform.flipY ?? false,
          ...(source.srcRect ? { srcRect: source.srcRect } : {}),
        };
        const bounds = imageBounds(appearance);
        if (!bounds) continue;
        for (const value of Object.values(bounds)) finite(value, maximum, -maximum);
        if (
          bounds.left < -0.01 ||
          bounds.right > frame.width + 0.01 ||
          bounds.top < frame.top - 0.01
        )
          unsupported();
        bottom = Math.max(bottom, bounds.bottom);
        images.push({
          id: drawing.drawingId,
          source: source.source,
          bounds,
          appearance,
          opacity: source.opacity ?? 1,
          behind: source.behindDoc === 1,
          order: sourceOrder.get(drawing.drawingId) ?? source.relativeHeight ?? 0,
        });
      }
    };
    walk(root, frame.left, frame.top, 0);
    const layoutUnits = nodes - firstLayoutNode;
    if (bottom > maximum - frame.bottom + 0.01)
      throw new PrintError('limit', 'PDF document exceeds its page budget.');
    // Preserve authored paragraph keep rules when the group fits a physical
    // page. Native shaping still owns each line and all paragraph spacing.
    const paragraphs = snapshot.body!.paragraphs ?? [];
    for (let i = 0; i < paragraphs.length; i++) {
      const paragraph = paragraphs[i];
      const lines = paragraphLines.get(paragraph.startIndex);
      if (!lines?.length) continue;
      lines.sort((a, b) => a.top - b.top);
      const style = paragraph.paragraphStyle;
      if (style?.keepLines === 1)
        intervals.push({ top: lines[0].top, bottom: lines.at(-1)!.bottom });
      if (style?.widowControl === 1 && lines.length > 2) {
        intervals.push({ top: lines[0].top, bottom: lines[1].bottom });
        intervals.push({ top: lines.at(-2)!.top, bottom: lines.at(-1)!.bottom });
      }
      if (
        style?.keepNext === 1 &&
        (i === 0 ||
          paragraphs[i - 1].paragraphStyle?.keepNext !== 1 ||
          !paragraphLines.has(paragraphs[i - 1].startIndex))
      ) {
        let end = lines.at(-1)!.bottom;
        let j = i;
        while (paragraphs[j]?.paragraphStyle?.keepNext === 1 && paragraphs[j + 1]) {
          visit();
          const next = paragraphLines.get(paragraphs[++j].startIndex);
          if (!next?.length) break; // An explicit native break terminates a chain.
          end = next.reduce((maximum, line) => Math.max(maximum, line.bottom), end);
        }
        intervals.push({ top: lines[0].top, bottom: end });
      }
    }
    // Fully contained intervals are atomic only if they fit an otherwise empty
    // physical page. This leaves a finite continuation rule for tall cells/images.
    const atomic = intervals.filter(
      (interval) => interval.bottom - interval.top <= contentHeight + 0.001,
    );
    atomic.sort((a, b) => a.top - b.top || a.bottom - b.bottom);
    let start = frame.top;
    const first = result.length;
    do {
      check();
      let end = Math.min(start + contentHeight, bottom);
      if (end < bottom) {
        // Move the seam backwards until it crosses no line or ordinary row. The
        // bounded work budget prevents adversarial overlapping keep regions from
        // making seam search quadratic without admission.
        let moved = true;
        while (moved) {
          moved = false;
          for (const interval of atomic) {
            visit();
            if (
              interval.top < end - 0.001 &&
              interval.bottom > end + 0.001 &&
              interval.top > start + 0.001
            ) {
              end = interval.top;
              moved = true;
            }
          }
        }
      }
      if (end <= start) end = Math.min(start + contentHeight, bottom);
      if (result.length >= limits.pages)
        throw new PrintError('limit', 'PDF document exceeds its page budget.');
      result.push({ page: root, top: start, bottom: end, images: [] });
      start = end;
    } while (start < bottom - 0.001);
    if (result.length === first)
      result.push({ page: root, top: frame.top, bottom: frame.top, images: [] });
    const slices = result.slice(first);
    // Documents paints a complete native virtual page through each physical
    // clip. Charge that repeated traversal, plus the earlier ink pass, before
    // allocating PDF output; a source-only node cap would miss this multiplier.
    paintWork += layoutUnits * (slices.length + 1);
    if (!Number.isSafeInteger(paintWork) || paintWork + nodes > limits.gridCells)
      throw new PrintError('limit', 'PDF repeated painting exceeds its work budget.');
    // Unwrapped page-relative objects belong to the physical page containing
    // their anchor. They do not influence line flow; their source offset moves
    // once and remains fixed over every continuation slice.
    for (const image of images) {
      const source = snapshot.drawings![image.id];
      const position = source.docTransform.positionV;
      if (
        source.layoutType !== PositionedObjectLayoutType.INLINE &&
        [ObjectRelativeFromV.PAGE, ObjectRelativeFromV.MARGIN].includes(position.relativeFrom)
      ) {
        const anchor = drawingAnchors.get(image.id);
        if (anchor === undefined) unsupported();
        const slice =
          slices.find((candidate) => anchor >= candidate.top && anchor < candidate.bottom) ??
          slices.at(-1)!;
        const shift = slice.top - frame.top;
        image.appearance!.top += shift;
        image.bounds.top += shift;
        image.bounds.bottom += shift;
        // Moving a float must not manufacture content beyond the already
        // admitted page plan. Such geometry requires a prepared paragraph anchor.
        if (image.bounds.bottom > bottom + 0.001) unsupported();
      }
    }
    images.sort((a, b) => a.order - b.order);
    for (const slice of slices)
      slice.images = images.filter(
        (image) => image.bounds.bottom > slice.top && image.bounds.top < slice.bottom,
      );
  }
  // Short text does not prove a saved tall row retained its full blank area,
  // borders and background. Check authored min/exact heights separately from
  // text coverage, summing all native fragments of the same original row.
  for (const table of Object.values(snapshot.tableSource ?? {})) {
    const heights = rowHeights.get(table.tableId);
    for (const [index, row] of table.tableRows.entries()) {
      check();
      const actual = heights?.get(index);
      if (actual === undefined) unsupported();
      if (row.trHeight.hRule !== 0 && actual + 0.01 < row.trHeight.val.v) unsupported();
    }
  }
  for (let i = 0; i < covered.length; i++) {
    check();
    if (!covered[i] && !/[\x00-\x1f\s]/u.test(snapshot.body!.dataStream[i]))
      throw new PrintError('unsupported', 'PDF document layout omitted source text.');
  }
  for (const drawing of Object.values(snapshot.drawings ?? {}))
    if (!drawing.hidden && !seenImages.has(drawing.drawingId))
      throw new PrintError('unsupported', 'PDF document layout omitted an image.');
  return result;
}
