import { expect, test } from 'vitest';
import { emptySearch, parseSearch, searchCatalog, searchItems } from './search.ts';
import type { SearchQuery } from './search.ts';
import {
  parseSearchInput,
  searchFilterFields,
  searchInputAsPlainText,
  serializeSearchInput,
} from './searchInput.ts';

test('plain text and all qualifiers produce only the existing server fields', () => {
  expect(
    parseSearchInput('budget annual type:sheet owner:shared tag:"summer travel" modified:week'),
  ).toEqual({
    ok: true,
    query: {
      q: 'budget annual',
      type: 'sheet',
      owner: 'shared',
      tag: 'summer travel',
      modified: 'week',
    },
  });
  expect(parseSearchInput('budget  annual')).toEqual({
    ok: true,
    query: { ...emptySearch, q: 'budget  annual' },
  });
  expect(parseSearchInput('type:sheet budget tag:travel annual')).toEqual({
    ok: true,
    query: { ...emptySearch, q: 'budget annual', type: 'sheet', tag: 'travel' },
  });
});

test('literal colons, unknown keys and quoted qualifier text remain title/path/tag words', () => {
  for (const text of ['https://example.test/plan', 'note:travel', 'q:budget', 'Type:sheet']) {
    expect(parseSearchInput(text)).toEqual({ ok: true, query: { ...emptySearch, q: text } });
  }
  expect(parseSearchInput('"type:sheet" owner:shared')).toEqual({
    ok: true,
    query: { ...emptySearch, q: 'type:sheet', owner: 'shared' },
  });
  expect(parseSearchInput(String.raw`tag:"summer \"trip\""`)).toEqual({
    ok: true,
    query: { ...emptySearch, tag: 'summer "trip"' },
  });
  expect(parseSearchInput(String.raw`tag:"C:\\notes"`)).toEqual({
    ok: true,
    query: { ...emptySearch, tag: 'C:\\notes' },
  });
});

test.each([
  'type:',
  'type: sheet',
  'type:slides',
  'owner:admin',
  'modified:forever',
  'tag:""',
  'tag:"unfinished',
  '"unfinished',
  '"word"suffix',
  'type:sheet type:doc',
  'type:sheet type:sheet',
  'tag:travel tag:work',
  'owner:mine owner:shared',
  'modified:day modified:week',
])('invalid draft %s yields no partial query that could discard a constraint', (text) => {
  const result = parseSearchInput(text);
  expect(result.ok).toBe(false);
  expect(result).not.toHaveProperty('query');
  expect(result).toHaveProperty('error', expect.any(String));
});

test('limits apply to decoded fields rather than the whole query-builder string', () => {
  const query: SearchQuery = {
    q: 'q'.repeat(200),
    tag: 't'.repeat(100),
    type: 'space',
    owner: 'shared',
    modified: 'month',
  };
  const encoded = serializeSearchInput(query);
  expect(encoded.length).toBeGreaterThan(300);
  expect(parseSearchInput(encoded)).toEqual({ ok: true, query });
  const escaped = { ...query, q: '"'.repeat(200), tag: '\\'.repeat(100) };
  expect(parseSearchInput(serializeSearchInput(escaped))).toEqual({ ok: true, query: escaped });
  expect(parseSearchInput(`"${'q'.repeat(201)}" type:sheet`)).toMatchObject({ ok: false });
  expect(parseSearchInput(`tag:"${'t'.repeat(101)}"`)).toMatchObject({ ok: false });
  expect(() => serializeSearchInput({ ...query, q: 'q'.repeat(201) })).toThrow();
});

test('options and individual chip removal round-trip without consuming literal qualifiers', () => {
  const applied: SearchQuery = {
    ...emptySearch,
    q: 'find type:sheet "quoted" C:\\notes  today',
    type: 'doc',
    owner: 'shared',
    tag: 'summer "trip" \\ planning',
    modified: 'month',
  };
  expect(parseSearchInput(serializeSearchInput(applied))).toEqual({ ok: true, query: applied });
  for (const field of searchFilterFields) {
    const removed = { ...applied, [field]: '' };
    expect(parseSearchInput(serializeSearchInput(removed))).toEqual({ ok: true, query: removed });
  }
  for (const q of [
    'word',
    'type:sheet',
    'before tag:travel after',
    'a\tb',
    'a\nb',
    'a  b',
    'a"b',
    'C:\\tmp',
  ]) {
    const query = parseSearch({ ...applied, q });
    expect(parseSearchInput(serializeSearchInput(query))).toEqual({ ok: true, query });
  }
});

test('explicit plain-text fallback retains every applied filter and refuses truncation', () => {
  const applied: SearchQuery = {
    q: 'old text',
    type: 'sheet',
    owner: 'shared',
    tag: 'travel',
    modified: 'week',
  };
  expect(searchInputAsPlainText('type:doc type:sheet', applied)).toEqual({
    ok: true,
    query: { ...applied, q: 'type:doc type:sheet' },
  });
  const long = searchInputAsPlainText('x'.repeat(201), applied);
  expect(long.ok).toBe(false);
  expect(long).not.toHaveProperty('query');
  expect(applied.q).toBe('old text');
});

test('quoted literal qualifiers retain existing matching and ownership restrictions', () => {
  const parsed = parseSearchInput('"type:sheet" owner:shared');
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.error);
  const catalog = searchCatalog([
    {
      id: 'literal',
      name: 'Notes type:sheet',
      kind: 'doc' as const,
      parentId: null,
      access: 'viewer' as const,
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'mine',
      name: 'Notes type:sheet',
      kind: 'doc' as const,
      parentId: null,
      access: 'owner' as const,
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'other',
      name: 'A sheet',
      kind: 'sheet' as const,
      parentId: null,
      access: 'viewer' as const,
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    },
  ]);
  expect(searchItems(catalog, parsed.query, 1).map(({ id }) => id)).toEqual(['literal']);
});
