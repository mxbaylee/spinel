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
 * and services/sheet-drawing-placement.ts, dream-num/univer tag v1.3.1.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const formats = {
  es: '137a6044dfd8b2df07f4e72584b22bd278e61cc479429065d60030ebcd9cbc3d',
  cjs: '96e714645fb718ddaf9f97be06dc5dd4722871ec0a0d9ae4b36da6bba9881032',
} as const;
export function prepareDrawingPatch(source: string, format: keyof typeof formats) {
  // 1.3.1 centralizes both resize and queued refresh in this method. Preserve
  // its marker validation, hidden-cell handling, range filter and error isolation;
  // only an existing finite collapsed Position placement bypasses extent rejection.
  const replacements = [
    [
      `\t\t\tconst failure = validateSheetDrawingPlacement(drawing);
\t\t\tif (failure) {`,
      `\t\t\tconst failure = validateSheetDrawingPlacement(drawing);
\t\t\t// Modified for Spinel: retain finite collapsed geometry, not new placements.
\t\t\t// An extent failure implies both persisted cell markers already validated.
\t\t\tconst placement = failure?.reason === PLACEMENT_ERROR.EXTENT_INVALID
\t\t\t\t? getSheetDrawingPlacement(drawing) : void 0;
\t\t\tconst retainedCollapsed = placement?.kind === "0" &&
\t\t\t\tNumber.isFinite(placement.width) && Number.isFinite(placement.height) &&
\t\t\t\t(placement.width <= 0 || placement.height <= 0);
\t\t\tif (failure && !retainedCollapsed) {`,
    ],
    [
      '\t\t\tconst result = tryRefreshSheetDrawingPlacement(drawing, skeleton);',
      `\t\t\tconst result = retainedCollapsed
\t\t\t\t? { ok: true, drawing: resolveSheetDrawingPlacement(drawing, placement, skeleton) }
\t\t\t\t: tryRefreshSheetDrawingPlacement(drawing, skeleton);`,
    ],
  ];
  const original = replacements.reduce(
    (text, [before, after]) => text.replace(after, before),
    source,
  );
  if (createHash('sha256').update(original).digest('hex') !== formats[format])
    throw new Error(
      `Unrecognized @univerjs/sheets-drawing ${format} build; review the drawing patch.`,
    );
  const patched = replacements.reduce((text, [before, after]) => {
    if (text.split(before).length !== 2)
      throw new Error('Drawing patch target must occur exactly once.');
    return text.replace(before, after);
  }, original);
  if (source !== original && source !== patched)
    throw new Error('Partially modified drawing build; restore the pinned package.');
  return { original, patched };
}

export function patchDrawing(source: string, format: keyof typeof formats): string {
  return prepareDrawingPatch(source, format).patched;
}

export async function patchInstalledDrawing(root: string) {
  const directory = resolve(root, 'node_modules/@univerjs/sheets-drawing');
  const metadata = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
  if (metadata.version !== '1.3.1')
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
