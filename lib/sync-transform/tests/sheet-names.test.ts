import type { IWorkbookData } from '@univerjs/core';
import { describe, expect, test } from 'vitest';
import { flip, transform } from '../index.ts';
import type { Mutation } from '../index.ts';
import { settingIds } from '../src/settings.ts';
import { structureIds } from '../src/structure.ts';
import { capture, seededWorkbook } from './generate.ts';
import { refusedBothWays, Replica, snapshotCells } from './harness.ts';
import { simulate } from './simulate.ts';

const unitId = 'wb';
const document = { workbook: seededWorkbook() };
type Command = [id: string, params: Record<string, unknown>];

/** Capture native commands in order, without assigning artificial unique names. */
function commands(steps: Command[], earlier: Command[] = []): Mutation[] {
  const replica = new Replica(document);
  try {
    return steps.flatMap(([id, params], i) => {
      const edits = capture(replica, id, { unitId, ...params }, i === 0 ? earlier : []);
      if (!edits) throw new Error(`${id} sent no mutations`);
      // Undo's earlier commands ran in capture's private history, not on this copy.
      if (earlier.length === 0) replica.apply(edits);
      return edits;
    });
  } finally {
    replica.univer.dispose();
  }
}

const add = (name?: string) =>
  commands([['sheet.command.insert-sheet', name === undefined ? {} : { sheet: { name } }]]);
const copy = () => commands([['sheet.command.copy-sheet', { subUnitId: 's1' }]]);
const rename = (subUnitId: string, name: string): Command => [
  'sheet.command.set-worksheet-name',
  { subUnitId, name },
];
const inserted = (edits: Mutation[]) =>
  edits.find(({ id }) => id === structureIds.insertSheet)!.params.sheet;

// Decision 37: refuse the later batch visibly; suffixing a sheet alone would
// silently redirect the formulas its sender already typed against that name.
describe('concurrent worksheet identity collisions', () => {
  test('two ordinary Add Sheet commands choose the same name and are refused', () => {
    const [a, b] = [add(), add()];
    expect(inserted(a).id).not.toBe(inserted(b).id);
    expect(inserted(a).name).toBe(inserted(b).name);
    refusedBothWays(a, b, 'name-race');
  });

  test('two native copies of the same sheet are refused', () => {
    const [a, b] = [copy(), copy()];
    expect(inserted(a).id).not.toBe(inserted(b).id);
    expect(inserted(a).name).toBe(inserted(b).name);
    refusedBothWays(a, b, 'name-race');
  });

  test.each(['Shared', 'sHaReD'])('different sheets renamed to %s collide', (name) => {
    refusedBothWays(
      commands([rename('s1', 'Shared')]),
      commands([rename('s2', name)]),
      'name-race',
    );
    refusedBothWays(add('Shared'), commands([rename('s2', name)]), 'name-race');
    refusedBothWays(add('Shared'), add(name), 'name-race');
  });

  test('a native copy and a rename to its case-insensitive name collide', () => {
    const copied = copy();
    refusedBothWays(
      copied,
      commands([rename('s2', inserted(copied).name.toUpperCase())]),
      'name-race',
    );
  });

  test('an intermediate rename is checked before pairwise transforms can drop it', () => {
    const a = commands([rename('s1', 'Shared'), rename('s1', 'Final')]);
    const b = commands([rename('s1', 'First'), rename('s2', 'Shared')]);
    refusedBothWays(a, b, 'name-race');
  });

  test('two undos restoring the same removed sheet are refused, even with different names', () => {
    const undo = () =>
      commands(
        [['univer.command.undo', {}]],
        [['sheet.command.remove-sheet', { subUnitId: 's2' }]],
      );
    const [a, b] = [undo(), undo()];
    expect(inserted(a).id).toBe('s2');
    expect(inserted(b).id).toBe('s2');
    refusedBothWays(a, b, 'name-race');
    inserted(b).name = 'Restored';
    refusedBothWays(a, b, 'name-race');
  });
});

/** The raw persisted snapshot must keep every name attached to the same ID on reopen. */
function reopen(replica: Replica): IWorkbookData {
  const raw = JSON.parse(JSON.stringify(replica.workbook()!.getSnapshot())) as IWorkbookData;
  const names = Object.fromEntries(
    Object.entries(raw.sheets).map(([id, sheet]) => [id, sheet.name]),
  );
  expect(new Set(Object.values(names).map((name) => name!.toLowerCase())).size).toBe(
    raw.sheetOrder.length,
  );
  const restored = new Replica({ workbook: raw });
  try {
    const after = restored.workbook()!.getSnapshot();
    expect(
      Object.fromEntries(Object.entries(after.sheets).map(([id, sheet]) => [id, sheet.name])),
    ).toEqual(names);
    return structuredClone(after);
  } finally {
    restored.univer.dispose();
  }
}

test.each(['left', 'right'] as const)(
  'distinct sheet names and pending formulas survive both arrival orders (%s)',
  (side) => {
    const [a, b] = [add('Alpha'), add('Beta')];
    const write = (name: string, column: number): Mutation => ({
      id: 'sheet.mutation.set-range-values',
      params: { unitId, subUnitId: 's1', cellValue: { 0: { [column]: { f: `=${name}!A1` } } } },
    });
    a.push(write('Alpha', 0));
    b.push(write('Beta', 1));
    const [first, second] = [new Replica(document), new Replica(document)];
    try {
      first.apply([
        ...a,
        ...transform(b, a, flip(side), { cells: snapshotCells(document.workbook) }),
      ]);
      second.apply([...b, ...transform(a, b, side, { cells: snapshotCells(document.workbook) })]);
      const [one, two] = [reopen(first), reopen(second)];
      expect(one).toEqual(two);
      expect(one.sheets[inserted(a).id].name).toBe('Alpha');
      expect(one.sheets[inserted(b).id].name).toBe('Beta');
      expect(one.sheets.s1.cellData![0][0]?.f).toBe('=Alpha!A1');
      expect(one.sheets.s1.cellData![0][1]?.f).toBe('=Beta!A1');
    } finally {
      first.univer.dispose();
      second.univer.dispose();
    }
  },
);

test('same-sheet renames keep first-accepted behavior and other workbooks are independent', () => {
  const [a, b] = [commands([rename('s1', 'First')]), commands([rename('s1', 'Second')])];
  expect(transform(a, b, 'left')).toEqual(a);
  expect(transform(a, b, 'right')).toEqual([]);
  const other = commands([rename('s2', 'First')]).map((m) => ({
    ...m,
    params: { ...m.params, unitId: 'other' },
  }));
  expect(transform(a, other, 'right')).toEqual(a);
  expect(a[0].id).toBe(settingIds.name);
});

for (const winner of [0, 1]) {
  for (const deliverBeforeRefusal of [false, true]) {
    test(`colliding adds with pending formulas resync and reopen safely (winner ${winner}, early delivery ${deliverBeforeRefusal})`, () => {
      const additions = [add(), add()];
      const batches = additions.map((added, client) => {
        const sheet = inserted(added);
        const formula = `='${sheet.name.replaceAll("'", "''")}'!A1`;
        const replica = new Replica(document);
        try {
          replica.apply(added);
          const value = capture(replica, 'sheet.command.set-range-values', {
            unitId,
            subUnitId: sheet.id,
            range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
            value: { v: 10 + client },
          })!;
          replica.apply(value);
          const typed = capture(replica, 'sheet.command.set-range-values', {
            unitId,
            subUnitId: 's1',
            range: { startRow: 0, endRow: 0, startColumn: client, endColumn: client },
            value: { f: formula },
          })!;
          expect(value.length).toBeGreaterThan(0);
          expect(typed.length).toBeGreaterThan(0);
          return { edits: [...added, ...value, ...typed], formula };
        } finally {
          replica.univer.dispose();
        }
      });
      const loser = 1 - winner;
      const run = simulate({
        seed: 1,
        document,
        mutations: 0,
        generate: () => null,
        script: [
          { client: 0, edit: batches[0].edits },
          { client: 1, edit: batches[1].edits },
          { client: 0, take: 'send' },
          { client: 1, take: 'send' },
          { client: winner, take: 'server' },
          ...(deliverBeforeRefusal ? [{ client: loser, take: 'client' as const }] : []),
          { client: loser, take: 'server' },
        ],
      });
      try {
        expect(run.stats.refused).toBe(1);
        const snapshots = [run.server, ...run.clients].map(reopen);
        for (const snapshot of snapshots) {
          expect(snapshot).toEqual(snapshots[0]);
          const accepted = inserted(additions[winner]);
          expect(snapshot.sheetOrder).toEqual(['s1', 's2', accepted.id]);
          expect(snapshot.sheets[accepted.id].name).toBe(accepted.name);
          expect(snapshot.sheets[accepted.id].cellData![0][0]?.v).toBe(10 + winner);
          expect(snapshot.sheets.s1.cellData![0][winner]?.f).toBe(batches[winner].formula);
          expect(snapshot.sheets.s1.cellData![0][loser]?.f).toBeUndefined();
          expect(snapshot.sheets[inserted(additions[loser]).id]).toBeUndefined();
        }
      } finally {
        for (const replica of [run.server, ...run.clients]) replica.univer.dispose();
      }
    });
  }
}
