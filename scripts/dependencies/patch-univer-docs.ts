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
 * in an order-preserving balanced tree up to the first unsupported state. The
 * remaining actions keep their original fold, except SPN-146's strictly qualified
 * single-Enter boundary followed by a contiguous plain append run. SPN-135 aggregates only fully
 * qualified descending single-character deletes; SPN-142 also aggregates their
 * qualified leading prefixes before the unchanged sequential tail. It observes native flushes
 * through an opt-in scalar API. Native grouping, metadata,
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
import { docFlushObservationReplacements } from './doc-flush-observation.ts';

const formats = {
  es: '84349b3374cafabaf0baee661b97b4a76a2ac47d1bc68e73cef34f9b8c58e145',
  cjs: '8a3191dee7f9f21c2a2cbb7bb0a7c93af624ef58f2fb8a96af71b27f6cbf5642',
} as const;

export function prepareDocsPatch(source: string, format: keyof typeof formats) {
  const json = format === 'cjs' ? '_univerjs_core.JSONX' : 'JSONX';
  const anchor = 'const DEBOUNCE_DELAY = 300;';
  const markerField = ', "__textXPreserveParagraphIds"';
  const markerGuard = `
\t\t// Sync capture marks every insert before native apply; keep the marker intact.
\t\tif (Object.hasOwn(body, "__textXPreserveParagraphIds") && body.__textXPreserveParagraphIds !== true) return false;`;
  const markerHelper = `${anchor}
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
\t\tif (!hasOnlyDocInsertKeys(body, ["dataStream", "textRuns", "paragraphs", "customRanges", "customDecorations", "customBlocks", "sectionBreaks"${markerField}]) || !Object.hasOwn(body, "dataStream") || typeof body.dataStream !== "string" || body.dataStream.length !== 1) return false;${markerGuard}
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
  // Keep the exact SPN-132 bytes for install upgrades and regression controls.
  // Qualification is unchanged; return the length of its leading valid prefix.
  const prefixHelper = markerHelper
    .replace(
      '// Modified for Spinel: only plain single-character insert groups have the\n// qualified native action shape. Mixed composition can change own undefined\n// body fields, so an ineligible state keeps the entire original cache fold.',
      '// Modified for Spinel: balance only the qualified leading insert prefix.\n// Its raw result equals the original fold; keep every remaining call in order.\n// Never balance later islands or reassociate an unsupported native action.',
    )
    .replace('canBalanceDocInserts', 'docInsertPrefixLength')
    .replace('if (states.length < 2) return false;', 'if (states.length < 2) return 0;')
    .replace(
      'for (const state of states) {',
      'for (let index = 0; index < states.length; index++) {\n\t\tconst state = states[index];',
    )
    .replaceAll('return false;', 'return index;')
    .replace('return true;', 'return states.length;')
    .replace(
      'if (!canBalanceDocInserts(states, key))',
      'const prefix = docInsertPrefixLength(states, key);\n\t// Tiny partial trees do not reduce work; preserve their original fold.\n\tif (prefix < 2 || (prefix < 4 && prefix < states.length))',
    )
    .replace(
      'return composeRange(0, states.length);',
      `let result = composeRange(0, prefix);\n\tfor (let index = prefix; index < states.length; index++) result = ${json}.compose(result, states[index][key].actions);\n\treturn result;`,
    );
  // Retain the exact SPN-133 helper as an upgrade source and regression control.
  // Descending adjacent deletes preserve the lowest-offset action's body: the
  // native TextX.push merges only lengths, never concatenates deleted bodies.
  // Reuse the same strict root-body/metadata qualification as keyboard inserts.
  const deleteShapeGuard = `
function isPlainDocDeleteData(value, depth = 0) {
\tif (value === null || typeof value !== "object") return value === void 0 || value === null || (typeof value === "string" || typeof value === "number" || typeof value === "boolean");
\tif (depth > 16 || Object.getPrototypeOf(value) !== (Array.isArray(value) ? Array.prototype : Object.prototype)) return false;
\treturn Reflect.ownKeys(value).every((key) => {
\t\tconst descriptor = Object.getOwnPropertyDescriptor(value, key);
\t\treturn typeof key === "string" && Object.hasOwn(descriptor, "value") && (descriptor.enumerable || (Array.isArray(value) && key === "length")) && isPlainDocDeleteData(descriptor.value, depth + 1);
\t});
}
`;
  const deleteGuard = markerHelper
    .slice(anchor.length, markerHelper.indexOf('function composeDocStateActions'))
    .replace('canBalanceDocInserts', 'canCombineDocDeletes')
    .replace(
      'const actions = state[key].actions;',
      'const actions = state[key].actions;\n\t\tif (!isPlainDocDeleteData(actions)) return false;',
    )
    .replace('insert.t !== "i"', 'insert.t !== "d"')
    .replace('offset === previousOffset + 1', 'offset === previousOffset - 1')
    .replace('prepend = prepend && offset === previousOffset;', 'prepend = false;')
    .replace(/function hasOnlyDocInsertKeys[\s\S]*?\n}\n/, '')
    .replace(
      /\/\/ Modified for Spinel:[\s\S]*?function canCombineDocDeletes/,
      '// Modified for Spinel: aggregate only complete descending single-character\n// delete groups; native merging retains the lowest-offset deleted body.\nfunction canCombineDocDeletes',
    );
  const clone = format === 'cjs' ? '_univerjs_core.Tools.deepClone' : 'Tools.deepClone';
  const completeDeleteHelper = prefixHelper.replace(
    'function composeDocStateActions(states, key) {',
    `${deleteShapeGuard}${deleteGuard}function composeDocStateActions(states, key) {
\tif (canCombineDocDeletes(states, key)) {
\t\tconst result = ${clone}(states[states.length - 1][key].actions);
\t\tconst edits = result[1].e;
\t\tedits[edits.length - 1].len = states.length;
\t\treturn result;
\t}`,
  );
  // Keep the exact SPN-135 helper for hash-verified install upgrades and controls.
  // A qualified prefix is itself a previously admitted complete delete group.
  // Its equal accumulator leaves every unsupported/later compose call unchanged.
  const deletePrefixGuard = deleteGuard
    .replace('canCombineDocDeletes', 'docDeletePrefixLength')
    .replace(
      'aggregate only complete descending single-character',
      'aggregate only leading qualified descending single-character',
    )
    .replace('if (states.length < 2) return false;', 'if (states.length < 2) return 0;')
    .replace(
      'for (const state of states) {',
      'for (let index = 0; index < states.length; index++) {\n\t\tconst state = states[index];',
    )
    .replaceAll('return false;', 'return index;')
    .replace('return true;', 'return states.length;');
  const deletePrefixHelper = completeDeleteHelper
    .replace(deleteGuard, deletePrefixGuard)
    .replace(
      'if (canCombineDocDeletes(states, key)) {',
      'const deletePrefix = docDeletePrefixLength(states, key);\n\tif (deletePrefix >= 2) {',
    )
    .replace(
      `const result = ${clone}(states[states.length - 1][key].actions);`,
      `let result = ${clone}(states[deletePrefix - 1][key].actions);`,
    )
    .replace(
      'edits[edits.length - 1].len = states.length;',
      `edits[edits.length - 1].len = deletePrefix;\n\t\tfor (let index = deletePrefix; index < states.length; index++) result = ${json}.compose(result, states[index][key].actions);`,
    );
  // Retain the exact first SPN-142 candidate for install upgrades and controls.
  // These private read-only lists are module constants: qualification preserves
  // the same includes/iteration order without rebuilding them for every state.
  const guardLists = [
    ['docActionKeys', '["0", "1", "length"]'],
    ['docComponentKeys', '["et", "e"]'],
    ['docRetainKeys', '["t", "len"]'],
    ['docEditKeys', '["t", "len", "body", "valueRangeId"]'],
    [
      'docBodyKeys',
      '["dataStream", "textRuns", "paragraphs", "customRanges", "customDecorations", "customBlocks", "sectionBreaks", "__textXPreserveParagraphIds"]',
    ],
    [
      'docEmptyBodyFields',
      '["paragraphs", "customRanges", "customDecorations", "customBlocks", "sectionBreaks"]',
    ],
    ['docEmptyArrayKeys', '["length"]'],
    ['docRunArrayKeys', '["0", "length"]'],
    ['docRunKeys', '["st", "ed", "ts", "sId"]'],
  ];
  const constantGuardHelper = guardLists
    .reduce((text, [name, literal]) => text.replaceAll(literal, name), deletePrefixHelper)
    .replace(
      anchor,
      anchor + '\n' + guardLists.map(([name, literal]) => `const ${name} = ${literal};`).join('\n'),
    );
  // Keep SPN-142's exact bytes as an upgrade source and a work negative.
  // Only one native Enter between append-contiguous plain inserts is admitted.
  // Its style retain stays in the head; compose the qualified final run once.
  const paragraphTailGuard = `
const docParagraphKeys = ["startIndex", "paragraphId", "paragraphStyle"];
const docParagraphRetainKeys = ["t", "len", "body", "coverType", "oldBody"];
const docParagraphEditsKeys = ["0", "1", "2", "length"];
function isDocParagraphBody(body, kind) {
\tif (!hasOnlyDocInsertKeys(body, docBodyKeys) || body.dataStream !== (kind === "insert" ? "\\r" : "")) return false;
\tif (Object.hasOwn(body, "__textXPreserveParagraphIds") && body.__textXPreserveParagraphIds !== true) return false;
\tfor (const field of docEmptyBodyFields) {
\t\tif (field === "paragraphs" && kind === "insert") continue;
\t\tconst value = body[field];
\t\tif (value !== void 0 && (!Array.isArray(value) || value.length !== 0 || !hasOnlyDocInsertKeys(value, docEmptyArrayKeys))) return false;
\t}
\tconst runs = body.textRuns;
\tif (!Array.isArray(runs) || runs.length > 1 || !hasOnlyDocInsertKeys(runs, docRunArrayKeys) || (kind !== "old" && runs.length !== 1)) return false;
\tif (runs.length) {
\t\tconst run = runs[0];
\t\tif (!hasOnlyDocInsertKeys(run, docRunKeys) || run.st !== 0 || run.ed !== 1 || run.sId !== void 0 || (run.ts !== void 0 && (run.ts === null || typeof run.ts !== "object" || Array.isArray(run.ts)))) return false;
\t}
\tif (kind !== "insert") return true;
\tconst paragraphs = body.paragraphs;
\tif (!Array.isArray(paragraphs) || paragraphs.length !== 1 || !hasOnlyDocInsertKeys(paragraphs, docRunArrayKeys)) return false;
\tconst paragraph = paragraphs[0];
\treturn hasOnlyDocInsertKeys(paragraph, docParagraphKeys) && paragraph.startIndex === 0 && typeof paragraph.paragraphId === "string" && paragraph.paragraphId.startsWith("para_") && paragraph.paragraphStyle != null && typeof paragraph.paragraphStyle === "object" && !Array.isArray(paragraph.paragraphStyle) && Reflect.ownKeys(paragraph.paragraphStyle).length === 0;
}
function canComposeDocParagraphTail(states, key, prefix) {
\t// Descriptor inspection rejects accessors before reading a new field. The old
\t// helper remains the fallback, including its original operand/read order.
\tif (!isPlainDocDeleteData(states)) return false;
\tconst actions = states[prefix][key].actions;
\tif (!Array.isArray(actions) || actions.length !== 2 || !hasOnlyDocInsertKeys(actions, docActionKeys) || actions[0] !== "body") return false;
\tconst component = actions[1];
\tif (!hasOnlyDocInsertKeys(component, docComponentKeys) || component.et !== "text-x") return false;
\tconst edits = component.e;
\tif (!Array.isArray(edits) || (edits.length !== 2 && edits.length !== 3) || !hasOnlyDocInsertKeys(edits, docParagraphEditsKeys)) return false;
\tlet offset = 0;
\tif (edits.length === 3) {
\t\tconst retain = edits[0];
\t\tif (!hasOnlyDocInsertKeys(retain, docRetainKeys) || retain.t !== "r" || !Number.isSafeInteger(retain.len) || retain.len <= 0) return false;
\t\toffset = retain.len;
\t}
\tconst insert = edits[edits.length - 2];
\tconst following = edits[edits.length - 1];
\tif (!hasOnlyDocInsertKeys(insert, docEditKeys) || insert.t !== "i" || insert.len !== 1 || insert.valueRangeId !== void 0 || !isDocParagraphBody(insert.body, "insert")) return false;
\tif (!hasOnlyDocInsertKeys(following, docParagraphRetainKeys) || following.t !== "r" || following.len !== 1 || (following.coverType !== 0 && following.coverType !== 1) || !isDocParagraphBody(following.body, "retain") || !isDocParagraphBody(following.oldBody, "old")) return false;
\tconst tail = states.slice(prefix + 1);
\tif (docInsertPrefixLength(tail, key) !== tail.length) return false;
\tconst firstOffset = offset - prefix;
\tif (firstOffset < 0) return false;
\tfor (let index = 0; index < states.length; index++) {
\t\tconst state = states[index];
\t\tif (state.unitId !== states[0].unitId || state.segmentId !== states[0].segmentId) return false;
\t\tif (index === prefix) continue;
\t\tconst current = state[key].actions[1].e;
\t\tconst currentOffset = current.length === 2 ? current[0].len : 0;
\t\tif (currentOffset !== firstOffset + index) return false;
\t}
\treturn true;
}
`;
  const helper = constantGuardHelper
    .replace(
      '// Never balance later islands or reassociate an unsupported native action.',
      '// Only the separately qualified single-Enter append tail below may join\n// its non-null head once. All other unsupported tails retain their native fold.',
    )
    .replace(
      'function composeDocStateActions(states, key) {',
      paragraphTailGuard + 'function composeDocStateActions(states, key) {',
    )
    .replace(
      'const prefix = docInsertPrefixLength(states, key);',
      `const prefix = docInsertPrefixLength(states, key);
\tif (key === "redoState" && states.length - prefix > 4 && canComposeDocParagraphTail(states, key, prefix)) {
\t\tconst head = composeDocStateActions(states.slice(0, prefix + 1), key);
\t\tconst tail = composeDocStateActions(states.slice(prefix + 1), key);
\t\treturn ${json}.compose(head, tail);
\t}`,
    );
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
  // Permit upgrading the exact previous patch during npm install as well as a
  // fresh npm ci. Both recoveries still verify the complete upstream file.
  const previousHelper = markerHelper.replace(markerField, '').replace(markerGuard, '');
  // The recovered original also supplies an executable negative control.
  const original = replacements.reduce(
    (text, { before, after }) => text.replaceAll(after, before),
    docFlushObservationReplacements
      .reduce((text, { before, after }) => text.replaceAll(after, before), source)
      .replaceAll(constantGuardHelper, anchor)
      .replaceAll(deletePrefixHelper, anchor)
      .replaceAll(completeDeleteHelper, anchor)
      .replaceAll(previousHelper, anchor)
      .replaceAll(markerHelper, anchor)
      .replaceAll(prefixHelper, anchor),
  );
  if (createHash('sha256').update(original).digest('hex') !== formats[format])
    throw new Error(`Unrecognized @univerjs/docs ${format} build; review native composition.`);
  const composed = replacements.reduce((text, { before, after, count }) => {
    if (text.split(before).length !== count + 1)
      throw new Error('Docs composition patch target count changed.');
    return text.replaceAll(before, after);
  }, original);
  const previousPatched = composed.replace(helper, previousHelper);
  const markerPatched = composed.replace(helper, markerHelper);
  const prefixPatched = composed.replace(helper, prefixHelper);
  const patched = docFlushObservationReplacements.reduce((text, { before, after, count }) => {
    if (text.split(before).length !== count + 1)
      throw new Error('Docs observation patch target count changed.');
    return text.replaceAll(before, after);
  }, composed);
  const completeDeletePatched = patched.replace(helper, completeDeleteHelper);
  const deletePrefixPatched = patched.replace(helper, deletePrefixHelper);
  const constantGuardPatched = patched.replace(helper, constantGuardHelper);
  if (
    source !== original &&
    source !== patched &&
    source !== completeDeletePatched &&
    source !== deletePrefixPatched &&
    source !== constantGuardPatched &&
    source !== previousPatched &&
    source !== markerPatched &&
    source !== prefixPatched
  )
    throw new Error(
      `Partially modified @univerjs/docs ${format} build; restore the pinned package.`,
    );
  return {
    original,
    patched,
    previousPatched,
    markerPatched,
    prefixPatched,
    completeDeletePatched,
    deletePrefixPatched,
    constantGuardPatched,
  };
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
