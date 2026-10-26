import { CustomRangeType } from '@univerjs/core';
import type { ICustomRange, IDocumentData, ITextRun, ITextStyle } from '@univerjs/core';
import { PrintError } from './contract.ts';
import type { PrintLimits } from './contract.ts';

/** Materialize native link appearance without embedding destinations or account metadata. */
export function projectDocHyperlinks(
  snapshot: IDocumentData,
  limits: Readonly<PrintLimits>,
  check: () => void,
) {
  const body = snapshot.body!;
  const ranges = (body.customRanges ?? []) as (ICustomRange & { show?: boolean })[];
  const links = ranges.filter((range) => range?.rangeType === CustomRangeType.HYPERLINK);
  if (!links.length) return;
  const invalid = (): never => {
    throw new PrintError('invalid-input', 'Invalid PDF hyperlink range.');
  };
  if (ranges.length > limits.cells)
    throw new PrintError('limit', 'PDF hyperlinks exceed their layout budget.');
  const graphemes = new Set([0, body.dataStream.length]);
  for (const part of new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(body.dataStream))
    graphemes.add(part.index);
  if (ranges.some((range) => !range || typeof range !== 'object')) invalid();
  const ordered = [...ranges].sort((a, b) => a.startIndex - b.startIndex);
  let end = -1;
  const ids = new Set<string>();
  for (const range of ordered) {
    check();
    if (!range || typeof range.rangeId !== 'string' || !range.rangeId || ids.has(range.rangeId) ||
        !Number.isSafeInteger(range.startIndex) || !Number.isSafeInteger(range.endIndex) ||
        range.startIndex < 0 || range.endIndex < range.startIndex ||
        range.endIndex >= body.dataStream.length - 2 || range.startIndex <= end ||
        !graphemes.has(range.startIndex) || !graphemes.has(range.endIndex + 1)) invalid();
    ids.add(range.rangeId);
    end = range.endIndex;
    if (range.rangeType !== CustomRangeType.HYPERLINK) continue;
    if (range.show !== undefined && typeof range.show !== 'boolean') invalid();
    // Native hyperlinks wrap as text. A hidden atomic custom renderer needs its
    // own prepared geometry and must not be flattened into an ordinary link.
    if (range.wholeEntity || Object.keys(range).some((key) => key.startsWith('glyph'))) invalid();
    for (const key of ['textStyleMode', 'textColorMode']) {
      const mode = range.properties?.[key];
      if (mode !== undefined && mode !== 'text' && mode !== 'link') invalid();
    }
  }
  links.sort((a, b) => a.startIndex - b.startIndex);
  const cuts = new Set<number>();
  for (const run of body.textRuns ?? []) { cuts.add(run.st); cuts.add(run.ed); }
  for (const link of links) { cuts.add(link.startIndex); cuts.add(link.endIndex + 1); }
  const boundaries = [...cuts].sort((a, b) => a - b);
  const runs = body.textRuns ?? [];
  const result: ITextRun[] = [];
  let runIndex = 0;
  let linkIndex = 0;
  for (let index = 0; index + 1 < boundaries.length; index++) {
    check();
    const st = boundaries[index];
    const ed = boundaries[index + 1];
    while (runs[runIndex] && runs[runIndex].ed <= st) runIndex++;
    while (links[linkIndex] && links[linkIndex].endIndex < st) linkIndex++;
    const existing = runs[runIndex] && runs[runIndex].st <= st ? runs[runIndex] : undefined;
    const candidate = links[linkIndex];
    const link = candidate && candidate.startIndex <= st && candidate.endIndex >= ed - 1
      ? candidate : undefined;
    let style: ITextStyle | undefined = existing?.ts;
    if (link?.show !== false && link && link.properties?.textStyleMode !== 'text') {
      // Univer 1.1's native hyperlink is underlined and blue. Its light theme
      // blue.600 is materialized because the PDF owns no interactive theme service.
      style = { ...style, ul: { s: 1 }, ...(link.properties?.textColorMode === 'text'
        ? {} : { cl: { rgb: '#2563eb' } }) };
    }
    if (existing || style) result.push({ ...existing, st, ed, ts: style });
  }
  body.textRuns = result;
  body.customRanges = ranges.filter((range) => range.rangeType !== CustomRangeType.HYPERLINK);
}
