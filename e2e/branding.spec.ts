import { expect, test } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';

test('public identity assets load and preview clearly in light, dark and phone layouts', async ({
  page,
}, info) => {
  await page.goto('/sign-in');
  await expect(page).toHaveTitle('Spinel');
  const icon = page.locator('link[rel="icon"][type="image/svg+xml"]');
  await expect(icon).toHaveAttribute('href', '/favicon.svg');
  expect((await page.request.get((await icon.getAttribute('href'))!)).status()).toBe(200);
  const image = page.locator('meta[property="og:image"]');
  const imageUrl = (await image.getAttribute('content'))!;
  expect((await page.request.get(imageUrl)).status()).toBe(200);
  const database = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(database),
    workspace = new WorkspaceStore(auth);
  const owner = auth.createUser(`Branding ${info.testId}`);
  const cards = [
    {
      label: 'generic',
      image: '/social-preview.png',
      title: 'Spinel',
      description: 'Your private workspace for documents and spreadsheets.',
    },
  ];
  try {
    for (const [kind, label, name] of [
      ['doc', 'doc', 'Autumn recipes'],
      ['sheet', 'sheet', 'Our next adventure'],
      ['doc', 'emoji', '🥕 Autumn recipes 🍂'],
      ['sheet', 'long-word', 'Supercalifragilisticexpialidocious'.repeat(3)],
    ] as const) {
      const item = workspace.create(owner.id, { kind, name, parentId: null });
      const link = workspace.links.begin(item.id, 'viewer');
      workspace.links.finish(item.id, link.epoch, true);
      await page.goto(`/share/${item.id}?preview=${link.previewToken}`);
      await expect(page).toHaveTitle(`${name} — Spinel`);
      const description = await page.locator('meta[name="description"]').getAttribute('content');
      cards.push({
        label,
        image: (await page.locator('meta[property="og:image"]').getAttribute('content'))!,
        title: name,
        description: description!,
      });
    }
    // Review fixture only: actual public assets, not a new product/chat screen.
    for (const card of cards)
      for (const [name, width, background, ink] of [
        ['light', 960, '#fff5f2', '#4a1e33'],
        ['dark', 960, '#1a1225', '#ece2f7'],
        ['phone', 390, '#fff5f2', '#4a1e33'],
      ] as const) {
        await page.setViewportSize({ width, height: width === 390 ? 520 : 660 });
        await page.setContent(`<html><body style="margin:0;padding:32px;box-sizing:border-box;background:${background};color:${ink};font:16px system-ui">
        <p style="display:flex;align-items:center;gap:12px;margin:0 0 24px"><img src="/favicon.svg" width="16" height="16" alt="">Spinel · Browser icon at 16px</p>
        <img src="/favicon-32.png" width="32" height="32" alt="Spinel favicon at 32px">
        <figure style="margin:24px 0 0;border:1px solid ${ink}33;border-radius:16px;overflow:hidden">
        <img src="${card.image}" alt="${card.title} social card" style="display:block;width:100%">
        <figcaption style="padding:16px"><b>${card.title}</b><p style="margin:6px 0 0">${card.description}</p></figcaption></figure>
        </body></html>`);
        await page
          .locator('img')
          .evaluateAll(async (images) =>
            Promise.all(images.map((image) => (image as HTMLImageElement).decode())),
          );
        await page.screenshot({
          path: `test-results/theme-screenshots/branding-${card.label}-${name}-${info.project.name}.png`,
          fullPage: true,
        });
      }
  } finally {
    database.prepare('DELETE FROM workspace_items WHERE owner_id=?').run(owner.id);
    database.prepare('DELETE FROM auth_users WHERE id=?').run(owner.id);
    database.close();
  }
});
