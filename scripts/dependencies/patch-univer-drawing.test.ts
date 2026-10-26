/**
 * Copyright 2023-present DreamNum Co., Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modified for Spinel: execute the pinned open-source drawing resize/refresh
 * methods and placement validation with controlled geometry dependencies. Keep
 * the original methods as negative controls. No Pro package is read.
 * Source: packages/sheets-drawing/src/controllers/sheet-drawing-transform-affected.controller.ts
 * and services/sheet-drawing-placement.ts, dream-num/univer tag v1.1.0.
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { patchDrawing, patchInstalledDrawing } from './patch-univer-drawing.ts';

type Format = 'es' | 'cjs';
const controllerMarker = '//#region src/controllers/sheet-drawing-transform-affected.controller.ts';
const readBuild = (format: Format) =>
  readFile(
    new URL(`../../node_modules/@univerjs/sheets-drawing/lib/${format}/index.js`, import.meta.url),
    'utf8',
  );

function originalSource(source: string): string {
  // Recover only the three patch sites; patchDrawing then validates the entire
  // recovered file against the pinned upstream hash before it can be executed.
  const start = source.indexOf(controllerMarker) + controllerMarker.length;
  const end = source.indexOf('\nconst UPDATE_COMMANDS', start);
  assert.ok(start >= controllerMarker.length && end >= start);
  let original = source.slice(0, start) + source.slice(end);
  for (const skeleton of ['skeleton', 'sheetSkeletonParam.skeleton'])
    original = original.replace(
      `refreshRetainedSheetDrawingPlacement(drawing, ${skeleton})`,
      `applySheetDrawingPlacement(drawing, getSheetDrawingPlacement(drawing), ${skeleton})`,
    );
  return original;
}

function region(source: string, path: string) {
  const marker = `//#region ${path}\n`;
  const start = source.indexOf(marker);
  const end = source.indexOf('//#endregion', start);
  assert.ok(start >= 0 && end > start, `${path}: source region exists`);
  return source.slice(start + marker.length, end);
}

function method(source: string, name: string) {
  const start = source.indexOf(`\t${name}(`);
  const end = source.indexOf('\n\t}', start);
  assert.ok(start >= 0 && end > start, `${name}: source method exists`);
  return source.slice(start, end + '\n\t}'.length);
}

const cell = (row = 1, column = 1, rowOffset = 0, columnOffset = 0) => ({
  row,
  column,
  rowOffset,
  columnOffset,
});
function image(width: number, height: number) {
  return {
    unitId: 'book',
    subUnitId: 'sheet',
    drawingId: 'retained-image',
    drawingType: 0,
    anchorType: '0',
    source: '/images/retained.png',
    sheetTransform: { from: cell(), to: cell(3, 2), angle: 90, flipX: true },
    transform: { left: 900, top: 900, width, height, angle: 90, flipX: true },
  };
}
type Drawing = ReturnType<typeof image>;
type Placement = { kind: string; from: ReturnType<typeof cell>; width: number; height: number };
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

function drawingMethods(source: string, format: Format) {
  const placement = region(source, 'src/services/sheet-drawing-placement.ts');
  const controller = region(
    source,
    'src/controllers/sheet-drawing-transform-affected.controller.ts',
  );
  const helper = controller.slice(0, controller.indexOf('const UPDATE_COMMANDS'));
  const core = {
    DrawingTypeEnum: { DRAWING_IMAGE: 0, DRAWING_DOM: 1 },
    Rectangle: { intersects: () => true },
  };
  const sheets = {
    convertPositionCellToSheetOverGrid(
      unitId: string,
      subUnitId: string,
      from: ReturnType<typeof cell>,
      width: number,
      height: number,
    ) {
      assert.equal(unitId, 'book');
      assert.equal(subUnitId, 'sheet');
      return {
        sheetTransform: {
          from: { ...from },
          to: {
            ...from,
            rowOffset: from.rowOffset + height,
            columnOffset: from.columnOffset + width,
          },
        },
        transform: {
          left: from.column * 80 + from.columnOffset,
          top: from.row * 20 + from.rowOffset,
          width,
          height,
        },
      };
    },
  };
  return runInNewContext(
    `${placement}\n${helper}\nconst methods = {
      ${method(source, '_getDrawingUndoForRowAndColSize')},
      ${method(source, '_refreshDrawingTransform')}
    };
    const ranges = [{ startRow: 0, endRow: 3, startColumn: 0, endColumn: 3 }];
    function context(drawing) {
      return {
        _getCalculatedSkeletonParam: () => ({ skeleton: {} }),
        _drawingManagerService: { getDrawingData: () => ({ [drawing.drawingId]: drawing }) },
        _createUndoAndRedoMutation: (_unit, _sheet, updates) => updates,
        _finalizePlan: (_unit, _sheet, updates) => updates
      };
    }
    ({
      resize: (drawing) => methods._getDrawingUndoForRowAndColSize.call(context(drawing), 'book', 'sheet', ranges),
      refresh: (drawing) => {
        const receiver = context(drawing);
        let updates;
        receiver._finalizePlan = (_unit, _sheet, value) => { updates = value; };
        methods._refreshDrawingTransform.call(receiver, {}, 'book', 'sheet', ranges);
        return updates;
      },
      explicit: (drawing, input) => applySheetDrawingPlacement(drawing, input, {})
    });`,
    {
      // Do not provide ESM import names to CJS: a missing qualification in the
      // injected helper must fail here, just as it would in the installed build.
      ...(format === 'es'
        ? { ...core, ...sheets }
        : { _univerjs_core: core, _univerjs_sheets: sheets }),
      transformToAxisAlignPosition: (transform: unknown) => ({ transformed: transform }),
    },
    { filename: `${format}/drawing-refresh.installed.js`, timeout: 1000 },
  ) as {
    resize: (drawing: Drawing) => Drawing[];
    refresh: (drawing: Drawing) => Drawing[];
    explicit: (drawing: Drawing, placement: Placement) => Drawing;
  };
}

const collapsedExtents = [
  [0, 40],
  [-20, 40],
  [80, 0],
  [80, -20],
];
for (const format of ['es', 'cjs'] as const) {
  test(`${format}: both native resize and queued refresh retain finite collapsed geometry`, async () => {
    const original = originalSource(await readBuild(format));
    const patched = drawingMethods(patchDrawing(original, format), format);
    const upstream = drawingMethods(original, format);
    for (const [width, height] of collapsedExtents) {
      const drawing = image(width, height);
      const before = structuredClone(drawing);
      for (const path of ['resize', 'refresh'] as const) {
        const updated = patched[path](drawing);
        assert.equal(updated.length, 1, `${path}: keep the drawing`);
        assert.equal(updated[0].drawingId, drawing.drawingId);
        assert.equal(updated[0].source, drawing.source);
        assert.equal(updated[0].anchorType, '0');
        assert.deepEqual(plain(updated[0].transform), { ...drawing.transform, left: 80, top: 20 });
        assert.deepEqual(plain(updated[0].sheetTransform.from), drawing.sheetTransform.from);
        assert.equal(updated[0].sheetTransform.angle, 90);
        assert.equal(updated[0].sheetTransform.flipX, true);
        assert.throws(() => upstream[path](drawing), /SHEET_DRAWING_PLACEMENT_EXTENT_INVALID/);
      }
      assert.deepEqual(drawing, before, 'refresh does not mutate its input');
    }
    for (const path of ['resize', 'refresh'] as const)
      assert.deepEqual(plain(patched[path](image(80, 40))), plain(upstream[path](image(80, 40))));
  });

  test(`${format}: explicit invalid placement and nonfinite retained geometry still fail`, async () => {
    const original = originalSource(await readBuild(format));
    const methods = drawingMethods(patchDrawing(original, format), format);
    for (const [width, height] of [...collapsedExtents, [NaN, 40], [80, Infinity]]) {
      const drawing = image(width, height);
      assert.throws(
        () => methods.explicit(drawing, { kind: '0', from: cell(), width, height }),
        /SHEET_DRAWING_PLACEMENT_EXTENT_INVALID/,
      );
    }
    for (const path of ['resize', 'refresh'] as const) {
      assert.throws(() => methods[path](image(NaN, 40)), /SHEET_DRAWING_PLACEMENT_EXTENT_INVALID/);
      assert.throws(
        () => methods[path](image(80, Infinity)),
        /SHEET_DRAWING_PLACEMENT_EXTENT_INVALID/,
      );
      const invalidCell = image(0, 40);
      invalidCell.sheetTransform.from.row = -1;
      assert.throws(() => methods[path](invalidCell), /SHEET_DRAWING_PLACEMENT_CELL_INVALID/);
    }
  });

  test(`${format}: the drawing patch is idempotent and rejects changed upstream bytes`, async () => {
    const installed = await readBuild(format);
    const original = originalSource(installed);
    const patched = patchDrawing(original, format);
    assert.equal(patchDrawing(patched, format), patched);
    for (const source of [original, patched])
      assert.throws(() => patchDrawing(source + '\n// unexpected change', format), /Unrecognized/);
    assert.throws(() => patchDrawing(original, format === 'es' ? 'cjs' : 'es'), /Unrecognized/);
    assert.throws(
      () =>
        patchDrawing(
          patched.replace(
            'validateCellPosition(placement.from);\n  const converted',
            'validateCellPosition(placement.from);\n  // changed\n  const converted',
          ),
          format,
        ),
      /Unrecognized/,
    );
  });
}

test('drawing installation validates its version and both formats before changing either', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'spinel-drawing-patch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = resolve(root, 'node_modules/@univerjs/sheets-drawing');
  const metadata = resolve(directory, 'package.json');
  const originals = {
    es: originalSource(await readBuild('es')),
    cjs: originalSource(await readBuild('cjs')),
  };
  for (const format of ['es', 'cjs'] as const) {
    await mkdir(resolve(directory, 'lib', format), { recursive: true });
    await writeFile(resolve(directory, 'lib', format, 'index.js'), originals[format]);
  }
  await writeFile(metadata, JSON.stringify({ version: '1.1.1' }));
  await assert.rejects(patchInstalledDrawing(root), /Upgrading @univerjs\/sheets-drawing/);
  for (const format of ['es', 'cjs'] as const)
    assert.equal(
      await readFile(resolve(directory, 'lib', format, 'index.js'), 'utf8'),
      originals[format],
    );

  await writeFile(metadata, JSON.stringify({ version: '1.1.0' }));
  const cjs = resolve(directory, 'lib/cjs/index.js');
  await writeFile(cjs, originals.cjs + '\n// unexpected change');
  await assert.rejects(patchInstalledDrawing(root), /Unrecognized @univerjs\/sheets-drawing cjs/);
  assert.equal(await readFile(resolve(directory, 'lib/es/index.js'), 'utf8'), originals.es);
  assert.equal(await readFile(cjs, 'utf8'), originals.cjs + '\n// unexpected change');

  await writeFile(cjs, originals.cjs);
  await patchInstalledDrawing(root);
  await patchInstalledDrawing(root);
  for (const format of ['es', 'cjs'] as const)
    assert.equal(
      await readFile(resolve(directory, 'lib', format, 'index.js'), 'utf8'),
      patchDrawing(originals[format], format),
    );
});
