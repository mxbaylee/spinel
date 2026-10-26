/** Nonwrapping image continuations preserve the original body flow and image transform. */
import { DocStyleType, PositionedObjectLayoutType, SpacingRule } from '@univerjs/core';
import type { IDocDrawingBase, IDocumentData } from '@univerjs/core';
import type { IDocumentSkeletonCached, IDocumentSkeletonPage } from '@univerjs/engine-render';
import { PrintError } from './contract.ts';
import type { PrintLimits } from './contract.ts';
import type { DocPlacedImage } from './doc-layout.ts';
import { imageBounds } from './image-render.ts';
import { inspectSnapshot } from './preflight.ts';

interface ImageSource extends IDocDrawingBase {
  source: string;
  opacity?: number;
  srcRect?: { left: number; top: number; right: number; bottom: number };
}

function unsupported(): never {
  throw new PrintError(
    'unsupported',
    'PDF floating image continuation cannot preserve its source geometry.',
  );
}

/**
 * A nonwrapping image is an overlay: it must never turn into a paragraph-height
 * reservation that moves the following source text. Continue its exact original
 * appearance through each physical body's clip, using existing pages first.
 * A later native layout supplies any missing pages and resolves page fields.
 */
export function planFloatingDocImages(
  snapshot: IDocumentData,
  data: IDocumentSkeletonCached,
  reservedImages: ReadonlySet<string>,
  limits: Readonly<PrintLimits>,
  check: () => void,
  budget: { nodes: number; paintWork: number },
) {
  const ids = new Set<string>();
  const seen = new Set<string>();
  const paints = new Map<IDocumentSkeletonPage, DocPlacedImage[]>();
  const order = new Map((snapshot.drawingsOrder ?? []).map((id, index) => [id, index]));
  let additionalPages = 0;
  const visit = () => {
    check();
    if (++budget.nodes + budget.paintWork > limits.gridCells)
      throw new PrintError('limit', 'PDF floating images exceed their continuation budget.');
  };
  for (const [pageIndex, anchor] of data.pages.entries())
    for (const drawing of anchor.skeDrawings.values()) {
      visit();
      const source = snapshot.drawings?.[drawing.drawingId] as ImageSource | undefined;
      if (
        !source ||
        source.hidden ||
        source.layoutType !== PositionedObjectLayoutType.WRAP_NONE ||
        reservedImages.has(drawing.drawingId)
      )
        continue;
      if (seen.has(drawing.drawingId)) unsupported();
      seen.add(drawing.drawingId);
      const appearance = {
        left: anchor.marginLeft + drawing.aLeft,
        top: anchor.marginTop + drawing.aTop,
        width: drawing.width,
        height: drawing.height,
        angle: drawing.angle,
        flipX: source.docTransform.flipX ?? false,
        flipY: source.docTransform.flipY ?? false,
        ...(source.srcRect ? { srcRect: source.srcRect } : {}),
      };
      const bounds = imageBounds(appearance);
      if (!bounds || bounds.bottom <= anchor.pageHeight - anchor.marginBottom + 0.01) continue;
      if (bounds.top < anchor.marginTop - 0.01 || typeof source.source !== 'string') unsupported();
      ids.add(drawing.drawingId);
      const start = bounds.top - anchor.marginTop;
      const end = bounds.bottom - anchor.marginTop;
      let position = 0;
      let covered = 0;
      for (let index = pageIndex; index < data.pages.length && position < end - 0.001; index++) {
        visit();
        const page = data.pages[index];
        const capacity = page.pageHeight - page.marginTop - page.marginBottom;
        if (
          !Number.isFinite(capacity) ||
          capacity <= 0 ||
          bounds.left < -0.01 ||
          bounds.right > page.pageWidth + 0.01
        )
          unsupported();
        const top = Math.max(start, position);
        const bottom = Math.min(end, position + capacity);
        if (bottom > top) {
          const shift = page.marginTop - anchor.marginTop - position;
          const clip = {
            left: bounds.left,
            right: bounds.right,
            top: page.marginTop + top - position,
            bottom: page.marginTop + bottom - position,
          };
          const image: DocPlacedImage = {
            id: drawing.drawingId,
            source: source.source,
            bounds: clip,
            clip,
            appearance: { ...appearance, top: appearance.top + shift },
            opacity: source.opacity ?? 1,
            behind: source.behindDoc === 1,
            order: order.get(drawing.drawingId) ?? source.relativeHeight ?? 0,
          };
          const items = paints.get(page) ?? [];
          items.push(image);
          paints.set(page, items);
          covered += bottom - top;
          if (++budget.paintWork + budget.nodes > limits.gridCells)
            throw new PrintError('limit', 'PDF floating images exceed their painting budget.');
        }
        position += capacity;
      }
      if (position < end - 0.001) {
        // Appended pages belong to the final stored section. Its origin margins
        // give an upper bound on body capacity before selected story reservations.
        // Adding only this lower bound on required pages cannot create a spare
        // trailing page if a later first/even/default story is shorter.
        const last = data.pages.at(-1)!;
        const maximum = last.pageHeight - last.originMarginTop - last.originMarginBottom;
        if (!Number.isFinite(maximum) || maximum <= 0) unsupported();
        additionalPages = Math.max(additionalPages, Math.ceil((end - position) / maximum));
      } else if (Math.abs(covered - (bounds.bottom - bounds.top)) > 0.01) unsupported();
    }
  if (data.pages.length + additionalPages > limits.pages)
    throw new PrintError('limit', 'PDF floating images exceed the page budget.');
  return { ids, paints, additionalPages };
}

/** Add public explicit page breaks after all authored body content, never inside its flow. */
export function appendFloatingDocPages(
  snapshot: IDocumentData,
  count: number,
  limits: Readonly<PrintLimits>,
  check: () => void,
): IDocumentData {
  if (!Number.isSafeInteger(count) || count <= 0 || count > limits.pages) unsupported();
  const body = snapshot.body!;
  const end = body.dataStream.length - 1;
  if (body.dataStream[end] !== '\n' || body.dataStream[end - 1] !== '\r') unsupported();
  let characters = body.dataStream.length + count * 2;
  for (const stories of [snapshot.headers, snapshot.footers])
    for (const story of Object.values(stories ?? {})) {
      check();
      characters += story.body.dataStream.length;
    }
  if (characters > limits.textCharacters)
    throw new PrintError('limit', 'PDF floating page projection exceeds its character budget.');
  inspectSnapshot(snapshot, limits, check);
  let styleId = `print-floating-boundary-${end}`;
  while (Object.hasOwn(snapshot.styles ?? {}, styleId)) {
    check();
    styleId += '-generated';
  }
  const noBorder = { color: { rgb: '#000000' }, width: 0, padding: 0, dashStyle: 1 as const };
  const paragraphs = [...body.paragraphs!];
  for (let index = 0; index < count; index++) {
    check();
    paragraphs.push({
      startIndex: end + index * 2 + 1,
      paragraphId: `print-floating-page-${end}-${index}`,
      // A distinct style ends the authored tail's contextual-spacing group.
      // Explicit neutral properties stop document defaults from changing either
      // the preceding border set or the page count before the public break.
      styleId,
      paragraphStyle: {
        pageBreakBefore: 0,
        keepNext: 0,
        keepLines: 0,
        widowControl: 0,
        contextualSpacing: 0,
        beforeAutoSpacing: 0,
        afterAutoSpacing: 0,
        snapToGrid: 0,
        lineSpacing: 1,
        spacingRule: SpacingRule.EXACT,
        spaceAbove: { v: 0, u: 3 },
        spaceBelow: { v: 0, u: 3 },
        borderTop: noBorder,
        borderBottom: noBorder,
        borderBetween: noBorder,
        borderLeft: noBorder,
        borderRight: noBorder,
        paragraphMarkTextStyle: { ...snapshot.documentStyle.textStyle, hidden: true },
      },
    });
  }
  // Borrow existing data until the entire prospective projection is admitted.
  // A nearly full snapshot must fail before a complete payload copy is made.
  const projected = {
    ...snapshot,
    styles: {
      ...snapshot.styles,
      [styleId]: { name: 'PDF page boundary', type: DocStyleType.paragraph },
    },
    body: {
      ...body,
      dataStream: body.dataStream.slice(0, end) + '\f\r'.repeat(count) + '\n',
      paragraphs,
      sectionBreaks: body.sectionBreaks?.map((section) =>
        section.startIndex === end ? { ...section, startIndex: end + count * 2 } : section,
      ),
      textRuns: body.textRuns?.map((run) =>
        run.ed > end ? { ...run, ed: run.ed + count * 2 } : run,
      ),
    },
  };
  inspectSnapshot(projected, limits, check);
  return structuredClone(projected);
}
