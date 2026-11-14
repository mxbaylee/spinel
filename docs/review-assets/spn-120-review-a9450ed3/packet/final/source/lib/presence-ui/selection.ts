/** Parse the cursor-only Sheet wire format; reject unsupported or unsafe addresses. */
export function parseSheetSelection(value: string) {
  const separator = value.lastIndexOf('!');
  if (separator < 1) return;
  const sheetId = value.slice(0, separator),
    address = value.slice(separator + 1);
  if (!/^[A-Z]+[1-9]\d*(?::[A-Z]+[1-9]\d*)?$/.test(address)) return;
  if (address.split(':').some((cell) => !Number.isSafeInteger(Number(cell.replace(/^[A-Z]+/, '')))))
    return;
  return { sheetId, address };
}

/** Body insertion offsets only: headers, footers and table rectangles are not guessed. */
export function parseDocSelection(value: string, bodyLength: number) {
  const match = /^(\d+):(\d+):\d+:TEXT::-1$/.exec(value);
  if (!match || !Number.isSafeInteger(bodyLength) || bodyLength < 2) return;
  const startOffset = Number(match[1]);
  const endOffset = Number(match[2]);
  if (
    !Number.isSafeInteger(startOffset) ||
    !Number.isSafeInteger(endOffset) ||
    startOffset > endOffset ||
    endOffset > bodyLength - 2
  )
    return;
  return { startOffset, endOffset };
}

/** Header selections use NaN for their unbounded axis in Univer's public range. */
export function boundedSheetRange(
  range: { startRow: number; endRow: number; startColumn: number; endColumn: number },
  rows: number,
  columns: number,
) {
  return {
    startRow: Number.isFinite(range.startRow) ? Math.max(0, range.startRow) : 0,
    endRow: Number.isFinite(range.endRow) ? Math.min(rows - 1, range.endRow) : rows - 1,
    startColumn: Number.isFinite(range.startColumn) ? Math.max(0, range.startColumn) : 0,
    endColumn: Number.isFinite(range.endColumn)
      ? Math.min(columns - 1, range.endColumn)
      : columns - 1,
  };
}
