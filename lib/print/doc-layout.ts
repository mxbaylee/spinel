/** Finite physical pagination over complete public native Doc geometry. */
import { ObjectRelativeFromV, PositionedObjectLayoutType } from '@univerjs/core';
import type { IDocDrawingBase, IDocumentData } from '@univerjs/core';
import { getDocsTableLayoutViewportWidth } from '@univerjs/engine-render';
import type {
  IDocumentSkeletonCached,
  IDocumentSkeletonDivide,
  IDocumentSkeletonLine,
  IDocumentSkeletonPage,
} from '@univerjs/engine-render';
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
  /** A verified overlay band retains its whole original transform inside this clip. */
  clip?: PrintBox;
}

export interface DocPageSlice {
  page: IDocumentSkeletonPage;
  frame: DocFrame;
  /** Absolute coordinates within one complete native page; consecutive edges are identical. */
  top: number;
  bottom: number;
  images: DocPlacedImage[];
}

interface Interval {
  top: number;
  bottom: number;
  required?: boolean;
}
interface DocImageSource extends IDocDrawingBase {
  source: string;
  opacity?: number;
  srcRect?: { left: number; top: number; right: number; bottom: number };
}

function hasVisibleText(text: string): boolean {
  return [...text].some(
    (character) =>
      character.codePointAt(0)! >= 0x20 && character !== '\ufffc' && !/\s/u.test(character),
  );
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
export function virtualDocFrame(
  snapshot: IDocumentData,
  limits: Readonly<PrintLimits>,
  deferredLineAnchors?: ReadonlySet<string>,
): DocFrame {
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
  validateDocImageAnchors(snapshot, deferredLineAnchors);
  return frame;
}

/** Shared by finite native pages and virtual continuation after image-flow projection. */
export function validateDocImageAnchors(
  snapshot: IDocumentData,
  deferredLineAnchors?: ReadonlySet<string>,
): void {
  // A page-relative floating image is positioned after pagination. Text-wrapping
  // page-relative anchors require iterative flow and are explicitly unsupported.
  const anchors = new Map(
    (snapshot.body?.customBlocks ?? []).map((block) => [block.blockId, block.startIndex]),
  );
  const stream = snapshot.body!.dataStream;
  for (const [id, drawing] of Object.entries(snapshot.drawings ?? {})) {
    const position = drawing.docTransform.positionV;
    if (drawing.layoutType === PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM) {
      const anchor = anchors.get(id);
      const end = anchor === undefined ? -1 : stream.indexOf('\r', anchor);
      const suffix = end < 0 ? '' : stream.slice(anchor! + 1, end);
      const following = (snapshot.body!.customBlocks ?? [])
        .filter((block) => block.startIndex > (anchor ?? -1) && block.startIndex < end)
        .map((block) => snapshot.drawings?.[block.blockId]);
      const inlineContent = following.some(
        (image) => image?.layoutType === PositionedObjectLayoutType.INLINE && image.hidden !== true,
      );
      const measuredTerminal = following.some(
        (image) => image && deferredLineAnchors?.has(image.drawingId),
      );
      const floating = following.filter(
        (image) => image?.layoutType === PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM,
      );
      if (
        floating.length &&
        [drawing, ...floating].some(
          (image) =>
            !image ||
            image.docTransform.positionV.relativeFrom !== ObjectRelativeFromV.PARAGRAPH ||
            !Number.isFinite(image.docTransform.positionV.posOffset) ||
            image.docTransform.positionV.align !== undefined ||
            image.docTransform.positionV.percent !== undefined,
        )
      )
        unsupported();
      // Image-only paragraphs have already received their measured equivalent
      // flow reservation in doc-image-flow. Other unsupported source shapes
      // must not reach the pinned native double-height/drifting-anchor path.
      // Pending LINE-relative captions receive a measured public-model anchor
      // projection after the first layout. A PARAGRAPH anchor followed by real
      // authored text gets its own native zero-height anchor line, preserving
      // earlier text above and the caption below it. A following visible inline
      // image supplies real line metrics as well, including a multi-file insert
      // with no caption. Consecutive Top-and-bottom anchors each get their own
      // native block line, so captions and interleaved text retain source order.
      // Invisible markers do not separate that line and are not a workaround.
      if (
        (position.relativeFrom !== ObjectRelativeFromV.PARAGRAPH &&
          !(position.relativeFrom === ObjectRelativeFromV.LINE && deferredLineAnchors?.has(id))) ||
        anchor === undefined ||
        following.some(
          (image) =>
            image?.layoutType !== PositionedObjectLayoutType.INLINE &&
            image?.layoutType !== PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM,
        ) ||
        (!inlineContent &&
          !measuredTerminal &&
          !deferredLineAnchors?.has(id) &&
          ![...suffix].some(
            (character) =>
              character.codePointAt(0)! >= 0x20 &&
              character !== '\ufffc' &&
              !/\s|\p{Default_Ignorable_Code_Point}/u.test(character),
          ))
      )
        unsupported();
    }
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
}

/**
 * Validate native completeness before emitting anything. Normal rows and lines
 * stay together when they fit; oversized objects use the exact shared source
 * coordinates on adjacent pages rather than being independently resized.
 */
export function paginateDocument(
  snapshot: IDocumentData,
  data: IDocumentSkeletonCached,
  baseFrame: DocFrame,
  fonts: PreparedFonts,
  limits: Readonly<PrintLimits>,
  check: () => void,
  inks: ReadonlyMap<
    IDocumentSkeletonPage,
    { bounds: PrintBox | null; text: PrintBox[]; horizontal: PrintBox[] }
  >,
  nativePages = false,
  budget = { nodes: 0, paintWork: 0 },
  sliceHeights: readonly number[] = [],
  floatingImages: ReadonlySet<string> = new Set(),
): DocPageSlice[] {
  if (!data.pages.length || data.pages.length > limits.pages) {
    throw new PrintError('limit', 'PDF document exceeds its page budget.');
  }
  const covered = new Uint8Array(snapshot.body!.dataStream.length);
  const result: DocPageSlice[] = [];
  const seenImages = new Set<string>();
  const rowHeights = new Map<string, Map<number, number>>();
  const sourceOrder = new Map((snapshot.drawingsOrder ?? []).map((id, i) => [id, i]));
  let nodes = budget.nodes;
  let paintWork = budget.paintWork;
  const visit = () => {
    check();
    budget.nodes = ++nodes;
    if (nodes > limits.gridCells)
      throw new PrintError('limit', 'PDF layout exceeds its work budget.');
  };

  // Empty native parity pages/columns consume presentation indexes, but no
  // source characters. Paragraph endpoints remain source-owned. Reconstruct
  // coverage offsets from those endpoints and actual source glyph counts so
  // an intentional empty column cannot shift or omit later source text.
  const paragraphs = new Map<number, IDocumentSkeletonLine[]>();
  const collect = (page: IDocumentSkeletonPage, depth: number) => {
    visit();
    if (depth > 32) unsupported();
    for (const section of page.sections)
      for (const column of section.columns)
        for (const line of column.lines) {
          visit();
          const lines = paragraphs.get(line.paragraphIndex) ?? [];
          lines.push(line);
          paragraphs.set(line.paragraphIndex, lines);
        }
    for (const table of page.skeTables.values())
      for (const row of table.rows)
        for (const cell of row.cells) if (!cell.isMergedCellCovered) collect(cell, depth + 1);
  };
  for (const page of data.pages) collect(page, 0);
  const sourceStarts = new Map<IDocumentSkeletonDivide, number>();
  for (const [paragraphIndex, lines] of paragraphs) {
    let characters = 0;
    let endCount: number | undefined;
    for (const line of lines)
      for (const divide of line.divides)
        for (const glyph of divide.glyphGroup) {
          visit();
          if (glyph.glyphType === 2) continue;
          characters += glyph.count;
          if ((glyph.raw ?? glyph.streamType) === '\r') endCount = characters;
        }
    if (endCount === undefined) continue;
    if (snapshot.body!.dataStream[paragraphIndex] !== '\r') invalid();
    let offset = paragraphIndex + 1 - endCount;
    if (!Number.isSafeInteger(offset) || offset < 0) invalid();
    for (const line of lines)
      for (const divide of line.divides) {
        sourceStarts.set(divide, offset);
        for (const glyph of divide.glyphGroup) if (glyph.glyphType !== 2) offset += glyph.count;
      }
  }

  for (const root of data.pages) {
    check();
    const frame = nativePages
      ? {
          width: root.pageWidth,
          height: root.pageHeight,
          top: root.marginTop,
          bottom: root.marginBottom,
          left: root.marginLeft,
          right: root.marginRight,
        }
      : baseFrame;
    for (const value of Object.values(frame)) finite(value, 100_000);
    const contentHeight = frame.height - frame.top - frame.bottom;
    if (contentHeight <= 0 || frame.width <= frame.left + frame.right) invalid();
    const maximum = contentHeight * limits.pages + frame.top + frame.bottom;
    const firstLayoutNode = nodes;
    const textInk = [...(inks.get(root)?.text ?? [])].sort((a, b) => a.top - b.top);
    const maximumTextHeight = textInk.reduce(
      (height, box) => Math.max(height, box.bottom - box.top),
      0,
    );
    const horizontalInk = (inks.get(root)?.horizontal ?? [])
      .map((box) => ({ ...box, center: (box.top + box.bottom) / 2 }))
      .sort((a, b) => a.center - b.center);
    const intervals: Interval[] = textInk.map((box) => ({ ...box, required: true }));
    const tableEdge = (edge: number, left: number, right: number) => {
      let low = 0;
      let high = horizontalInk.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (horizontalInk[middle].center < edge - 1) low = middle + 1;
        else high = middle;
      }
      for (let index = low; index < horizontalInk.length; index++) {
        const box = horizontalInk[index];
        if (box.center > edge + 1) break;
        visit();
        if (box.right <= left || box.left >= right) continue;
        // Native 1x border-center snapping differs from the saved edge by less
        // than one source pixel. Two more pixels conservatively cover the
        // destination 0.75x PDF snap. Protect only the table's outer edges:
        // padding every shared internal border would join all adjacent rows
        // into a single atomic group. Internal/vertical borders continue in
        // the exact source slices with their neighboring rows.
        intervals.push({ top: box.top - 2, bottom: box.bottom + 2 });
      }
    };
    const lineInk = (top: number, bottom: number): Interval | undefined => {
      let low = 0;
      let high = textInk.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (textInk[middle].top < top - maximumTextHeight) low = middle + 1;
        else high = middle;
      }
      let found: Interval | undefined;
      for (let index = low; index < textInk.length && textInk[index].top < bottom; index++) {
        visit();
        const box = textInk[index];
        if (box.bottom <= top) continue;
        found = found
          ? { top: Math.min(found.top, box.top), bottom: Math.max(found.bottom, box.bottom) }
          : { top: box.top, bottom: box.bottom };
      }
      return found;
    };
    const paragraphLines = new Map<number, Interval[]>();
    const images: DocPlacedImage[] = [];
    const drawingAnchors = new Map<string, number>();
    let bottom = nativePages
      ? frame.top
      : Math.max(frame.top, inks.get(root)?.bounds?.bottom ?? frame.top);
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
              // Preserve each native line's complete mixed-font ink envelope.
              // Its empty trailing font padding can contain a table-top stroke;
              // keeping that blank padding atomic would orphan the stroke or
              // unnecessarily move the preceding text with the following table.
              const painted = lineInk(top, end);
              const decorated =
                line.borderTop ||
                line.borderBottom ||
                line.borderBetween ||
                line.divides.some((divide) =>
                  divide.glyphGroup.some((glyph) =>
                    [glyph.ts?.ul, glyph.ts?.st, glyph.ts?.ol, glyph.ts?.bbl].some(
                      (decoration) => decoration?.s === 1,
                    ),
                  ),
                );
              // Retain the full native line box for under/over/strike lines and
              // paragraph borders; their decoration may extend past glyph ink.
              if (decorated)
                intervals.push({
                  top: Math.min(top - 2, painted?.top ?? top),
                  bottom: Math.max(end + 2, painted?.bottom ?? end),
                });
              else if (painted) intervals.push(painted);
              const lines = paragraphLines.get(line.paragraphIndex) ?? [];
              lines.push(interval);
              paragraphLines.set(line.paragraphIndex, lines);
            }
            for (const divide of line.divides) {
              let offset = sourceStarts.get(divide) ?? divide.st;
              for (const glyph of divide.glyphGroup) {
                visit();
                finite(glyph.width, frame.width);
                const count = glyph.glyphType === 2 ? 0 : glyph.count;
                if (
                  !Number.isSafeInteger(glyph.count) ||
                  glyph.count < 0 ||
                  !Number.isSafeInteger(offset) ||
                  offset < 0 ||
                  offset + count > covered.length
                )
                  invalid();
                covered.fill(1, offset, offset + count);
                offset += count;
                if (glyph.drawingId) drawingAnchors.set(glyph.drawingId, top);
                if (hasVisibleText(glyph.content)) {
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
        // The native painter clips an overflowing table to this public viewport.
        // Validate that same containing page/cell width even when all short text
        // fits: otherwise blank columns, background and borders could disappear.
        const viewportWidth = getDocsTableLayoutViewportWidth(
          page,
          table.left,
          table.tableSource,
          snapshot.documentStyle.documentFlavor,
        );
        if (table.width > viewportWidth + 0.01) unsupported();
        const tableLeft = x + table.left;
        if (tableLeft < -0.01 || tableLeft + table.width > frame.width + 0.01) unsupported();
        // Traditional native layout adds outer-border inset to row.top and
        // table.height. The painter strokes the actual first/last row edges,
        // not the outer table box, which differs for thick admitted borders.
        const firstRow = table.rows[0];
        const lastRow = table.rows.at(-1);
        if (firstRow) tableEdge(y + table.top + firstRow.top, tableLeft, tableLeft + table.width);
        if (lastRow)
          tableEdge(
            y + table.top + lastRow.top + lastRow.height,
            tableLeft,
            tableLeft + table.width,
          );
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
        if (floatingImages.has(drawing.drawingId)) continue;
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
        // Full-column square exclusion causes the pinned native float relayout
        // loop to move its own preceding paragraph repeatedly. Keep ordinary
        // square wrapping, but fail this known geometry before any PDF pages
        // are emitted. Native cell/column widths also cover nested anchors.
        if (
          source.layoutType === PositionedObjectLayoutType.WRAP_SQUARE &&
          page.sections.some((section) =>
            section.columns.some(
              (column) =>
                bounds.right - bounds.left + (source.distL ?? 0) + (source.distR ?? 0) >=
                column.width - 0.01,
            ),
          )
        )
          unsupported();
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
    const critical: Interval[] = [];
    for (const interval of intervals
      .filter((entry) => entry.required)
      .sort((a, b) => a.top - b.top)) {
      visit();
      const previous = critical.at(-1);
      if (previous && interval.top < previous.bottom - 0.001)
        previous.bottom = Math.max(previous.bottom, interval.bottom);
      else critical.push({ ...interval });
    }
    if (critical.some((interval) => interval.bottom - interval.top > contentHeight + 0.001))
      unsupported();
    const atomic = [
      ...critical,
      ...intervals.filter(
        (interval) => !interval.required && interval.bottom - interval.top <= contentHeight + 0.001,
      ),
    ];
    atomic.sort((a, b) => a.top - b.top || a.bottom - b.bottom);
    let start = frame.top;
    let criticalCursor = 0;
    const first = result.length;
    if (nativePages && bottom > frame.height + 0.01) unsupported();
    do {
      check();
      const capacity = sliceHeights[result.length] ?? contentHeight;
      if (!Number.isFinite(capacity) || capacity < 1 || capacity > contentHeight + 0.01) invalid();
      while (critical[criticalCursor]?.bottom <= start + 0.001) {
        visit();
        criticalCursor++;
      }
      const firstCritical = critical[criticalCursor];
      const minimumEnd =
        firstCritical && firstCritical.top <= start + 0.001 ? firstCritical.bottom : start;
      let end = nativePages ? bottom : Math.min(Math.max(start + capacity, minimumEnd), bottom);
      if (end < bottom) {
        // A backwards pass reaches the same earliest safe seam as repeated
        // forwards scans. Once the seam moves, previously visited intervals
        // start at or after it and cannot cross it. This also bounds overlapping
        // glyph/row/keep intervals to one visit each per physical page.
        for (let index = atomic.length - 1; index >= 0; index--) {
          visit();
          const interval = atomic[index];
          if (!interval.required && interval.bottom - interval.top > capacity + 0.001) continue;
          if (
            interval.top < end - 0.001 &&
            interval.bottom > end + 0.001 &&
            interval.top > start + 0.001
          )
            end = interval.top;
        }
        end = Math.max(end, minimumEnd);
      }
      if (end <= start) end = Math.min(start + capacity, bottom);
      if (result.length >= limits.pages)
        throw new PrintError('limit', 'PDF document exceeds its page budget.');
      result.push({ page: root, frame, top: start, bottom: end, images: [] });
      start = end;
    } while (start < bottom - 0.001);
    if (result.length === first)
      result.push({ page: root, frame, top: frame.top, bottom: frame.top, images: [] });
    const slices = result.slice(first);
    // Documents paints a complete native virtual page through each physical
    // clip. Charge that repeated traversal, plus the earlier ink pass, before
    // allocating PDF output; a source-only node cap would miss this multiplier.
    paintWork += layoutUnits * (slices.length + 1);
    budget.paintWork = paintWork;
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
    if (
      !covered[i] &&
      snapshot.body!.dataStream.charCodeAt(i) >= 0x20 &&
      !/\s/u.test(snapshot.body!.dataStream[i])
    )
      throw new PrintError('unsupported', 'PDF document layout omitted source text.');
  }
  for (const drawing of Object.values(snapshot.drawings ?? {}))
    if (
      !drawing.hidden &&
      !seenImages.has(drawing.drawingId) &&
      !floatingImages.has(drawing.drawingId)
    )
      throw new PrintError('unsupported', 'PDF document layout omitted an image.');
  return result;
}
