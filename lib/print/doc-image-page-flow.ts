/** Locate oversized body image paragraphs using their original public native geometry. */
import { PositionedObjectLayoutType } from '@univerjs/core';
import type { IDocumentData } from '@univerjs/core';
import type { IDocumentSkeletonCached } from '@univerjs/engine-render';
import { PrintError } from './contract.ts';
import type { PrintLimits } from './contract.ts';
import { bodyImageFlowParagraphs } from './doc-image-flow.ts';
import { imageBounds } from './image-render.ts';
import type { TableFlowTarget } from './doc-table-flow.ts';

export function imageParagraphTargets(
  snapshot: IDocumentData,
  data: IDocumentSkeletonCached,
  reserved: ReadonlySet<string>,
  limits: Readonly<PrintLimits>,
  check: () => void,
  budget: { nodes: number; paintWork: number },
): TableFlowTarget[] {
  const ends = new Set(bodyImageFlowParagraphs(snapshot, check));
  const result = new Map<number, TableFlowTarget>();
  const visit = () => {
    check();
    if (++budget.nodes + budget.paintWork > limits.gridCells)
      throw new PrintError('limit', 'PDF image continuation exceeds its work budget.');
  };
  for (const page of data.pages)
    for (const section of page.sections)
      for (const column of section.columns)
        for (const line of column.lines) {
          visit();
          const end = line.paragraphIndex;
          if (!ends.has(end)) continue;
          let target = result.get(end);
          if (!target) {
            let start = end;
            while (
              start > 0 &&
              !['\r', '\n', '\x1c', '\x0f'].includes(snapshot.body!.dataStream[start - 1])
            ) {
              visit();
              start--;
            }
            let reservationId = `print-image-flow-${result.size}`;
            while (Object.hasOwn(snapshot.tableSource ?? {}, reservationId))
              reservationId += '-generated';
            target = {
              kind: 'paragraph',
              range: { startIndex: start, endIndex: end + 1 },
              sourceId: reservationId,
              reservationId,
              sectionId: page.sectionId,
              width: column.width,
              capacity: page.pageHeight - page.originMarginTop - page.originMarginBottom,
              capacities: [
                page.pageHeight - page.marginBottom - page.marginTop - section.top - line.top,
              ],
              required: false,
              drawingLefts: new Map(),
            };
            result.set(end, target);
          }
          const capacity = page.pageHeight - page.marginTop - page.marginBottom;
          target.required ||= line.lineHeight > capacity + 0.01;
          for (const divide of line.divides)
            for (const glyph of divide.glyphGroup) {
              visit();
              if (!glyph.drawingId) continue;
              const drawing = page.skeDrawings.get(glyph.drawingId);
              const source = snapshot.drawings?.[glyph.drawingId];
              if (!drawing || !source)
                throw new PrintError('unsupported', 'PDF image continuation has no native anchor.');
              (target.drawingLefts as Map<string, number>).set(
                glyph.drawingId,
                drawing.aLeft - column.left,
              );
              const bounds = imageBounds({
                left: drawing.aLeft,
                top: drawing.aTop,
                width: drawing.width,
                height: drawing.height,
                angle: drawing.angle,
                flipX: source.docTransform.flipX ?? false,
                flipY: source.docTransform.flipY ?? false,
              });
              const flowing =
                source.layoutType !== PositionedObjectLayoutType.WRAP_NONE ||
                reserved.has(glyph.drawingId);
              target.required ||= Boolean(
                flowing && bounds && bounds.bottom - bounds.top > capacity + 0.01,
              );
            }
        }
  return [...result.values()].filter((target) => target.required);
}
