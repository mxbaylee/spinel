import { hasFormula, rewriteKey } from './cells.ts';
import { claimsOf } from './state.ts';
import { unaffected } from './family.ts';
import type { Family } from './family.ts';
import { settingIds } from './settings.ts';
import { axisIds, structureIds } from './structure.ts';
import { refuseRaces } from './types.ts';
import type { Mutation, Side } from './types.ts';
import { cellIds, matrixWrites, writesOf } from './writes.ts';

/** Defined names: workbook-wide, each a whole record that a set replaces by its `id`. */
export const nameIds = {
  set: 'formula.mutation.set-defined-name',
  remove: 'formula.mutation.remove-defined-name',
} as const;

/**
 * The mutations whose commands make Univer rewrite references (sheets-formula's
 * getReferenceMoveParams): row and column inserts, removes and moves, range
 * moves (drags, cuts and shifts), sheet removal, and sheet and workbook
 * renames, since a reference names its sheet and workbook. The command sends
 * the rewrites after its own mutations: a set of each defined name that refers
 * to its sheet (UpdateDefinedNameController), and a SetRangeValues of each cell
 * formula that reads its sheet, wherever the formula sits, or sits in cells it
 * moves (UpdateFormulaController). A row, column or shift command sends them
 * moved or not, so a row inserted below all content still re-sends, unchanged,
 * each name and formula that refers to its sheet. A name set or removal's
 * command rewrites cell formulas too, but no names, so it is not here (see
 * `refuseFormulaRaces`).
 */
const rewritesReferences = new Set<string>([
  ...axisIds,
  cellIds.moveRange,
  structureIds.removeSheet,
  settingIds.name,
  settingIds.workbookName,
]);

/**
 * The commands a person edits a defined name with (`@univerjs/sheets`). Univer's
 * CommandService sets `params.trigger` on every mutation a command sends to
 * the id of the innermost command running, so a name edit carries one of
 * these, and a name set or removal that carries none of them was another
 * command's rewrite of the name.
 */
const nameCommands = new Set([
  'sheet.command.insert-defined-name',
  'sheet.command.set-defined-name',
  'sheet.command.remove-defined-name',
]);

/**
 * The range insert and delete commands, which make Univer rewrite references
 * like the mutations in `rewritesReferences`, but can send none of them: a
 * delete that reaches the content's last line sends no MoveRange, only cell
 * writes and its rewrites. So each of their mutations, which carries the
 * command's id as `trigger`, counts as one.
 */
const shiftCommands = new Set([
  'sheet.command.insert-range-move-down',
  'sheet.command.insert-range-move-right',
  'sheet.command.delete-range-move-up',
  'sheet.command.delete-range-move-left',
]);

const isSet = (mutation: Mutation) => mutation.id === nameIds.set;
const isRemove = (mutation: Mutation) => mutation.id === nameIds.remove;
const editsName = (mutation: Mutation) => isSet(mutation) || isRemove(mutation);

/**
 * Whether a mutation makes Univer rewrite names and formulas, or is one of
 * the rewrites of a command that does: a mutation in `rewritesReferences`,
 * any a shift command sent, or a name set or removal that no name command
 * sent.
 *
 * Decision (owner, chat 2026-10-22): a shift at the content's edge races name
 * edits and formula writes as one inside the content does, and a name set
 * that another command sent is its rewrite of the name, racing a concurrent
 * name edit (see `racesName`). At the edge a delete sends no MoveRange, so a
 * rename and the delete's rewrite of the same name were two sets of one id:
 * the first accepted stood, and the rename was lost, or the name sat a row
 * off. Its formula rewrites went out as plain cell writes, so they merged
 * past a formula typed at once, or a value typed over them. Not taken:
 * keeping those merges as a known limit.
 *
 * Decision (agent, chat 2026-10-22): a name set or removal with no `trigger`
 * counts as a rewrite too, as does one an undo or redo sent, since the
 * transform cannot tell which command sent it. Refusing it is visible and
 * redone; taking it for a person's edit could let the first-accepted rule
 * drop a rename silently. So an undone rename is refused against any
 * concurrent name edit, even of the same name. Not taken: rejecting one with
 * no `trigger` as a sender bug, since Univer leaves it unset on a mutation run
 * outside any command.
 */
const rewrites = (mutation: Mutation) =>
  rewritesReferences.has(mutation.id) ||
  shiftCommands.has(mutation.params.trigger) ||
  (editsName(mutation) && !nameCommands.has(mutation.params.trigger));

/** The text Univer looks a name up by: trimmed, and matched case-insensitively. */
const textOf = (mutation: Mutation) => (mutation.params.name as string).trim().toLowerCase();

/**
 * Decision (owner, chat 2026-10-22): a name set and a concurrent mutation that
 * makes Univer rewrite names (see `rewrites`) are refused, either way round,
 * including a shift at the content's edge that sends only its rewrites. The
 * set's references were written for the cells before the move, and the command's
 * rewrite never saw the set. Each person's own row edits still keep names
 * right, since the command sends the rewrite with them. Not taken: rewriting
 * the set's references past the move, which would re-implement Univer's
 * unexported range remap, and need the sender to map sheet names to ids for a
 * stateless transform. This refuses some pairs that would merge, such as a
 * name on one sheet and a row insert on another, and, since a row, column or
 * shift command re-sends each name that refers to its sheet, moved or not,
 * every such edit on a named sheet against a concurrent one that rewrites
 * names.
 *
 * Decision (agent, chat 2026-10-22): a name removal and a concurrent mutation
 * that makes Univer rewrite names are refused too, either way round. The
 * removal's command rewrites the cells that use the name to `#REF!`, and those
 * writes stand even where the removal itself is dropped, as it is where the
 * other side's command, accepted first, sets the name it moved: the name would
 * stand while its formulas read `#REF!` on both screens. Not taken: keeping
 * the first accepted and documenting that damage.
 *
 * Decision (agent, chat 2026-10-22): two sets of different ids that give the
 * same name are refused, in any scope, following the owner's rule that races
 * refuse rather than diverge. Univer resolves a name to the first of them in
 * the order each screen added them, so two screens would read it differently;
 * that holds across a sheet scope and the workbook too. Not taken: renaming
 * one, which a stateless transform cannot pick consistently with the sender's
 * formulas; and comparing scopes, which would still let those diverge.
 *
 * Two name commands' edits of one id are not a race: the first accepted
 * stands (see `transform`), and the cell formulas a rename's command
 * rewrites follow the cells' own first-accepted rule, so they name the name
 * that stands, where both senders had them (see `refuseFormulaRaces`).
 */
function racesName(a: Mutation, b: Mutation): boolean {
  if (isSet(a) && isSet(b) && a.params.id !== b.params.id && textOf(a) === textOf(b)) return true;
  return (editsName(a) && rewrites(b)) || (editsName(b) && rewrites(a));
}

/**
 * Refuses two concurrent sequences when a mutation of one races a name set or
 * removal of the other (see `racesName`). They are checked whole, before any
 * pair is transformed: Univer's SetDefinedNameCommand sends a removal before
 * its set, and the first accepted removal drops the other side's set before
 * the two sets would meet.
 */
export const refuseNameRaces = (a: Mutation[], b: Mutation[]) =>
  refuseRaces(a, b, racesName, 'name-race');

/**
 * The cells a mutation writes with a formula (`f`, or a shared formula's
 * `si`), as `unitId subUnitId row:col`, each with that formula: a
 * SetRangeValues's, or those of the sheet an InsertSheet adds (its
 * `sheet.cellData`), which is what CopySheetCommand sends for a sheet under
 * its split threshold and what undo of a sheet removal sends.
 */
function formulaWrites(mutation: Mutation): { cell: string; formula: unknown }[] {
  const { unitId } = mutation.params;
  const [subUnitId, writes] =
    mutation.id === cellIds.setRangeValues
      ? [mutation.params.subUnitId, writesOf(mutation)]
      : mutation.id === structureIds.insertSheet
        ? [mutation.params.sheet.id, matrixWrites(mutation.params.sheet.cellData)]
        : [undefined, []];
  return writes.filter(hasFormula).map(({ row, col, value }) => ({
    cell: `${unitId} ${subUnitId} ${row}:${col}`,
    formula: claimsOf(value).f || claimsOf(value).si,
  }));
}

const formulaCells = (mutation: Mutation) => formulaWrites(mutation).map(({ cell }) => cell);

const writesFormula = (mutation: Mutation) => formulaCells(mutation).length > 0;

const nameKey = (mutation: Mutation) => `${mutation.params.unitId} ${mutation.params.id}`;

/**
 * The names `mutations` edits whose commands' rewrites can be all its formula
 * writes, so that the other sequence's edit of one stays first-accepted: each
 * formula write comes after the sequence's first edit of the name, as a name
 * command sends its rewrites after its name mutations, every write to a cell
 * gives it the same formula (the command writes each cell twice), and
 * `theirs`, the cells the other sequence writes a formula to, holds each cell.
 * A formula typed in the same batch fails one of those, before the name edit
 * or after it. None otherwise.
 */
function rewrittenNames(mutations: Mutation[], theirs: Set<string>): Set<string> {
  const formulas = new Map<string, unknown>();
  for (const { cell, formula } of mutations.flatMap(formulaWrites)) {
    if (!theirs.has(cell) || (formulas.get(cell) ?? formula) !== formula) return new Set();
    formulas.set(cell, formula);
  }
  const first = mutations.findIndex(writesFormula);
  if (first < 0) return new Set();
  return new Set(mutations.slice(0, first).filter(editsName).map(nameKey));
}

/**
 * Refuses two concurrent sequences when one writes a formula, in a cell or in
 * a sheet it inserts, and the other makes Univer rewrite formulas: a mutation
 * that `rewrites` (so a shift at the content's edge too, whose formula
 * rewrites go out as plain cell writes), or a name set or removal, unless
 * the formula's own sequence edits that name too and its formula writes are
 * only that edit's rewrites (see `rewrittenNames`). Another command's
 * rewrite of a name is never exempt.
 *
 * Decision (owner, chat 2026-10-22): refuse them, either way round
 * (`'formula-race'`). This is the cells counterpart of the name set rule
 * above: a formula written, or rewritten by a command, for the cells before
 * the other edit is not rewritten past it, and a stateless transform cannot
 * redo that. Two edits of one name keep the first-accepted rule (see
 * `transform`), since the formulas each rewrites follow the name that stands,
 * but only for formulas both senders had: each command rewrites the cells it
 * saw. So the exemption holds only where the other sequence writes a formula
 * to every cell this one does; name commands move no cells, so the two
 * address the same cells untransformed. A formula typed in the same batch as
 * the name edit, before or after it, is refused, since the other name edit
 * could win and drop it or leave it naming a name that no longer stands. Not taken:
 * remapping references inside the transform, which would re-implement
 * Univer's unexported reference rewriting. This refuses more edits in books
 * with formulas: a row, column or shift command re-sends each formula that
 * reads its sheet, moved or not, so on a sheet one formula reads, two row
 * inserts below all content are refused. SPN-058's sender could cut that by
 * dropping re-sends that change nothing.
 *
 * Decision (owner, chat 2026-10-22): a command's formula rewrite and a
 * concurrent write to the same cell that replaces its value or formula with
 * no formula, such as a value typed over it (which sends `v` and `f: null`)
 * or a clear, are refused too, either way round: where the rewrite was
 * accepted first it would put back the formula the write replaced. A style
 * or number format there overlaps no key of the rewrite and merges.
 * `markRewrites` marks the rewrites, and cells' `transform` refuses them
 * where they meet such a write.
 */
export function refuseFormulaRaces(a: Mutation[], b: Mutation[]): void {
  for (const [writes, edits] of [
    [a, b],
    [b, a],
  ]) {
    const own = rewrittenNames(writes, new Set(edits.flatMap(formulaCells)));
    const races = (edit: Mutation) =>
      rewrites(edit) || (editsName(edit) && !own.has(nameKey(edit)));
    refuseRaces(writes.filter(writesFormula), edits, (_, edit) => races(edit), 'formula-race');
  }
}

/**
 * `mutations` with each formula write marked (cells.rewriteKey) where the
 * sequence also holds a mutation that makes Univer rewrite formulas in its
 * workbook (see `rewrites`), or a name edit, so that the write is the
 * command's rewrite. Only a SetRangeValues is marked: an inserted sheet's
 * formulas are no command's rewrite, and no concurrent edit can write a cell
 * of a sheet it never had.
 */
export function markRewrites(mutations: Mutation[]): Mutation[] {
  const units = new Set(
    mutations
      .filter((mutation) => rewrites(mutation) || editsName(mutation))
      .map((mutation) => mutation.params.unitId),
  );
  return mutations.map((mutation) =>
    units.has(mutation.params.unitId) &&
    mutation.id === cellIds.setRangeValues &&
    writesFormula(mutation)
      ? { id: mutation.id, params: { ...mutation.params, [rewriteKey]: true } }
      : mutation,
  );
}

/**
 * Two edits of one name: the first accepted stands, and the loser's set or
 * removal is dropped. Edits of different names pass each other.
 *
 * Decision (owner, chat 2026-10-22): the whole record, as for a Doc formula.
 * Not taken: keeping the loser's fields the winner did not change, which would
 * need the sender to send the record as it was before the edit.
 */
// Diagnostics (SPN-057, not built): `sync.edit.dropped`, rule 'name-first-accepted'.
const transform = (a: Mutation, b: Mutation, side: Side): Mutation[] =>
  a.params.id === b.params.id && side === 'right' ? [] : [a];

// Names hold no row or column positions of their own; see `racesName`.
export const names: Family = { ids: Object.values(nameIds), remap: unaffected, transform };
