import { expect, test } from '@playwright/test';
import type { Page, Locator } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';

test('a member creates and revokes a once-only token while an operator sees only metadata', async ({
  page,
  context,
  browser,
  baseURL,
}, info) => {
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db);
  const member = auth.createUser('Assistant owner');
  const operator = auth.createUser('Assistant operator', true);
  const cookie = (token: string) => ({
    name: COOKIE_NAME,
    value: token,
    url: baseURL!.replace('http:', 'https:'),
    secure: true,
    httpOnly: true,
    sameSite: 'Strict' as const,
  });
  const adminContext = await browser.newContext();
  const screenshots = async (target: Page, name: string, mask: Locator[] = []) => {
    await mkdir('test-results/theme-screenshots', { recursive: true });
    for (const variant of ['light', 'dark', 'phone'] as const) {
      const theme = variant === 'dark' ? 'dark' : 'light';
      await target.setViewportSize({ width: variant === 'phone' ? 390 : 1280, height: 900 });
      await target.emulateMedia({ colorScheme: theme });
      await expect(target.locator('html')).toHaveAttribute('data-theme', theme);
      await target.evaluate(() => window.scrollTo(0, 0));
      await target.screenshot({
        path: `test-results/theme-screenshots/mcp-${info.project.name}-${name}-${variant}.png`,
        fullPage: true,
        mask,
        maskColor: '#999999',
      });
    }
    await target.setViewportSize({ width: 1280, height: 900 });
  };
  await context.addCookies([cookie(auth.createSession(member.id).token)]);
  await adminContext.addCookies([cookie(auth.createSession(operator.id).token)]);
  try {
    await page.goto('/settings#connections');
    await page.getByText('Advanced: personal access tokens', { exact: true }).click();
    const settings = page.getByRole('region', { name: 'Personal access tokens' });
    await expect(settings.getByText('No access tokens yet.')).toBeVisible();
    await expect(settings.getByRole('textbox', { name: 'Token server address' })).toHaveValue(
      `${baseURL}/mcp`,
    );
    await settings.getByRole('textbox', { name: 'Token name' }).fill('Chosen desktop assistant');
    await settings.getByRole('button', { name: 'Create access token' }).click();
    const reveal = settings.getByRole('textbox', { name: 'New access token' });
    await expect(reveal).toBeVisible();
    const token = await reveal.inputValue();
    expect(token.length).toBeGreaterThan(20);
    await expect(settings.getByRole('listitem')).toContainText('Active');
    // A blocked clipboard still leaves a selectable manual-copy value.
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async () => {
            throw new Error('Clipboard unavailable');
          },
        },
      });
    });
    await settings.getByRole('button', { name: 'Copy access token' }).click();
    await expect(settings.getByRole('status')).toHaveText('Select the token and copy it manually.');
    await expect(reveal).toHaveValue(token);
    await screenshots(page, 'token-revealed', [reveal]);

    const admin = await adminContext.newPage();
    await admin.goto(`${baseURL}/admin`);
    const metadata = admin.getByRole('region', { name: 'Personal access tokens' });
    await expect(
      metadata.getByRole('listitem').filter({ hasText: 'Chosen desktop assistant' }),
    ).toContainText('Assistant owner · Active');
    await expect(metadata.getByRole('textbox')).toHaveCount(0);
    await expect(metadata.getByRole('button', { name: /Create|Revoke/ })).toHaveCount(0);
    expect(await metadata.textContent()).not.toContain(token);
    await screenshots(admin, 'admin-tokens');

    // The raw token is only returned at creation, never in subsequent settings loads.
    await page.reload();
    await page.getByText('Advanced: personal access tokens', { exact: true }).click();
    await expect(settings.getByRole('listitem')).toContainText('Chosen desktop assistant');
    await expect(reveal).toHaveCount(0);
    expect(await (await context.request.get('/api/auth/tokens')).text()).not.toContain(token);
    await settings.getByRole('button', { name: 'Revoke Chosen desktop assistant' }).click();
    await expect(settings.getByRole('listitem')).toContainText('Revoked');
    await screenshots(page, 'token-revoked');
    await expect(
      settings.getByRole('button', { name: 'Revoke Chosen desktop assistant' }),
    ).toHaveCount(0);
    await admin.reload();
    await expect(
      metadata.getByRole('listitem').filter({ hasText: 'Chosen desktop assistant' }),
    ).toContainText('Assistant owner · Revoked');

    await admin.goto(`${baseURL}/settings`);
    await expect(admin.getByRole('region', { name: 'Personal access tokens' })).toHaveCount(0);
  } finally {
    await adminContext.close();
    db.close();
  }
});
