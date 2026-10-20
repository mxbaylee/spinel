import { readFile } from 'node:fs/promises';
import { renderSharedCard } from '../src/server/socialPreview.ts';

// Build-time only: the deployed catalogue receives PNGs, never server modules.
export async function socialCardExamples() {
  const cards: Record<string, string> = {};
  const png = (bytes: Buffer) => `data:image/png;base64,${bytes.toString('base64')}`;
  cards.generic = png(await readFile(new URL('../src/ui/social-preview.png', import.meta.url)));
  for (const [key, kind, name] of [
    ['doc', 'doc', 'Autumn recipes'],
    ['sheet', 'sheet', 'Our next adventure'],
    ['emoji', 'doc', '🥕 Autumn recipes 🍂'],
    [
      'longTitle',
      'doc',
      'Our wonderfully ambitious autumn holiday meal planning and favorite family recipes for everyone',
    ],
    ['longWord', 'sheet', 'Supercalifragilisticexpialidocious'.repeat(3)],
  ] as const) {
    cards[key] = png(await renderSharedCard({ name, kind }));
  }
  return cards;
}
