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
 * Modified for Spinel: compose contiguous, single-character root-body inserts
 * in an order-preserving balanced tree. All other native actions keep their
 * original fold, including deletes and rich metadata. Native grouping, metadata,
 * cache ownership, publication order and timers remain in the pinned SDK service.
 * Source: packages/docs/src/services/doc-state-change-manager.service.ts,
 * dream-num/univer v1.1.0 (Apache-2.0). No Pro code is read or modified.
 * Temporary: SPN-122 removes this after a suitable upstream release. SPN-121
 * retains the source, semantic and browser acceptance evidence.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const formats = {
  es: '84349b3374cafabaf0baee661b97b4a76a2ac47d1bc68e73cef34f9b8c58e145',
  cjs: '8a3191dee7f9f21c2a2cbb7bb0a7c93af624ef58f2fb8a96af71b27f6cbf5642',
} as const;

export function prepareDocsPatch(source: string, format: keyof typeof formats) {
  const json = format === 'cjs' ? '_univerjs_core.JSONX' : 'JSONX';
  const anchor = 'const DEBOUNCE_DELAY = 300;';
  const helper = `${anchor}
// Modified for Spinel: only plain single-character insert groups have the
// qualified native action shape. Mixed composition can change own undefined
// body fields, so an ineligible state keeps the entire original cache fold.
function hasOnlyDocInsertKeys(value, keys) {
\treturn value != null && typeof value === "object" && Reflect.ownKeys(value).every((key) => keys.includes(key));
}
function canBalanceDocInserts(states, key) {
\tif (states.length < 2) return false;
\tlet previousOffset;
\tlet append = true;
\tlet prepend = true;
\tfor (const state of states) {
\t\tconst actions = state[key].actions;
\t\tif (!Array.isArray(actions) || actions.length !== 2 || !hasOnlyDocInsertKeys(actions, ["0", "1", "length"]) || actions[0] !== "body") return false;
\t\tconst component = actions[1];
\t\tif (!hasOnlyDocInsertKeys(component, ["et", "e"]) || !Object.hasOwn(component, "et") || !Object.hasOwn(component, "e") || component.et !== "text-x") return false;
\t\tconst edits = component.e;
\t\tif (!Array.isArray(edits) || edits.length < 1 || edits.length > 2 || !hasOnlyDocInsertKeys(edits, ["0", "1", "length"])) return false;
\t\tlet offset = 0;
\t\tif (edits.length === 2) {
\t\t\tconst retain = edits[0];
\t\t\tif (!hasOnlyDocInsertKeys(retain, ["t", "len"]) || !Object.hasOwn(retain, "t") || !Object.hasOwn(retain, "len") || retain.t !== "r" || !Number.isSafeInteger(retain.len) || retain.len <= 0) return false;
\t\t\toffset = retain.len;
\t\t}
\t\tconst insert = edits[edits.length - 1];
\t\tif (!hasOnlyDocInsertKeys(insert, ["t", "len", "body", "valueRangeId"]) || !Object.hasOwn(insert, "t") || !Object.hasOwn(insert, "len") || !Object.hasOwn(insert, "body") || insert.t !== "i" || insert.len !== 1 || insert.valueRangeId !== void 0) return false;
\t\tconst body = insert.body;
\t\tif (!hasOnlyDocInsertKeys(body, ["dataStream", "textRuns", "paragraphs", "customRanges", "customDecorations", "customBlocks", "sectionBreaks"]) || !Object.hasOwn(body, "dataStream") || typeof body.dataStream !== "string" || body.dataStream.length !== 1) return false;
\t\t// The SDK's structural tokens are C0 controls. Keep all C0/DEL on the native path.
\t\tconst code = body.dataStream.charCodeAt(0);
\t\tif (code < 32 || code === 127) return false;
\t\tfor (const field of ["paragraphs", "customRanges", "customDecorations", "customBlocks", "sectionBreaks"]) {
\t\t\tconst value = body[field];
\t\t\tif (value !== void 0 && (!Array.isArray(value) || value.length !== 0 || !hasOnlyDocInsertKeys(value, ["length"]))) return false;
\t\t}
\t\tconst runs = body.textRuns;
\t\tif (runs !== void 0) {
\t\t\tif (!Array.isArray(runs) || runs.length > 1 || !hasOnlyDocInsertKeys(runs, ["0", "length"])) return false;
\t\t\tif (runs.length === 1) {
\t\t\t\tconst run = runs[0];
\t\t\t\tif (!hasOnlyDocInsertKeys(run, ["st", "ed", "ts", "sId"]) || !Object.hasOwn(run, "st") || !Object.hasOwn(run, "ed") || run.st !== 0 || run.ed !== 1 || run.sId !== void 0 || (run.ts !== void 0 && (run.ts === null || typeof run.ts !== "object" || Array.isArray(run.ts)))) return false;
\t\t\t}
\t\t}
\t\tif (previousOffset !== void 0) {
\t\t\tappend = append && offset === previousOffset + 1;
\t\t\tprepend = prepend && offset === previousOffset;
\t\t\tif (!append && !prepend) return false;
\t\t}
\t\tpreviousOffset = offset;
\t}
\treturn true;
}
function composeDocStateActions(states, key) {
\tif (!canBalanceDocInserts(states, key)) return states.reduce((acc, state) => ${json}.compose(acc, state[key].actions), null);
\tfunction composeRange(start, end) {
\t\tconst length = end - start;
\t\tif (length === 1) return states[start][key].actions;
\t\tconst middle = start + Math.floor(length / 2);
\t\treturn ${json}.compose(composeRange(start, middle), composeRange(middle, end));
\t}
\treturn composeRange(0, states.length);
}`;
  const replacements = [
    { before: anchor, after: helper, count: 1 },
    {
      before: `cacheStates.reduce((acc, cur) => ${json}.compose(acc, cur.redoState.actions), null)`,
      after: 'composeDocStateActions(cacheStates, "redoState")',
      count: 2,
    },
    {
      before: `cacheStates.reverse().reduce((acc, cur) => ${json}.compose(acc, cur.undoState.actions), null)`,
      after: 'composeDocStateActions(cacheStates.reverse(), "undoState")',
      count: 2,
    },
  ];
  // Recover only these exact substitutions, then verify the complete upstream
  // file. The recovered original also supplies an executable negative control.
  const original = replacements.reduce(
    (text, { before, after }) => text.replaceAll(after, before),
    source,
  );
  if (createHash('sha256').update(original).digest('hex') !== formats[format])
    throw new Error(`Unrecognized @univerjs/docs ${format} build; review native composition.`);
  const patched = replacements.reduce((text, { before, after, count }) => {
    if (text.split(before).length !== count + 1)
      throw new Error('Docs composition patch target count changed.');
    return text.replaceAll(before, after);
  }, original);
  if (source !== original && source !== patched)
    throw new Error(
      `Partially modified @univerjs/docs ${format} build; restore the pinned package.`,
    );
  return { original, patched };
}

export async function patchInstalledDocs(root: string) {
  const directory = resolve(root, 'node_modules/@univerjs/docs');
  const metadata = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
  if (metadata.name !== '@univerjs/docs' || metadata.version !== '1.1.0')
    throw new Error('Upgrading @univerjs/docs: review native composition and SPN-122 first.');
  // Fail closed on either unknown build before writing either format.
  const updates = await Promise.all(
    (Object.keys(formats) as (keyof typeof formats)[]).map(async (format) => {
      const path = resolve(directory, 'lib', format, 'index.js');
      const source = await readFile(path, 'utf8');
      return { path, source, patched: prepareDocsPatch(source, format).patched };
    }),
  );
  for (const { path, source, patched } of updates)
    if (source !== patched) await writeFile(path, patched);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await patchInstalledDocs(resolve(import.meta.dirname, '../..'));
