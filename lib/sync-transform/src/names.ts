import { cellIds, hasFormula, rewriteKey, writesOf } from './cells.ts';
import { unaffected } from './family.ts';
import type { Family } from './family.ts';
import { settingIds } from './settings.ts';
import { axisIds, structureIds } from './structure.ts';
import { refuseRaces } from './types.ts';
import type { Mutation, Side } from './types.ts';

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
 * the rewrites after its own mutations: a set of each defined name it moves
 * (UpdateDefinedNameController), and a SetRangeValues of each cell formula it
 * moves (UpdateFormulaController). A name set or removal's command rewrites
 * cell formulas too, but no names, so it is not here (see `refuseFormulaRaces`).
 */
const rewritesReferences = new Set<string>([
  ...axisIds,
  cellIds.moveRange,
  structureIds.removeSheet,
  settingIds.name,
  settingIds.workbookName,
]);

const isSet = (mutation: Mutation) => mutation.id === nameIds.set;
const isRemove = (mutation: Mutation) => mutation.id === nameIds.remove;
const editsName = (mutation: Mutation) => isSet(mutation) || isRemove(mutation);

/** The text Univer looks a name up by: trimmed, and matched case-insensitively. */
const textOf = (mutation: Mutation) => (mutation.params.name as string).trim().toLowerCase();

/**
 * Decision (owner, chat 2026-10-22): a name set and a concurrent mutation that
 * makes Univer rewrite names are refused, either way round. The set's
 * references were written for the cells before the move, and the command's
 * rewrite never saw the set. Each person's own row edits still keep names
 * right, since the command sends the rewrite with them. Not taken: rewriting
 * the set's references past the move, which would re-implement Univer's
 * unexported range remap, and need the sender to map sheet names to ids for a
 * stateless transform. This refuses some pairs that would merge, such as a
 * name on one sheet and a row insert on another.
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
 * Two sets of one id are not a race: the first accepted stands (see
 * `transform`), and the cell formulas a rename's command rewrites follow the
 * cells' own first-accepted rule, so they name the name that stands.
 */
function racesName(a: Mutation, b: Mutation): boolean {
  if (isSet(a) && isSet(b)) {
    return a.params.id !== b.params.id && textOf(a) === textOf(b);
  }
  return (
    (editsName(a) && rewritesReferences.has(b.id)) || (editsName(b) && rewritesReferences.has(a.id))
  );
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

/** Whether a SetRangeValues writes a formula: a cell with `f`, or a shared formula's `si`. */
const writesFormula = (mutation: Mutation) =>
  mutation.id === cellIds.setRangeValues && writesOf(mutation).some(hasFormula);

const nameKey = (mutation: Mutation) => `${mutation.params.unitId} ${mutation.params.id}`;

/**
 * Refuses two concurrent sequences when one writes a formula and the other
 * makes Univer rewrite formulas: a mutation in `rewritesReferences`, or a name
 * set or removal, unless the formula's own sequence edits that name too.
 *
 * Decision (owner, chat 2026-10-22): refuse them, either way round
 * (`'formula-race'`). This is the cells counterpart of the name set rule
 * above: a formula written, or rewritten by a command, for the cells before
 * the other edit is not rewritten past it, and a stateless transform cannot
 * redo that. Two edits of one name keep the first-accepted rule (see
 * `transform`), since the formulas each rewrites follow the name that stands.
 * Not taken: remapping references inside the transform, which would
 * re-implement Univer's unexported reference rewriting. This refuses more
 * edits in books with formulas, such as two row inserts that each move one.
 *
 * Decision (owner, chat 2026-10-22): a command's formula rewrite and a
 * concurrent write to the same cell that writes no formula, such as a value
 * typed over it (which sends `f: null`), are refused too, either way round:
 * where the rewrite was accepted first it would put back the formula the
 * write replaced. `markRewrites` marks the rewrites, and cells' `transform`
 * refuses them where they meet such a write.
 */
export function refuseFormulaRaces(a: Mutation[], b: Mutation[]): void {
  for (const [writes, edits] of [
    [a, b],
    [b, a],
  ]) {
    const own = new Set(writes.filter(editsName).map(nameKey));
    const rewrites = (edit: Mutation) =>
      rewritesReferences.has(edit.id) || (editsName(edit) && !own.has(nameKey(edit)));
    refuseRaces(writes.filter(writesFormula), edits, (_, edit) => rewrites(edit), 'formula-race');
  }
}

/**
 * `mutations` with each formula write marked (cells.rewriteKey) where the
 * sequence also holds a mutation that makes Univer rewrite formulas in its
 * workbook, so that the write is the command's rewrite.
 */
export function markRewrites(mutations: Mutation[]): Mutation[] {
  const units = new Set(
    mutations
      .filter((mutation) => rewritesReferences.has(mutation.id) || editsName(mutation))
      .map((mutation) => mutation.params.unitId),
  );
  return mutations.map((mutation) =>
    units.has(mutation.params.unitId) && writesFormula(mutation)
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
// Diagnostics (SPN-032, not built): `sync.edit.dropped`, rule 'name-first-accepted'.
const transform = (a: Mutation, b: Mutation, side: Side): Mutation[] =>
  a.params.id === b.params.id && side === 'right' ? [] : [a];

// Names hold no row or column positions of their own; see `racesName`.
export const names: Family = { ids: Object.values(nameIds), remap: unaffected, transform };
