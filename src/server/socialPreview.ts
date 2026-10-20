import { Router } from 'express';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import type { LinkAccess } from './workspace/links.ts';
import { palettes } from '../ui/palette.ts';
import { escapeMarkup } from '../shared/markup.ts';

const palette = palettes.light;
const base = fileURLToPath(new URL('../ui/social-preview.png', import.meta.url));
const font = fileURLToPath(new URL('../ui/fonts/AtkinsonHyperlegible-Bold.ttf', import.meta.url));
const emojiFont = fileURLToPath(new URL('../ui/fonts/NotoColorEmoji.ttf', import.meta.url));

export async function renderSharedCard(item: { name: string; kind: 'doc' | 'sheet' }) {
  // A bounded title area; the full title remains in HTML metadata.
  const text = Array.from(item.name, (character) => {
    const code = character.codePointAt(0)!;
    return code < 32 || code === 127 ? ' ' : character;
  }).join('');
  const characters = Array.from(new Intl.Segmenter().segment(text), (part) => part.segment);
  const name = characters.length > 64 ? characters.slice(0, 63).join('') + '…' : text;
  const kind = await sharp({
    text: {
      text: `<span foreground="${palette['sp-muted']}">${item.kind === 'sheet' ? 'Spreadsheet' : 'Document'} · Shared on Spinel</span>`,
      font: 'Atkinson Hyperlegible Bold 28',
      fontfile: font,
      rgba: true,
    },
  })
    .png()
    .toBuffer();
  // Register both bundled fonts before title layout, including emoji fallback.
  const title = await sharp({
    text: {
      text: `<span foreground="${palette['sp-text']}">${escapeMarkup(name)}</span>`,
      font: 'Atkinson Hyperlegible,Noto Color Emoji Bold 72',
      fontfile: emojiFont,
      width: 680,
      height: 180,
      rgba: true,
      wrap: 'word-char',
    },
  })
    .png()
    .toBuffer();
  return sharp(base)
    .composite([
      {
        input: Buffer.from(
          `<svg width="680" height="310"><rect width="680" height="310" fill="${palette['sp-bg']}"/></svg>`,
        ),
        left: 60,
        top: 180,
      },
      { input: title, left: 80, top: 210 },
      { input: kind, left: 80, top: 426 },
    ])
    .png()
    .toBuffer();
}

export function socialPreviewRoutes(links: LinkAccess, render = renderSharedCard) {
  const router = Router();
  let rendering = 0;
  router.get('/share/:id/preview.png', async (request, response) => {
    response.set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex',
    });
    const current = () => links.preview(request.params.id, request.query.preview);
    const item = current();
    if (!item) {
      response.sendStatus(404);
      return;
    }
    // No queue or per-link cache: bound native image work on the 2GB host.
    if (rendering >= 2) {
      response.set('Retry-After', '2').sendStatus(503);
      return;
    }
    rendering++;
    try {
      const png = await render(item);
      const latest = current();
      if (!latest || latest.name !== item.name || latest.kind !== item.kind) {
        response.sendStatus(404);
        return;
      }
      response.type('png').send(png);
    } catch {
      response.sendStatus(500);
    } finally {
      rendering--;
    }
  });
  return router;
}
