import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import sharp from 'sharp';
import type { Server } from 'node:http';
import { pwaRoutes } from './pwa.ts';

let server: Server | undefined;
afterEach(async () => {
  if (server)
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => (error ? reject(error) : resolve()));
      server!.closeAllConnections();
    });
});
describe('public installation assets', () => {
  it('serves a fixed credential-free manifest and only bounded PNG icon sizes', async () => {
    const app = express();
    app.use(pwaRoutes());
    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, '127.0.0.1', (error) => (error ? reject(error) : resolve()));
    });
    const address = server!.address();
    if (!address || typeof address === 'string') throw new Error('No test port');
    const origin = `http://127.0.0.1:${address.port}`;
    const manifestResponse = await fetch(
      `${origin}/manifest.webmanifest?item=private-title-928&token=secret-token-571`,
    );
    expect(manifestResponse.headers.get('content-type')).toContain('application/manifest+json');
    const manifest = await manifestResponse.json();
    expect(manifest).toMatchObject({
      id: '/',
      start_url: '/',
      scope: '/',
      name: 'Spinel',
      display: 'standalone',
    });
    expect(JSON.stringify(manifest)).not.toMatch(/private-title-928|secret-token-571/);
    expect(manifest.icons).toHaveLength(2);
    for (const size of [180, 192, 512]) {
      const response = await fetch(`${origin}/app-icon-${size}.png`);
      expect(response.ok).toBe(true);
      expect(response.headers.get('content-type')).toContain('image/png');
      const icon = Buffer.from(await response.arrayBuffer());
      expect(icon.length).toBeLessThan(100_000);
      expect(await sharp(icon).metadata()).toMatchObject({
        width: size,
        height: size,
        format: 'png',
      });
    }
    expect((await fetch(`${origin}/app-icon-8192.png`)).status).toBe(404);
  });
});
