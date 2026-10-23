import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';

async function capture(page: Page, info: TestInfo, state: string) {
  await mkdir('test-results/theme-screenshots', { recursive: true });
  for (const [theme, width, variant] of [
    ['light', 1280, 'light'], ['dark', 1280, 'dark'],
    ['light', 390, 'phone-light'], ['dark', 390, 'phone-dark'],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/theme-screenshots/spn-083-${state}-${variant}-${info.project.name}.png`, fullPage: true });
  }
}

test('entry keeps cancellation, retry and help on one task without losing the pending request', async ({ page }, info) => {
  const request = 'abcdef12-1234-4123-8123-abcdef123456';
  await page.goto(`/sign-in?connect=${request}`);
  await expect(page.getByRole('heading', { name: 'Your workspace.', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in with a passkey', exact: true })).toHaveCount(1);
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await capture(page, info, 'sign-in');

  let release = () => {};
  const released = new Promise<void>((resolve) => { release = resolve; });
  let received = (_id: string) => {};
  const challenge = new Promise<string>((resolve) => { received = resolve; });
  await page.route('**/api/auth/authentication/options', async (route) => {
    const response = await route.fetch();
    const body = await response.json() as { challengeId: string };
    received(body.challengeId);
    await released;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    const id = await challenge;
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await capture(page, info, 'passkey-pending');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Passkey request cancelled.');
    await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeFocused();
    const cancelled = page.waitForRequest((r) => r.url().endsWith('/api/auth/cancel') && r.postDataJSON().challengeId === id);
    release();
    await cancelled;
    await expect(page).toHaveURL(new RegExp(`/sign-in\\?connect=${request}$`));
    await capture(page, info, 'passkey-cancelled');
  } finally { release(); }

  await page.unroute('**/api/auth/authentication/options');
  await page.route('**/api/auth/authentication/options', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Passkey service is unavailable. Try again.' }) }));
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expect(page.getByRole('alert')).toHaveText('Passkey service is unavailable. Try again.');
  await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeFocused();
  await capture(page, info, 'passkey-error');

  const help = page.getByRole('button', { name: 'Need help?', exact: true });
  await expect(help).toHaveCount(1);
  await help.click();
  const dialog = page.getByRole('dialog', { name: 'Access to this workspace' });
  await expect(dialog).toContainText('recovery invitation');
  await expect(dialog.getByText('npm run setup', { exact: true })).not.toBeVisible();
  await capture(page, info, 'help');
  await dialog.getByText('Operator help and commands').click();
  await expect(dialog.getByText('npm run setup', { exact: true })).toBeVisible();
  await expect(dialog).toContainText('These commands are not run by this page.');
  await capture(page, info, 'operator-help');
  await page.keyboard.press('Escape');
  await expect(help).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`/sign-in\\?connect=${request}$`));
});

test('consent account switching preserves only the opaque request and never permits an Operator grant', async ({ page, context, baseURL }, info) => {
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db);
  const admin = auth.createUser(`Entry Operator ${info.testId}`, true);
  const request = 'abcdef12-1234-4123-8123-abcdef123456';
  try {
    await context.addCookies([{ name: COOKIE_NAME, value: auth.createSession(admin.id).token,
      url: baseURL!.replace('http:', 'https:'), secure: true, httpOnly: true, sameSite: 'Strict' }]);
    await page.goto(`/connect?request=${request}&return=https://untrusted.example`);
    await expect(page.getByRole('alert')).toContainText('Admin accounts cannot connect assistants');
    await expect(page.getByRole('button', { name: 'Allow', exact: true })).toHaveCount(0);
    await capture(page, info, 'consent-operator');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}/sign-in?connect=${request}`);
    await expect(page.getByRole('heading', { name: 'Your workspace.', exact: true })).toBeVisible();
    expect((await context.request.get('/api/auth/session')).status()).toBe(401);
    await page.goto('/connect?request=not-a-transaction&return=https://untrusted.example');
    await expect(page).toHaveURL(`${baseURL}/sign-in`);
  } finally {
    db.prepare('DELETE FROM auth_users WHERE id=?').run(admin.id);
    db.close();
  }
});
