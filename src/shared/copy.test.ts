import { expect, test } from 'vitest';
import { defaultCopyName } from './copy.ts';

test('copy names retain the suffix within the existing limit and do not cut emoji in half', () => {
  expect(defaultCopyName('Budget')).toBe('Budget (copy)');
  expect(defaultCopyName('a'.repeat(120))).toBe('a'.repeat(113) + ' (copy)');
  expect(defaultCopyName('a'.repeat(112) + '🌷 more')).toBe('a'.repeat(112) + ' (copy)');
  expect(defaultCopyName('a'.repeat(111) + '🌷 more')).toBe('a'.repeat(111) + '🌷 (copy)');
});
