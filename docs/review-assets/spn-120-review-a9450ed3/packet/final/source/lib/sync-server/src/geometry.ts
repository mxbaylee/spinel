/** Shared native range paths for admission and touched-cell enumeration.
 * No field inside a cell, rich-text body or opaque metadata is Sheet geometry. */
export function sheetRangePath(path: string[]): 'container' | 'ranges' | 'range' | undefined {
  if (!path.length) return 'container';
  if (path.length === 1) {
    if (/^(range|sourceRange|targetRange|fromRange|toRange)$/.test(path[0])) return 'range';
    if (path[0] === 'ranges') return 'ranges';
    if (path[0] === 'sheet' || path[0] === 'values') return 'container';
  }
  if (path.length === 2 && path[0] === 'ranges') return 'range';
  if (path[0] === 'sheet' && path[1] === 'mergeData') {
    if (path.length === 2) return 'ranges';
    if (path.length === 3) return 'range';
  }
  if (path[0] === 'values') {
    if (path.length === 2) return 'container';
    if (path[2] === 'ranges') {
      if (path.length === 3) return 'ranges';
      if (path.length === 4) return 'range';
    }
  }
}
