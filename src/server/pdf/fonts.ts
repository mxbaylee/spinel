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

/** Fixed, documented font substitutions. Never read system fonts or request a URL. */
export async function pdfFonts(snapshot: unknown): Promise<PreparedFont[]> {
  const requested = new Set<string>([PDF_DEFAULT_FAMILY.toLowerCase()]);
  const visit = (value: unknown, depth: number) => {
    if (depth > 64) throw new PdfError('limit');
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'ff' && typeof child === 'string' && child.trim())
        requested.add(child.trim().toLowerCase());
      else if (child && typeof child === 'object') visit(child, depth + 1);
    }
  };
  visit(snapshot, 0);
  const selected = families.filter((entry) =>
    [entry.family, ...entry.aliases].some((name) => requested.has(name.toLowerCase())),
  );
  const known = new Set(
    selected.flatMap((entry) => [entry.family, ...entry.aliases].map((name) => name.toLowerCase())),
  );
  known.add('noto sans symbols 2');
  if ([...requested].some((name) => !known.has(name))) throw new PdfError('unsupported');
  if (selected.length * 4 + 1 > PDF_LIMITS.fonts) throw new PdfError('limit');
  const faces = [
    { suffix: 'Regular', weight: 400 as const, italic: false },
    { suffix: 'Bold', weight: 700 as const, italic: false },
    { suffix: 'Italic', weight: 400 as const, italic: true },
    { suffix: 'BoldItalic', weight: 700 as const, italic: true },
  ];
  const fonts: PreparedFont[] = [];
  for (const entry of selected) {
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
