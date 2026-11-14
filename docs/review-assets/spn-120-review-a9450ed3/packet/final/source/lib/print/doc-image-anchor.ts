/** Move one existing image anchor while retaining every authored character and text span. */
import type { IDocumentBody, ITextRun } from '@univerjs/core';
import { PrintError } from './contract.ts';

export function moveImageAnchor(
  body: IDocumentBody,
  id: string,
  start: number,
  check: () => void,
): void {
  const block = body.customBlocks?.find((entry) => entry.blockId === id);
  if (
    !block ||
    body.dataStream[block.startIndex] !== '\b' ||
    !Number.isSafeInteger(start) ||
    start > block.startIndex ||
    start < 0
  )
    throw new PrintError('unsupported', 'PDF image flow has no complete source anchor.');
  const from = block.startIndex;
  if (from === start) return;
  const position = (index: number) =>
    index === from ? start : index >= start && index < from ? index + 1 : index;
  // Prepared fields cannot include an image; other visible range formatting
  // has already been materialized in text runs before image-flow projection.
  for (const range of body.customRanges ?? []) {
    check();
    if (range.startIndex <= from && range.endIndex >= from)
      throw new PrintError('unsupported', 'PDF image flow cannot split a prepared field.');
    range.startIndex = position(range.startIndex);
    range.endIndex = position(range.endIndex);
  }
  const runs: ITextRun[] = [];
  for (const run of body.textRuns ?? []) {
    check();
    for (const [left, right, shift] of [
      [0, start, 0],
      [start, from, 1],
      [from, from + 1, start - from],
      [from + 1, body.dataStream.length, 0],
    ]) {
      const st = Math.max(run.st, left);
      const ed = Math.min(run.ed, right);
      if (st < ed) runs.push({ ...run, st: st + shift, ed: ed + shift });
    }
  }
  body.textRuns = runs.sort((a, b) => a.st - b.st);
  for (const item of body.customBlocks ?? []) {
    check();
    item.startIndex = position(item.startIndex);
  }
  body.renderedPageBreaks = body.renderedPageBreaks?.map(position);
  body.dataStream =
    body.dataStream.slice(0, start) +
    '\b' +
    body.dataStream.slice(start, from) +
    body.dataStream.slice(from + 1);
}
