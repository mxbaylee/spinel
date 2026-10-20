import { expect, test } from '@playwright/test';

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
  // Review fixture only: actual served assets at social-card and favicon sizes.
  // This is not a new product screen or an imitation of any particular chat app.
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
      <img src="/social-preview.png" alt="Spinel social card" style="display:block;width:100%">
      <figcaption style="padding:16px"><b>Spinel</b><p style="margin:6px 0 0">Your private workspace for documents and spreadsheets.</p></figcaption></figure>
      </body></html>`);
    await page
      .locator('img')
      .evaluateAll(async (images) =>
        Promise.all(images.map((image) => (image as HTMLImageElement).decode())),
      );
    await page.screenshot({
      path: `test-results/theme-screenshots/branding-${name}-${info.project.name}.png`,
      fullPage: true,
    });
  }
});
