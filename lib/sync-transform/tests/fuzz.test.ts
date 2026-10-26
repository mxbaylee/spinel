import { setImmediate } from 'node:timers/promises';
import { expect, test } from 'vitest';
import { mixedCellEdit, commandEdit, sheetCut } from './generate-cells.ts';
import { markedDocEdit, seededDoc } from './generate-docs.ts';
import { drawingEdit } from './generate-drawings.ts';
import { nameEdit } from './generate-names.ts';
import { mergeEdit, propertyEdit, settingEdit } from './generate-sheet.ts';
import {
  drawingCaptureCoverage,
  resetDrawingCaptureCoverage,
  seededWorkbook,
  setDrawingCaptureSeed,
  structuralEdit,
} from './generate.ts';
import { resetTextMarkers, textMarker } from './content-intent.ts';
import { FamilyCoverage } from './coverage.ts';
import { historyGenerator } from './generate-history.ts';
import { convergesOver } from './simulate.ts';

// Every family at once, on a workbook and a doc, so edits of one family meet
// every other family's. `FUZZ_SEED=<n>` replays one failing seed.
const generators = {
  structure: structuralEdit,
  cells: mixedCellEdit,
  commands: commandEdit,
  cuts: sheetCut,
  properties: propertyEdit,
  merges: mergeEdit,
  settings: settingEdit,
  drawings: drawingEdit,
  names: nameEdit,
  docs: markedDocEdit,
};

const seeds = 100;
const mutationsPerSeed = 1000;
// Native history plus independent intent measured about 50s for ten seeds.
// Keep the whole matrix within its dedicated 15-minute hosted CI job.
const timeout = 600_000;

test(
  `${seeds * mutationsPerSeed} random mutations from two clients converge`,
  async () => {
    const doc = seededDoc();
    resetTextMarkers();
    // Seeded text is protected too: untouched text cannot silently disappear
    // merely because every replica applies the same broken transformed edit.
    doc.body!.dataStream = doc.body!.dataStream.replace(/[^\r\n]/g, () => textMarker());
    const reserved = doc.body!.dataStream.replace(/[\r\n]/g, '').length;
    const document = { workbook: seededWorkbook(), doc };
    const coverage = new FamilyCoverage();
    const contentChecks = { doc: 0, sheetInsert: 0, sheetRemove: 0 };
    resetDrawingCaptureCoverage();
    let total = 0;
    const started = performance.now();
    const selected = process.env.FUZZ_SEED
      ? [Number(process.env.FUZZ_SEED)]
      : Array.from({ length: seeds }, (_, index) => index + 1);
    try {
      for (const seed of selected) {
        const history = historyGenerator(generators);
        total += convergesOver(history.generate, {
          seeds: [seed],
          mutations: mutationsPerSeed,
          document,
          intent: true,
          contentIntent: true,
          describeEdit: history.describe,
          coverage,
          contentChecks,
          beforeSeed: (seed) => {
            resetTextMarkers(reserved);
            setDrawingCaptureSeed(seed);
          },
        });
        // Native commands enqueue local cache continuations. Let them finish
        // after each disposed, independent run instead of retaining 100 seeds'
        // copies until one synchronous test returns. No simulation step yields.
        await setImmediate();
        if (!process.env.FUZZ_SEED && seed % 10 === 0) {
          process.stdout.write(
            `Fuzz progress: ${seed}/${seeds} seeds; ${total} original mutations; ${Math.round(performance.now() - started)} ms\n`,
          );
        }
      }
      // Keep actual original-mutation outcomes in hosted logs for review. The
      // three terminal outcomes are exclusive, including pending edits discarded
      // by resync; an accepted batch's expansion cannot inflate these counts.
      process.stdout.write(
        `Fuzz original-mutation outcomes: ${JSON.stringify(Object.fromEntries(coverage.families))}\n`,
      );
      process.stdout.write(`Independent content-intent checks: ${JSON.stringify(contentChecks)}\n`);
    } finally {
      process.stdout.write(
        `Native drawing capture evidence: ${JSON.stringify(drawingCaptureCoverage())}\n`,
      );
    }
    const drawingChecks = drawingCaptureCoverage();
    if (process.env.FUZZ_SEED) return;
    expect(total).toBeGreaterThanOrEqual(seeds * mutationsPerSeed);
    for (const family of Object.keys(generators)) {
      const counts = coverage.families.get(family)!;
      expect(counts.generated, `${family} generated mutations`).toBeGreaterThan(100);
      expect(counts.accepted + counts.refused + counts.discarded, family).toBe(counts.generated);
      expect(counts.accepted / counts.generated, `${family} accepted share`).toBeGreaterThanOrEqual(
        0.2,
      );
      expect(counts.acceptedUndo, `${family} accepted native undo`).toBeGreaterThan(0);
      expect(counts.acceptedRedo, `${family} accepted native redo`).toBeGreaterThan(0);
    }
    expect(contentChecks.doc).toBeGreaterThan(100);
    expect(contentChecks.sheetInsert).toBeGreaterThan(100);
    expect(contentChecks.sheetRemove).toBeGreaterThan(100);
    expect(
      drawingChecks.withCollapsedDrawing,
      'native captures formerly skipped for collapsed drawings',
    ).toBeGreaterThan(0);
  },
  timeout,
);
