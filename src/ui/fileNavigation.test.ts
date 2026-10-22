import { expect, test } from 'vitest';
import { rememberFileView, rememberedFileHref } from '../../web/fileNavigation.ts';

test('My files return is account-scoped and accepts only ordinary IDs or the Trash view', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const id = '12345678-1234-1234-1234-123456789abc';
  rememberFileView('owner', id, storage);
  rememberFileView('collaborator', 'trash', storage);
  expect(rememberedFileHref('owner', storage)).toBe('/?item=' + id);
  expect(rememberedFileHref('collaborator', storage)).toBe('/?trash=1');
  expect(rememberedFileHref('different-account', storage)).toBe('/');
  rememberFileView('owner', 'https://unrelated.invalid', storage);
  expect(rememberedFileHref('owner', storage)).toBe('/');
  expect(
    rememberedFileHref('owner', { getItem: () => '/review/spaces/secret', setItem: () => {} }),
  ).toBe('/');
});

test('unavailable browser storage cannot block returning to My files', () => {
  const storage = {
    getItem: (): string => {
      throw new Error('Unavailable');
    },
    setItem: () => {
      throw new Error('Unavailable');
    },
  };
  expect(() => rememberFileView('owner', 'trash', storage)).not.toThrow();
  expect(rememberedFileHref('owner', storage)).toBe('/');
});
