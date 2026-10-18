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
 * Modified for Spinel: repair paragraph REPLACE composition in open-source
 * @univerjs/core 1.1.0. No @univerjs-pro package is read or modified.
 * Source: packages/core/src/docs/data-model/text-x/{utils,action-iterator}.ts, tag v1.1.0.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const formats = {
  es: {
    sha256: 'ecbebddd3821c5603d41fb7febf5277ca051171caa170d0c51afe12143cedc12',
    merge: 'merge',
  },
  cjs: {
    sha256: 'abbf88dcec149753c405c6a7243a3ea5267df31e56849ba4cde6bc839512d829',
    merge: '(0, lodash_es.merge)',
  },
} as const;

export function patchCore(source: string, format: keyof typeof formats): string {
  const spec = formats[format];
  const before = `paragraphs.push(${spec.merge}(thisParagraph, otherParagraph));`;
  const after = `// Modified for Spinel: REPLACE clears removed attributes, retaining stable identity.
\t\t\tif (coverType === 1) {
\t\t\t\tparagraphs.push({ ...Tools.deepClone(otherParagraph), paragraphId: otherParagraph.paragraphId ?? thisParagraph.paragraphId });
\t\t\t} else {
\t\t\t\t${before}
\t\t\t}`;
  const replacements = [
    [before, after],
    [
      '} else if (thisStart < otherStart) {\n\t\t\tparagraphs.push(Tools.deepClone(thisParagraph));',
      '} else if (thisStart < otherStart) {\n\t\t\tif (coverType !== 1 || otherBody.paragraphs == null) paragraphs.push(Tools.deepClone(thisParagraph));',
    ],
    [
      'if (thisIndex < thisParagraphs.length) paragraphs.push(...thisParagraphs.slice(thisIndex));',
      'if ((coverType !== 1 || otherBody.paragraphs == null) && thisIndex < thisParagraphs.length) paragraphs.push(...thisParagraphs.slice(thisIndex));',
    ],
    [
      'if (paragraphs.length) retBody.paragraphs = paragraphs;',
      'if (paragraphs.length || (coverType === 1 && otherBody.paragraphs != null)) retBody.paragraphs = paragraphs;',
    ],
  ];
  replacements.push([
    'body: getBodySliceForSplitTextXAction(nextAction.body, offset, offset + length, false)',
    `body: {
      ...getBodySliceForSplitTextXAction(nextAction.body, offset, offset + length, false),
      // Modified for Spinel: an explicit empty REPLACE array clears the sliced range.
      ...(nextAction.t === "r" && nextAction.coverType === 1 && nextAction.body.paragraphs != null
        ? { paragraphs: getParagraphsSlice(nextAction.body, offset, offset + length) ?? [] } : {})
    }`,
  ]);
  // Idempotent, but never silently patch a different upstream version or local edit.
  const original = replacements.reduce(
    (text, [old, replacement]) => text.replace(replacement, old),
    source,
  );
  if (createHash('sha256').update(original).digest('hex') !== spec.sha256)
    throw new Error(
      `Unrecognized @univerjs/core ${format} build; review the paragraph patch before installing.`,
    );
  const start = original.indexOf('function composeBody(');
  const end = original.indexOf(
    '//#endregion',
    original.indexOf('var ActionIterator = class', start),
  );
  const body = replacements.reduce(
    (text, [old, replacement]) => {
      if (text.split(old).length !== 2)
        throw new Error('Paragraph patch target must occur exactly once.');
      return text.replace(old, replacement);
    },
    original.slice(start, end),
  );
  return original.slice(0, start) + body + original.slice(end);
}

export async function patchInstalledCore(root: string) {
  const directory = resolve(root, 'node_modules/@univerjs/core');
  const metadata = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
  if (metadata.version !== '1.1.0')
    throw new Error('Review the paragraph patch when upgrading @univerjs/core.');
  // Validate both formats before making either change.
  const updates = await Promise.all(
    Object.keys(formats).map(async (format) => {
      const path = resolve(directory, 'lib', format, 'index.js');
      const source = await readFile(path, 'utf8');
      return { path, source, patched: patchCore(source, format as keyof typeof formats) };
    }),
  );
  for (const { path, source, patched } of updates)
    if (source !== patched) await writeFile(path, patched);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await patchInstalledCore(resolve(import.meta.dirname, '../..'));
