import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const id = 'c9a0e022-1111-4111-8111-111111111111';
const guestPath = '/api/guest/' + id;
const slowLine = (page: Page) => page.getByRole('status').filter({ hasText: /^Still starting:/ });

test.beforeEach(async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    // Bootstrap starts the first one-second interval before importing application.
    // Track its real browser handle without replacing the production callback.
    const browserWindow: Window = window;
    const set = browserWindow.setInterval.bind(browserWindow);
    const clear = browserWindow.clearInterval.bind(browserWindow);
    const probe = { reporter: null as number | null, cleared: false };
    Object.assign(window, { startupTimerProbe: probe });
    browserWindow.setInterval = (callback, delay, ...args) => {
      const handle = set(callback, delay, ...args);
      if (delay === 1000 && probe.reporter === null) probe.reporter = handle;
      return handle;
    };
    browserWindow.clearInterval = (handle) => {
      if (handle === probe.reporter) probe.cleared = true;
      clear(handle);
    };
  });
});

async function reporterCleared(page: Page, cleared: boolean) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const probe = (
          window as unknown as {
            startupTimerProbe: { reporter: number | null; cleared: boolean };
          }
        ).startupTimerProbe;
        return { started: probe.reporter !== null, cleared: probe.cleared };
      }),
    )
    .toEqual({ started: true, cleared });
}

async function beyondDeadline(page: Page, elapsed = 120_000) {
  // Change wall time, then tick once. Do not exhaust unrelated HTTP deadlines
  // or replay two minutes of guest polling just to test the startup reporter.
  await page.clock.setSystemTime((await page.evaluate(() => Date.now())) + elapsed);
  await page.clock.runFor(1000);
}

async function readySpace(page: Page) {
  await page.route('**' + guestPath, (route) =>
    route.fulfill({
      json: { item: { id, kind: 'space', name: 'Shared timer fixture', access: 'viewer' } },
    }),
  );
  await page.route('**/api/guest-spaces/' + id, (route) =>
    route.fulfill({
      json: {
        space: {
          id,
          kind: 'space',
          name: 'Shared timer fixture',
          parentId: null,
          spaceId: null,
          position: null,
          createdAt: 0,
          updatedAt: 0,
        },
        access: 'viewer',
        items: [],
      },
    }),
  );
}

// This is an actual application -> GuestApp -> Space mount with deterministic
// HTTP responses. Native editing has its own owners; no SDK editor is needed
// to verify entry lifecycle, DOM removal and timer disposal.
test('guest startup reporting ends when a ready guest mounts after slow app code', async ({
  page,
  context,
}) => {
  await readySpace(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested!: (owner: 'service worker' | 'app code') => void;
  const applicationRequested = new Promise<'service worker' | 'app code'>((resolve) => {
    requested = resolve;
  });
  // Production precaches the imported application through its real worker;
  // page.route cannot intercept that worker-owned fetch. Keep both owners gated.
  await context.route(
    /\/(?:application\.tsx(?:\?.*)?|assets\/application-[^/]+\.js)$/,
    async (route) => {
      requested(route.request().serviceWorker() ? 'service worker' : 'app code');
      await gate;
      await route.continue();
    },
  );
  try {
    await page.goto('/share/' + id, { waitUntil: 'commit' });
    const owner = await applicationRequested;
    test.info().annotations.push({ type: 'application delivery gate', description: owner });
    await beyondDeadline(page, 9000);
    // Network ownership does not rename the bootstrap's application-import stage.
    await expect(slowLine(page)).toContainText('Still starting: app code');
    await expect(
      page.getByRole('heading', { name: 'This Space is empty', exact: true }),
    ).toHaveCount(0);
    await reporterCleared(page, false);
    release();
    await expect(
      page.getByRole('heading', { name: 'This Space is empty', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Shared timer fixture', exact: true, level: 1 }),
    ).toBeVisible();
    await expect(slowLine(page)).toHaveCount(0);
    await reporterCleared(page, true);
    await beyondDeadline(page);
    await expect(slowLine(page)).toHaveCount(0);
  } finally {
    release();
  }
});

for (const state of ['unavailable', 'revoked', 'unsupported'] as const) {
  test(`guest startup reporting ends for ${state} entry`, async ({ page }) => {
    if (state === 'unsupported')
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
      });
    await page.route('**' + guestPath, (route) =>
      route.fulfill({ status: state === 'revoked' ? 404 : 503, json: {} }),
    );
    await page.goto('/share/' + id + (state === 'unsupported' ? '#timer-fixture' : ''));
    if (state === 'unsupported')
      await expect(page.getByRole('alert')).toHaveText(
        'Open this link in a current browser that supports Web Locks.',
      );
    else
      await expect(
        page.getByRole('heading', {
          name: state === 'revoked' ? 'This link no longer works.' : "You're offline",
          exact: true,
        }),
      ).toBeVisible();
    await reporterCleared(page, true);
    await beyondDeadline(page);
    await expect(slowLine(page)).toHaveCount(0);
  });
}

test('account startup reporting remains live while actual admission is pending', async ({
  page,
}) => {
  let requested!: () => void;
  const sessionRequested = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route('**/api/auth/session', () => {
    requested();
  });
  await page.goto('/sign-in');
  await sessionRequested;
  await beyondDeadline(page, 9000);
  await expect(slowLine(page)).toContainText('Still starting: sign-in check');
  await reporterCleared(page, false);
});
