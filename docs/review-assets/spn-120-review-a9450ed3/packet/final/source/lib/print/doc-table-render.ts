/** Compose original table ink through independently verified native row reservations. */
import type { IDocumentData } from '@univerjs/core';
import type { IDocumentSkeletonCached, IDocumentSkeletonPage } from '@univerjs/engine-render';
import { PrintError } from './contract.ts';
import type { PrintLimits } from './contract.ts';
import type { PreparedFonts } from './fonts.ts';
import { paginateDocument } from './doc-layout.ts';
import type { DocFrame, DocPageSlice } from './doc-layout.ts';
import type { DocInk } from './doc-story-layout.ts';
import { projectTableReservations, tableFlowSnapshot, tallTableTargets } from './doc-table-flow.ts';
import type { TableFlowTarget } from './doc-table-flow.ts';
import { imageParagraphTargets } from './doc-image-page-flow.ts';
import type { DocImageGeometry } from './doc-image-groups.ts';

export interface DocTablePaint {
  slice: DocPageSlice;
  left: number;
  top: number;
  width: number;
}

interface TableSource {
  target: TableFlowTarget;
  snapshot: IDocumentData;
  data: IDocumentSkeletonCached;
  frame: DocFrame;
  inks: Map<IDocumentSkeletonPage, DocInk>;
  slices: DocPageSlice[];
  advanceAfter: boolean;
}

function unsupported(): never {
  throw new PrintError(
    'unsupported',
    'PDF table continuation did not preserve complete source placement.',
  );
}

/** Remove only synthetic reservations from a public presentation page, never source table ink. */
export function withoutTableReservations(
  page: IDocumentSkeletonPage,
  ids: ReadonlySet<string>,
): IDocumentSkeletonPage {
  if (!ids.size) return page;
  return {
    ...page,
    skeTables: new Map(
      [...page.skeTables].filter(([, table]) => !ids.has(table.tableSource.tableId)),
    ),
  };
}

export async function prepareNativeTableFlow(
  original: IDocumentData,
  initial: IDocumentSkeletonCached | undefined,
  fonts: PreparedFonts,
  limits: Readonly<PrintLimits>,
  check: () => void,
  budget: { nodes: number; paintWork: number },
  scene: {
    layout: (snapshot: IDocumentData) => Promise<IDocumentSkeletonCached>;
    measure: (page: IDocumentSkeletonPage) => DocInk;
  },
  reservedImages: ReadonlySet<string> = new Set(),
  imageGeometry?: DocImageGeometry,
) {
  const targets = [
    ...tallTableTargets(original, initial!, limits, check, budget),
    ...imageParagraphTargets(
      original,
      initial!,
      reservedImages,
      limits,
      check,
      budget,
      imageGeometry,
    ),
  ];
  if (!targets.length)
    return {
      snapshot: original,
      data: initial!,
      paints: new Map<IDocumentSkeletonPage, DocTablePaint[]>(),
      reservationIds: new Set<string>(),
    };
  // Subsequent layouts may release the previous native scene. Retain only the
  // original table's own bounded geometry, never a second whole-document cache.
  initial = undefined;
  const sources: TableSource[] = [];
  for (const target of targets) {
    check();
    const snapshot = tableFlowSnapshot(original, target, limits, check);
    const native = await scene.layout(snapshot);
    const oversized = native.pages.some((page) =>
      [...page.skeTables.values()].some(
        (table) =>
          table.tableSource.tableId === target.sourceId &&
          table.rows.some((row) => row.height > target.capacity + 0.01),
      ),
    );
    if (!target.required && !oversized && native.pages.length === 1) continue;
    // The required document terminator has no authored space after this table.
    // Its structural paragraph is not part of the source table's paint/height.
    const pages =
      target.kind === 'paragraph'
        ? native.pages
        : native.pages.map((page) => ({
            ...page,
            sections: page.sections.map((section) => ({
              ...section,
              columns: section.columns.map((column) => ({ ...column, lines: [] })),
            })),
          }));
    const data = { ...native, pages };
    const inks = new Map(pages.map((page) => [page, scene.measure(page)]));
    const frame = {
      width: target.width + 8,
      height: target.capacity + 8,
      left: 4,
      right: 4,
      top: 4,
      bottom: 4,
    };
    sources.push({ target, snapshot, data, inks, frame, slices: [], advanceAfter: false });
  }
  const reservationIds = new Set(sources.map(({ target }) => target.reservationId));
  if (!sources.length)
    return {
      snapshot: original,
      data: await scene.layout(original),
      paints: new Map<IDocumentSkeletonPage, DocTablePaint[]>(),
      reservationIds,
    };
  // An oversized native paragraph can have moved wholesale to the next page.
  // A one-pixel public reservation locates its actual source position after the
  // preceding content; the first continuation band may use that remaining space.
  let placement: IDocumentSkeletonCached | undefined = await scene.layout(
    projectTableReservations(
      original,
      sources.map(({ target }) => ({
        ...target,
        heights: [1],
        advanceAfter: false,
      })),
      limits,
      check,
      budget,
    ),
  );
  const firstCapacities = new Map<string, number>();
  for (const page of placement.pages)
    for (const table of page.skeTables.values()) {
      check();
      if (++budget.nodes + budget.paintWork > limits.gridCells)
        throw new PrintError('limit', 'PDF table continuation exceeds its placement budget.');
      if (reservationIds.has(table.tableSource.tableId))
        firstCapacities.set(
          table.tableSource.tableId,
          page.pageHeight - page.marginTop - page.marginBottom - table.top - table.rows[0].top,
        );
    }
  for (const source of sources) {
    const capacity = firstCapacities.get(source.target.reservationId);
    if (capacity === undefined || !Number.isFinite(capacity) || capacity < 1) unsupported();
    source.target.capacities = [capacity];
  }
  placement = undefined;
  for (let attempt = 0; attempt < limits.pages; attempt++) {
    check();
    for (const source of sources)
      source.slices = paginateDocument(
        source.snapshot,
        source.data,
        source.frame,
        fonts,
        limits,
        check,
        source.inks,
        false,
        budget,
        source.target.capacities,
        new Set(),
        new Set(),
        imageGeometry,
      );
    const snapshot = projectTableReservations(
      original,
      sources.map(({ target, slices, advanceAfter }) => ({
        ...target,
        advanceAfter,
        heights: slices.map((slice) => slice.bottom - slice.top),
      })),
      limits,
      check,
      budget,
    );
    const data = await scene.layout(snapshot);
    const paints = new Map<IDocumentSkeletonPage, DocTablePaint[]>();
    let retry = false;
    const visit = () => {
      check();
      if (++budget.nodes + budget.paintWork > limits.gridCells)
        throw new PrintError('limit', 'PDF table continuation exceeds its placement budget.');
    };
    for (const source of sources) {
      const { target, slices } = source;
      const placed = new Map<
        number,
        { page: IDocumentSkeletonPage; left: number; top: number; capacity: number }
      >();
      let capacityChanged = false;
      let nativeRowCapacity: number | undefined;
      for (const page of data.pages)
        for (const table of page.skeTables.values()) {
          visit();
          if (table.tableSource.tableId !== target.reservationId) continue;
          // The public native table builder caps every exact row against the
          // first table page's body height, including later pages whose selected
          // header is shorter. Reserve within both that structural ceiling and
          // the actual destination body space; a larger later frame cannot undo
          // the earlier native clamp.
          nativeRowCapacity ??= page.pageHeight - page.marginTop - page.marginBottom;
          for (const row of table.rows) {
            visit();
            const slice = slices[row.index];
            if (!slice || placed.has(row.index)) unsupported();
            const top = page.marginTop + table.top + row.top;
            const left = page.marginLeft + table.left;
            const capacity = Math.min(page.pageHeight - page.marginBottom - top, nativeRowCapacity);
            const column = page.sections
              .flatMap((section) => section.columns)
              .find(
                (column) =>
                  table.left >= column.left - 0.01 &&
                  table.left + target.width <= column.left + column.width + 0.01,
              );
            if (
              !column ||
              !Number.isFinite(capacity) ||
              capacity < 1 ||
              top < page.marginTop - 0.01
            )
              unsupported();
            if (
              row.height + 0.01 < slice.bottom - slice.top ||
              slice.bottom - slice.top > capacity + 0.01
            )
              retry = true;
            if (Math.abs(capacity - (target.capacities[row.index] ?? target.capacity)) > 0.01)
              capacityChanged = true;
            placed.set(row.index, { page, left, top, capacity });
          }
        }
      if (placed.size !== slices.length) unsupported();
      target.capacities = slices.map((_, index) => placed.get(index)!.capacity);
      if (capacityChanged) {
        retry = true;
        source.advanceAfter = false;
      }
      const last = placed.get(slices.length - 1)!;
      const bodyBottom = last.page.pageHeight - last.page.marginBottom;
      // Native finite layout can append the first paragraph after a table even
      // when that line exceeds the remaining column height. The
      // exact public column-break marker makes native flow put the authored
      // paragraph in the next column/page, with no added paragraph or spacing.
      if (
        !source.advanceAfter &&
        last.page.sections.some((section) =>
          section.columns.some(
            (column) =>
              last.left >= last.page.marginLeft + column.left - 0.01 &&
              last.left < last.page.marginLeft + column.left + column.width &&
              column.lines.some((line) => {
                visit();
                const top = last.page.marginTop + section.top + line.top;
                return (
                  top >= last.top + slices.at(-1)!.bottom - slices.at(-1)!.top - 0.01 &&
                  top + line.lineHeight > bodyBottom + 0.01
                );
              }),
          ),
        )
      ) {
        source.advanceAfter = true;
        retry = true;
      }
      let lastPage = -1;
      let lastTop = -1;
      let lastLeft = -1;
      for (const [index, slice] of slices.entries()) {
        const placement = placed.get(index)!;
        const pageIndex = data.pages.indexOf(placement.page);
        if (
          pageIndex < lastPage ||
          (pageIndex === lastPage &&
            (placement.left < lastLeft - 0.01 ||
              (Math.abs(placement.left - lastLeft) < 0.01 && placement.top < lastTop - 0.01)))
        )
          unsupported();
        lastPage = pageIndex;
        lastTop = placement.top;
        lastLeft = placement.left;
        const entries = paints.get(placement.page) ?? [];
        entries.push({
          slice,
          top: placement.top,
          left: placement.left - 4,
          width: target.width + 8,
        });
        paints.set(placement.page, entries);
      }
    }
    if (!retry) return { snapshot, data, paints, reservationIds };
  }
  throw new PrintError('limit', 'PDF table continuation exceeds its bounded relayout budget.');
}
