import { readFile } from 'node:fs/promises';
import type { PreparedFont } from '@spinel/print';
import { PDF_LIMITS, PdfError } from './limits.ts';

const base = new URL('./fonts/', import.meta.url);
const liberationSource =
  'https://github.com/liberationfonts/liberation-fonts/files/7261482/liberation-fonts-ttf-2.1.5.tar.gz';
const googleSource =
  'https://github.com/google/fonts/tree/95f4904fc8bcf26d3420fe315560c96417c6dec7/ofl/';
const families = [
  {
    family: 'Liberation Sans',
    file: 'LiberationSans',
    aliases: [
      'Arial',
      'Helvetica',
      'Arial Unicode MS',
      'Roboto',
      'Aptos',
      'Calibri',
      'Verdana',
      'Tahoma',
      'Trebuchet MS',
      'system-ui',
      'sans-serif',
    ],
    license: 'Liberation-OFL.txt',
    source: liberationSource,
  },
  {
    family: 'Liberation Serif',
    file: 'LiberationSerif',
    aliases: ['Times New Roman', 'Times', 'Cambria', 'Georgia', 'serif'],
    license: 'Liberation-OFL.txt',
    source: liberationSource,
  },
  {
    family: 'Liberation Mono',
    file: 'LiberationMono',
    aliases: ['Courier New', 'Courier', 'Consolas', 'Menlo', 'Monaco', 'monospace'],
    license: 'Liberation-OFL.txt',
    source: liberationSource,
  },
  {
    family: 'Atkinson Hyperlegible',
    file: 'AtkinsonHyperlegible',
    aliases: [],
    license: 'Atkinson-OFL.txt',
    source: `${googleSource}atkinsonhyperlegible`,
  },
] as const;

export const PDF_DEFAULT_FAMILY = 'Liberation Sans';
export const PDF_FALLBACK_FAMILIES = ['Noto Sans Symbols 2'];

/**
 * Fixed licensed bank; never inspect stored styles, system fonts or a URL.
 * The renderer resolves families against actual selected text. An unused style,
 * hidden cell or unselected sheet must not veto another part of the document.
 */
export async function pdfFonts(): Promise<PreparedFont[]> {
  if (families.length * 4 + 1 > PDF_LIMITS.fonts) throw new PdfError('limit');
  const faces = [
    { suffix: 'Regular', weight: 400 as const, italic: false },
    { suffix: 'Bold', weight: 700 as const, italic: false },
    { suffix: 'Italic', weight: 400 as const, italic: true },
    { suffix: 'BoldItalic', weight: 700 as const, italic: true },
  ];
  const fonts: PreparedFont[] = [];
  for (const entry of families) {
    const text = await readFile(new URL(entry.license, base), 'utf8');
    for (const face of faces)
      fonts.push({
        family: entry.family,
        aliases: entry.aliases,
        weight: face.weight,
        italic: face.italic,
        bytes: await readFile(new URL(`${entry.file}-${face.suffix}.ttf`, base)),
        license: { identifier: 'OFL-1.1', text, source: entry.source },
      });
  }
  fonts.push({
    family: 'Noto Sans Symbols 2',
    weight: 400,
    italic: false,
    bytes: await readFile(new URL('NotoSansSymbols2-Regular.ttf', base)),
    license: {
      identifier: 'OFL-1.1',
      text: await readFile(new URL('NotoSymbols-OFL.txt', base), 'utf8'),
      source: `${googleSource}notosanssymbols2`,
    },
  });
  return fonts;
}
