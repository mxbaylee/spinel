/** Exact public structural range emitted by InsertDocumentColumnBreakCommand. */
import { CustomRangeType, DocxBreakType } from '@univerjs/core';
import type { ICustomRange, IDocumentData } from '@univerjs/core';
import { PrintError } from './contract.ts';
import type { PrintLimits } from './contract.ts';

export function isDocColumnBreak(range: ICustomRange): boolean {
  return (
    range.rangeType === CustomRangeType.CUSTOM &&
    range.wholeEntity === true &&
    range.startIndex === range.endIndex &&
    range.properties?.breakType === DocxBreakType.COLUMN
  );
}

export function docColumnBreak(position: number, id: string): ICustomRange {
  return {
    startIndex: position,
    endIndex: position,
    rangeId: id,
    rangeType: CustomRangeType.CUSTOM,
    wholeEntity: true,
    properties: { breakType: DocxBreakType.COLUMN },
  };
}

export function prepareDocColumnBreaks(
  snapshot: IDocumentData,
  limits: Readonly<PrintLimits>,
  check: () => void,
) {
  const body = snapshot.body!;
  const ranges = body.customRanges ?? [];
  if (ranges.length > limits.cells)
    throw new PrintError('limit', 'PDF ranges exceed their layout budget.');
  const ids = new Set<string>();
  const structural: { range: ICustomRange; index: number }[] = [];
  for (const [index, range] of ranges.entries()) {
    check();
    if (!range || typeof range.rangeId !== 'string' || !range.rangeId || ids.has(range.rangeId))
      throw new PrintError('invalid-input', 'Invalid PDF structural range.');
    ids.add(range.rangeId);
    if (range.properties?.breakType === undefined) continue;
    if (
      !isDocColumnBreak(range) ||
      !Number.isSafeInteger(range.startIndex) ||
      range.startIndex < 0 ||
      body.dataStream[range.startIndex] !== '\v' ||
      Object.keys(range.properties ?? {}).some((key) => key !== 'breakType') ||
      Object.keys(range).some(
        (key) =>
          !['startIndex', 'endIndex', 'rangeId', 'rangeType', 'wholeEntity', 'properties'].includes(
            key,
          ),
      )
    )
      throw new PrintError('unsupported', 'PDF structural range is not a native column break.');
    structural.push({ range, index });
  }
  let cursor = 0;
  let nesting = 0;
  for (const { range, index } of structural.sort(
    (a, b) => a.range.startIndex - b.range.startIndex,
  )) {
    while (cursor < range.startIndex) {
      check();
      if (body.dataStream[cursor] === '\x1a') nesting++;
      else if (body.dataStream[cursor] === '\x0f') nesting--;
      cursor++;
    }
    if (nesting)
      throw new PrintError('unsupported', 'PDF structural range is not a native column break.');
    ranges[index] = docColumnBreak(range.startIndex, `print-column-break-${index}`);
  }
}
