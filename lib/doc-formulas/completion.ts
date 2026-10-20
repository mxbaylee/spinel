import type { FormulaReference } from './definition.ts';
export interface FormulaSourceOption {
  itemId: string;
  name: string;
}
export interface FormulaSheetOption {
  sheetId: string;
  name: string;
}
export interface FormulaCompletion {
  label: string;
  expression: string;
  cursor: number;
  start: number;
  source: FormulaSourceOption;
  sheet?: FormulaSheetOption;
  range?: string;
}
export function quoteFormulaName(name: string) {
  return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) ? name : `'${name.replaceAll("'", "''")}'`;
}
/** Preserve explicit picker identities only while their original reference text is unchanged. */
export function moveFormulaBindings(
  before: string,
  after: string,
  bindings: FormulaReference[],
): FormulaReference[] {
  let start = 0;
  while (start < Math.min(before.length, after.length) && before[start] === after[start]) start++;
  let tail = 0;
  while (
    tail < before.length - start &&
    tail < after.length - start &&
    before[before.length - tail - 1] === after[after.length - tail - 1]
  )
    tail++;
  const oldEnd = before.length - tail;
  const delta = after.length - before.length;
  return bindings.flatMap((binding) =>
    binding.end <= start
      ? [binding]
      : binding.start >= oldEnd
        ? [{ ...binding, start: binding.start + delta, end: binding.end + delta }]
        : [],
  );
}
export function completeFormula(
  expression: string,
  cursor: number,
  sources: FormulaSourceOption[],
  sheets: FormulaSheetOption[],
  selectedSource?: string,
): { source?: FormulaSourceOption; options: FormulaCompletion[] } {
  const before = expression.slice(0, cursor),
    suffix = expression.slice(cursor);
  let start = 1,
    quoted = false,
    string = false;
  for (let at = 1; at < before.length; at++) {
    if (before[at] === '"' && !quoted) {
      if (string && before[at + 1] === '"') at++;
      else string = !string;
    }
    if (string) continue;
    if (before[at] === "'") {
      if (quoted && before[at + 1] === "'") at++;
      else quoted = !quoted;
    }
    if (!quoted && '=,+-*/(){};'.includes(before[at]!)) start = at + 1;
  }
  if (string || (!quoted && /[)}]\s*$/.test(before))) return { options: [] };
  while (before[start] === ' ') start++;
  const token = before.slice(start),
    parts: string[] = [];
  let part = '',
    inQuote = false;
  for (let at = 0; at < token.length; at++) {
    const char = token[at]!;
    if (char === "'") {
      if (inQuote && token[at + 1] === "'") {
        part += "''";
        at++;
        continue;
      }
      inQuote = !inQuote;
    }
    if (char === '.' && !inQuote) {
      parts.push(part);
      part = '';
    } else part += char;
  }
  parts.push(part);
  const unquote = (name: string) => name.replace(/^'/, '').replace(/'$/, '').replaceAll("''", "'");
  const prefix = before.slice(0, start);
  const matching = sources.filter((source) => source.name === unquote(parts[0]!));
  const source =
    matching.find((entry) => entry.itemId === selectedSource) ??
    (matching.length === 1 ? matching[0] : undefined);
  const option = (
    source: FormulaSourceOption,
    value: string,
    label: string,
    sheet?: FormulaSheetOption,
    range?: string,
  ): FormulaCompletion => ({
    source,
    sheet,
    range,
    label,
    expression: prefix + value + suffix,
    cursor: prefix.length + value.length,
    start,
  });
  if (parts.length === 1)
    return {
      options: sources
        .filter((source) =>
          source.name.toLocaleLowerCase().startsWith(unquote(parts[0]!).toLocaleLowerCase()),
        )
        .map((source) =>
          option(
            source,
            `${quoteFormulaName(source.name)}.`,
            `${source.name}${sources.filter((entry) => entry.name === source.name).length > 1 ? ` (${source.itemId.slice(0, 8)})` : ''}`,
          ),
        )
        .slice(0, 8),
    };
  if (!source) return { options: [] };
  if (parts.length === 2)
    return {
      source,
      options: sheets
        .filter((sheet) =>
          sheet.name.toLocaleLowerCase().startsWith(unquote(parts[1]!).toLocaleLowerCase()),
        )
        .map((sheet) =>
          option(
            source,
            `${quoteFormulaName(source.name)}.${quoteFormulaName(sheet.name)}.`,
            sheet.name,
            sheet,
          ),
        )
        .slice(0, 8),
    };
  const sheet = sheets.find((sheet) => sheet.name === unquote(parts[1]!));
  if (
    parts.length !== 3 ||
    !sheet ||
    /^[A-Za-z]{1,3}[1-9]\d*(?::[A-Za-z]{1,3}[1-9]\d*)?$/.test(parts[2]!)
  )
    return { source, options: [] };
  return {
    source,
    options: ['A1', 'A1:C30']
      .filter((range) => range.startsWith(parts[2]!.toUpperCase()))
      .map((range) =>
        option(
          source,
          `${quoteFormulaName(source.name)}.${quoteFormulaName(sheet.name)}.${range}`,
          range,
          sheet,
          range,
        ),
      ),
  };
}
