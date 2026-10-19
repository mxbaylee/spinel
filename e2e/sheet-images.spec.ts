import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { sheetImageFixture } from './sheet-image-fixture.ts';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';

for (const mobile of [false, true]) {
  test(`imported Sheet images render in ${mobile ? 'mobile' : 'desktop'} live and readonly history views`, async ({
    browser,
    baseURL,
  }, info) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({
      baseURL,
      hasTouch: mobile,
      viewport: mobile ? { width: 412, height: 915 } : { width: 1440, height: 1100 },
    });
    const page = await context.newPage();
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(mobile);
    const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
    const auth = new AuthStore(db);
    const user = auth.createUser(`Sheet images ${info.testId}`);
    await context.addCookies([
      {
        name: COOKIE_NAME,
        value: auth.createSession(user.id).token,
        url: baseURL!.replace('http:', 'https:'),
        secure: true,
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
    await page.setViewportSize(
      mobile ? { width: 412, height: 915 } : { width: 1440, height: 1100 },
    );
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const snapshot = await sheetImageFixture();
    try {
      const imported = await context.request.post('/api/items/import', {
        headers: { Origin: baseURL! },
        data: {
          filename: 'Sheet images.univer.json',
          parentId: null,
          snapshot,
        },
      });
      expect(imported.status(), await imported.text()).toBe(201);
      const { item } = await imported.json();
      const pixels = async () => {
        const buffer = await page.locator('.univer-container').screenshot();
        const { data, info: metadata } = await sharp(buffer)
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const counts = [0, 0, 0];
        const rgb = [
          [255, 153, 0],
          [34, 85, 238],
          [34, 187, 102],
        ];
        for (let offset = 0; offset < data.length; offset += metadata.channels)
          rgb.forEach((color, index) => {
            if (color.every((value, channel) => Math.abs(data[offset + channel] - value) < 12))
              counts[index]++;
          });
        return counts;
      };
      const allImagesVisible = async () => {
        await expect
          .poll(async () => (await pixels()).every((count) => count > 1000), { timeout: 25_000 })
          .toBe(true);
      };
      await page.goto(`/?item=${item.id}`);
      await expect(page.getByLabel('Spreadsheet grid', { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await allImagesVisible();
      await page.reload();
      await expect(page.getByLabel('Spreadsheet grid', { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await allImagesVisible();
      const named = await context.request.post(`/api/items/${item.id}/history`, {
        headers: { Origin: baseURL! },
        data: { name: 'Images retained' },
      });
      expect(named.ok(), await named.text()).toBe(true);
      const checkpoint = await named.json();
      await page.goto(`/preview?item=${item.id}&version=${checkpoint.version.id}`);
      await expect(
        page.getByRole('button', { name: 'Restore this version', exact: true }),
      ).toBeEnabled({ timeout: 30_000 });
      await allImagesVisible();
      if (!mobile)
        await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled();
      const floatingBounds = async () => {
        const { data, info: meta } = await sharp(
          await page.locator('.univer-container').screenshot(),
        )
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        let left = meta.width,
          top = meta.height,
          right = 0,
          bottom = 0;
        for (let y = 0; y < meta.height; y++)
          for (let x = 0; x < meta.width; x++) {
            const i = (y * meta.width + x) * meta.channels;
            if (data[i] > 245 && Math.abs(data[i + 1] - 153) < 10 && data[i + 2] < 10) {
              left = Math.min(left, x);
              right = Math.max(right, x);
              top = Math.min(top, y);
              bottom = Math.max(bottom, y);
            }
          }
        return { left, right, top, bottom };
      };
      const before = await floatingBounds();
      const canvas = (await page.locator('.univer-container').boundingBox())!;
      const center = {
        x: canvas.x + (before.left + before.right) / 2,
        y: canvas.y + (before.top + before.bottom) / 2,
      };
      await page.mouse.click(center.x, center.y);
      await page.keyboard.press('Delete');
      const refusal = page.getByText(
        'The range is protected, and you do not have edit permission. To edit, please contact the creator.',
        { exact: true },
      );
      await expect(refusal).toBeVisible();
      await page.getByRole('button', { name: 'ok', exact: true }).click();
      await expect(refusal).toBeHidden();
      // The refusal backdrop dims canvas colors. Assert it before dismissing,
      // then verify the exact original image geometry rather than dimmed pixels.
      await expect.poll(floatingBounds).toEqual(before);
      await page.mouse.move(center.x, center.y);
      await page.mouse.down();
      await page.mouse.move(center.x + (mobile ? -30 : 40), center.y + 30, { steps: 6 });
      await page.mouse.up();
      if (await refusal.isVisible()) {
        await page.getByRole('button', { name: 'ok', exact: true }).click();
        await expect(refusal).toBeHidden();
      }
      await expect.poll(floatingBounds).toEqual(before);
      await allImagesVisible();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      db.close();
    }
  });
}
