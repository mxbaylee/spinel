/** Match the existing 120 UTF-16-unit file-name budget without splitting a surrogate pair. */
export function defaultCopyName(source: string): string {
  const suffix = ' (copy)';
  let stem = source.slice(0, 120 - suffix.length);
  if (/[\uD800-\uDBFF]$/.test(stem)) stem = stem.slice(0, -1);
  return stem + suffix;
}
