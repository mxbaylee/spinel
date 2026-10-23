import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';

for (const admin of [false, true]) {
  test(`${admin ? 'Operator' : 'Member'} profile navigation shares persistent appearance on desktop and phone`, async ({
    page,
    context,
    baseURL,
  }, info) => {
    const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
    const auth = new AuthStore(db);
    const user = auth.createUser(admin ? 'Profile operator' : 'Profile owner', admin);
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
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await mkdir('test-results/theme-screenshots', { recursive: true });
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(admin ? '/admin' : '/');
        await page.getByRole('link', { name: 'Your profile', exact: true }).click();
        await expect(page).toHaveURL(/\/profile$/);
        await expect(
          page.getByRole('heading', { name: 'Your profile', exact: true }),
        ).toBeVisible();
        await expect(page.getByRole('textbox', { name: 'Display name' })).toHaveValue(user.name);
        for (const link of await page
          .getByRole('navigation', { name: 'Profile sections' })
          .getByRole('link')
          .all())
          await expect(link).toBeInViewport();
        await page.getByRole('link', { name: 'This device', exact: true }).click();
        const rail = page.locator('.workspace > header');
        const device = page.getByRole('region', { name: 'Appearance on this device' });
        for (const [value, name] of [
          ['system', 'Follow system'],
          ['light', 'Light'],
          ['dark', 'Dark'],
        ] as const) {
          await rail.getByRole('radio', { name, exact: true }).click();
          await expect(device.getByRole('radio', { name, exact: true })).toBeChecked();
          await page.reload();
          await expect(rail.getByRole('radio', { name, exact: true })).toBeChecked();
          expect(await page.evaluate(() => localStorage.getItem('spinel-theme'))).toBe(value);
          await page.emulateMedia({ colorScheme: 'dark' });
          await expect(page.locator('html')).toHaveAttribute(
            'data-theme',
            value === 'light' ? 'light' : 'dark',
          );
          await page.emulateMedia({ colorScheme: 'light' });
          await expect(page.locator('html')).toHaveAttribute(
            'data-theme',
            value === 'dark' ? 'dark' : 'light',
          );
        }
        // The device picker and the rail both write the existing shared preference.
        await device.getByRole('radio', { name: 'Light', exact: true }).click();
        await expect(rail.getByRole('radio', { name: 'Light', exact: true })).toBeChecked();
        const sections = ['profile', 'passkeys', 'device', ...(!admin ? ['connections'] : [])];
        for (const section of sections) {
          await page.goto('/profile#' + section);
          if (section === 'profile')
            await expect(page.getByRole('textbox', { name: 'Display name' })).toBeVisible();
          for (const mode of width === 390 ? (['light'] as const) : (['light', 'dark'] as const)) {
            await rail
              .getByRole('radio', { name: mode === 'light' ? 'Light' : 'Dark', exact: true })
              .click();
            await page.screenshot({
              path: `test-results/theme-screenshots/profile-${admin ? 'operator' : 'member'}-${section}-${width === 390 ? 'phone' : mode}-${info.project.name}.png`,
              fullPage: true,
            });
          }
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
        }
        await page.goto('/settings#device');
        await expect(page).toHaveURL(/\/profile#device$/);
        await expect(device).toBeVisible();
        await expect(
          page
            .getByRole('navigation', { name: 'Profile sections' })
            .getByRole('link', { name: 'Connected assistants' }),
        ).toHaveCount(admin ? 0 : 1);
      }
      expect(errors).toEqual([]);
    } finally {
      db.close();
    }
  });
}
