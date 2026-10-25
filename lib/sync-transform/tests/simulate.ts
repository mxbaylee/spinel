import { expect } from 'vitest';
import { flip, RefusedEditError, transform as realTransform } from '../index.ts';
import type { BaseCells, Mutation, Side } from '../index.ts';
import { mapIndex } from '../src/axis.ts';
import { shiftOf } from '../src/shifts.ts';
import { Cells, claimsOf, isAbsolute } from '../src/state.ts';
import { axisEdit } from '../src/structure.ts';
import { checkBases } from '../src/transform.ts';
import { cellIds, writesOf } from '../src/writes.ts';
import { random } from './random.ts';
import { seededWorkbook } from './generate.ts';
import { liveCells, Replica, snapshotCells } from './harness.ts';
import { isFormulaId } from '@univerjs/core';
import type { IDocumentData, IRange, IWorkbookData } from '@univerjs/core';

/**
 * Whether a cell value is a tail (state.ts `absolute`): an absolute write that
 * names no `v`, where every other absolute write names each key.
 */
const isTail = (value: unknown) => isAbsolute(value) && value.v === undefined;

/** Makes one random edit from a replica's current state, or null to skip a turn. */
export type Generate = (replica: Replica, next: () => number) => Mutation[] | null;

/** Each cell's keys, by `sheet:row:col`, as `stateOf` reads them. */
type State = Map<string, Keys>;
type Keys = Map<string, string>;
/**
 * A replica's keys, each with what wrote it: `seed`, `client:n` for the nth
 * mutation a client made, or `#i` for the history's ith edit as a client
 * applied it.
 */
type Facts = Map<string, Map<string, Fact>>;
/** `typeOnly`: a value `by` retyped with a write of `t` alone (see `shapes`). */
type Fact = { value: string; by: string; typeOnly?: true };
/** Where a cell's content is: a cell, null once deleted, undefined once dragged nowhere. */
type Place = string | null | undefined;

/** What an edit wrote or changed where it landed (see `written`), and the keys there after. */
type Landed = { touched: Set<string>; after: State };
/** A replica, with the keys it holds. */
interface Site {
  replica: Replica;
  facts: Facts;
}

/**
 * A mutation a client made, `label` (see `Facts`), and what transforms have
 * made of it since. Its sender had applied the first `revision` edits of the
 * history when it made it: those, and its sender's own earlier mutations, are
 * what it saw.
 */
interface Part {
  label: string;
  revision: number;
  mutations: Mutation[];
}

const flat = (parts: Part[]) => parts.flatMap((part) => part.mutations);
const sender = (label: string) => label.split(':')[0];

interface Client extends Site {
  /**
   * Its document before its pending edits: each accepted edit as the server
   * sent it, and its own as acknowledged. What its transforms read (BaseCells).
   */
  confirmed: Replica;
  revision: number;
  inflight: Part[] | null;
  buffer: Part[];
  /** Server messages not yet delivered, in order: an ack, or another client's edit's history index. */
  inbox: ('ack' | number)[];
  /** Edits sent but not yet received by the server, in order. */
  outbox: { revision: number; parts: Part[] }[];
  /** Resyncing: it waits for the server's answer to the batch it sent, then reloads. */
  waiting: boolean;
}

/**
 * One step of a scripted run: a client makes `edit`, or sends its pending
 * edits, or the server takes the client's next batch, or the client its next
 * message.
 */
export type Step = { client: number } & (
  { edit: Mutation[] } | { take: 'send' | 'server' | 'client' }
);

/** A cell, as `sheet:row:col`. */
const at = (sheet: string, row: number, col: number) => `${sheet}:${row}:${col}`;
const parse = (key: string) => {
  const [sheet, row, col] = key.split(':');
  return { sheet, row: Number(row), col: Number(col) };
};

/** Seeded values name their first cell (`s1:0:2`); each text, formula or colour written has a token. */
const tokenPattern = /s\d+:\d+:\d+|[wc]#\d+/g;

/** The text decorations whose colour follows the font colour. */
const decorations = new Set(['ul', 'ol', 'st']);

const booleans = new Map([
  ['true', '1'],
  ['false', '0'],
]);

/**
 * Each key `replica` holds, by cell: `s` as `s.<key>` for each style key and
 * `s.bd.<edge>` for each border edge, and no `t`, which Univer derives. A
 * value reads as its text, as a text format types it, and rich text as its
 * text, which a style restyles. With `where`, throws if a token is in two
 * cells: moves move content, and nothing copies it.
 */
function stateOf(replica: Replica, where?: string): State {
  const state: State = new Map();
  const tokens = new Map<string, string>();
  const styles = replica.workbook()!.getStyles();
  const read = (key: string, value: any): [string, string][] => {
    if (value == null || key === 't') return [];
    if (key === 's') {
      const style = typeof value === 'string' ? styles.get(value) : value;
      return Object.entries(style ?? {}).flatMap(([name, v]): [string, string][] => {
        if (v == null) return [];
        // Univer copies the font colour into these lines whenever a style
        // holds `cl`, even a null one (mergeStyle), so a line's own colour is
        // not its writer's to keep.
        if (decorations.has(name)) {
          const { cl: _, ...line } = v as Record<string, unknown>;
          return [[`s.${name}`, JSON.stringify(line)]];
        }
        if (name !== 'bd') return [[`s.${name}`, JSON.stringify(v)]];
        return Object.entries(v).flatMap(([edge, e]): [string, string][] =>
          e == null ? [] : [[`s.bd.${edge}`, JSON.stringify(e)]],
        );
      });
    }
    // Univer stores TRUE as 1, so a value's type may turn one into the other.
    if (key === 'v') return [['v', booleans.get(String(value).toLowerCase()) ?? String(value)]];
    if (key === 'p') return [['p', String(value.body?.dataStream)]];
    return [[key, JSON.stringify(value)]];
  };
  for (const sheet of replica.workbook()!.getSheets()) {
    sheet.getCellMatrix().forValue((row, col, cell) => {
      const key = at(sheet.getSheetId(), row, col);
      const keys = new Map(
        Object.entries(cell ?? {}).flatMap(([name, value]) => read(name, value)),
      );
      if (keys.size > 0) state.set(key, keys);
      if (where) {
        for (const token of [...keys.values()].join(' ').match(tokenPattern) ?? []) {
          const other = tokens.get(token) ?? key;
          if (other !== key) throw new Error(`${where}: ${token} is in ${other} and ${key}`);
          tokens.set(token, key);
        }
      }
    });
  }
  return state;
}

const inRange = (r: IRange, row: number, col: number) =>
  row >= r.startRow && row <= r.endRow && col >= r.startColumn && col <= r.endColumn;

/**
 * Where a drag takes each source cell's content: the cell at the same place
 * in `toRange`, while the move still writes it.
 */
function targets(move: Mutation): Map<string, { row: number; col: number }> {
  const { fromRange, toRange, from, to } = move.params;
  const result = new Map<string, { row: number; col: number }>();
  for (const [r, columns] of Object.entries(from.value ?? {})) {
    for (const c of Object.keys(columns ?? {})) {
      const row = Number(r) + toRange.startRow - fromRange.startRow;
      const col = Number(c) + toRange.startColumn - fromRange.startColumn;
      if (to.value?.[row]?.[col] !== undefined) result.set(`${r}:${c}`, { row, col });
    }
  }
  return result;
}

/**
 * Where `mutation` takes the content of a cell: to the same cell or another,
 * to null where it deletes the cell, or to undefined where a drag takes it to
 * no target, as when a concurrent edit removed the target. A drag to another
 * sheet takes it there. A shift moves the cells of its band, written or not,
 * as far as its ranges reach, and deletes those in the lines it removes.
 */
function follower(mutation: Mutation): (cell: string) => Place {
  const p = mutation.params;
  const line = axisEdit(mutation);
  const shift = line ? { axis: line.axis, ...line.edit } : shiftOf(mutation);
  const drag = !shift && mutation.id === cellIds.moveRange && targets(mutation);
  if (!shift && !drag) return (cell) => cell;
  return (cell) => {
    const { sheet, row, col } = parse(cell);
    if (sheet !== (line ? p.subUnitId : p.from.subUnitId)) return cell;
    if (drag) {
      if (p.from.value[row]?.[col] === undefined) return cell;
      const target = drag.get(`${row}:${col}`);
      return target && at(p.to.subUnitId, target.row, target.col);
    }
    const [index, across] = shift!.axis === 'row' ? [row, col] : [col, row];
    if (!line) {
      const { fromRange: band } = p;
      const [first, last] =
        shift!.axis === 'row' ? [band.startColumn, band.endColumn] : [band.startRow, band.endRow];
      if (across < first || across > last) return cell;
      const removed =
        shift!.kind === 'remove' && index >= shift!.at && index < shift!.at + shift!.count;
      if (!removed && !inRange(band, row, col) && !inRange(p.toRange, row, col)) return cell;
    }
    const moved = mapIndex(shift!, index);
    if (moved === null) return null;
    return shift!.axis === 'row' ? at(sheet, moved, col) : at(sheet, row, moved);
  };
}

/**
 * The keys `mutation` writes in each cell: '' for a whole cell
 * (a null write or a drag's), `s` for a whole style. A shift moves cells and
 * writes none. A write that clears its formula also deletes `ft` and `fd`
 * (mergeCellData), and one with a value and a merged style rich text it does
 * not name (handleStyle), so it writes those keys too. An absolute write (see
 * state.absolute) writes only the keys it claims; the rest it writes again as
 * the cell held them.
 */
function written(mutation: Mutation): { cell: string; key: string }[] {
  const p = mutation.params;
  const cells = Object.values(cellIds) as string[];
  if (!cells.includes(mutation.id) || shiftOf(mutation)) return [];
  // A move writes whole cells, each matrix on its own sheet.
  if (mutation.id === cellIds.moveRange) {
    return [p.from, p.to].flatMap(({ subUnitId, value }) =>
      Object.entries(value ?? {}).flatMap(([row, columns]) =>
        Object.keys(columns ?? {}).map((col) => ({ cell: at(subUnitId, +row, +col), key: '' })),
      ),
    );
  }
  return writesOf(mutation).flatMap(({ row, col, value }) => {
    const cell = at(p.subUnitId, row, col);
    if (mutation.id !== cellIds.setRangeValues) return [{ cell, key: 's.n' }];
    if (value === null) return [{ cell, key: '' }];
    // A tail puts back what its absolute write dropped, and is no edit of
    // its own: the transform reads it as part of that write (decision 36).
    if (isTail(value)) return [];
    // An absolute write writes what it claims, with what Univer derives in it.
    if (isAbsolute(value)) return claimed(cell, claimsOf(value));
    const cleared = (value.f === null || value.f === '') && !isFormulaId(value.si);
    const dropsText = value.s !== undefined && value.v && value.p === undefined;
    const derived = [
      ...(cleared ? ['ft', 'fd'] : []),
      ...(dropsText && !p.isOverrideStyle ? ['p'] : []),
    ];
    return [
      ...derived.map((key) => ({ cell, key })),
      ...Object.entries(value).flatMap(([key, v]) => {
        if (v === undefined || key === 't') return [];
        if (key !== 's' || v === null || p.isOverrideStyle) return [{ cell, key }];
        return Object.entries(v as object).flatMap(([name, style]) =>
          name === 'bd' && style
            ? Object.keys(style).map((edge) => ({ cell, key: `s.bd.${edge}` }))
            : [{ cell, key: `s.${name}` }],
        );
      }),
    ];
  });
}

/** The keys an absolute write's `claims` name in `cell` (see state.difference). */
function claimed(
  cell: string,
  claims: Record<string, any> | null,
): { cell: string; key: string }[] {
  if (!claims) return [{ cell, key: '' }];
  return Object.entries(claims).flatMap(([key, v]) => {
    if (key === 't') return [];
    if (key !== 's' || v === null) return [{ cell, key }];
    return Object.entries(v as object).flatMap(([name, style]) =>
      name === 'bd' && style
        ? Object.keys(style).map((edge) => ({ cell, key: `s.bd.${edge}` }))
        : [{ cell, key: `s.${name}` }],
    );
  });
}

/** Whether a cell write names `t` and nothing else: as sent, or as an absolute write's claims. */
const typeOnly = (value: unknown) => {
  const own = claimsOf(value);
  if (!own || typeof own !== 'object') return false;
  return (
    Object.keys(own)
      .filter((key) => own[key] !== undefined)
      .join() === 't'
  );
};

/**
 * The cells where `mutation` makes one of the two writes the intent checks
 * let a concurrent edit beat, as `cell|type` and `cell|restyle`:
 * - `type`: a write of `t` alone, the retype SetNumfmtCommand sends, which
 *   yields to a concurrent write of the value (decision 35).
 * - `restyle`: a value with a style and no rich text, not overriding, which
 *   Univer lands as a restyle of the cell's rich text where the value is its
 *   text (handleStyle), and otherwise as a deletion of it (decision 32).
 */
function shapes(mutation: Mutation): string[] {
  const p = mutation.params;
  if (mutation.id !== cellIds.setRangeValues || shiftOf(mutation)) return [];
  return writesOf(mutation).flatMap(({ row, col, value }) => {
    const cell = at(p.subUnitId, row, col);
    if (typeOnly(value)) return [`${cell}|type`];
    const restyle =
      !!value &&
      !isAbsolute(value) &&
      !p.isOverrideStyle &&
      value.s !== undefined &&
      !!value.v &&
      value.p === undefined;
    return restyle ? [`${cell}|restyle`] : [];
  });
}

/** Each entry `each` gives for `mutations`, as `cell|…`, in the cell the later ones take it to. */
function followed(mutations: Mutation[], each: (mutation: Mutation) => string[]): Set<string> {
  let entries: string[] = [];
  for (const mutation of mutations) entries = [...moved(entries, [mutation]), ...each(mutation)];
  return new Set(entries);
}

/** What `mutation` writes (see `written`), as `cell|key`. */
const writes = (mutation: Mutation) => written(mutation).map(({ cell, key }) => `${cell}|${key}`);

/** Whether `touched`, as `cell|key` (see `written`), holds `key` of `cell`. */
const covered = (touched: Set<string>, cell: string, key: string) =>
  touched.has(`${cell}|${key}`) ||
  touched.has(`${cell}|`) ||
  (key.startsWith('s.') && touched.has(`${cell}|s`)) ||
  (key.startsWith('s.bd.') && touched.has(`${cell}|s.bd`));

/** `touched` (see `covered`), with each cell where `mutations` take it. */
function moved(touched: Iterable<string>, mutations: Mutation[]): string[] {
  const follows = mutations.map(follower);
  return [...touched].flatMap((entry) => {
    const [cell, key] = entry.split('|');
    const here = follows.reduce<Place>((place, follow) => place && follow(place), cell);
    return here ? [`${here}|${key}`] : [];
  });
}

/** Throws if a cell's keys `x` and the server's `y` differ in a key `named` picks. */
function compare(x?: Keys, y?: Keys, where = '', named: (key: string) => boolean = () => true) {
  for (const key of new Set([...(x?.keys() ?? []), ...(y?.keys() ?? [])])) {
    if (!named(key) || x?.get(key) === y?.get(key)) continue;
    throw new Error(`${where}: ${key} is ${x?.get(key)}, and ${y?.get(key)} on the server`);
  }
}

/** `value` as JSON with each object's keys sorted, since replicas that agree can order them apart. */
const sortedJson = (value: unknown) =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );

/** `transform`'s signature, for a run that swaps in another (see `simulate`). */
export type Transform = typeof realTransform;

/** Refusals and resyncs by reason, as `count:reason`, over every run since it was cleared. */
export const reasons = new Map<string, number>();

/** What `simulate` counts (see its doc). */
export type Stats = ReturnType<typeof newStats>;
export const newStats = () => ({
  edits: 0,
  mutations: 0,
  batches: 0,
  accepted: 0,
  refused: 0,
  resynced: 0,
  discarded: 0,
});

/**
 * The README's sender rules take a refusal for moved cells or a format race
 * to refuse the other order too, whichever edit lands first. Growth depends
 * on the order, so it is not checked.
 */
function refusedBothWays(
  error: unknown,
  a: Mutation[],
  b: Mutation[],
  side: Side,
  cells: BaseCells,
  transformAll: Transform,
) {
  if (!(error instanceof RefusedEditError) || error.reason === 'growth') return;
  try {
    transformAll(b, a, flip(side), { cells });
  } catch (other) {
    if (other instanceof RefusedEditError) return;
  }
  throw new Error(
    `${a.length} past ${b.length} was refused (${error.reason}), the other order not`,
  );
}

/**
 * Two clients and a server, with every message delayed at random, the way a
 * central sync server orders edits: the server transforms each incoming edit
 * past the edits it has accepted since the client's revision (they win), and
 * each client transforms incoming edits past its own unacknowledged ones.
 * An edit the transforms refuse (RefusedEditError) is refused as a server
 * would: its sender discards its pending edits and reloads the server's
 * document, and `stats.refused` counts it. A client that cannot take an
 * incoming edit past its pending ones resyncs too, as the README's sender
 * rules say: it discards the edits it has not sent, and the batch it sent
 * still reaches the server, which accepts or refuses it on its own, and the
 * client reloads once it has the answer.
 *
 * With `intent`, for cell edits only, it also checks the edits keep what they
 * should. Each replica holds every key of every cell (see `stateOf`) with
 * what wrote it (see `Facts`), and follows the cell as rows, columns, shifts
 * and drags move it, so each key an edit writes is held from then on. Then:
 * - No token is ever in two cells of a replica.
 * - The server lands each mutation a client made on its own, as transforms
 *   made it (see `Part`). Each key held keeps its value unless the mutation
 *   deletes its cell or saw the key: its writer was accepted before the
 *   mutation's revision, or is its sender's earlier mutation, whose key it
 *   changed on its sender too. History wins, even over a mutation that was
 *   transformed past it on its sender before it was sent, except over a
 *   write of the value (`v` named, or the cell deleted) where history's
 *   writer of `v` was a write of `t` alone (decision 35, F12).
 * - On a client, an incoming edit changes only keys it changed on the server
 *   (see `written`), in the cells the pending edits, landing after it there,
 *   take them to, and they must then be as on the server, except where a
 *   pending edit writes the key too and one of two rules gives it the say
 *   (see `yields`): `v`, where the incoming edit writes `t` alone and the
 *   client keeps the value it held (decision 35, F12); and `p`, where the
 *   incoming edit is a value with a style that restyled the server's rich
 *   text of its own text and the client ends with no `p` (decision 32, F8).
 * - A client whose edit is acknowledged, with none pending, holds the server's.
 * The transform reads cells where two writes meet: the server those of the
 * revision a batch was made on (`revisions`, the snapshots SPN-057 would
 * keep), and a client those of its `confirmed` replica, the server's document
 * as it last heard, advanced past each pending edit in turn.
 *
 * Whether or not `intent` is set, a client that is caught up, with nothing
 * pending or on its way and every accepted edit applied, must hold the
 * server's document, not only at the end.
 *
 * `stats` counts the edits made (`edits`, one per `generate` call, and
 * `mutations`), the batches that reached the server (`batches`), those it
 * accepted and refused, the clients that resynced because an incoming edit
 * could not pass their pending ones (`resynced`), and the pending mutations
 * that refusals and resyncs discarded (`discarded`).
 */
export function simulate(options: {
  seed: number;
  document: { workbook?: IWorkbookData; doc?: IDocumentData };
  /** Runs until the clients have made this many mutations. */
  mutations: number;
  generate: Generate;
  /** The most mutations a transform may return per mutation it transforms. */
  budget?: number;
  intent?: boolean;
  /**
   * Steps to run before the random ones. A step that cannot run is skipped,
   * as the random steps skip it, so a shrunk script still runs: an edit by a
   * client waiting to reload, or taking a batch or message where none waits.
   */
  script?: Step[];
  /** Filled with the random steps as they run, to replay them as a `script`. */
  trace?: Step[];
  /** The transform the server and clients run: `transform`, or a broken one a test plants. */
  transform?: Transform;
}) {
  const transformAll = options.transform ?? realTransform;
  const next = random(options.seed);
  let largest = 0;
  /** Transforms `a` past `b`, both made on `cells`. */
  const transform = (a: Mutation[], b: Mutation[], side: Side, cells: BaseCells) => {
    let result: Mutation[];
    try {
      result = transformAll(a, b, side, { cells });
    } catch (error) {
      refusedBothWays(error, a, b, side, cells, transformAll);
      throw error;
    }
    // Every absolute write it returns restates its cell, after `b`, wherever
    // it claims nothing (state.baseError), whether or not it is transformed
    // again: the server's stored edits, and a client's rebased pending ones.
    let after = Cells.of(cells);
    for (const mutation of b) after = after.after(mutation);
    checkBases(result, after);
    const inputs = a.length + b.length;
    largest = Math.max(largest, result.length / Math.max(inputs, 1));
    if (options.budget !== undefined && result.length > options.budget * inputs) {
      throw new Error(`${a.length} mutations past ${b.length} became ${result.length}`);
    }
    return result;
  };
  const intent = options.intent;
  /**
   * Transforms `parts` past `b`, keeping what each became: transform pairs
   * mutations up in order, so the first n parts become the start of the whole.
   */
  const pastParts = (parts: Part[], b: Mutation[], side: Side, cells: BaseCells): Part[] => {
    const all = transform(flat(parts), b, side, cells);
    if (!intent) return [{ ...parts[0], mutations: all }];
    let [done, prefix] = [0, [] as Mutation[]];
    return parts.map((part, i) => {
      // The final part owns the remainder; comparing `all` with its own slice
      // proves nothing. Every proper prefix still gets transformed and checked.
      if (i === parts.length - 1) return { ...part, mutations: all.slice(done) };
      prefix = [...prefix, ...part.mutations];
      const upTo = transformAll(prefix, b, side, { cells });
      if (JSON.stringify(upTo) !== JSON.stringify(all.slice(0, upTo.length))) {
        throw new Error(`${part.label} became no start of its batch's transform`);
      }
      const start = done;
      done = upTo.length;
      return { ...part, mutations: all.slice(start, done) };
    });
  };
  const server: Site = { replica: new Replica(options.document), facts: new Map() };
  /** Each accepted edit, with `shapes` (see `shapes`) where it lands, as `touched`. */
  const history: ({ mutations: Mutation[]; shapes: Set<string> } & Landed)[] = [];
  /** The server's cells after the first `revision` edits, by revision: its snapshots (SPN-057). */
  const snapshot = () => snapshotCells(structuredClone(server.replica.workbook()?.getSnapshot()));
  const revisions: BaseCells[] = [snapshot()];
  /** Each client mutation's history index; the seeded document's is -1. */
  const acceptedAt = new Map([['seed', -1]]);
  const indexOf = (by: string) =>
    by.startsWith('#') ? Number(by.slice(1)) : (acceptedAt.get(by) ?? Infinity);
  /**
   * The keys each client mutation changed on its sender, as `key|value`:
   * writers differ where replicas held a value before it was written again.
   */
  const changes = new Map<string, Set<string>>();
  let made = 0;
  const stats = newStats();
  /**
   * Applies `mutations`, which `by` made, to `site`, and checks the
   * keys it held as `simulate` says, `mayChange` allowing changes, told
   * whether the mutations write the key (see `written`). Returns the keys
   * the mutations wrote or changed, and the state.
   */
  const land = (
    site: Site,
    mutations: Mutation[],
    by: string,
    where: string,
    mayChange: (fact: Fact, cell: string, key: string, writes: boolean) => boolean = () => true,
  ): Landed => {
    site.replica.apply(mutations);
    if (!intent) return { touched: new Set(), after: new Map() };
    const held = [...site.facts].flatMap(([cell, keys]) =>
      [...keys].map(([key, fact]) => ({ cell: cell as Place, last: cell, key, fact })),
    );
    const wrote: { cell: Place; key: string }[] = [];
    const retyped: { cell: Place }[] = [];
    for (const mutation of mutations) {
      const follow = follower(mutation);
      for (const entry of [...held, ...wrote, ...retyped]) entry.cell &&= follow(entry.cell);
      for (const entry of held) entry.last = entry.cell || entry.last;
      wrote.push(...written(mutation));
      for (const entry of shapes(mutation)) {
        const [cell, shape] = entry.split('|');
        if (shape === 'type') retyped.push({ cell });
      }
    }
    const typed = new Set(retyped.flatMap(({ cell }) => (cell ? [cell] : [])));
    const after = stateOf(site.replica, where);
    const kept: Facts = new Map();
    const keep = (cell: string, key: string, fact: Fact) =>
      kept.set(cell, (kept.get(cell) ?? new Map()).set(key, fact));
    const touched = new Set(wrote.flatMap(({ cell, key }) => (cell ? [`${cell}|${key}`] : [])));
    const writing = new Set(touched);
    for (const { cell, last, key, fact } of held) {
      if (cell === null) continue;
      const value = cell && after.get(cell)?.get(key);
      if (value === fact.value) {
        // Written again by an edit before its writer, it is that edit's.
        const again = covered(touched, cell!, key) && indexOf(by) < indexOf(fact.by);
        keep(cell!, key, again ? { value, by } : fact);
        continue;
      }
      touched.add(`${last}|${key}`);
      if (mayChange(fact, last, key, covered(writing, last, key))) continue;
      throw new Error(`${where}: ${key} of ${last} by ${fact.by}, ${fact.value}, is now ${value}`);
    }
    for (const [cell, keys] of after) {
      for (const [key, value] of keys) {
        if (kept.get(cell)?.has(key)) continue;
        keep(
          cell,
          key,
          key === 'v' && typed.has(cell) ? { value, by, typeOnly: true } : { value, by },
        );
        touched.add(`${cell}|${key}`);
      }
    }
    site.facts = kept;
    return { touched, after };
  };
  const seeded = land(server, [], 'seed', 'seeded').after;
  const clients: Client[] = [0, 1].map(() => ({
    replica: new Replica(options.document),
    confirmed: new Replica(options.document),
    facts: server.facts,
    revision: 0,
    inflight: null,
    buffer: [],
    inbox: [],
    outbox: [],
    waiting: false,
  }));
  /** The server's keys after the first `revision` edits. */
  const stateAt = (revision: number) => (revision === 0 ? seeded : history[revision - 1].after);

  const send = (client: Client) => {
    if (client.inflight || client.buffer.length === 0) return;
    client.inflight = client.buffer;
    client.buffer = [];
    client.outbox.push({ revision: client.revision, parts: client.inflight });
  };
  /**
   * Discards `client`'s pending edits and reloads the server's document, which
   * holds every message still on its way to it. The document is rebuilt from
   * the server's history, as the server's was.
   */
  const reload = (client: Client) => {
    // An acknowledged batch is in the server's history, so the reload keeps it.
    const acknowledged = client.inbox.includes('ack');
    const inflight = acknowledged ? [] : (client.inflight ?? []);
    stats.discarded += flat([...inflight, ...client.buffer]).length;
    for (const replica of [client.replica, client.confirmed]) replica.univer.dispose();
    client.replica = new Replica(options.document);
    client.confirmed = new Replica(options.document);
    for (const { mutations } of history) {
      client.replica.apply(mutations);
      client.confirmed.apply(mutations);
    }
    Object.assign(client, { revision: history.length, inflight: null, buffer: [] });
    Object.assign(client, { facts: server.facts, waiting: false });
    client.inbox.length = 0;
  };
  /**
   * Refuses `client`'s pending edits. A batch it sent that the server has not
   * yet received still reaches it, and may be accepted: the server pairs it
   * only with the edits accepted since, and what failed here may be a later
   * edit. So the client discards only its unsent edits now, ignores the edits
   * that arrive meanwhile, and reloads on the server's answer.
   */
  const resync = (client: Client) => {
    if (client.outbox.length === 0) return reload(client);
    stats.discarded += flat(client.buffer).length;
    Object.assign(client, { buffer: [], waiting: true });
    client.inbox.length = 0;
  };
  /**
   * Runs `transforms`, or resyncs `client` if they refuse, counted as a
   * refusal at the server and as a resync at a client.
   */
  const transformOr = <T>(client: Client, count: 'refused' | 'resynced', transforms: () => T) => {
    try {
      return transforms();
    } catch (error) {
      if (!(error instanceof RefusedEditError)) throw error;
      stats[count]++;
      const at = `${count}:${error.reason}`;
      reasons.set(at, (reasons.get(at) ?? 0) + 1);
      resync(client);
      return null;
    }
  };
  const receiveAtServer = (from: Client) => {
    const { revision, parts } = from.outbox.shift()!;
    stats.batches++;
    let incoming: Part[] | null = parts;
    for (let at = revision; at < history.length; at++) {
      const { mutations } = history[at];
      const cells = revisions[at];
      incoming = transformOr(from, 'refused', () =>
        pastParts(incoming!, mutations, 'right', cells),
      );
      if (!incoming) return;
    }
    stats.accepted++;
    const index = history.length;
    if (intent) for (const { label } of incoming) acceptedAt.set(label, index);
    const where = `server at ${index}`;
    // Each mutation changes only keys it saw: the edits accepted since lose
    // nothing to it, except a value retyped by a write of `t` alone, which
    // yields to a concurrent write of the value (decision 35).
    let { touched, after } = { touched: new Set<string>(), after: stateAt(index) };
    let shaped = new Set<string>();
    for (const { label, revision: saw, mutations } of incoming) {
      if (mutations.length === 0) continue;
      const landed = land(server, mutations, label, where, (fact, _cell, key, writes) => {
        if (indexOf(fact.by) < saw) return true;
        if (key === 'v' && fact.typeOnly && writes) return true;
        return (
          sender(fact.by) === sender(label) && !!changes.get(label)?.has(`${key}|${fact.value}`)
        );
      });
      if (intent) {
        touched = new Set([...moved(touched, mutations), ...landed.touched]);
        // A shape is its writer's: a later part that writes the key it lets a
        // pending edit keep there (`v` for `type`, `p` for `restyle`) ends it.
        const wrote = followed(mutations, writes);
        const kept = moved(shaped, mutations).filter((entry) => {
          const [cell, shape] = entry.split('|');
          return !covered(wrote, cell, shape === 'type' ? 'v' : 'p');
        });
        shaped = new Set([...kept, ...followed(mutations, shapes)]);
      }
      after = landed.after;
    }
    history.push({ mutations: flat(incoming), touched, after, shapes: shaped });
    revisions.push(snapshot());
    for (const client of clients) client.inbox.push(client === from ? 'ack' : index);
  };
  /** The server's snapshot, taken once per revision, as JSON and as `sortedJson` once needed. */
  let latest: { revision: number; snapshot: unknown; json: string; sorted?: string } | null = null;
  /**
   * Expects `client`, if it is caught up (no edit pending or on its way, and
   * every accepted edit applied), to hold the server's document. Plain JSON
   * is the quick check, and sorted JSON the next, before a deep comparison.
   */
  const caughtUp = (client: Client, where: string) => {
    if (client.inflight || client.buffer.length > 0 || client.revision !== history.length) return;
    if (latest?.revision !== history.length) {
      const snapshot = server.replica.snapshot();
      latest = { revision: history.length, snapshot, json: JSON.stringify(snapshot) };
    }
    const here = client.replica.snapshot();
    if (JSON.stringify(here) === latest.json) return;
    latest.sorted ??= sortedJson(latest.snapshot);
    if (sortedJson(here) === latest.sorted) return;
    expect(here, `${where}, caught up`).toEqual(latest.snapshot);
  };
  const receiveAtClient = (client: Client) => {
    const message = client.inbox.shift()!;
    if (client.waiting) {
      // Its batch was accepted, so the reload keeps it. A refusal reloads at the server.
      if (message === 'ack') reload(Object.assign(client, { inflight: null }));
      return;
    }
    const where = `client ${clients.indexOf(client)} at ${client.revision++}`;
    if (message === 'ack') {
      // Acknowledged as the server landed it: transformed past every edit it took.
      client.confirmed.apply(flat(client.inflight!));
      client.inflight = null;
      if (intent && client.buffer.length === 0) {
        const [here, there] = [stateOf(client.replica), stateAt(client.revision)];
        for (const cell of new Set([...here.keys(), ...there.keys()])) {
          compare(here.get(cell), there.get(cell), `${where}, acknowledged: ${cell}`);
        }
      }
      caughtUp(client, where);
      send(client);
      return;
    }
    const { mutations, touched, shapes: shaped } = history[message];
    let incoming = mutations;
    // The inflight edits were made on the confirmed document, and the buffer
    // on it with the inflight edits, as they were before this edit came.
    let made = Cells.of(liveCells(client.confirmed));
    for (const key of ['inflight', 'buffer'] as const) {
      const pending = client[key];
      if (!pending || pending.length === 0) continue;
      const on = made;
      const cells: BaseCells = (...at) => on.get(...at);
      // The server refuses the pending edits for the same reason. Where only
      // the incoming edit cannot go past them, the client cannot apply it
      // and resyncs as well.
      const kept = transformOr(client, 'resynced', () =>
        pastParts(pending, incoming, 'right', cells),
      );
      const past =
        kept &&
        transformOr(client, 'resynced', () => transform(incoming, flat(pending), 'left', cells));
      if (!kept || !past) return;
      for (const mutation of flat(pending)) made = made.after(mutation);
      client[key] = kept;
      incoming = past;
    }
    client.confirmed.apply(mutations);
    // What the incoming edit wrote on the server, and its shapes, in the
    // cells the pending edits, landing after it there, take them to here.
    const pending = intent ? flat([...(client.inflight ?? []), ...client.buffer]) : [];
    const follows = pending.map(follower);
    const [there, mine, kinds] = [new Map<string, string>(), new Set<string>(), new Set<string>()];
    for (const [entries, into] of intent
      ? ([
          [touched, mine],
          [shaped, kinds],
        ] as const)
      : []) {
      for (const entry of entries) {
        const [cell, key] = entry.split('|');
        let here: Place = cell;
        for (const follow of follows) here &&= follow(here);
        if (!here) continue;
        into.add(`${here}|${key}`);
        if (into === mine) there.set(here, cell);
      }
    }
    // What the pending edits write here, and the keys here before the incoming edit.
    const [theirs, before] = [intent ? followed(pending, writes) : new Set<string>(), client.facts];
    /**
     * Whether `key` of `here` may differ from the server's `server`, where
     * the client ends with `after`: the incoming edit wrote it, but by an
     * accepted rule a pending edit that writes it too has the say there.
     */
    const yields = (here: string, key: string, server?: Keys, after?: Keys) => {
      if (!covered(theirs, here, key)) return false;
      // Decision 35 (F12): a write of `t` alone, accepted first, yields to a
      // concurrent write of the value, which keeps what the pending edit left.
      if (key === 'v') {
        return kinds.has(`${here}|type`) && after?.get('v') === before.get(here)?.get('v')?.value;
      }
      // Decision 32 (F8): a restyle of the cell's own rich text, accepted
      // first, past a concurrent deletion of the rich text: the value, its
      // style and no `p`, as one person doing both in that order makes.
      if (key === 'p') {
        const restyled = server?.get('p') === `${server?.get('v')}\r\n`;
        return kinds.has(`${here}|restyle`) && restyled && after?.get('p') === undefined;
      }
      return false;
    };
    const landed = land(client, incoming, `#${message}`, where, (_fact, cell, key) =>
      covered(mine, cell, key),
    );
    for (const [here, cell] of there) {
      const [keys, after] = [stateAt(message + 1).get(cell), landed.after.get(here)];
      compare(
        after,
        keys,
        `${where}: ${here}`,
        (key) => covered(mine, here, key) && !yields(here, key, keys, after),
      );
    }
    caughtUp(client, where);
  };

  let mutationsMade = 0;
  /** Lands an edit `client` made on it and buffers it. */
  const edit = (client: Client, mutations: Mutation[]) => {
    const name = clients.indexOf(client);
    for (const mutation of mutations) {
      const [label, changed] = [`${name}:${made++}`, new Set<string>()];
      if (intent) changes.set(label, changed);
      land(client, [mutation], label, `client ${name}`, ({ value }, _cell, key) => {
        changed.add(`${key}|${value}`);
        return true;
      });
      client.buffer.push({ label, revision: client.revision, mutations: [mutation] });
    }
    mutationsMade += mutations.length;
    stats.edits++;
    stats.mutations += mutations.length;
  };
  // A run that throws leaves no replicas to its caller, so it disposes them.
  try {
    for (const step of options.script ?? []) {
      const client = clients[step.client];
      if ('edit' in step) {
        if (!client.waiting && step.edit.length > 0) edit(client, step.edit);
      } else if (step.take === 'send') send(client);
      else if (step.take === 'server') {
        if (client.outbox.length > 0) receiveAtServer(client);
      } else if (client.inbox.length > 0) receiveAtClient(client);
    }
    const trace = (step: Step) => options.trace?.push(step);
    while (mutationsMade < options.mutations) {
      const client = clients[next() % 2];
      const at = { client: clients.indexOf(client) };
      const roll = next() % 10;
      if (roll < 4) {
        // A client waiting to reload makes no edits.
        const mutations = client.waiting ? null : options.generate(client.replica, next);
        if (!mutations || mutations.length === 0) continue;
        // As sent: the replicas apply copies, but a trace keeps its own.
        options.trace?.push({ ...at, edit: structuredClone(mutations) });
        edit(client, mutations);
        if (next() % 2 === 0) {
          trace({ ...at, take: 'send' });
          send(client);
        }
      } else if (roll < 7 && client.outbox.length > 0) {
        trace({ ...at, take: 'server' });
        receiveAtServer(client);
      } else if (client.inbox.length > 0) {
        trace({ ...at, take: 'client' });
        receiveAtClient(client);
      }
    }
    // Deliver everything still in flight.
    for (;;) {
      const busy = clients.find(
        (client) => client.outbox.length > 0 || client.inbox.length > 0 || client.buffer.length > 0,
      );
      if (!busy) break;
      send(busy);
      if (busy.outbox.length > 0) receiveAtServer(busy);
      while (busy.inbox.length > 0) receiveAtClient(busy);
      for (const client of clients) while (client.inbox.length > 0) receiveAtClient(client);
    }
  } catch (error) {
    for (const site of [server, ...clients]) site.replica.univer.dispose();
    for (const client of clients) client.confirmed.univer.dispose();
    throw error;
  }
  for (const client of clients) client.confirmed.univer.dispose();
  return {
    server: server.replica,
    clients: clients.map((client) => client.replica),
    mutations: mutationsMade,
    largest,
    stats,
  };
}

/**
 * Runs `simulate` for each of `seeds`, or only `FUZZ_SEED` when set, and
 * checks every client ends with the server's document. A failure names its
 * seed. Returns the number of mutations made, and adds each seed's counts to
 * `stats` if given.
 */
export function convergesOver(
  generate: Generate,
  {
    seeds,
    mutations = 300,
    document = { workbook: seededWorkbook() },
    budget,
    intent,
    stats,
  }: {
    /** Seeds 1 to this many, or the seeds listed. */
    seeds: number | number[];
    mutations?: number;
    document?: { workbook?: IWorkbookData; doc?: IDocumentData };
    /** As simulate's. */
    budget?: number;
    /** As simulate's. */
    intent?: boolean;
    /** Summed over the seeds. */
    stats?: Stats;
  },
): number {
  const only = process.env.FUZZ_SEED;
  const all = Array.isArray(seeds) ? seeds : Array.from({ length: seeds }, (_, i) => i + 1);
  const list = only ? [Number(only)] : all;
  let total = 0;
  for (const seed of list) {
    let run: ReturnType<typeof simulate>;
    try {
      run = simulate({ seed, document, mutations, generate, budget, intent });
    } catch (error) {
      // Univer rejecting a transformed mutation fails here, not at the comparison.
      throw new Error(`seed ${seed}: ${(error as Error).message}`, { cause: error });
    }
    const expected = run.server.snapshot();
    for (const client of run.clients) expect(client.snapshot(), `seed ${seed}`).toEqual(expected);
    for (const replica of [run.server, ...run.clients]) replica.univer.dispose();
    total += run.mutations;
    for (const key of Object.keys(run.stats) as (keyof Stats)[]) {
      if (stats) stats[key] += run.stats[key];
    }
  }
  return total;
}
