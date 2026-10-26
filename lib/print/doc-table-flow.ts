/** Native row reservations place complete virtual table slices without changing their ink. */
import { getBodySlice, SpacingRule } from '@univerjs/core';
import type { IDocumentData, IParagraph, ITable, ITextRun } from '@univerjs/core';
import type { IDocumentSkeletonCached, IDocumentSkeletonPage, IDocumentSkeletonTable } from '@univerjs/engine-render';
import { PrintError } from './contract.ts';
import type { PrintLimits } from './contract.ts';
import { docStories } from './doc-stories.ts';
import { inspectSnapshot } from './preflight.ts';

export interface TableFlowTarget {
  sourceId: string;
  reservationId: string;
  sectionId: string | undefined;
  width: number;
  capacity: number;
  capacities: number[];
  table: ITable;
  required: boolean;
}

export interface TableReservation extends TableFlowTarget {
  heights: number[];
}

function unsupported(): never {
  throw new PrintError('unsupported', 'PDF table continuation cannot preserve its source geometry.');
}

/** Only replace complete top-level tables; nested content stays inside its original master. */
export function tallTableTargets(snapshot: IDocumentData, data: IDocumentSkeletonCached, limits: Readonly<PrintLimits>, check: () => void, budget: { nodes: number; paintWork: number }): TableFlowTarget[] {
  const visit = () => { check(); if (++budget.nodes + budget.paintWork > limits.gridCells) throw new PrintError('limit', 'PDF table continuation exceeds its work budget.'); };
  const ranges = [...snapshot.body!.tables ?? []].sort((a, b) => a.startIndex - b.startIndex);
  const top: typeof ranges = [];
  let previousEnd = -1;
  for (const range of ranges) { visit(); if (range.startIndex >= previousEnd) { top.push(range); previousEnd = range.endIndex; } }
  const nativeTables = new Map<string, { page: IDocumentSkeletonPage; native: IDocumentSkeletonTable }[]>();
  for (const page of data.pages) for (const native of page.skeTables.values()) {
    visit();
    const fragments = nativeTables.get(native.tableSource.tableId) ?? [];
    fragments.push({ page, native });
    nativeTables.set(native.tableSource.tableId, fragments);
  }
  const targets: TableFlowTarget[] = [];
  for (const range of top) {
    const table = snapshot.tableSource![range.tableId];
    visit();
    const fragments = nativeTables.get(range.tableId) ?? [];
    if (!fragments.length) unsupported();
    const heights = new Map<number, number>();
    for (const { native } of fragments) for (const row of native.rows) {
      visit(); heights.set(row.index, (heights.get(row.index) ?? 0) + row.height);
    }
    const required = table.tableRows.some((row, index) => row.trHeight.hRule !== 0 && (heights.get(index) ?? 0) + 0.01 < row.trHeight.val.v) ||
      fragments.some(({page, native}) => page.sections.some(section => section.columns.some(column =>
        native.left >= column.left - 0.01 && native.left < column.left + column.width && column.lines.some(line => {
          visit();
          const top = section.top + line.top;
          return top >= native.top + native.height - 0.01 && top + line.lineHeight > page.pageHeight - page.marginTop - page.marginBottom + 0.01;
        }))));
    const { page, native } = fragments[0];
    let capacity = 0;
    let width = Number.POSITIVE_INFINITY;
    for (const { page, native } of fragments) {
      visit();
      capacity = Math.max(capacity, page.pageHeight - page.originMarginTop - page.originMarginBottom);
      const columns = page.sections.flatMap((section) => section.columns);
      const column = [...columns].reverse().find((column) => native.left >= column.left - 0.01 && native.left < column.left + column.width);
      width = Math.min(width, column?.width ?? page.pageWidth - page.marginLeft - page.marginRight);
    }
    if (![capacity, width].every((value) => Number.isFinite(value) && value > 4) || native.width > width + 0.01) unsupported();
    let reservationId = `print-table-flow-${targets.length}`;
    while (Object.hasOwn(snapshot.tableSource ?? {}, reservationId)) reservationId += '-generated';
    targets.push({ sourceId: range.tableId, reservationId, sectionId: page.sectionId, width, capacity,
      capacities: [page.pageHeight - page.marginTop - page.marginBottom - native.top],
      required,
      table: { ...structuredClone(native.tableSource), size: { type: 1, width: { v: native.width, u: 3 } } } });
  }
  return targets;
}

/** An isolated original table retains every nested cell/run/image and its real available width. */
export function tableFlowSnapshot(snapshot: IDocumentData, target: TableFlowTarget, limits: Readonly<PrintLimits>, check: () => void): IDocumentData {
  const range = snapshot.body!.tables!.find((entry) => entry.tableId === target.sourceId);
  if (!range) unsupported();
  const body = getBodySlice(snapshot.body!, range.startIndex, range.endIndex, false);
  const end = body.dataStream.length;
  body.dataStream += '\r\n';
  (body.paragraphs ??= []).push({ startIndex: end, paragraphId: `${target.reservationId}-end` });
  const temporary: IDocumentData = {
    ...snapshot, body, headers: undefined, footers: undefined, headerFooterDrawingsOrder: undefined,
    documentStyle: { ...snapshot.documentStyle, pageSize: { width: target.width + 8, height: target.capacity * limits.pages + 8 },
      marginTop: 4, marginBottom: 4, marginLeft: 4, marginRight: 4,
      defaultHeaderId: undefined, firstPageHeaderId: undefined, evenPageHeaderId: undefined,
      defaultFooterId: undefined, firstPageFooterId: undefined, evenPageFooterId: undefined },
  };
  const tableIds = new Set((body.tables ?? []).map((entry) => entry.tableId));
  const imageIds = new Set((body.customBlocks ?? []).map((entry) => entry.blockId));
  temporary.tableSource = Object.fromEntries([...tableIds].map((id) => [id, snapshot.tableSource![id]]));
  temporary.drawings = Object.fromEntries([...imageIds].map((id) => [id, snapshot.drawings![id]]));
  temporary.drawingsOrder = snapshot.drawingsOrder?.filter((id) => imageIds.has(id));
  const owned = structuredClone(temporary);
  owned.tableSource![target.sourceId] = structuredClone(target.table);
  inspectSnapshot(owned, limits, check);
  return owned;
}

/** Replace only native layout reservations; the original model remains the completeness authority. */
export function projectTableReservations(snapshot: IDocumentData, reservations: readonly TableReservation[], limits: Readonly<PrintLimits>, check: () => void, budget: { nodes: number; paintWork: number }): IDocumentData {
  const owned = structuredClone(snapshot);
  const body = owned.body!;
  const visit = () => { check(); if (++budget.nodes + budget.paintWork > limits.gridCells) throw new PrintError('limit', 'PDF table continuation exceeds its work budget.'); };
  const ranges = new Map(body.tables!.map((range) => { visit(); return [range.tableId, range] as const; }));
  const ordered = [...reservations].sort((a, b) =>
    ranges.get(b.sourceId)!.startIndex - ranges.get(a.sourceId)!.startIndex);
  for (const plan of ordered) {
    visit();
    const range = ranges.get(plan.sourceId)!;
    const source = owned.tableSource![plan.sourceId];
    if (!range || !source || !plan.heights.length || plan.heights.length > limits.pages * limits.columns ||
        plan.heights.some((height) => !Number.isFinite(height) || height < 1 || height > plan.capacity + 0.01)) unsupported();
    let stream = '\x1a';
    const paragraphs: IParagraph[] = [];
    for (const [index] of plan.heights.entries()) {
      visit();
      stream += '\x1b\x1c';
      paragraphs.push({ startIndex: stream.length, paragraphId: `${plan.reservationId}-${index}`,
        paragraphStyle: { lineSpacing: 1, spacingRule: SpacingRule.EXACT,
          spaceAbove: { v: 0, u: 3 }, spaceBelow: { v: 0, u: 3 },
          textStyle: { ...owned.documentStyle.textStyle, fs: 1 } } });
      stream += '\r\n\x1d\x0e';
    }
    stream += '\x0f';
    const { startIndex: start, endIndex: end } = range;
    const delta = stream.length - (end - start);
    const inside = (position: number) => position >= start && position < end;
    const shift = (position: number) => position < end ? position : position + delta;
    for (const key of ['paragraphs', 'sectionBreaks', 'customBlocks'] as const) {
      const entries = body[key]?.filter((entry) => !inside(entry.startIndex));
      for (const entry of entries ?? []) { visit(); entry.startIndex = shift(entry.startIndex); }
      // Each key retains its own public metadata element type.
      Object.assign(body, { [key]: entries });
    }
    body.tables = body.tables!.filter((entry) => !inside(entry.startIndex));
    for (const entry of body.tables) { visit(); entry.startIndex = shift(entry.startIndex); entry.endIndex = shift(entry.endIndex); }
    body.renderedPageBreaks = body.renderedPageBreaks?.filter((position) => !inside(position)).map(shift);
    const runs: ITextRun[] = [];
    for (const run of body.textRuns ?? []) {
      visit();
      if (run.ed <= start) runs.push(run);
      else if (run.st >= end) runs.push({ ...run, st: shift(run.st), ed: shift(run.ed) });
      else {
        if (run.st < start) runs.push({ ...run, ed: start });
        if (run.ed > end) runs.push({ ...run, st: start + stream.length, ed: shift(run.ed) });
      }
    }
    runs.push({ st: start, ed: start + stream.length, ts: { ...owned.documentStyle.textStyle, fs: 1 } });
    body.textRuns = runs.sort((a, b) => a.st - b.st);
    body.dataStream = body.dataStream.slice(0, start) + stream + body.dataStream.slice(end);
    if (body.dataStream.length > limits.textCharacters) throw new PrintError('limit', 'PDF table continuation exceeds its character budget.');
    (body.paragraphs ??= []).push(...paragraphs.map((paragraph) => ({ ...paragraph, startIndex: start + paragraph.startIndex })));
    body.paragraphs.sort((a, b) => a.startIndex - b.startIndex);
    body.tables.push({ startIndex: start, endIndex: start + stream.length, tableId: plan.reservationId });
    body.tables.sort((a, b) => a.startIndex - b.startIndex);
    const table: ITable = { ...source, tableId: plan.reservationId, align: 0, indent: { v: 0, u: 3 }, legacyIndentAdjustment: undefined,
      dist: { distT: 0, distB: 0, distL: 0, distR: 0 },
      tableColumns: [{ size: { type: 1, width: { v: plan.width, u: 3 } } }],
      size: { type: 1, width: { v: plan.width, u: 3 } }, cellMargin: undefined,
      tableRows: plan.heights.map((height) => ({ trHeight: { hRule: 2, val: { v: height, u: 3 } },
        tableCells: [{ size: { type: 1, width: { v: plan.width, u: 3 } }, margin: {
          start: { v: 0, u: 3 }, end: { v: 0, u: 3 }, top: { v: 0, u: 3 }, bottom: { v: 0, u: 3 },
        } }] })) };
    owned.tableSource![plan.reservationId] = table;
  }
  const bodies = [body, ...Object.values(owned.headers ?? {}).map((story) => story.body), ...Object.values(owned.footers ?? {}).map((story) => story.body)];
  const tables = new Set(bodies.flatMap((story) => (story.tables ?? []).map((entry) => entry.tableId)));
  const drawings = new Set(bodies.flatMap((story) => (story.customBlocks ?? []).map((entry) => entry.blockId)));
  owned.tableSource = Object.fromEntries(Object.entries(owned.tableSource ?? {}).filter(([id]) => tables.has(id)));
  owned.drawings = Object.fromEntries(Object.entries(owned.drawings ?? {}).filter(([id]) => drawings.has(id)));
  owned.drawingsOrder = owned.drawingsOrder?.filter((id) => drawings.has(id));
  docStories(owned); // Resource scoping must remain valid after removing original anchors.
  inspectSnapshot(owned, limits, check);
  return owned;
}
