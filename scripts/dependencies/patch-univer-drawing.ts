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
 * Modified for Spinel: refresh retained, finite collapsed Sheet drawing geometry
 * after native structural edits without treating it as a new placement request.
 * Explicit placement validation remains unchanged. No Pro package is read.
 * Source: packages/sheets-drawing/src/controllers/sheet-drawing-transform-affected.controller.ts
 * and services/sheet-drawing-placement.ts, dream-num/univer tag v1.1.0.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const formats = {
  es: '1bdd287986af35517d44249e62dea67932aeaf00216028d0e01d5e1519b09701',
  cjs: '0887a284c9856cae8d4933d48d0032b27953e1636aa5729045c4397cd4d81e67',
} as const;
const marker = '//#region src/controllers/sheet-drawing-transform-affected.controller.ts';
const helper = `${marker}
// Modified for Spinel: structural edits can retain an image with zero/signed
// extent. Refresh its existing anchor without changing that extent or identity.
function refreshRetainedSheetDrawingPlacement(drawing, skeleton) {
  const placement = getSheetDrawingPlacement(drawing);
  if (placement.kind !== "0" || !Number.isFinite(placement.width) ||
      !Number.isFinite(placement.height) || (placement.width > 0 && placement.height > 0)) {
    return applySheetDrawingPlacement(drawing, placement, skeleton);
  }
  validateCellPosition(placement.from);
  const converted = convertPositionCellToSheetOverGrid(
    drawing.unitId, drawing.subUnitId, placement.from, placement.width, placement.height, skeleton);
  const transform = withExistingTransform(drawing.transform, converted.transform);
  return {
    ...drawing,
    sheetTransform: withExistingSheetTransform(drawing.sheetTransform, converted.sheetTransform),
    transform,
    axisAlignSheetTransform: transformToAxisAlignPosition(transform, skeleton)
  };
}`;
const replacements = [
  [marker, helper],
  ...['skeleton', 'sheetSkeletonParam.skeleton'].map((skeleton) => [
    `applySheetDrawingPlacement(drawing, getSheetDrawingPlacement(drawing), ${skeleton})`,
    `refreshRetainedSheetDrawingPlacement(drawing, ${skeleton})`,
  ]),
];

export function patchDrawing(source: string, format: keyof typeof formats): string {
  const original = replacements.reduce(
    (text, [before, after]) => text.replace(after, before),
    source,
  );
  if (createHash('sha256').update(original).digest('hex') !== formats[format])
    throw new Error(
      `Unrecognized @univerjs/sheets-drawing ${format} build; review the drawing patch.`,
    );
  return replacements.reduce((text, [before, after]) => {
    if (text.split(before).length !== 2)
      throw new Error('Drawing patch target must occur exactly once.');
    return text.replace(before, after);
  }, original);
}

export async function patchInstalledDrawing(root: string) {
  const directory = resolve(root, 'node_modules/@univerjs/sheets-drawing');
  const metadata = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
  if (metadata.version !== '1.1.0')
    throw new Error('Upgrading @univerjs/sheets-drawing: review retained drawing geometry first.');
  const updates = await Promise.all(
    (Object.keys(formats) as (keyof typeof formats)[]).map(async (format) => {
      const path = resolve(directory, 'lib', format, 'index.js');
      const source = await readFile(path, 'utf8');
      return { path, source, patched: patchDrawing(source, format) };
    }),
  );
  for (const { path, source, patched } of updates)
    if (source !== patched) await writeFile(path, patched);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await patchInstalledDrawing(resolve(import.meta.dirname, '../..'));
