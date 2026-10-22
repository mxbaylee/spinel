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
 * Modified for Spinel: repair paragraph REPLACE composition, keep custom ranges
 * canonical after every update, and stop adding a custom range from emitting a
 * negative retain, in open-source @univerjs/core 1.1.0. No @univerjs-pro
 * package is read or modified.
 * Source: packages/core/src/docs/data-model/text-x/{utils,action-iterator}.ts,
 * packages/core/src/docs/data-model/text-x/apply-utils/{common,update-apply}.ts and
 * packages/core/src/docs/data-model/text-x/build-utils/text-x-utils.ts, tag v1.1.0.
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
  // Each patch edits one function, and its targets must occur exactly once there.
  // A region runs from `from` to `to`, or to the end of the source file `to` is in.
  const regions: { from: string; to: string; toFileEnd?: true; replacements: string[][] }[] = [
    {
      from: 'function composeBody(',
      to: 'var ActionIterator = class',
      toFileEnd: true,
      replacements,
    },
    {
      from: 'function mergeContinuousRanges(',
      to: 'function splitCustomRangesByIndex(',
      replacements: [
        [
          'if (ranges.length <= 1) return ranges;',
          `// Modified for Spinel: one range is renamed to its root id like any other.
\tif (ranges.length === 0) return ranges;`,
        ],
      ],
    },
    {
      from: 'function updateCustomRanges(',
      to: 'function updateCustomDecorations(',
      replacements: [
        [
          'if (!updateDataCustomRanges) return [];',
          `// Modified for Spinel: a retain without ranges still splits them at its
\t// edges above, so join the pieces again, as a retain with ranges does.
\tif (!updateDataCustomRanges) {
\t\tbody.customRanges = mergeContinuousRanges(body.customRanges);
\t\treturn [];
\t}`,
        ],
      ],
    },
    {
      from: 'function addCustomRangeTextX(',
      to: 'function isAtomicContainerDeleted(',
      replacements: [
        [
          'const rangeStartIndex = Math.min(',
          `// Modified for Spinel: each piece grows to swallow the ranges it meets,
\t\t\t// so the piece before a paragraph can already cover an existing range
\t\t\t// that runs past it. The next piece met the same range and started
\t\t\t// back at its start, before the cursor: a negative retain. It now
\t\t\t// starts at the cursor, and is dropped when nothing is left of it.
\t\t\tconst rangeStartIndex = Math.max(cursor, Math.min(`,
        ],
        [
          '_relativeCustomRanges.startIndex) ?? Infinity, startIndex);',
          '_relativeCustomRanges.startIndex) ?? Infinity, startIndex));',
        ],
        [
          '_relativeCustomRanges2.endIndex) ?? -Infinity, endIndex);',
          `_relativeCustomRanges2.endIndex) ?? -Infinity, endIndex);
\t\t\tif (rangeEndIndex < rangeStartIndex) return;`,
        ],
      ],
    },
  ];
  // Idempotent, but never silently patch a different upstream version or local edit.
  const original = regions
    .flatMap((region) => region.replacements)
    .reduce((text, [old, replacement]) => text.replace(replacement, old), source);
  if (createHash('sha256').update(original).digest('hex') !== spec.sha256)
    throw new Error(
      `Unrecognized @univerjs/core ${format} build; review the core patch before installing.`,
    );
  return regions.reduce((text, { from, to, toFileEnd, replacements: edits }) => {
    const start = text.indexOf(from);
    const stop = text.indexOf(to, start);
    const end = toFileEnd ? text.indexOf('//#endregion', stop) : stop;
    if (start < 0 || stop < 0 || end < 0) throw new Error(`Core patch region ${from} not found.`);
    const body = edits.reduce(
      (part, [old, replacement]) => {
        if (part.split(old).length !== 2)
          throw new Error('Core patch target must occur exactly once.');
        return part.replace(old, replacement);
      },
      text.slice(start, end),
    );
    return text.slice(0, start) + body + text.slice(end);
  }, original);
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
