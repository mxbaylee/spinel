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
  let text = "";
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
    text = prepend ? body.dataStream + text : text + body.dataStream;
  }
  const pair = ${json}.compose(states[0][key].actions, states[1][key].actions);
  if (!Array.isArray(pair) || pair.length !== 2 || pair[0] !== "body" || pair[1].et !== "text-x") return null;
  const pairEdits = pair[1].e;
  const pairInsert = pairEdits[pairEdits.length - 1];
  const secondBody = secondEdits[secondEdits.length - 1].body;
  const pairText = prepend ? secondBody.dataStream + firstBody.dataStream : firstBody.dataStream + secondBody.dataStream;
  if (pairEdits.length !== firstEdits.length || offset(pairEdits) !== offset(firstEdits) || pairInsert.t !== "i" || pairInsert.len !== 2 || pairInsert.body.dataStream !== pairText) return null;
  const pairRuns = pairInsert.body.textRuns;
  if (firstRun) {
    if (!Array.isArray(pairRuns) || pairRuns.length !== 1 || pairRuns[0].st !== 0 || pairRuns[0].ed !== 2 || !samePlainOwnShape(firstRun, pairRuns[0]) || !samePlainStyle(firstRun.ts, pairRuns[0].ts)) return null;
  } else if (pairRuns !== void 0 && pairRuns.length !== 0) return null;
  // Independently own the result of each history/collaboration composition.
  const result = ${tools}.deepClone(pair);
  const resultEdits = result[1].e;
  const resultInsert = resultEdits[resultEdits.length - 1];
  resultInsert.len = states.length;
  resultInsert.body.dataStream = text;
  if (firstRun) resultInsert.body.textRuns[0].ed = states.length;
  return result;
}
${anchor}`).replace(
    '\tfunction composeRange(start, end) {',
    '\tconst uniform = uniformPlainInsertActions(states, key);\n\tif (uniform !== null) return uniform;\n\tfunction composeRange(start, end) {',
  );
}
