/** Reserve omitted native hyphen advances without changing authored text or cell widths. */
import type { IDocumentBody, IDocumentData, IParagraph } from '@univerjs/core';
import type { IDocumentSkeletonCached, IDocumentSkeletonPage } from '@univerjs/engine-render';
import { createCanvas } from '@napi-rs/canvas';
import { PrintError } from './contract.ts';

/**
 * Native line adjustment appends an automatic dash after deciding which source
 * glyphs fit. In a narrow cell that dash can cross the cell's actual clip edge.
 * Only zero-source-count, generated end-of-line dashes qualify for this repair.
 * The existing paragraph reserves their measured advance through its public
 * end indent, and native layout runs again with every source run intact.
 *
 * The caller owns snapshot and must re-layout before painting. Final source and
 * strict ink checks remain authoritative; this function never relaxes a clip.
 */
export function reserveGeneratedDocHyphens(
  snapshot: IDocumentData,
  data: IDocumentSkeletonCached,
  visit: () => void,
): boolean {
  const context = createCanvas(1, 1).getContext('2d');
  const reserves = new Map<IParagraph, number>();
  const walkStory = (body: IDocumentBody, roots: Iterable<IDocumentSkeletonPage>) => {
    const paragraphs = new Map(
      (body.paragraphs ?? []).map((paragraph) => {
        visit();
        return [paragraph.startIndex, paragraph] as const;
      }),
    );
    const visited = new Set<IDocumentSkeletonPage>();
    const walk = (page: IDocumentSkeletonPage, depth: number) => {
      visit();
      if (visited.has(page)) return;
      visited.add(page);
      if (depth > 32 || page.isLayoutPlaceholder || page.isMaterializationPlaceholder)
        throw new PrintError('unsupported', 'PDF hyphen layout is incomplete.');
      for (const section of page.sections)
        for (const column of section.columns)
          for (const line of column.lines) {
            visit();
            for (const divide of line.divides) {
              visit();
              const dash = divide.glyphGroup.at(-1);
              if (
                divide.breakType !== 'Hyphen' ||
                !dash ||
                dash.count !== 0 ||
                dash.content !== '-' ||
                !dash.fontStyle
              )
                continue;
              context.font = dash.fontStyle.fontString;
              context.fontKerning = dash.fontStyle.fontKerning ?? 'auto';
              const metrics = context.measureText('-');
              const advance = Math.max(dash.width, dash.xOffset + metrics.actualBoundingBoxRight);
              const right = column.left + divide.left + divide.paddingLeft + dash.left + advance;
              // Cell content starts inside its saved margin, but the native cell
              // clip ends at the outer cell edge. Body/story columns retain their
              // own right edge so a generated dash cannot enter the next column.
              const edge =
                page.type === 3
                  ? Math.min(
                      column.left + column.width + page.marginRight,
                      page.pageWidth - page.marginLeft,
                    )
                  : column.left + column.width;
              if (![advance, right, edge].every(Number.isFinite) || advance <= 0)
                throw new PrintError('unsupported', 'PDF hyphen metrics are unavailable.');
              if (right <= edge + 0.01) continue;
              const paragraph = paragraphs.get(line.paragraphIndex);
              const indent = (line.paragraphPaddingRight ?? 0) + advance;
              if (!paragraph || !Number.isFinite(indent) || indent >= column.width - 1)
                throw new PrintError(
                  'unsupported',
                  'PDF hyphen does not fit its native text frame.',
                );
              reserves.set(paragraph, Math.max(reserves.get(paragraph) ?? -Infinity, indent));
            }
          }
      for (const table of page.skeTables.values())
        for (const row of table.rows)
          for (const cell of row.cells) {
            visit();
            if (!cell.isMergedCellCovered) walk(cell, depth + 1);
          }
      for (const group of page.skeColumnGroups.values())
        for (const column of group.columns) walk(column.page, depth + 1);
    };
    for (const page of roots) walk(page, 0);
  };
  walkStory(snapshot.body!, data.pages);
  for (const [stories, layouts] of [
    [snapshot.headers, data.skeHeaders],
    [snapshot.footers, data.skeFooters],
  ] as const)
    for (const [id, story] of Object.entries(stories ?? {})) {
      visit();
      walkStory(story.body, layouts.get(id)?.values() ?? []);
    }
  for (const [paragraph, indent] of reserves) {
    visit();
    paragraph.paragraphStyle = { ...paragraph.paragraphStyle, indentEnd: { v: indent, u: 3 } };
  }
  return reserves.size > 0;
}
