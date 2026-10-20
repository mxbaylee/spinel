import { afterEach, expect, test, vi } from 'vitest';
import express from 'express';
import sharp from 'sharp';
import { openDatabase } from '../../server/database.ts';
import { AuthStore } from './auth/store.ts';
import { WorkspaceStore } from './workspace/store.ts';
import { socialPreviewRoutes, renderSharedCard } from './socialPreview.ts';
const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const close of cleanup.reverse()) await close();
  cleanup.length = 0;
  vi.restoreAllMocks();
});
async function fixture(render?: typeof renderSharedCard) {
  const db = openDatabase(':memory:');
  cleanup.push(() => db.close());
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth);
  const owner = auth.createUser('Private owner');
  const item = workspace.create(owner.id, { kind: 'doc', name: 'Summer recipes', parentId: null });
  const change = workspace.links.begin(item.id, 'viewer');
  workspace.links.finish(item.id, change.epoch, true);
  const app = express();
  app.use(socialPreviewRoutes(workspace.links, render));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((ready) => server.on('listening', ready));
  cleanup.push(
    () =>
      new Promise<void>((ready) => {
        server.close(() => ready());
        server.closeAllConnections();
      }),
  );
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  const url = `http://127.0.0.1:${address.port}/share/${item.id}/preview.png`;
  return { workspace, item, change, url };
}
test('personalized images use only authorized stored title/kind and are not cached', async () => {
  const f = await fixture();
  expect((await fetch(f.url)).status).toBe(404);
  expect((await fetch(`${f.url}?preview=${f.change.token}`)).status).toBe(404);
  const response = await fetch(
    `${f.url}?preview=${f.change.previewToken}&name=ATTACKER&kind=sheet`,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const bytes = Buffer.from(await response.arrayBuffer());
  expect(await sharp(bytes).metadata()).toMatchObject({ width: 1280, height: 640, format: 'png' });
  expect(bytes.equals(await renderSharedCard({ name: f.item.name, kind: 'doc' }))).toBe(true);
  const unusual = await renderSharedCard({
    name: '<b>R&D "Summer"</b> 🥕'.repeat(10),
    kind: 'sheet',
  });
  expect(await sharp(unusual).metadata()).toMatchObject({ width: 1280, height: 640 });
  // Several independent native renders include cold font initialization.
}, 15_000);
test('revoking during asynchronous rendering prevents the image response', async () => {
  const f = await fixture();
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const preview = f.workspace.links.preview.bind(f.workspace.links);
  vi.spyOn(f.workspace.links, 'preview').mockImplementation((...args) => {
    const result = preview(...args);
    entered();
    return result;
  });
  const pending = fetch(`${f.url}?preview=${f.change.previewToken}`);
  await started;
  const off = f.workspace.links.begin(f.item.id, null);
  f.workspace.links.finish(f.item.id, off.epoch, false);
  expect((await pending).status).toBe(404);
});

test('the renderer refuses excess concurrent work and releases slots after failure', async () => {
  let renders = 0,
    release!: () => void,
    entered!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const f = await fixture(async () => {
    renders++;
    if (renders <= 2) {
      if (renders === 2) entered();
      await held;
      throw new Error('Rendering failed');
    }
    return Buffer.from('test image');
  });
  const url = `${f.url}?preview=${f.change.previewToken}`;
  const first = fetch(url),
    second = fetch(url);
  await started;
  const excess = await fetch(url);
  expect(excess.status).toBe(503);
  expect(excess.headers.get('retry-after')).toBe('2');
  expect(renders).toBe(2);
  release();
  expect((await first).status).toBe(500);
  expect((await second).status).toBe(500);
  expect((await fetch(url)).status).toBe(200);
});

test('emoji titles contain colored glyphs instead of missing-character boxes', async () => {
  const png = await renderSharedCard({ name: '🥕', kind: 'doc' });
  const { data, info } = await sharp(png)
    .extract({ left: 80, top: 210, width: 680, height: 180 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let orangePixels = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const [red, green, blue] = data.subarray(offset, offset + 3);
    if (red > 160 && green > 50 && green < 180 && blue < 80) orangePixels++;
  }
  // A carrot needs orange pixels; plain text or a missing-glyph box has none.
  expect(orangePixels).toBeGreaterThan(100);
});
