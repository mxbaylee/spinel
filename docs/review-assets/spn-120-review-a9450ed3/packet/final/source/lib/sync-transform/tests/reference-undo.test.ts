import { ICommandService, IUniverInstanceService, LocaleService, LocaleType } from '@univerjs/core';
import type { IWorkbookData } from '@univerjs/core';
import { beforeAll, describe, expect, test } from 'vitest';
import { flip, transform } from '../index.ts';
import type { Mutation } from '../index.ts';
import { nameIds } from '../src/names.ts';
import { cellIds } from '../src/writes.ts';
import { recordWire } from './generate.ts';
import type { ObservedMutation } from './generate.ts';
import { realBook } from './generate-cells.ts';
import { refusedBothWays, Replica, snapshotCells } from './harness.ts';

const target = { unitId: 'wb', subUnitId: 's1' };
const one = (row: number, col: number) => ({
  startRow: row,
  endRow: row,
  startColumn: col,
  endColumn: col,
});
type Action = 'undo' | 'redo';
type Fixture = {
  document: { workbook: IWorkbookData };
  mutations: Mutation[];
  observed: ObservedMutation[];
};

/** Capture native history mutations and the exact state immediately before them. */
async function historyOfEdgeDelete(action: Action, withFormula = true): Promise<Fixture> {
  const workbook = realBook();
  if (withFormula) workbook.sheets.s1.cellData![5][5] = { f: '=A31' };
  const replica = new Replica({ workbook });
  try {
    const commands = replica.injector.get(ICommandService);
    replica.injector.get(LocaleService).load({ [LocaleType.EN_US]: {} });
    replica.injector.get(IUniverInstanceService).focusUnit(target.unitId);
    // Await the real async shift command; capture's synchronous `earlier`
    // commands cannot run this one. The content ends at row 30.
    expect(
      await commands.executeCommand('sheet.command.delete-range-move-up', {
        ...target,
        range: { startRow: 29, endRow: 29, startColumn: 0, endColumn: 1 },
      }),
    ).toBe(true);
    if (action === 'redo') {
      expect(await commands.executeCommand('univer.command.undo', { unitId: target.unitId })).toBe(
        true,
      );
    }
    const document = { workbook: structuredClone(replica.workbook()!.getSnapshot()) };
    const recording = recordWire(commands);
    try {
      expect(
        await commands.executeCommand(`univer.command.${action}`, { unitId: target.unitId }),
      ).toBe(true);
      return { document, mutations: recording.mutations, observed: recording.observed };
    } finally {
      recording.dispose();
    }
  } finally {
    replica.univer.dispose();
  }
}

/** A native peer command made on the same snapshot as the history mutation. */
function peer(on: Fixture, command: string, params: object): Mutation[] {
  const replica = new Replica(on.document);
  const commands = replica.injector.get(ICommandService);
  const recording = recordWire(commands);
  try {
    replica.injector.get(LocaleService).load({ [LocaleType.EN_US]: {} });
    expect(commands.syncExecuteCommand(command, { ...target, ...params })).toBe(true);
    expect(recording.mutations.length).toBeGreaterThan(0);
    return recording.mutations;
  } finally {
    recording.dispose();
    replica.univer.dispose();
  }
}

test('the shared recorder keeps sync-only writes and excludes local-only writes', () => {
  const replica = new Replica({ workbook: realBook() });
  const commands = replica.injector.get(ICommandService);
  const recording = recordWire(commands);
  const executed: string[] = [];
  const listener = commands.onCommandExecuted(({ id }) => executed.push(id));
  try {
    const write = (value: string) => ({ ...target, cellValue: { 0: { 0: { v: value } } } });
    expect(
      commands.syncExecuteCommand(cellIds.setRangeValues, write('local'), { onlyLocal: true }),
    ).toBe(true);
    expect(
      commands.syncExecuteCommand(cellIds.setRangeValues, write('sent'), { syncOnly: true }),
    ).toBe(true);
    // The ordinary callback sees local work but misses syncOnly; the native
    // collaboration stream plus execution options has the opposite boundary.
    expect(executed).toEqual([cellIds.setRangeValues]);
    expect(recording.mutations).toHaveLength(1);
    expect(recording.mutations[0]).toMatchObject({
      id: cellIds.setRangeValues,
      params: write('sent'),
    });
    expect(recording.observed.map(({ options }) => options)).toEqual([
      { onlyLocal: true },
      { syncOnly: true },
    ]);
    expect(replica.workbook()!.getSheetBySheetId(target.subUnitId)!.getCellRaw(0, 0)?.v).toBe(
      'local',
    );
  } finally {
    listener.dispose();
    recording.dispose();
    replica.univer.dispose();
  }
});

// Decision 39: undo/redo hides the original shift command, so a possibly
// stale rewrite is refused visibly instead of overwriting a typed value or
// leaving a new reference pointing at the wrong cell.
describe.each(['undo', 'redo'] as const)('%s of a nameless content-edge shift', (action) => {
  let fixture: Fixture;
  const expected = action === 'undo' ? '=A31' : '=A30';
  beforeAll(async () => {
    fixture = await historyOfEdgeDelete(action);
  });

  test('only its history trigger reveals the native formula rewrite', () => {
    const { mutations, document, observed } = fixture;
    expect(mutations.length).toBeGreaterThan(0);
    expect(mutations.map(({ id }) => id)).not.toContain(cellIds.moveRange);
    expect(mutations.map(({ id }) => id)).not.toContain(nameIds.set);
    expect(mutations.map(({ id }) => id)).not.toContain(nameIds.remove);
    expect(new Set(mutations.map(({ params }) => params.trigger))).toEqual(
      new Set([`univer.command.${action}`]),
    );
    expect(document.workbook.sheets.s1.cellData![5][5]?.f).toBe(
      action === 'undo' ? '=A30' : '=A31',
    );
    expect(mutations.some(({ params }) => params.cellValue?.[5]?.[5]?.f === expected)).toBe(true);
    // This cache work really occurs, but Univer explicitly keeps it local.
    // The actual SetRangeValues rewrite above must remain on the wire.
    const cacheId = 'formula.mutation.set-formula-data';
    const cached = observed.filter(({ id }) => id === cacheId);
    expect(cached.length).toBeGreaterThan(0);
    expect(cached.every(({ options }) => options?.onlyLocal === true)).toBe(true);
    expect(mutations.map(({ id }) => id)).not.toContain(cacheId);
  });

  test('refuses a formula typed elsewhere while the history edit is pending', () => {
    const typed = peer(fixture, 'sheet.command.set-range-values', {
      range: one(7, 6),
      value: { f: '=A31', v: null, si: null, p: null },
    });
    refusedBothWays(
      fixture.mutations,
      typed,
      'formula-race',
      snapshotCells(fixture.document.workbook),
    );
  });

  test('refuses a value typed over the formula it restores', () => {
    const typed = peer(fixture, 'sheet.command.set-range-values', {
      range: one(5, 5),
      value: { v: 3, f: null, si: null, p: null },
    });
    refusedBothWays(
      fixture.mutations,
      typed,
      'formula-race',
      snapshotCells(fixture.document.workbook),
    );
  });

  test('refuses a defined name added while the history edit is pending', () => {
    const named = peer(fixture, 'sheet.command.insert-defined-name', {
      id: 'N',
      name: 'budget',
      formulaOrRefString: 'One!$A$31',
    });
    refusedBothWays(
      fixture.mutations,
      named,
      'name-race',
      snapshotCells(fixture.document.workbook),
    );
  });

  test('keeps a concurrent style and the restored formula in both priority orders', () => {
    const styled = peer(fixture, 'sheet.command.set-style', {
      range: one(5, 5),
      style: { type: 'bl', value: 1 },
    });
    const { document, mutations } = fixture;
    for (const side of ['left', 'right'] as const) {
      const first = new Replica(document);
      const second = new Replica(document);
      try {
        const options = { cells: snapshotCells(document.workbook) };
        first.apply([...styled, ...transform(mutations, styled, side, options)]);
        second.apply([...mutations, ...transform(styled, mutations, flip(side), options)]);
        expect(first.snapshot()).toEqual(second.snapshot());
        const workbook = first.workbook()!;
        const cell = workbook.getSheetBySheetId(target.subUnitId)!.getCellRaw(5, 5)!;
        expect(cell.f).toBe(expected);
        expect(
          typeof cell.s === 'string' ? workbook.getStyles().get(cell.s) : cell.s,
        ).toMatchObject({
          bl: 1,
        });
      } finally {
        first.univer.dispose();
        second.univer.dispose();
      }
    }
  });

  test('still refuses a new formula when the shift had no existing references to rewrite', async () => {
    const empty = await historyOfEdgeDelete(action, false);
    expect(empty.mutations.map(({ id }) => id)).not.toContain(cellIds.moveRange);
    expect(empty.mutations.map(({ id }) => id)).not.toContain(nameIds.set);
    const typed = peer(empty, 'sheet.command.set-range-values', {
      range: one(7, 6),
      value: { f: '=A31', v: null, si: null, p: null },
    });
    refusedBothWays(empty.mutations, typed, 'formula-race', snapshotCells(empty.document.workbook));
  });
});
