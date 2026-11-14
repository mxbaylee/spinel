import type { IRange } from '@univerjs/core';
import type { Mutation } from './types.ts';

export const cellIds = {
  setRangeValues: 'sheet.mutation.set-range-values',
  setNumfmt: 'sheet.mutation.set.numfmt',
  removeNumfmt: 'sheet.mutation.remove.numfmt',
  moveRange: 'sheet.mutation.move-range',
} as const;

export type Matrix = Record<number, Record<number, unknown>>;
export type Cell = { row: number; col: number };

/**
 * One cell a mutation writes. `value` is the cell data (SetRangeValues and
 * MoveRange), the pattern id (SetNumfmt) or null (RemoveNumfmt).
 */
export interface Write extends Cell {
  value: any;
}

export const cellKey = (cell: Cell) => `${cell.row}:${cell.col}`;

/**
 * The id of a ghost (see cells.haunted): never a Univer mutation, so `check`
 * rejects one sent in, and `transform` drops every one from what it returns.
 */
export const ghostId = 'sync-transform.cells.ghost';
export const isGhost = (mutation: Mutation) => mutation.id === ghostId;

export function matrixWrites(matrix: Matrix): Write[] {
  return Object.entries(matrix ?? {}).flatMap(([row, columns]) =>
    Object.entries(columns ?? {}).map(([col, value]) => ({
      row: Number(row),
      col: Number(col),
      value,
    })),
  );
}

function rangeWrites(ranges: IRange[], value: unknown): Write[] {
  const writes: Write[] = [];
  for (const range of ranges) {
    for (let row = range.startRow; row <= range.endRow; row++) {
      for (let col = range.startColumn; col <= range.endColumn; col++) {
        writes.push({ row, col, value });
      }
    }
  }
  return writes;
}

export const isMove = (mutation: Mutation) => mutation.id === cellIds.moveRange;

/** Whether `a` writes a cell `b` writes. */
export function meets(a: Mutation, b: Mutation): boolean {
  const cells = new Set(writesOf(b).map(cellKey));
  return writesOf(a).some((write) => cells.has(cellKey(write)));
}

const written = new WeakMap<Mutation, Write[]>();

/** The cells `mutation` writes, kept per mutation: a sequence is paired many times. */
export function writesOf(mutation: Mutation): Write[] {
  let writes = written.get(mutation);
  if (!writes) written.set(mutation, (writes = cellWrites(mutation)));
  return writes;
}

function cellWrites(mutation: Mutation): Write[] {
  const p = mutation.params;
  if (mutation.id === cellIds.setRangeValues || isGhost(mutation)) {
    return matrixWrites(p.cellValue);
  }
  if (mutation.id === cellIds.setNumfmt) {
    const values = p.values as Record<string, { ranges: IRange[] }>;
    return Object.entries(values).flatMap(([id, { ranges }]) => rangeWrites(ranges, id));
  }
  if (mutation.id === cellIds.removeNumfmt) return rangeWrites(p.ranges, null);
  return [...matrixWrites(p.from.value), ...matrixWrites(p.to.value)];
}
