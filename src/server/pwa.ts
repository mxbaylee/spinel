import sharp from 'sharp';
import { Router } from 'express';
import { HEART, GEM_FACETS } from '../ui/gemGeometry.ts';
import { palettes } from '../ui/palette.ts';

export const manifest = {
  id: '/',
  name: 'Spinel',
  short_name: 'Spinel',
  description: 'Your private workspace for documents and spreadsheets.',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: palettes.light['sp-bg'],
  theme_color: palettes.light['sp-rail'],
  icons: [192, 512].map((size) => ({
    src: `/app-icon-${size}.png`,
    sizes: `${size}x${size}`,
    type: 'image/png',
    purpose: 'any maskable',
  })),
};

export function iconSvg() {
  const palette = palettes.light;
  // Keep the existing heart within the maskable icon's central safe circle.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${palette['sp-bg']}"/><defs><clipPath id="heart"><path d="${HEART}"/></clipPath></defs><g transform="translate(20 20) scale(.6)"><g clip-path="url(#heart)" stroke-width=".6" stroke-linejoin="round">${GEM_FACETS.map((facet) => `<path d="${facet.d}" fill="${palette[`gem-${facet.tone}`]}" stroke="${palette[`gem-${facet.tone}`]}"/>`).join('')}</g><path d="${HEART}" fill="none" stroke="${palette['gem-edge']}" stroke-width="3.2" stroke-linejoin="round"/></g></svg>`;
}

export function pwaRoutes() {
  const router = Router();
  router.get('/manifest.webmanifest', (_request, response) => {
    response.set('Cache-Control', 'no-cache').type('application/manifest+json').send(manifest);
  });
  // These three public buffers are the only retained data. No per-user icon or URL input.
  const icons = new Map<number, Promise<Buffer>>();
  for (const size of [180, 192, 512]) {
    router.get(`/app-icon-${size}.png`, async (_request, response) => {
      let icon = icons.get(size);
      if (!icon) {
        icon = sharp(Buffer.from(iconSvg())).resize(size, size).png().toBuffer();
        icons.set(size, icon);
        void icon.catch(() => icons.delete(size));
      }
      response
        .set('Cache-Control', 'public, max-age=86400')
        .type('png')
        .send(await icon);
    });
  }
  return router;
}
