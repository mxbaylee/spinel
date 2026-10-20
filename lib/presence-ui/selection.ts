export function parseBodySelection(selection: string) {
  const match = /^(\d+):(\d+):\d+:TEXT::-1$/.exec(selection);
  if (!match) return null;
  const startOffset = Number(match[1]),
    endOffset = Number(match[2]);
  return Number.isSafeInteger(startOffset) &&
    Number.isSafeInteger(endOffset) &&
    startOffset <= endOffset
    ? {
        startOffset,
        endOffset,
        collapsed: startOffset === endOffset,
        segmentId: '',
        segmentPage: -1,
      }
    : null;
}
