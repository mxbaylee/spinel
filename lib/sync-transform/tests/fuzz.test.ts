import type { IDrawingJsonUndo1 } from '@univerjs/drawing';
import { DrawingTypeEnum } from '@univerjs/core';
import { SetRowHeightCommand } from '@univerjs/sheets';
import { ISheetDrawingService, SheetDrawingAnchorType } from '@univerjs/sheets-drawing';
import { Replica } from './harness.ts';
import { drawingIds } from '../src/drawings.ts';
import { setImmediate } from 'node:timers/promises';
import { expect, test } from 'vitest';
import { mixedCellEdit, commandEdit, sheetCut } from './generate-cells.ts';
import { markedDocEdit, seededDoc } from './generate-docs.ts';
import { drawingEdit } from './generate-drawings.ts';
import { nameEdit } from './generate-names.ts';
import { mergeEdit, propertyEdit, settingEdit } from './generate-sheet.ts';
import {
  capture,
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

// 1.3.1 rejects newly computed negative structural extents, so old random
// seeds no longer necessarily create them. Keep all 100 original seeds intact
// and separately prove the same capture path still handles retained old data.
function captureRetainedDrawings() {
  for (const width of [0, -20]) {
    const replica = new Replica({ workbook: seededWorkbook() });
    try {
      const target = { unitId: 'wb', subUnitId: 's1' };
      const service = replica.injector.get(ISheetDrawingService);
      const marker = (row: number, column: number) => ({
        row,
        column,
        rowOffset: 0,
        columnOffset: 0,
      });
      const anchor = { from: marker(0, 0), to: marker(2, 1) };
      const drawing = {
        ...target,
        drawingId: 'retained',
        drawingType: DrawingTypeEnum.DRAWING_IMAGE,
        imageSourceType: 'URL' as const,
        source: '/images/retained.png',
        anchorType: SheetDrawingAnchorType.Position,
        sheetTransform: anchor,
        axisAlignSheetTransform: anchor,
        transform: { left: 0, top: 0, width, height: 40, angle: 0 },
      };
      const { redo, objects } = service.getBatchAddOp([drawing as never]) as IDrawingJsonUndo1;
      replica.apply([{ id: drawingIds.apply, params: { ...target, op: redo, objects, type: 0 } }]);
      const captured = capture(replica, SetRowHeightCommand.id, {
        ...target,
        ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 5 }],
        value: 35,
      });
      expect(captured?.length, `retained width ${width} emits native mutations`).toBeGreaterThan(0);
      replica.apply(captured!);
      expect(service.getDrawingData('wb', 's1').retained).toMatchObject({
        drawingId: 'retained',
        source: drawing.source,
        transform: { width, height: 40 },
      });
      expect(replica.workbook()!.getSheetBySheetId('s1')!.getRowHeight(0)).toBe(35);
    } finally {
      replica.univer.dispose();
    }
  }
}

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
    captureRetainedDrawings();
    const retainedCaptures = drawingCaptureCoverage().withCollapsedDrawing;
    expect(retainedCaptures).toBe(2);
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
        `Native drawing capture evidence: ${JSON.stringify({ ...drawingCaptureCoverage(), retainedCaptures })}\n`,
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
