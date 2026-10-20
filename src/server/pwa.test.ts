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
    for (const size of [32, 180, 192, 512]) {
      const response = await fetch(
        `${origin}/${size === 32 ? 'favicon-32' : `app-icon-${size}`}.png`,
      );
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
    const svg = await fetch(`${origin}/favicon.svg`);
    expect(svg.headers.get('content-type')).toContain('image/svg+xml');
    expect(await svg.text()).toContain('viewBox="0 0 100 100"');
    const icoResponse = await fetch(`${origin}/favicon.ico`);
    expect(icoResponse.headers.get('content-type')).toContain('image/vnd.microsoft.icon');
    const ico = Buffer.from(await icoResponse.arrayBuffer());
    expect([...ico.subarray(0, 8)]).toEqual([0, 0, 1, 0, 1, 0, 32, 32]);
    expect(ico.readUInt32LE(14)).toBe(ico.length - 22);
    expect(ico.readUInt32LE(18)).toBe(22);
    expect(await sharp(ico.subarray(22)).metadata()).toMatchObject({ width: 32, height: 32 });
    const card = await fetch(`${origin}/social-preview.png?title=private-title-928`);
    expect(card.headers.get('content-type')).toContain('image/png');
    const bytes = Buffer.from(await card.arrayBuffer());
    expect(bytes.length).toBeLessThan(1_000_000);
    expect(await sharp(bytes).metadata()).toMatchObject({
      width: 1280,
      height: 640,
      format: 'png',
    });
    expect(
      bytes.equals(Buffer.from(await (await fetch(`${origin}/social-preview.png`)).arrayBuffer())),
    ).toBe(true);
    expect((await fetch(`${origin}/app-icon-8192.png`)).status).toBe(404);
  });
});
