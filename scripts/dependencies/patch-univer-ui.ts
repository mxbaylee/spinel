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
 * Modified for Spinel: ignore queued virtual-list resize callbacks after React
 * clears the container ref, in open-source @univerjs/ui 1.1.0. Capture the node
 * once so both dimensions come from the same mounted container.
 * No @univerjs-pro package is read or modified.
 * Source: packages/ui/src/views/hooks/virtual-list.ts, tag v1.1.0:
 * https://github.com/dream-num/univer/blob/v1.1.0/packages/ui/src/views/hooks/virtual-list.ts
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const formats = {
  es: '7a9a61456eb048be1536acb51322c6178558379bb9a8d0925ba0986062c8aef9',
  cjs: '94e6cbd279adeb40a62c4a877df520ecd71c99c3061bdc962e3b3666f3eb148a',
} as const;

const before = `const getSize = () => {
\t\t\t\tconst width = containerTarget.current.clientWidth;
\t\t\t\tconst height = containerTarget.current.clientHeight;`;
const after = `const getSize = () => {
\t\t\t\t// Modified for Spinel: React may clear the ref before observer cleanup.
\t\t\t\tconst container = containerTarget.current;
\t\t\t\tif (!container) return;
\t\t\t\tconst width = container.clientWidth;
\t\t\t\tconst height = container.clientHeight;`;

export function patchUi(source: string, format: keyof typeof formats): string {
  // Accept the original or our exact repair, but no other upstream or local edits.
  const original = source.replace(after, before);
  if (createHash('sha256').update(original).digest('hex') !== formats[format])
    throw new Error(
      `Unrecognized @univerjs/ui ${format} build; review the UI patch before installing.`,
    );
  const start = original.indexOf('//#region src/views/hooks/virtual-list.ts');
  const end = original.indexOf('//#endregion', start);
  if (start < 0 || end < 0) throw new Error('UI virtual-list patch region not found.');
  const body = original.slice(start, end);
  if (body.split(before).length !== 2)
    throw new Error('UI virtual-list patch target must occur exactly once.');
  return original.slice(0, start) + body.replace(before, after) + original.slice(end);
}

export async function patchInstalledUi(root: string) {
  const directory = resolve(root, 'node_modules/@univerjs/ui');
  const metadata = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
  if (metadata.version !== '1.1.0')
    throw new Error('Upgrading @univerjs/ui: review the virtual-list resize patch first.');
  // Validate both formats before making either change.
  const updates = await Promise.all(
    (Object.keys(formats) as (keyof typeof formats)[]).map(async (format) => {
      const path = resolve(directory, 'lib', format, 'index.js');
      const source = await readFile(path, 'utf8');
      return { path, source, patched: patchUi(source, format) };
    }),
  );
  for (const { path, source, patched } of updates)
    if (source !== patched) await writeFile(path, patched);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await patchInstalledUi(resolve(import.meta.dirname, '../..'));
