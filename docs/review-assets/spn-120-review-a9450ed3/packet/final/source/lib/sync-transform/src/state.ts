import { isFormulaId, ObjectMatrix, Styles, Tools } from '@univerjs/core';
import { prepareSetRangeValuesMutation } from '@univerjs/sheets';
import { mapIndex } from './axis.ts';
import type { AxisEdit } from './axis.ts';
import { cellIds, writesOf } from './writes.ts';
import { axisEdit, structureIds } from './structure.ts';
import { MalformedEditError } from './types.ts';
import type { Mutation } from './types.ts';

export type CellData = Record<string, any>;

/**
 * A cell of the document both sequences were made from, by unit, sheet, row
 * and column, with its style inline (`s` an object, never a style id), or
 * null or undefined where there is none. The server reads it from its
 * snapshot at the sequences' base revision; a client from its copy of the
 * document before its pending edits.
 */
export type BaseCells = (
  unitId: string,
  subUnitId: string,
  row: number,
  col: number,
) => CellData | null | undefined;

/** The keys of a cell an absolute write names, each explicitly, as null where absent. */
const cellKeys = ['v', 't', 'f', 'si', 'p', 's', 'custom', 'ft', 'fd', 'ref', 'xf'] as const;

/** `cell` without empty keys and an empty style, or null when nothing is left. */
function normalize(cell: CellData | null | undefined): CellData | null {
  if (!cell) return null;
  const out: CellData = {};
  for (const [key, value] of Object.entries(cell)) {
    if (value === null || value === undefined || key === claimKey) continue;
    if (key === 's' && typeof value === 'object' && Object.keys(value).length === 0) continue;
    out[key] = value;
  }
  return Object.keys(out).length === 0 ? null : out;
}

export const sameCell = (x: CellData | null, y: CellData | null) =>
  JSON.stringify(sorted(normalize(x))) === JSON.stringify(sorted(normalize(y)));

/** Whether two values are equal key for key, null keys and claims included; unset is null. */
export const same = (p: unknown, q: unknown) =>
  JSON.stringify(sorted(p ?? null)) === JSON.stringify(sorted(q ?? null));

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sorted((value as CellData)[key])]),
    );
  }
  return value;
}

/**
 * The key in a cell an absolute write (see `absolute`) holds its claims
 * under: never a Univer cell key, so mergeCellData ignores it. A claim is
 * history, what the edit the write resolves changed, which the cells alone
 * cannot give back once a later write lands under it, so it travels with the
 * transform's output (see `claimError`).
 */
export const claimKey = 'sync-transform.cells.claim';

/**
 * Why `value`, a cell of a SetRangeValues sent in, could not be the
 * transform's own, or undefined where it could. The transform's output is
 * sent on as it is returned: stored and broadcast by the server (SPN-057),
 * and sent by a client that rebased its pending edits past an incoming edit
 * (SPN-058). So a claim cannot be refused outright, and is checked instead:
 * it needs `isOverrideStyle`, as every absolute write has, and each key it
 * claims must hold the value the cell writes, and `baseError` checks that
 * every key it leaves out holds what the cell it lands on holds, so a claim
 * names the keys a write changes, as a plain write naming just those keys
 * would. A sender that forges one changes how its own write merges, and
 * nothing it could not send anyway. No other `sync-transform.` key is ever
 * in a cell.
 *
 * Decision (agent, 2026-10-23, docs/implementation/SPN-056.md decision 33):
 * check a claim, not refuse it. Not taken: refusing it from every sender,
 * which refuses each client's rebased edits; deriving it from the cells,
 * which loses what a winner claimed once a loser of its sender's sequence
 * landed the same value under it (schema seed 134, shrunk).
 */
export function claimError(value: unknown, override: boolean): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const cell = value as CellData;
  const marks = Object.keys(cell).filter((key) => key.startsWith('sync-transform.'));
  if (marks.some((key) => key !== claimKey)) return 'names a `sync-transform.` key';
  if (!(claimKey in cell)) return undefined;
  if (!override) return 'claims without `isOverrideStyle`';
  const claims = cell[claimKey];
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return 'claims no object';
  for (const [key, claim] of Object.entries(claims as CellData)) {
    if (!(cellKeys as readonly string[]).includes(key)) return `claims \`${key}\``;
    if (key !== 's' || claim === null) {
      if (!same(claim, cell[key])) return `claims a \`${key}\` it does not write`;
      continue;
    }
    if (typeof claim !== 'object') return 'claims a style that is no object';
    const style: CellData = cell.s ?? {};
    for (const [name, part] of Object.entries(claim as CellData)) {
      if (name !== 'bd' || part === null || typeof part !== 'object') {
        if (!same(part, style[name])) return `claims a style \`${name}\` it does not write`;
        continue;
      }
      for (const [edge, line] of Object.entries(part as CellData)) {
        if (!same(line, style.bd?.[edge]))
          return `claims a border edge \`${edge}\` it does not write`;
      }
    }
  }
  return undefined;
}

/**
 * Why `value`, an absolute write (see `absolute`) that `claimError` passed,
 * could not be the transform's own on `base`, the cell it lands on, or
 * undefined where it could. The transform's absolute write restates the cell
 * it resolved and claims what it changed of it, so every key it names and
 * does not claim, style key by style key and border edge by border edge,
 * holds what `base` holds. A claim of fewer keys than a write changes would
 * make the rest no edit of its sender's: `'formula-race'` reads the claims,
 * so a formula claimed as none passed it (replay round 20). With this, a
 * claim can only name what a plain write of the keys it changes would.
 *
 * Except `t`, which no refusal reads: Univer types each value it writes, and
 * the transform restates the type of the cell it resolved, which can differ
 * from the base's by that typing alone. A value the base holds untyped is
 * restated typed, an untyped restatement can land on a cell a later write
 * typed, and a tail (see `absolute`) restates the type of a value Univer
 * dropped for rich text (cells fuzz seed 89, schema seed 68). And except
 * `ft` and `fd` where the write clears `f` with no formula id in `si`:
 * Univer's merge drops them there, as `absolute` says, so they change nothing
 * and its tail claims the ones it writes back (schema seed 90,082).
 *
 * Decision (agent, 2026-10-23, docs/implementation/SPN-056.md decision 33):
 * check the keys a claim leaves out against the base cell too. Not taken:
 * reading the formula race from the whole write rather than its claims,
 * which refuses a restated formula a command rewrites, and leaves every
 * other reader of the claims open to the same forgery.
 */
export function baseError(value: CellData, base: CellData | null): string | undefined {
  const claims: CellData = value[claimKey];
  const cell = base ?? {};
  const dropped = dropsFormulaData(value);
  for (const key of cellKeys) {
    if (key === 's' || key === 't' || value[key] === undefined || key in claims) continue;
    if (dropped && (key === 'ft' || key === 'fd')) continue;
    if (!same(value[key], cell[key])) return `changes \`${key}\` and does not claim it`;
  }
  if (value.s === undefined || claims.s === null) return undefined;
  const object = (x: unknown): CellData => (x && typeof x === 'object' ? (x as CellData) : {});
  const [style, was, own] = [object(value.s), object(cell.s), object(claims.s)];
  for (const name of new Set([...Object.keys(style), ...Object.keys(was)])) {
    const claim = own[name];
    if (name !== 'bd' || !claim || typeof claim !== 'object') {
      if (name in own) continue;
      if (!same(style[name], was[name])) return `changes style \`${name}\` and does not claim it`;
      continue;
    }
    const [lines, before] = [object(style.bd), object(was.bd)];
    for (const edge of new Set([...Object.keys(lines), ...Object.keys(before)])) {
      if (edge in claim || same(lines[edge], before[edge])) continue;
      return `changes border edge \`${edge}\` and does not claim it`;
    }
  }
  return undefined;
}

/**
 * Whether Univer's merge of `write` deletes the cell's `ft` and `fd`
 * (mergeCellData): it clears `f`, null or empty, with no formula id in `si`.
 */
export const dropsFormulaData = (write: CellData) =>
  (write.f === null || write.f === '') && !isFormulaId(write.si);

/** Whether a cell value in a mutation is an absolute write (see `absolute`). */
export const isAbsolute = (value: unknown): value is CellData =>
  !!value && typeof value === 'object' && claimKey in value;

/** What a cell write claims as its own edit: an absolute write's claims, or the write itself. */
export const claimsOf = (value: any) => (isAbsolute(value) ? value[claimKey] : value);

/**
 * What one cell of `mutation` makes of `cell`, as Univer 1.1.0's handlers
 * would: a SetRangeValues merges through `prepareSetRangeValuesMutation`,
 * which runs the handler's own `mergeCellData` on a detached copy; a numfmt
 * sets or deletes style key `n` without retyping, as NumfmtService does; a
 * null cell deletes it.
 */
export function effect(mutation: Mutation, value: unknown, cell: CellData | null): CellData | null {
  if (mutation.id === cellIds.setNumfmt) {
    const n = { pattern: mutation.params.refMap[value as string].pattern };
    return { ...cell, s: { ...cell?.s, n } };
  }
  if (mutation.id === cellIds.removeNumfmt) {
    if (!cell) return null;
    const { n: _, ...s } = cell.s ?? {};
    return normalize({ ...cell, s });
  }
  if (value === null || value === undefined) return null;
  return merge(value as CellData, cell, !!mutation.params.isOverrideStyle);
}

/**
 * What one cell of `mutation` leaves on `cell` once all of it has landed
 * (see `effect`): an absolute write with its tail (see `absolute`), since
 * Univer's merge drops ft and fd under a write that clears `f`, and the tail
 * puts them back. Read without it, the loser claimed the winner's `fd` as its
 * own edit and later beat its sender's next `fd` (schema seed 50,205, shrunk).
 *
 * Only a write that clears `f` has a tail. A tail is itself an absolute
 * write, of ft and fd, and drops nothing; given a tail of its own, with no
 * `t`, it retyped a text `'7'` that no screen retypes, so a loser's retype of
 * it matched the wrongly landed cell and was dropped (seed 100,646, shrunk).
 */
export function lands(mutation: Mutation, value: unknown, cell: CellData | null): CellData | null {
  const landed = effect(mutation, value, cell);
  const tail = tailFor(value);
  return tail ? effect(mutation, tail, landed) : landed;
}

/**
 * The tail a cell value needs after it (see `absolute`): one of the ft and
 * fd it names, for an absolute write that drops formula data
 * (`dropsFormulaData`) and names either; otherwise undefined.
 */
export function tailFor(value: unknown): CellData | undefined {
  if (!isAbsolute(value) || !dropsFormulaData(value)) return undefined;
  const { [claimKey]: _, ...plain } = value;
  return absolute(plain, {}).tail;
}

/**
 * Univer's own merge of `write` into `cell` (mergeCellData), with styles
 * inline. It passes no `sourceFormulaData`: that only makes the merge skip a
 * cell whose formula changed since a formula result was computed, and
 * `check` rejects every write that carries it (formula results are never
 * sent), so no write this merges has it.
 */
export function merge(write: CellData, cell: CellData | null, override: boolean): CellData | null {
  const { after, styles } = prepareSetRangeValuesMutation(
    new ObjectMatrix({ 0: { 0: cell && Tools.deepClone(cell) } }),
    new Styles(),
    { cellValue: { 0: { 0: write } }, isOverrideStyle: override },
  );
  const out = after[0]?.[0] ?? null;
  if (out && typeof out.s === 'string') out.s = styles[out.s];
  return normalize(out);
}

/**
 * `cell` as an absolute SetRangeValues cell: every key explicit, null where
 * absent (all of them where `cell` is null, which deletes it), the style whole (the mutation sets isOverrideStyle), and
 * `claims`, the keys it changed for its own edit, under `claimKey`. Univer's
 * mergeCellData ignores the claim, as it does any key it does not know.
 *
 * mergeCellData deletes `ft` and `fd` whenever a write clears `f` with no
 * formula id in `si`, as an absolute write of a cell with no formula does,
 * so a cell that holds either with no formula needs a second write of them
 * after it (`tail`), typed as the cell is. The tail claims only ft and fd
 * (seed 1557): an unmarked tail met a later value as a plain write, and its
 * `t` retyped that value.
 */
export function absolute(
  cell: CellData | null,
  claims: CellData,
): { value: CellData; tail?: CellData } {
  const value: CellData = {};
  for (const key of cellKeys) value[key] = cell?.[key] ?? null;
  if (value.v === null) value.t = null;
  value[claimKey] = claims;
  if (!cell || (cell.ft == null && cell.fd == null) || cell.f || isFormulaId(cell.si)) {
    return { value };
  }
  // The tail claims only ft and fd: `checkBases` accepts those though its base
  // cell lacks them, and its `t`, unclaimed, is not read as an edit.
  const own: CellData = {};
  for (const key of ['ft', 'fd']) if (cell[key] != null) own[key] = cell[key];
  const tail: CellData = { ...own, [claimKey]: own };
  if (cell.v != null) tail.t = cell.t;
  return { value, tail };
}

/**
 * The write that changes `from` into `to`, key by key, style key by style
 * key and border edge by border edge, with null for a key `to` drops: what an
 * absolute write claims as its own edit. A value is claimed with its type. A
 * deletion claims each key it drops, not the whole cell, so a key written
 * concurrently that `from` never held is not its to delete.
 */
export function difference(from: CellData | null, to: CellData | null): CellData {
  const [x, y] = [from ?? {}, to ?? {}];
  const claims: CellData = {};
  for (const key of cellKeys) {
    if (key === 's' || key === 't') continue;
    if (!same(x[key] ?? null, y[key] ?? null)) claims[key] = y[key] ?? null;
  }
  if ('v' in claims || (!same(x.t ?? null, y.t ?? null) && !inferred(x, y))) {
    claims.v = y.v ?? null;
    if (y.v != null) claims.t = y.t;
  }
  const [xs, ys] = [x.s ?? {}, y.s ?? {}];
  const style: CellData = {};
  for (const key of new Set([...Object.keys(xs), ...Object.keys(ys)])) {
    if (key !== 'bd') {
      if (!same(xs[key] ?? null, ys[key] ?? null)) style[key] = ys[key] ?? null;
      continue;
    }
    const [xb, yb] = [xs.bd ?? {}, ys.bd ?? {}];
    for (const edge of new Set([...Object.keys(xb), ...Object.keys(yb)])) {
      if (!same(xb[edge] ?? null, yb[edge] ?? null)) (style.bd ??= {})[edge] = yb[edge] ?? null;
    }
  }
  if (Object.keys(style).length > 0) claims.s = style;
  return claims;
}

/**
 * Whether `to`'s type is only the one Univer gives `from`'s value, which
 * `from` holds untyped, as a document loaded from data can: Univer's merge
 * types the value of every cell it writes, so that type is no edit of the
 * write (schema seed 50,205, shrunk: a loser's `fd` claimed the cell's value
 * by it, so a retype yielded to it and a later `fd` was lost).
 */
function inferred(from: CellData, to: CellData): boolean {
  if (from.t != null || from.v == null || to.t == null) return false;
  if (JSON.stringify(from.v) !== JSON.stringify(to.v)) return false;
  return merge({ v: to.v }, to.s ? { v: to.v, s: to.s } : { v: to.v }, false)?.t === to.t;
}

/**
 * `cell` with the keys `claims` names (see `difference`) set to theirs,
 * key by key, style key by style key and border edge by border edge, and
 * nothing Univer would derive from them: what an absolute write claims,
 * landed over what landed under it.
 */
export function overlay(claims: CellData, cell: CellData | null): CellData | null {
  const out: CellData = { ...cell };
  const set = (target: CellData, key: string, value: unknown) => {
    if (value === null || value === undefined) delete target[key];
    else target[key] = Tools.deepClone(value);
  };
  for (const [key, value] of Object.entries(claims)) {
    if (key !== 's' || value === null) set(out, key, value);
  }
  if (claims.v === null) delete out.t;
  if (claims.s) {
    const style: CellData = { ...out.s };
    for (const [key, value] of Object.entries(claims.s as CellData)) {
      if (key !== 'bd' || value === null) {
        set(style, key, value);
        continue;
      }
      const border: CellData = { ...style.bd };
      for (const [edge, line] of Object.entries(value as CellData)) set(border, edge, line);
      if (Object.keys(border).length > 0) style.bd = border;
      else delete style.bd;
    }
    out.s = style;
  }
  return normalize(out);
}

type Read = (unitId: string, subUnitId: string, row: number, col: number) => CellData | null;

/** Where `index` was before `edit`, or null for a line the edit inserted. */
function before(edit: AxisEdit, index: number): number | null {
  if (edit.kind === 'insert') {
    if (index < edit.at) return index;
    return index < edit.at + edit.count ? null : index - edit.count;
  }
  if (edit.kind === 'remove') return index < edit.at ? index : index + edit.count;
  const lo = Math.min(edit.from, edit.to);
  const hi = Math.max(edit.from + edit.count, edit.to);
  if (index < lo || index >= hi) return index;
  for (let i = lo; i < hi; i++) if (mapIndex(edit, i) === index) return i;
  return index;
}

/**
 * The cells of the document at one point of a transform: the base, then each
 * mutation applied in turn. Read lazily and kept per cell, so a transform pays
 * only for the cells two concurrent writes share.
 */
export class Cells {
  private readonly kept = new Map<string, CellData | null>();
  private readonly read: Read;
  private readonly charge?: (value: unknown) => void;

  private constructor(read: Read, charge?: (value: unknown) => void) {
    this.read = read;
    this.charge = charge;
  }

  private next(read: Read): Cells {
    return new Cells(read, this.charge);
  }

  /** The base, or one that throws when read, for a transform given none. */
  static of(base?: BaseCells, charge?: (value: unknown) => void): Cells {
    if (!base) {
      return new Cells(() => {
        throw new MalformedEditError(
          'base-cells',
          'Two writes to one cell need the base cells (`options.cells`).',
        );
      });
    }
    return new Cells((unitId, subUnitId, row, col) => {
      const value = base(unitId, subUnitId, row, col) ?? null;
      charge?.(value);
      return normalize(Tools.deepClone(value));
    }, charge);
  }

  get(unitId: string, subUnitId: string, row: number, col: number): CellData | null {
    const key = `${unitId} ${subUnitId} ${row}:${col}`;
    if (!this.kept.has(key)) {
      this.charge?.([unitId, subUnitId, row, col]);
      const value = this.read(unitId, subUnitId, row, col);
      this.charge?.(value);
      this.kept.set(key, value);
    }
    return this.kept.get(key)!;
  }

  /**
   * The cells once `mutation` is applied, with `tails` each absolute write's
   * tail too, as a transform reads a list with its tails folded in (see
   * cells.withoutTails).
   */
  after(mutation: Mutation, tails = false): Cells {
    const p = mutation.params;
    const read = this.get.bind(this);
    const line = axisEdit(mutation);
    if (line) {
      const { axis, edit } = line;
      return this.next((unitId, subUnitId, row, col) => {
        if (unitId !== p.unitId || subUnitId !== p.subUnitId)
          return read(unitId, subUnitId, row, col);
        const was = before(edit, axis === 'row' ? row : col);
        if (was === null) return null;
        return axis === 'row'
          ? read(unitId, subUnitId, was, col)
          : read(unitId, subUnitId, row, was);
      });
    }
    if (mutation.id === structureIds.insertSheet) {
      // Its styles are inline: `check` rejects a style id in a sheet mutation.
      const { cellData = {} } = p.sheet;
      return this.next((unitId, subUnitId, row, col) => {
        if (unitId !== p.unitId || subUnitId !== p.sheet.id)
          return read(unitId, subUnitId, row, col);
        const value = cellData[row]?.[col] ?? null;
        this.charge?.(value);
        return normalize(Tools.deepClone(value));
      });
    }
    if (mutation.id === structureIds.removeSheet) {
      return this.next((unitId, subUnitId, row, col) =>
        unitId === p.unitId && subUnitId === p.subUnitId ? null : read(unitId, subUnitId, row, col),
      );
    }
    if (mutation.id === cellIds.moveRange) {
      // Univer's handler writes `from` on its sheet, then `to` on its own, each cell whole.
      const sides = [p.to, p.from] as { subUnitId: string; value: any }[];
      return this.next((unitId, subUnitId, row, col) => {
        if (unitId === p.unitId) {
          for (const side of sides) {
            if (side.subUnitId !== subUnitId) continue;
            const cell = side.value?.[row]?.[col];
            if (cell !== undefined) {
              this.charge?.(cell);
              return normalize(Tools.deepClone(cell));
            }
          }
        }
        return read(unitId, subUnitId, row, col);
      });
    }
    const ids: string[] = [cellIds.setRangeValues, cellIds.setNumfmt, cellIds.removeNumfmt];
    if (!ids.includes(mutation.id)) return this;
    const writes = new Map(writesOf(mutation).map((write) => [`${write.row}:${write.col}`, write]));
    return this.next((unitId, subUnitId, row, col) => {
      const cell = read(unitId, subUnitId, row, col);
      const write = unitId === p.unitId && subUnitId === p.subUnitId && writes.get(`${row}:${col}`);
      if (!write) return cell;
      this.charge?.(cell);
      this.charge?.(write.value);
      return tails ? lands(mutation, write.value, cell) : effect(mutation, write.value, cell);
    });
  }
}
