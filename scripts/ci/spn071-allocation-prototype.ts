// Investigation only. Inject into the hash-verified existing public SDK patch.
// No installed package or production source is modified by this function.
export function allocationPrototype(source: string, format: 'es' | 'cjs') {
  const json = format === 'cjs' ? '_univerjs_core.JSONX' : 'JSONX';
  const tools = format === 'cjs' ? '_univerjs_core.Tools' : 'Tools';
  const anchor = 'function composeDocStateActions(states, key) {';
  if (source.split(anchor).length !== 2) throw new Error('Expected current balanced patch.');
  return source.replace(anchor, `
function samePlainOwnShape(left, right) {
  const keys = Reflect.ownKeys(left);
  return keys.length === Reflect.ownKeys(right).length && keys.every((key) => Object.hasOwn(right, key));
}
function plainInsertStyle(style) {
  if (style === void 0) return true;
  if (style === null || typeof style !== "object" || Array.isArray(style)) return false;
  const keys = Reflect.ownKeys(style);
  if (keys.length === 0) return true;
  return keys.length === 1 && keys[0] === "cl" && style.cl !== null && typeof style.cl === "object" && !Array.isArray(style.cl) && Reflect.ownKeys(style.cl).length === 1 && Object.hasOwn(style.cl, "rgb") && typeof style.cl.rgb === "string";
}
function samePlainStyle(left, right) {
  if (left === void 0 || right === void 0) return left === right;
  return samePlainOwnShape(left, right) && (Object.hasOwn(left, "cl") ? left.cl.rgb === right.cl.rgb : true);
}
function uniformPlainInsertActions(states, key) {
  if (states.length < 3) return null;
  const firstEdits = states[0][key].actions[1].e;
  const first = firstEdits[firstEdits.length - 1];
  const firstBody = first.body;
  const firstRuns = firstBody.textRuns;
  const firstRun = firstRuns && firstRuns[0];
  if (firstRun && !plainInsertStyle(firstRun.ts)) return null;
  const secondEdits = states[1][key].actions[1].e;
  const offset = (edits) => edits.length === 2 ? edits[0].len : 0;
  const prepend = offset(firstEdits) === offset(secondEdits);
  for (const state of states) {
    const edits = state[key].actions[1].e;
    const insert = edits[edits.length - 1];
    const body = insert.body;
    const runs = body.textRuns;
    if (!samePlainOwnShape(first, insert) || !samePlainOwnShape(firstBody, body)) return null;
    for (const field of ["paragraphs", "customRanges", "customDecorations", "customBlocks", "sectionBreaks"]) {
      if ((firstBody[field] === void 0) !== (body[field] === void 0)) return null;
    }
    if ((firstRuns === void 0) !== (runs === void 0) || (firstRuns && firstRuns.length !== runs.length)) return null;
    if (firstRun) {
      const run = runs[0];
      if (!samePlainOwnShape(firstRun, run) || !plainInsertStyle(run.ts) || !samePlainStyle(firstRun.ts, run.ts)) return null;
    }
  }
  const pair = ${json}.compose(states[0][key].actions, states[1][key].actions);
  if (!Array.isArray(pair) || pair.length !== 2 || pair[0] !== "body" || pair[1].et !== "text-x") return null;
  const pairEdits = pair[1].e;
  const retained = firstEdits.length === 2 ? 1 : 0;
  if (pairEdits.length !== retained + 2 || (retained && (pairEdits[0].t !== "r" || pairEdits[0].len !== offset(firstEdits) || !samePlainOwnShape(pairEdits[0], firstEdits[0])))) return null;
  const left = pairEdits[retained];
  const right = pairEdits[retained + 1];
  const secondBody = secondEdits[secondEdits.length - 1].body;
  if (left.t !== "i" || right.t !== "i" || left.len !== 1 || right.len !== 1 || !samePlainOwnShape(left, right)) return null;
  if (left.body.dataStream !== (prepend ? secondBody.dataStream : firstBody.dataStream) || right.body.dataStream !== (prepend ? firstBody.dataStream : secondBody.dataStream)) return null;
  // Both canonical templates must match exactly, including own undefined fields.
  function sameTemplate(a, b, ignoreText = false) {
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return Object.is(a, b);
    return Array.isArray(a) === Array.isArray(b) && samePlainOwnShape(a, b) && Reflect.ownKeys(a).every((field) => ignoreText && field === "dataStream" || sameTemplate(a[field], b[field]));
  }
  if (!Reflect.ownKeys(left).every((field) => field === "body" ? sameTemplate(left.body, right.body, true) : sameTemplate(left[field], right[field]))) return null;
  // Keep native per-character action and run partitioning. No publication sharing.
  const result = ${tools}.deepClone(pair);
  const edits = retained ? [result[1].e[0]] : [];
  for (let index = 0; index < states.length; index++) {
    const state = states[prepend ? states.length - index - 1 : index];
    const inputEdits = state[key].actions[1].e;
    const insert = ${tools}.deepClone(left);
    insert.body.dataStream = inputEdits[inputEdits.length - 1].body.dataStream;
    edits.push(insert);
  }
  result[1].e = edits;
  return result;
}
${anchor}`).replace(
    '\tfunction composeRange(start, end) {',
    '\tconst uniform = uniformPlainInsertActions(states, key);\n\tif (uniform !== null) return uniform;\n\tfunction composeRange(start, end) {',
  );
}
