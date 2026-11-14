import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import type { MaintenancePublicStatus } from '../src/shared/maintenance.ts';

const id = 'c9a0e022-2222-4222-8222-222222222222';
const paused: MaintenancePublicStatus = {
  available: true,
  phase: 'paused',
  epoch: 'banner-browser-regression',
  notice: null,
};
const variants = [
  ['light', 1280, 'light'],
  ['dark', 1280, 'dark'],
  ['light', 390, 'phone-light'],
  ['dark', 390, 'phone-dark'],
] as const;
const banner = (page: Page) =>
  page.getByRole('region', { name: 'Workspace maintenance', exact: true });

// This exercises the real guest shell and production banner, not the supervisor.
// The full maintenance journey separately verifies authoritative write admission.
async function fixture(context: BrowserContext, status: () => MaintenancePublicStatus) {
  await context.route('**/api/maintenance', (route) => route.fulfill({ json: status() }));
  await context.route('**/api/guest/' + id, (route) => route.fulfill({ status: 503, json: {} }));
}

async function capture(page: Page, info: TestInfo, state: string) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await mkdir('test-results/theme-screenshots', { recursive: true });
  await page.screenshot({
    path: `test-results/theme-screenshots/spn-111-banner-${state}-${info.project.name}.png`,
    animations: 'disabled',
    fullPage: true,
  });
}

for (const [theme, width, variant] of variants) {
  test(`maintenance dismissal reopens with native keyboard and pointer (${variant})`, async ({
    page,
    context,
  }, info) => {
    await fixture(context, () => paused);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.goto('/share/' + id);
    const content = page.getByRole('heading', { name: "You're offline", exact: true });
    await expect(content).toBeVisible();
    const retained = await content.elementHandle();
    expect(retained).not.toBeNull();
    const summary = banner(page).locator('summary');
    const guidance = banner(page).getByText(/Already acknowledged edits remain saved/);
    const dismiss = banner(page).getByRole('button', { name: 'Dismiss for now', exact: true });
    await expect(dismiss).toBeVisible();
    await capture(page, info, `${variant}-announced`);

    // user-event's synthetic Enter does not activate a native <summary>.
    // These trusted browser inputs must keep both Enter and Space working.
    for (const key of ['Enter', 'Space']) {
      await dismiss.click();
      await expect(banner(page)).toHaveAttribute('data-dismissed', 'true');
      await expect(summary).toBeFocused();
      await expect(summary).toContainText('Edits paused');
      await expect(guidance).not.toBeVisible();
      const target = await summary.boundingBox();
      expect(target?.height).toBeGreaterThanOrEqual(44);
      await capture(page, info, `${variant}-${key.toLowerCase()}-dismissed`);
      await summary.press(key);
      await expect(guidance).toBeVisible();
      await expect(dismiss).toBeVisible();
      await expect(banner(page)).not.toHaveAttribute('data-dismissed', 'true');
      expect(await content.evaluate((node, original) => node === original, retained!)).toBe(true);
    }

    await dismiss.click();
    await summary.click();
    await expect(guidance).toBeVisible();
    await expect(dismiss).toBeVisible();
    expect(await content.evaluate((node, original) => node === original, retained!)).toBe(true);
    await capture(page, info, `${variant}-reopened`);
  });
}

test('maintenance dismissal survives reload but does not hide another tab or a new pause', async ({
  page,
  context,
}) => {
  let status: MaintenancePublicStatus = {
    ...paused,
    phase: 'running',
    notice: {
      id: 'browser-notice',
      startsAt: Date.UTC(2030, 10, 3, 9, 30),
      timeZone: 'America/Los_Angeles',
      durationMinutes: 30,
      state: 'scheduled',
    },
  };
  await fixture(context, () => status);
  await page.goto('/share/' + id);
  await banner(page).getByRole('button', { name: 'Dismiss for now', exact: true }).click();
  await expect(banner(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: "You're offline", exact: true })).toBeVisible();
  await expect(banner(page)).toHaveCount(0);

  const other = await context.newPage();
  try {
    await other.goto('/share/' + id);
    await expect(banner(other).getByText('Maintenance scheduled', { exact: true })).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
    status = { ...status, phase: 'paused', epoch: 'new-pause' };
    await page.reload();
    await expect(banner(page).getByText('Edits paused', { exact: true })).toBeVisible();
    await expect(
      banner(page).getByRole('button', { name: 'Dismiss for now', exact: true }),
    ).toBeVisible();
  } finally {
    await other.close();
  }
});

test('blocked session storage still allows dismissal and native reopening', async ({
  page,
  context,
}) => {
  await fixture(context, () => paused);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new DOMException('Storage blocked by the browser fixture.', 'SecurityError');
      },
    });
  });
  await page.goto('/share/' + id);
  await banner(page).getByRole('button', { name: 'Dismiss for now', exact: true }).click();
  await expect(banner(page)).toHaveAttribute('data-dismissed', 'true');
  await banner(page).locator('summary').press('Enter');
  await expect(banner(page).getByText(/Already acknowledged edits remain saved/)).toBeVisible();
});
