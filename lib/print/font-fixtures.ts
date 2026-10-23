import { readFile } from 'node:fs/promises';
import type { PreparedFont } from './contract.ts';

/** Test-only prepared faces; production callers must choose and license their own font set. */
export async function fixtureFonts(): Promise<PreparedFont[]> {
  const base = new URL('./test-fixtures/fonts/', import.meta.url);
  const atkinsonLicense = await readFile(new URL('Atkinson-OFL.txt', base), 'utf8');
  const symbolsLicense = await readFile(new URL('NotoSymbols-OFL.txt', base), 'utf8');
  const faces = [
    { suffix: 'Regular', weight: 400 as const, italic: false },
    { suffix: 'Bold', weight: 700 as const, italic: false },
    { suffix: 'Italic', weight: 400 as const, italic: true },
    { suffix: 'BoldItalic', weight: 700 as const, italic: true },
  ];
  const fonts: PreparedFont[] = [];
  for (const face of faces) fonts.push({
    family: 'Atkinson Hyperlegible', weight: face.weight, italic: face.italic,
    bytes: await readFile(new URL(`AtkinsonHyperlegible-${face.suffix}.ttf`, base)),
    license: { identifier: 'OFL-1.1', text: atkinsonLicense, source: 'https://github.com/google/fonts/tree/95f4904fc8bcf26d3420fe315560c96417c6dec7/ofl/atkinsonhyperlegible' },
  });
  fonts.push({ family: 'Noto Sans Symbols 2', weight: 400, italic: false,
    bytes: await readFile(new URL('NotoSansSymbols2-Regular.ttf', base)),
    license: { identifier: 'OFL-1.1', text: symbolsLicense, source: 'https://github.com/google/fonts/tree/95f4904fc8bcf26d3420fe315560c96417c6dec7/ofl/notosanssymbols2' },
  });
  return fonts;
}
