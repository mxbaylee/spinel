import { IDefinedNamesService, serializeRangeWithSheet } from '@univerjs/engine-formula';
import type { Replica } from './harness.ts';
import { capture, pick, randomSheet } from './generate.ts';
import type { Generate } from './generate.ts';

const commandIds = {
  insert: 'sheet.command.insert-defined-name',
  set: 'sheet.command.set-defined-name',
  remove: 'sheet.command.remove-defined-name',
};

/** Up to three rows of a random sheet's first two columns, as the name manager writes them. */
function reference(replica: Replica, next: () => number): string {
  const sheet = randomSheet(replica, next);
  const startRow = next() % sheet.getRowCount();
  const endRow = Math.min(sheet.getRowCount() - 1, startRow + (next() % 3));
  const endColumn = Math.min(1, sheet.getColumnCount() - 1);
  return serializeRangeWithSheet(sheet.getName(), { startRow, endRow, startColumn: 0, endColumn });
}

// Not a cell reference, which a name must not look like.
const label = (next: () => number) => `name_${next() % 1000}`;

/** The workbook's defined names, as the name manager lists them. */
export const namesOf = (replica: Replica) =>
  Object.values(
    replica.injector.get(IDefinedNamesService).getDefinedNameMap(replica.workbook()!.getUnitId()) ??
      {},
  );

/**
 * Defined names added, renamed, pointed elsewhere and removed, as the name
 * manager sends them through Univer's commands (see `capture`).
 */
export const nameEdit: Generate = (replica, next) => {
  const unitId = replica.workbook()!.getUnitId();
  const names = namesOf(replica);
  const kind = next() % 4;
  if (kind === 0 || names.length === 0) {
    const id = `n${next() % 1e9}`;
    const formulaOrRefString = reference(replica, next);
    return capture(replica, commandIds.insert, {
      unitId,
      id,
      name: label(next),
      formulaOrRefString,
    });
  }
  const name = pick(next, names);
  if (kind === 1) return capture(replica, commandIds.remove, { unitId, ...name });
  const change =
    kind === 2 ? { name: label(next) } : { formulaOrRefString: reference(replica, next) };
  return capture(replica, commandIds.set, { unitId, ...name, ...change });
};
