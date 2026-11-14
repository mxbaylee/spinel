import { expect, test } from 'vitest';
import { pdfFonts, PDF_DEFAULT_FAMILY, PDF_FALLBACK_FAMILIES } from './fonts.ts';
import { PDF_LIMITS } from './limits.ts';

test('the fixed licensed bank fits its face and unchanged byte budgets', async () => {
  const fonts = await pdfFonts();
  expect(fonts).toHaveLength(17);
  expect(fonts.length).toBeLessThanOrEqual(PDF_LIMITS.fonts);
  expect(fonts.reduce((sum, font) => sum + font.bytes.byteLength, 0)).toBeLessThanOrEqual(
    PDF_LIMITS.fontBytes,
  );
  const names = new Set(fonts.map((font) => font.family));
  expect(names).toEqual(
    new Set([
      'Liberation Sans',
      'Liberation Serif',
      'Liberation Mono',
      'Atkinson Hyperlegible',
      'Noto Sans Symbols 2',
    ]),
  );
  for (const family of [PDF_DEFAULT_FAMILY, ...PDF_FALLBACK_FAMILIES])
    expect(names.has(family)).toBe(true);
  for (const font of fonts) {
    expect(font.bytes.byteLength).toBeGreaterThan(1_000);
    expect(font.license.identifier).toBe('OFL-1.1');
    expect(font.license.text).toContain('SIL OPEN FONT LICENSE');
  }
});
