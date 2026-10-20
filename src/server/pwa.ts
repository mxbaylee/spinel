import sharp from 'sharp';
import { Router } from 'express';
import { iconSvg } from '../ui/appIcon.ts';
import { fileURLToPath } from 'node:url';
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

export function pwaRoutes() {
  const router = Router();
  router.get('/manifest.webmanifest', (_request, response) => {
    response.set('Cache-Control', 'no-cache').type('application/manifest+json').send(manifest);
  });
  router.get('/favicon.svg', (_request, response) => {
    response.set('Cache-Control', 'public, max-age=86400').type('image/svg+xml').send(iconSvg());
  });
  router.get('/social-preview.png', (_request, response) => {
    response
      .set('Cache-Control', 'public, max-age=86400')
      .sendFile(fileURLToPath(new URL('../ui/social-preview.png', import.meta.url)));
  });
  // These fixed public buffers are the only retained data. No per-user icon or URL input.
  const icons = new Map<number, Promise<Buffer>>();
  for (const size of [32, 180, 192, 512]) {
    router.get(
      size === 32 ? ['/favicon-32.png', '/favicon.ico'] : `/app-icon-${size}.png`,
      async (request, response) => {
        let icon = icons.get(size);
        if (!icon) {
          icon = sharp(Buffer.from(iconSvg())).resize(size, size).png().toBuffer();
          icons.set(size, icon);
          void icon.catch(() => icons.delete(size));
        }
        const png = await icon;
        if (request.path === '/favicon.ico') {
          // One 32px PNG entry in the standard ICO container; no extra encoder dependency.
          const header = Buffer.alloc(22);
          header.writeUInt16LE(1, 2);
          header.writeUInt16LE(1, 4);
          header[6] = header[7] = 32;
          header.writeUInt16LE(1, 10);
          header.writeUInt16LE(32, 12);
          header.writeUInt32LE(png.length, 14);
          header.writeUInt32LE(22, 18);
          response
            .set('Cache-Control', 'public, max-age=86400')
            .type('image/vnd.microsoft.icon')
            .send(Buffer.concat([header, png]));
          return;
        }
        response.set('Cache-Control', 'public, max-age=86400').type('png').send(png);
      },
    );
  }
  return router;
}
