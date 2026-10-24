import { emptySearch, parseSearch } from './search.ts';
import type { SearchQuery } from './search.ts';

export const searchFilterFields = ['type', 'owner', 'tag', 'modified'] as const;
export type SearchFilterField = (typeof searchFilterFields)[number];
export type SearchInputResult = { ok: true; query: SearchQuery } | { ok: false; error: string };

const qualifier = /^(type|owner|tag|modified):/;
const whitespace = /\s/;

/** Double quotes group a value; only escaped quotes and backslashes are decoded. */
function valueAt(input: string, start: number): { value: string; end: number } {
  if (input[start] !== '"') {
    let end = start;
    while (end < input.length && !whitespace.test(input[end])) end++;
    return { value: input.slice(start, end), end };
  }
  let value = '';
  for (let end = start + 1; end < input.length; end++) {
    const char = input[end];
    if (char === '"') {
      if (end + 1 < input.length && !whitespace.test(input[end + 1]))
        throw new Error('Add a space after the closing quote.');
      return { value, end: end + 1 };
    }
    if (char === '\\' && (input[end + 1] === '"' || input[end + 1] === '\\')) {
      value += input[++end];
    } else value += char;
  }
  throw new Error('Finish the quoted value, or search this as plain text.');
}

/** Client-only notation retains the existing five fields and matching contract. */
export function parseSearchInput(input: string): SearchInputResult {
  const query = { ...emptySearch };
  const seen = new Set<SearchFilterField>();
  let text = '';
  let cursor = 0;
  let previousTextEnd: number | null = null;
  let hadToken = false;
  try {
    while (cursor < input.length) {
      const gapStart = cursor;
      while (cursor < input.length && whitespace.test(input[cursor])) cursor++;
      if (cursor === input.length) {
        if (previousTextEnd !== null || !hadToken) text += input.slice(gapStart);
        break;
      }
      const start = cursor;
      const match = qualifier.exec(input.slice(start));
      const field = match?.[1] as SearchFilterField | undefined;
      const { value, end } = valueAt(input, start + (match?.[0].length ?? 0));
      if (field) {
        if (seen.has(field)) throw new Error(`Use ${field}: once; remove the duplicate filter.`);
        if (!value.trim()) throw new Error(`Finish ${field}: with a value.`);
        if (value.length > 100) throw new Error(`${field}: accepts up to 100 characters.`);
        try {
          Object.assign(query, parseSearch({ ...query, [field]: value }));
        } catch {
          const choices =
            field === 'type'
              ? 'folder, sheet, doc or space'
              : field === 'owner'
                ? 'mine or shared'
                : 'day, week or month';
          throw new Error(`Use ${field}:${choices}.`);
        }
        seen.add(field);
        previousTextEnd = null;
      } else {
        // Keep whitespace within plain text; one separator replaces removed qualifiers.
        const gap =
          previousTextEnd !== null || !hadToken ? input.slice(gapStart, start) : text ? ' ' : '';
        text += gap + value;
        previousTextEnd = end;
      }
      cursor = end;
      hadToken = true;
    }
    if (text.length > 200) throw new Error('Search words accept up to 200 characters.');
    return { ok: true, query: parseSearch({ ...query, q: text }) };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : 'Check the search text.' };
  }
}

const quoted = (value: string) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

/** A literal query is quoted whenever reparsing it could consume a qualifier or punctuation. */
export function serializeSearchInput(value: SearchQuery): string {
  const query = parseSearch(value);
  const literal = /["\\\t\r\n]|\s{2}|(?:^|\s)(?:type|owner|tag|modified):/.test(query.q)
    ? quoted(query.q)
    : query.q;
  return [
    literal,
    ...searchFilterFields.flatMap((field) => {
      const value = query[field];
      return value ? [`${field}:${/[\s"\\]/.test(value) ? quoted(value) : value}`] : [];
    }),
  ]
    .filter(Boolean)
    .join(' ');
}

/** An explicit fallback retains every applied filter; it never truncates the literal text. */
export function searchInputAsPlainText(input: string, applied: SearchQuery): SearchInputResult {
  if (input.length > 200)
    return {
      ok: false,
      error: 'Plain-text search accepts up to 200 characters. Shorten the text first.',
    };
  try {
    return { ok: true, query: parseSearch({ ...applied, q: input }) };
  } catch {
    return { ok: false, error: 'Check the existing search filters before using plain text.' };
  }
}
