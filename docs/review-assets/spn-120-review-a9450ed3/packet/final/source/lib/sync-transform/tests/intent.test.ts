import { expect, test } from 'vitest';
import { transform } from '../index.ts';
import type { Mutation } from '../index.ts';
import { structureIds } from '../src/structure.ts';
import { cellIds } from '../src/writes.ts';
import { seededWorkbook } from './generate.ts';
import { simulate } from './simulate.ts';
import type { Step, Transform } from './simulate.ts';

function removalRace(writeSheet: string, replacement?: Transform) {
  const remove: Mutation = {
    id: structureIds.removeSheet,
    params: { unitId: 'wb', subUnitId: 's1', index: 0 },
  };
  const write: Mutation = {
    id: cellIds.setRangeValues,
    params: {
      unitId: 'wb',
      subUnitId: writeSheet,
      cellValue: { 0: { 0: { v: 'accepted value' } } },
    },
  };
  const script: Step[] = [
    { client: 0, edit: [remove] },
    { client: 1, edit: [write] },
    { client: 1, take: 'send' },
    { client: 1, take: 'server' },
    { client: 0, take: 'client' },
  ];
  const run = simulate({
    seed: 1,
    document: { workbook: seededWorkbook() },
    mutations: 0,
    generate: () => null,
    script,
    intent: true,
    contentIntent: true,
    transform: replacement,
  });
  try {
    const expected = run.server.snapshot();
    for (const client of run.clients) expect(client.snapshot()).toEqual(expected);
    expect(run.server.workbook()!.getSheetBySheetId('s1')).toBeUndefined();
    if (writeSheet === 's2') {
      expect(run.server.workbook()!.getSheetBySheetId('s2')!.getCell(0, 0)?.v).toBe(
        'accepted value',
      );
    }
  } finally {
    for (const replica of [run.server, ...run.clients]) replica.univer.dispose();
  }
}

test.each(['s1', 's2'])(
  'cell intent follows worksheet removal exactly while a write targets %s',
  (sheet) => {
    removalRace(sheet);
  },
);

test('worksheet removal cannot excuse a dropped accepted write to a different worksheet', () => {
  const broken: Transform = (a, b, side, options) => {
    const result = transform(a, b, side, options);
    return b.some(({ id }) => id === structureIds.removeSheet)
      ? result.filter(({ id }) => id !== cellIds.setRangeValues)
      : result;
  };
  expect(() => removalRace('s2', broken)).toThrow('s2:0:0');
});
