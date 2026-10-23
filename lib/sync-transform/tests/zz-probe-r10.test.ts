import { writeFileSync } from 'node:fs';
import { test } from 'vitest';
import { transform } from '../index.ts';
import type { Mutation } from '../index.ts';
import { cellIds } from '../src/cells.ts';
import { flip } from '../src/types.ts';
import { seededWorkbook } from './generate.ts';
import { Replica } from './harness.ts';

const out = '/private/tmp/claude-501/-Users-bschmeisser-projects/6492e93c-aefc-4be7-8764-5fcddafe4d2b/scratchpad/review10/probe.txt';
const unitId = 'wb';
const subUnitId = 's1';
const set = (cellValue: unknown, extra = {}): Mutation => ({
  id: cellIds.setRangeValues,
  params: { unitId, subUnitId, cellValue, ...extra },
});
const cell = (row: number, col: number, value: unknown, extra = {}) => set({ [row]: { [col]: value } }, extra);
const setNumfmt = (pattern: string, ranges: unknown[]): Mutation => ({
  id: cellIds.setNumfmt,
  params: { unitId, subUnitId, values: { k: { ranges } }, refMap: { k: { pattern } } },
});
const range = (r: number, c: number, r2 = r, c2 = c) => ({ startRow: r, startColumn: c, endRow: r2, endColumn: c2 });
const setup = [
  set({ 2: { 1: { s: { n: { pattern: '0.00' } }, v: 'TRUE' } } }, { isOverrideStyle: true }),
  setNumfmt('@', [range(2, 1, 3, 1)]),
];
const lines: string[] = [];
function run(name: string, a: Mutation[], b: Mutation[]) {
  for (const side of ['left', 'right'] as const) {
    try {
      const first = new Replica({ workbook: seededWorkbook() });
      const second = new Replica({ workbook: seededWorkbook() });
      first.apply(setup);
      second.apply(setup);
      first.apply([...b, ...transform(a, b, side)]);
      second.apply([...a, ...transform(b, a, flip(side))]);
      const x = (first.snapshot() as any).workbook.sheets.s1.cellData[2][1];
      const y = (second.snapshot() as any).workbook.sheets.s1.cellData[2][1];
      lines.push(`${name} ${side}: ${JSON.stringify(x) === JSON.stringify(y) ? 'SAME' : 'DIVERGE'} ${JSON.stringify(x)} | ${JSON.stringify(y)}`);
    } catch (e: any) {
      lines.push(`${name} ${side}: threw ${e.reason ?? e.message}`);
    }
  }
}

test('probe', () => {
  const before = new Replica({ workbook: seededWorkbook() });
  before.apply(setup);
  lines.push('before ' + JSON.stringify((before.snapshot() as any).workbook.sheets.s1.cellData[2][1]));
  const bold = cell(2, 1, { s: { bl: 1 } });
  const clear = cell(2, 1, { s: null });
  const overrideBold = cell(2, 1, { s: { it: 1 } }, { isOverrideStyle: true });
  run('clear vs bold', [clear], [bold]);
  run('overrideItalic vs bold', [overrideBold], [bold]);
  run('clear vs overrideItalic', [clear], [overrideBold]);
  run('empty vs clear', [cell(2, 1, {})], [clear]);
  writeFileSync(out, lines.join('\n'));
});
