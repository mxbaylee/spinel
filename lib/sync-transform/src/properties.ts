import { mapIndex } from './axis.ts';
import type { AxisEdit } from './axis.ts';
import { axisKeys } from './family.ts';
import type { Axis, Family } from './family.ts';
import type { Mutation, Side } from './types.ts';

/**
 * Row and column metadata (height, width, hidden, auto height, row and column
 * data), keyed by index. Every mutation here is read as one write per index
 * (which keys it sets there), so concurrent writes conflict per index and key.
 */
export const propertyIds = {
  rowHeight: 'sheet.mutation.set-worksheet-row-height',
  rowIsAutoHeight: 'sheet.mutation.set-worksheet-row-is-auto-height',
  rowAutoHeight: 'sheet.mutation.set-worksheet-row-auto-height',
  rowHidden: 'sheet.mutation.set-row-hidden',
  rowVisible: 'sheet.mutation.set-row-visible',
  rowData: 'sheet.mutation.set-row-data',
  colWidth: 'sheet.mutation.set-worksheet-col-width',
  colHidden: 'sheet.mutation.set-col-hidden',
  colVisible: 'sheet.mutation.set-col-visible',
  colData: 'sheet.mutation.set-col-data',
} as const;

/** Each index's write: a value, or `true` for hide and show, which carry none. */
type Writes = Map<number, unknown>;

interface Kind {
  axis: Axis;
  read(params: any): Writes;
  write(params: any, writes: Writes): Record<string, unknown>;
  /** The keys one write sets; null clears the whole row or column. */
  keys(value: unknown): string[] | null;
}

/**
 * A mutation over `ranges` whose `field` is one number for every index or a
 * map keyed by index. `sparse`: an index missing from the map is not written
 * (height and width); otherwise it is written as undefined (is-auto-height).
 */
function ranged(axis: Axis, key: string, field?: string, sparse = true): Kind {
  const [start, end] = axisKeys(axis);
  return {
    axis,
    keys: () => [key],
    read(params) {
      const writes: Writes = new Map();
      const value = field === undefined ? true : params[field];
      for (const range of params.ranges) {
        for (let i = range[start]; i <= range[end]; i++) {
          const at = typeof value === 'object' ? value[i] : value;
          if (!sparse || at != null) writes.set(i, at);
        }
      }
      return writes;
    },
    write(params, writes) {
      const indices = [...writes.keys()].sort((x, y) => x - y);
      const ranges: unknown[] = [];
      for (let i = 0; i < indices.length; i++) {
        let last = i;
        while (indices[last + 1] === indices[last] + 1) last++;
        ranges.push({ ...params.ranges[0], [start]: indices[i], [end]: indices[last] });
        i = last;
      }
      const result: Record<string, unknown> = { ...params, ranges };
      if (field && typeof params[field] === 'object') result[field] = Object.fromEntries(writes);
      return result;
    },
  };
}

/** A mutation whose `field` maps each index to its data, or null to clear it. */
function keyed(axis: Axis, field: string): Kind {
  return {
    axis,
    keys: (data) => (data === null ? null : Object.keys(data as object)),
    read: (params) => new Map(Object.entries(params[field]).map(([i, data]) => [Number(i), data])),
    write: (params, writes) => ({ ...params, [field]: Object.fromEntries(writes) }),
  };
}

const kinds: Record<string, Kind> = {
  [propertyIds.rowHeight]: ranged('row', 'h', 'rowHeight'),
  [propertyIds.rowIsAutoHeight]: ranged('row', 'ia', 'autoHeightInfo', false),
  [propertyIds.rowHidden]: ranged('row', 'hd'),
  [propertyIds.rowVisible]: ranged('row', 'hd'),
  [propertyIds.rowData]: keyed('row', 'rowData'),
  [propertyIds.colWidth]: ranged('column', 'w', 'colWidth'),
  [propertyIds.colHidden]: ranged('column', 'hd'),
  [propertyIds.colVisible]: ranged('column', 'hd'),
  [propertyIds.colData]: keyed('column', 'columnData'),
  [propertyIds.rowAutoHeight]: {
    axis: 'row',
    keys: () => ['ah'],
    read: (params) =>
      new Map(params.rowsAutoHeightInfo.map((info: any) => [info.row, info.autoHeight])),
    write: (params, writes) => ({
      ...params,
      rowsAutoHeightInfo: [...writes].map(([row, autoHeight]) => ({ row, autoHeight })),
    }),
  },
};

/** Re-addresses or drops (null) one write; returns `mutation` itself if nothing changed. */
type Edit = (index: number, value: unknown) => [number, unknown] | null;

function rebuild(mutation: Mutation, edit: Edit): Mutation | null {
  const kind = kinds[mutation.id];
  const writes: Writes = new Map();
  let same = true;
  for (const [index, value] of kind.read(mutation.params)) {
    const result = edit(index, value);
    if (result) writes.set(...result);
    same &&= result !== null && result[0] === index && result[1] === value;
  }
  if (same) return mutation;
  if (writes.size === 0) return null;
  return { id: mutation.id, params: kind.write(mutation.params, writes) };
}

const present = (mutations: (Mutation | null)[]) =>
  mutations.filter((m): m is Mutation => m !== null);

type Keys = string[] | null;

/** Each index `mutation` writes, with the keys written there. */
function keysOf(mutation: Mutation): Map<number, Keys> {
  const kind = kinds[mutation.id];
  return new Map(
    [...kind.read(mutation.params)].map(([index, value]) => [index, kind.keys(value)]),
  );
}

/**
 * SetWorksheetColWidthMutation skips hidden columns, so where the other edit
 * could change a column's visibility or width, the two orders could disagree
 * on whether the width landed. There both orders write it as set-col-data,
 * which always assigns: the edit itself is split, and the side that applied
 * the real width writes it that way again first.
 */
function unconditional(mutation: Mutation, other: Mutation): Set<number> {
  if (mutation.id !== propertyIds.colWidth) return new Set();
  const theirs = keysOf(other);
  const touches = (keys: Keys | undefined) =>
    keys === null || keys?.includes('hd') || keys?.includes('w');
  return new Set([...keysOf(mutation).keys()].filter((index) => touches(theirs.get(index))));
}

/** A width's writes at `indices` as set-col-data, or null if there are none. */
function widthAsData(mutation: Mutation, indices: Set<number>): Mutation | null {
  const columnData: Record<number, { w: unknown }> = {};
  for (const [index, w] of kinds[mutation.id].read(mutation.params)) {
    if (indices.has(index)) columnData[index] = { w };
  }
  if (Object.keys(columnData).length === 0) return null;
  const { unitId, subUnitId } = mutation.params;
  return { id: propertyIds.colData, params: { unitId, subUnitId, columnData } };
}

/** `mutation`'s writes at `indices`, with a width split as `unconditional` says. */
function writesAt(mutation: Mutation, other: Mutation, indices: Set<number>): Mutation[] {
  const split = unconditional(mutation, other);
  return present([
    widthAsData(mutation, new Set([...indices].filter((index) => split.has(index)))),
    rebuild(mutation, (index, value) =>
      indices.has(index) && !split.has(index) ? [index, value] : null,
    ),
  ]);
}

/** A losing write keeps only the keys the winner does not write; a cleared line stays cleared. */
function yieldTo(mutation: Mutation, winner: Map<number, Keys>): Mutation | null {
  const kind = kinds[mutation.id];
  return rebuild(mutation, (index, value) => {
    const theirs = winner.get(index);
    const mine = kind.keys(value);
    if (theirs === undefined || mine === null) return [index, value];
    const kept = theirs === null ? [] : mine.filter((key) => !theirs.includes(key));
    if (kept.length === mine.length) return [index, value];
    if (kept.length === 0) return null;
    const data = value as Record<string, unknown>;
    return [index, Object.fromEntries(kept.map((key) => [key, data[key]]))];
  });
}

function remap(mutation: Mutation, axis: Axis, edit: AxisEdit): Mutation[] {
  if (kinds[mutation.id].axis !== axis) return [mutation];
  return present([
    rebuild(mutation, (index, value) => {
      const to = mapIndex(edit, index);
      return to === null ? null : [to, value];
    }),
  ]);
}

/**
 * Where both write a row or column, the winner's keys stand: the loser drops
 * them, and a loser that cleared the line (set-row-data null) writes the
 * winner's keys again after clearing.
 */
function transform(a: Mutation, b: Mutation, side: Side): Mutation[] {
  if (kinds[a.id].axis !== kinds[b.id].axis) return [a];
  const before = present([widthAsData(b, unconditional(b, a))]);
  const mine = writesAt(a, b, new Set(keysOf(a).keys()));
  if (side === 'left') return [...before, ...mine];
  const theirs = keysOf(b);
  const cleared = new Set(
    [...keysOf(a)].filter(([i, keys]) => keys === null && theirs.get(i)).map(([i]) => i),
  );
  return [...before, ...present(mine.map((m) => yieldTo(m, theirs))), ...writesAt(b, a, cleared)];
}

export const properties: Family = { ids: Object.keys(kinds), remap, transform };
