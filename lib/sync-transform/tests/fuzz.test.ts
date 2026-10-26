import { expect, test } from 'vitest';
import { cellEdit, commandEdit, sheetCut } from './generate-cells.ts';
import { docEdit, seededDoc } from './generate-docs.ts';
import { drawingEdit } from './generate-drawings.ts';
import { nameEdit } from './generate-names.ts';
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
  sheetCut,
  propertyEdit,
  mergeEdit,
  settingEdit,
  drawingEdit,
  nameEdit,
  docEdit,
];
const anyEdit: Generate = (replica, next) => pick(next, generators)(replica, next);

const seeds = 100;
const mutationsPerSeed = 1000;

test(`${seeds * mutationsPerSeed} random mutations from two clients converge`, () => {
  const document = { workbook: seededWorkbook(), doc: seededDoc() };
  const total = convergesOver(anyEdit, { seeds, mutations: mutationsPerSeed, document });
  if (!process.env.FUZZ_SEED) expect(total).toBeGreaterThanOrEqual(seeds * mutationsPerSeed);
}, 300_000);
