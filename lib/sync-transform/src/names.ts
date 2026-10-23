import { cellIds } from './cells.ts';
import { unaffected } from './family.ts';
import type { Family } from './family.ts';
import { settingIds } from './settings.ts';
import { axisIds, structureIds } from './structure.ts';
import { RefusedEditError } from './types.ts';
import type { Mutation, Side } from './types.ts';

/** Defined names: workbook-wide, each a whole record that a set replaces by its `id`. */
export const nameIds = {
  set: 'formula.mutation.set-defined-name',
  remove: 'formula.mutation.remove-defined-name',
} as const;

/**
 * The mutations whose commands make Univer rewrite the references in each
 * defined name they move (sheets-formula's UpdateDefinedNameController): row
 * and column inserts, removes and moves, range moves (drags, cuts and shifts),
 * sheet removal, and sheet and workbook renames, since a name's references
 * name their sheet and workbook. The command sends the rewrite as a name set
 * after its own mutations.
 */
const rewritesNames = new Set<string>([
  ...axisIds,
  cellIds.moveRange,
  structureIds.removeSheet,
  settingIds.name,
  settingIds.workbookName,
]);

const isSet = (mutation: Mutation) => mutation.id === nameIds.set;

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
  return (isSet(a) && rewritesNames.has(b.id)) || (isSet(b) && rewritesNames.has(a.id));
}

/**
 * Refuses two concurrent sequences when a mutation of one races a name set of
 * the other (see `racesName`). They are checked whole, before any pair is
 * transformed: Univer's SetDefinedNameCommand sends a removal before its set,
 * and the first accepted removal drops the other side's set before the two
 * sets would meet.
 */
export function refuseNameRaces(a: Mutation[], b: Mutation[]): void {
  for (const x of a) {
    for (const y of b) {
      if (x.params.unitId === y.params.unitId && racesName(x, y)) {
        throw new RefusedEditError('name-race');
      }
    }
  }
}

/**
 * Two edits of one name: the first accepted stands, and the loser's set or
 * removal is dropped. Edits of different names pass each other.
 *
 * Decision (owner, chat 2026-10-22): the whole record, as for a Doc formula.
 * Not taken: keeping the loser's fields the winner did not change, which would
 * need the sender to send the record as it was before the edit.
 */
const transform = (a: Mutation, b: Mutation, side: Side): Mutation[] =>
  a.params.id === b.params.id && side === 'right' ? [] : [a];

// Names hold no row or column positions of their own; see `racesName`.
export const names: Family = { ids: Object.values(nameIds), remap: unaffected, transform };
