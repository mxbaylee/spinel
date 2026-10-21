import { expect, test } from 'vitest';
import { cellEdit, commandEdit } from './generate-cells.ts';
import { docEdit, seededDoc } from './generate-docs.ts';
import { drawingEdit } from './generate-drawings.ts';
import { mergeEdit, propertyEdit, settingEdit } from './generate-sheet.ts';
import { pick, seededWorkbook, structuralEdit } from './generate.ts';
import type { Generate } from './generate.ts';
import { convergesOver } from './simulate.ts';

// Every family at once, on a workbook and a doc, so edits of one family meet
// every other family's. `FUZZ_SEED=<n>` replays one failing seed.
const generators: Generate[] = [
  structuralEdit,
  cellEdit,
  commandEdit,
  propertyEdit,
  mergeEdit,
  settingEdit,
  drawingEdit,
  docEdit,
];
const anyEdit: Generate = (replica, next) => pick(next, generators)(replica, next);

const seeds = 100;
const editsPerSeed = 1000;

test(`${seeds * editsPerSeed} random edits from two clients converge`, () => {
  const document = { workbook: seededWorkbook(), doc: seededDoc() };
  const total = convergesOver(anyEdit, { seeds, edits: editsPerSeed, document });
  if (!process.env.FUZZ_SEED) expect(total).toBeGreaterThanOrEqual(seeds * editsPerSeed);
}, 300_000);
