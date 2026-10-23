import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';

const id = 'c9a0e022-1111-4111-8111-111111111111';
const path = '/api/guest/' + id;
const variants = [
  ['light', 1280, 'light'],
  ['dark', 1280, 'dark'],
  ['light', 390, 'phone-light'],
  ['dark', 390, 'phone-dark'],
] as const;

async function capture(page: Page, info: TestInfo, state: string) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await mkdir('test-results/theme-screenshots', { recursive: true });
  await page.screenshot({
    path: `test-results/theme-screenshots/spn-084-${state}-${info.project.name}.png`,
    fullPage: true,
    animations: 'disabled',
  });
}

test('guest launch distinguishes offline, retry and authoritative denial without private metadata', async ({
  page,
}, info) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/api/')) requests.push(pathname);
  });
  let status = 503;
  await page.route('**' + path, (route) =>
    route.fulfill({ status, json: { error: 'Private file name must not appear' } }),
  );
  for (const [theme, width, variant] of variants) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme });
    status = 503;
    await page.goto('/share/' + id);
    await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
    await expect(page.getByText('Opening shared document…')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();
    await capture(page, info, 'offline-' + variant);
    // Retry uses the same scoped probe. A denial ends access, rather than showing
    // an endlessly retryable network error or echoing the server's private text.
    const retried = page.waitForResponse((response) => new URL(response.url()).pathname === path);
    await page.getByRole('button', { name: 'Try again' }).click();
    await retried;
    await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
    status = 404;
    await page.reload();
    await expect(page.getByRole('alert')).toHaveText('This link no longer works.');
    await expect(page.getByRole('heading', { name: 'This link no longer works.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
    await expect(page.getByRole('link')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('Private file name');
    await expect(page).toHaveTitle('Spinel');
    await capture(page, info, 'revoked-' + variant);
  }
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every((request) => request === path)).toBe(true);
});

test('a guest Space with an unreachable tree exposes no root identity or account controls', async ({
  page,
}, info) => {
  await page.route('**' + path, (route) =>
    route.fulfill({
      json: { item: { id, kind: 'space', name: 'Private Space title', access: 'viewer' } },
    }),
  );
  let treeStatus = 503;
  const treePath = '/api/guest-spaces/' + id;
  await page.route('**' + treePath, (route) =>
    route.fulfill({ status: treeStatus, json: { error: 'Private tree title' } }),
  );
  for (const [theme, width, variant] of variants) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme });
    treeStatus = 503;
    await page.goto('/share/' + id);
    await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Private Space title');
    await expect(page.getByRole('button', { name: 'Open Space contents' })).toHaveCount(0);
    await capture(page, info, 'space-offline-' + variant);
    const retried = page.waitForResponse(
      (response) => new URL(response.url()).pathname === treePath,
    );
    await page.getByRole('button', { name: 'Try again' }).click();
    await retried;
    treeStatus = 404;
    await page.reload();
    await expect(page.getByRole('alert')).toHaveText('This link no longer works.');
    await expect(page.locator('body')).not.toContainText('Private tree title');
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /My files|Your profile|Document actions/ }),
    ).toHaveCount(0);
    await capture(page, info, 'space-revoked-' + variant);
  }
});

test('unsupported guest browsers retain the generic guard and never exchange a capability', async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
  });
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
  });
  for (const [theme, width, variant] of variants) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/share/' + id + '#browser-guard-fixture');
    await expect(page.getByRole('alert')).toHaveText(
      'Open this link in a current browser that supports Web Locks.',
    );
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('browser-guard-fixture');
    await capture(page, info, 'unsupported-' + variant);
  }
  expect(apiRequests).toEqual([]);
});

test('pending guest bootstrap shows one generic loading state', async ({ page }, info) => {
  // A held response exercises loading rather than conflating a server failure
  // with an empty document. No native content or account session is supplied.
  await page.route('**' + path, () => {});
  for (const [theme, width, variant] of variants) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/share/' + id);
    await expect(page.getByRole('status')).toHaveText('Opening shared document…');
    await expect(page.getByRole('heading', { name: 'Shared document', exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('link')).toHaveCount(0);
    await capture(page, info, 'loading-' + variant);
  }
});
