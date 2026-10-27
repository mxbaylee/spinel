import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { AppearanceStore } from '../src/server/appearance/store.ts';
for (const variant of [
  { name: 'light', width: 1440, height: 1000 },
  { name: 'dark', width: 1440, height: 1000 },
  { name: 'phone-light', width: 390, height: 844 },
  { name: 'phone-dark', width: 390, height: 844 },
]) {
  test(`personalization persists and cover controls remain stable ${variant.name}`, async ({
    page,
    context,
    baseURL,
  }, info) => {
    test.setTimeout(120_000);
    const db = openDatabase(`test-results/${info.project.name}/app.sqlite`),
      auth = new AuthStore(db),
      workspace = new WorkspaceStore(auth);
    const owner = auth.createUser('Iris Garden');
    const item = workspace.create(owner.id, {
      name: 'Field notes',
      kind: 'doc',
      parentId: null,
      icon: '🌷',
    });
    await new AppearanceStore(workspace).update({ userId: owner.id, customData: {} }, item.id, {
      revision: 1,
      cover: { source: 'gem', gem: 'spinel' },
    });
    await context.addCookies([
      {
        name: COOKIE_NAME,
        value: auth.createSession(owner.id).token,
        url: baseURL!.replace('http:', 'https:'),
        secure: true,
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
    await page.setViewportSize({ width: variant.width, height: variant.height });
    await page.addInitScript(
      (theme) => localStorage.setItem('spinel-theme', theme),
      variant.name.includes('dark') ? 'dark' : 'light',
    );
    await mkdir('test-results/theme-screenshots', { recursive: true });
    const capture = async (name: string) => {
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await page.screenshot({
        path: `test-results/theme-screenshots/spn-086-${name}-${variant.name}-${info.project.name}.png`,
        animations: 'disabled',
      });
    };
    try {
      await page.goto(`/?item=${item.id}`);
      await expect(
        page.getByRole('button', { name: 'Change appearance', exact: true }),
      ).toBeVisible();
      await expect(page.locator('.appearance-banner img')).toBeVisible();
      await expect(page.locator('.appearance-banner img')).toHaveCSS('object-position', '0% 50%');
      await expect
        .poll(() =>
          page
            .locator('.appearance-banner img')
            .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
        )
        .toBe(true);
      await capture('editor');
      await page.getByRole('button', { name: 'Change appearance', exact: true }).click();
      await page.getByRole('textbox', { name: 'Emoji', exact: true }).fill('🍋');
      await page.getByRole('button', { name: 'Save appearance', exact: true }).click();
      await page.reload();
      await expect(
        page.getByRole('button', { name: 'Change appearance', exact: true }),
      ).toContainText('🍋');
      await page.getByRole('button', { name: 'Change appearance', exact: true }).click();
      await page.getByRole('button', { name: 'Change cover', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Page cover', exact: true });
      await expect(dialog).toBeVisible();
      const initial = (await dialog.boundingBox())!.height;
      for (const source of ['Upload', 'Unsplash', 'Gems']) {
        await dialog.getByRole('button', { name: source, exact: true }).click();
        expect(Math.abs((await dialog.boundingBox())!.height - initial)).toBeLessThanOrEqual(1);
        await capture(`picker-${source.toLowerCase()}`);
      }
      await dialog.getByRole('button', { name: 'Bismuth', exact: true }).click();
      await dialog.getByRole('button', { name: 'Save cover', exact: true }).click();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      const saved = await (await context.request.get(`/api/appearance/items/${item.id}`)).json();
      expect(saved.appearance.cover).toEqual({ source: 'gem', gem: 'bismuth' });
      expect(saved.appearance.icon).toBe('🍋');
      await page.locator('.editor-frame').evaluate((element) => {
        element.scrollTop = 200;
      });
      await expect
        .poll(
          async () =>
            (await page.locator('.appearance-banner').boundingBox())!.y +
            (await page.locator('.appearance-banner').boundingBox())!.height,
        )
        .toBeLessThanOrEqual(1);
    } finally {
      db.prepare('DELETE FROM workspace_items WHERE owner_id=?').run(owner.id);
      db.prepare('DELETE FROM auth_users WHERE id=?').run(owner.id);
      db.close();
    }
  });
}
