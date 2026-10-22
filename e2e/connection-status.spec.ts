import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { interruptibleNetwork } from './live-network.ts';

type ConnectionState = 'Online' | 'Offline' | 'Reconnecting';
const labels = {
  Online: 'Online — connected to Spinel',
  Offline: 'Offline — not connected to Spinel',
  Reconnecting: 'Reconnecting — connecting to Spinel',
};
const status = (page: Page) => page.getByRole('status', { name: 'Connection status', exact: true });
const indicator = (page: Page) =>
  page.getByRole('button', { name: /^(Online|Offline|Reconnecting) — / });

async function connection(page: Page, state: ConnectionState) {
  await expect(status(page)).toHaveText(state, { timeout: state === 'Offline' ? 5_000 : 15_000 });
  await expect(status(page)).toHaveCount(1);
  await expect(status(page)).toHaveAttribute('aria-live', 'polite');
  await expect(indicator(page)).toHaveCount(1);
  await expect(page.getByRole('button', { name: labels[state], exact: true })).toBeVisible();
}

async function detail(page: Page, state: ConnectionState, touch = false) {
  const trigger = page.getByRole('button', { name: labels[state], exact: true });
  const before = await trigger.boundingBox();
  if (touch) {
    expect(before!.width).toBeGreaterThanOrEqual(44);
    expect(before!.height).toBeGreaterThanOrEqual(44);
    await trigger.tap();
  } else await trigger.hover();
  await expect(page.getByRole('dialog', { name: 'Connection details', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Connection details', exact: true })).toContainText(
    /connect|offline/i,
  );
  expect(await trigger.boundingBox()).toEqual(before);
}

async function closeDetail(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Connection details', exact: true })).toHaveCount(
    0,
  );
  await page.mouse.move(0, 0);
}

async function capture(page: Page, info: TestInfo, name: string, variant: string) {
  await mkdir('test-results/theme-screenshots', { recursive: true });
  await page.screenshot({
    path: `test-results/theme-screenshots/spn-042-${name}-${variant}-${info.project.name}.png`,
    fullPage: true,
    animations: 'disabled',
  });
}

// Document-relative coordinates ignore deliberate scrolling to reach native controls.
async function documentBounds(locator: Locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height };
  });
}

test('dashboard verifies the server before reporting Online and explains a stale file list', async ({
  page,
  context,
  baseURL,
}, info) => {
  test.setTimeout(90_000);
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth);
  const user = auth.createUser(`Connection dashboard ${info.testId}`);
  for (const [name, kind] of [
    ['Household', 'folder'],
    ['Autumn travel budget', 'sheet'],
    ['Weekend plans', 'doc'],
  ] as const)
    workspace.create(user.id, { name, kind, parentId: null });
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
  let failHealth = false;
  let holdHealth = false;
  let heldHealthStatus = 0;
  let releaseHealth = () => {};
  const healthGate = new Promise<void>((resolve) => {
    releaseHealth = resolve;
  });
  await page.route('**/api/health', async (route) => {
    if (failHealth) return route.abort('failed');
    if (!holdHealth) return route.continue();
    const response = await route.fetch();
    heldHealthStatus = response.status();
    await healthGate;
    try {
      await route.fulfill({ response });
    } finally {
      await response.dispose();
    }
  });
  const captureDashboard = async (state: ConnectionState) => {
    for (const [theme, width, variant] of [
      ['light', 1280, 'light'],
      ['dark', 1280, 'dark'],
      ['light', 390, 'phone'],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await detail(page, state);
      if (state === 'Offline')
        await expect(
          page.getByRole('dialog', { name: 'Connection details', exact: true }),
        ).toContainText('Files as of');
      await expect(
        page.getByRole('dialog', { name: 'Connection details', exact: true }),
      ).not.toContainText('Saved on this device');
      await capture(page, info, `dashboard-${state.toLowerCase()}`, variant);
      await closeDetail(page);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
  };
  try {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /^Autumn travel budget/ })).toBeVisible();
    await connection(page, 'Online');
    await captureDashboard('Online');

    await context.setOffline(true);
    await connection(page, 'Offline');
    await captureDashboard('Offline');
    await expect(page.locator('.banner').filter({ hasText: 'Files as of' })).toHaveCount(0);

    holdHealth = true;
    await context.setOffline(false);
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    await expect.poll(() => heldHealthStatus).toBe(200);
    // The response exists on the server side but has not reached the application.
    await connection(page, 'Reconnecting');
    // Release promptly: the real two-second health deadline must not depend on
    // screenshot speed. Room-reconnect screenshots below hold the room instead.
    holdHealth = false;
    releaseHealth();
    await connection(page, 'Online');

    // An online browser with an unreachable Spinel server must not stay Online.
    failHealth = true;
    await expect(status(page)).toHaveText(/^(Offline|Reconnecting)$/, { timeout: 15_000 });
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    await expect(page.getByRole('button', { name: labels.Online, exact: true })).toHaveCount(0);
    failHealth = false;
    await connection(page, 'Online');

    await indicator(page).evaluate((element) => (element as HTMLElement).blur());
    await indicator(page).focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('dialog', { name: 'Connection details', exact: true }),
    ).toBeVisible();
    await closeDetail(page);
  } finally {
    holdHealth = false;
    releaseHealth();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.close();
    db.prepare('DELETE FROM workspace_items WHERE owner_id=?').run(user.id);
    db.prepare('DELETE FROM auth_users WHERE id=?').run(user.id);
    db.close();
  }
});

for (const width of [1280, 390]) {
  test.describe(`${width}px connection geometry`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch: width === 390 });
    for (const kind of ['sheet', 'doc'] as const) {
      test(`${kind} stays still while offline and reconnecting until the room acknowledges JOIN`, async ({
        page,
        context,
        baseURL,
      }, info) => {
        test.setTimeout(90_000);
        const network = await interruptibleNetwork(context);
        const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
        const auth = new AuthStore(db),
          workspace = new WorkspaceStore(auth);
        const user = auth.createUser(`Connection ${kind} ${width} ${info.testId}`);
        const item = workspace.create(user.id, {
          kind,
          name: kind === 'sheet' ? 'Autumn travel budget' : 'Weekend plans',
          parentId: null,
        });
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
        const editor = page.getByRole('region', {
          name: kind === 'sheet' ? 'Sheet document' : 'Doc document',
          exact: true,
        });
        const canvas = editor.locator('.univer-container');
        const save = editor.getByRole('status', { name: 'Save status', exact: true });
        const saved = () => expect(save).toHaveText('All changes saved.', { timeout: 30_000 });
        let holdWrite = true;
        let writeHeld = false;
        let failWrites = false;
        let rejectedWrites = 0;
        let recoveryHeld = true;
        let releaseRecovery = () => {};
        const recoveryGate = new Promise<void>((resolve) => {
          releaseRecovery = resolve;
        });
        let releaseWrite = () => {};
        const writeGate = new Promise<void>((resolve) => {
          releaseWrite = resolve;
        });
        await page.route('**/universer-api/comb/*/unit/*/new_changes', async (route) => {
          if (holdWrite) {
            writeHeld = true;
            await writeGate;
          }
          if (failWrites) {
            // Reject exactly once; repeated 503s would test a reconnect storm,
            // rather than the save control's failure and user-triggered recovery.
            failWrites = false;
            rejectedWrites++;
            await route.fulfill({
              status: 503,
              json: { error: 'Save unavailable for this acceptance test.' },
            });
          } else {
            if (rejectedWrites && recoveryHeld) await recoveryGate;
            await route.continue();
          }
        });
        const captureEditor = async (state: ConnectionState) => {
          for (const theme of width === 390 ? (['light'] as const) : (['light', 'dark'] as const)) {
            await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
            await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
            await detail(page, state, width === 390);
            await capture(
              page,
              info,
              `${kind}-${state.toLowerCase()}`,
              width === 390 ? 'phone' : theme,
            );
            await closeDetail(page);
          }
          await page.emulateMedia({ colorScheme: 'light' });
        };
        try {
          await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
          await page.goto(`/?item=${item.id}`);
          await saved();
          await connection(page, 'Online');
          const saveTrigger = page.getByRole('button', { name: /^Save details:/ });
          await expect(saveTrigger).toHaveText('Saved');
          const savedBounds = await documentBounds(canvas);
          const slotBounds = await documentBounds(saveTrigger);
          const savedDocumentWidth = await page.evaluate(
            () => document.documentElement.scrollWidth,
          );
          if (kind === 'sheet' && width === 390) {
            await expect(editor).toHaveAttribute('data-mobile', 'true');
            const grid = editor.getByLabel('Spreadsheet grid', { exact: true });
            await grid.scrollIntoViewIfNeeded();
            const box = (await grid.boundingBox())!;
            await page.touchscreen.tap(box.x + 80, box.y + 40);
            await page.touchscreen.tap(box.x + 80, box.y + 40);
            const bar = editor.locator('[data-u-comp="mobile-formula-bar"]');
            await expect(bar).toBeVisible();
            await page.keyboard.type('Train tickets');
            await bar.getByRole('button', { name: 'OK', exact: true }).tap();
          } else if (kind === 'sheet') {
            const address = editor.getByRole('textbox').nth(2);
            await address.fill('A1');
            await address.press('Enter');
            await page.keyboard.type('Train tickets');
            await page.keyboard.press('Enter');
          } else {
            await canvas.click({ position: { x: 130, y: 200 } });
            await page.keyboard.type('Reserve train tickets and pack a picnic.');
          }
          await expect.poll(() => writeHeld).toBe(true);
          await expect(save).toContainText(/not saved|Saving|keep this tab open/i);
          await expect.poll(() => documentBounds(canvas)).toEqual(savedBounds);
          await expect.poll(() => documentBounds(saveTrigger)).toEqual(slotBounds);
          // Preserve SPN-042's healthy pending-save Retry proof before the
          // rejection: a rejected write may legitimately interrupt the room.
          await connection(page, 'Online');
          await saveTrigger.click();
          await page.getByRole('button', { name: 'Retry saving', exact: true }).click();
          await page.keyboard.press('Escape');
          await connection(page, 'Online');
          // A real rejected save remains unconfirmed; no production state is mocked.
          const rejectedResponse = page.waitForResponse(
            (response) => response.url().includes('/new_changes') && response.status() === 503,
          );
          failWrites = true;
          holdWrite = false;
          releaseWrite();
          await (await rejectedResponse).finished();
          await expect.poll(() => rejectedWrites).toBeGreaterThan(0);
          await expect(save).toContainText(/not saved|keep this tab open/i);
          await expect(save).toHaveAttribute('aria-live', 'polite');
          await expect(saveTrigger).toHaveText('Not saved');
          await expect.poll(() => documentBounds(canvas)).toEqual(savedBounds);
          await expect.poll(() => documentBounds(saveTrigger)).toEqual(slotBounds);
          await page.getByRole('button', { name: 'Save details: Not saved', exact: true }).click();
          const saveDetails = page.getByRole('dialog', { name: 'Save details', exact: true });
          await expect(saveDetails).toBeVisible();
          await expect.poll(() => documentBounds(canvas)).toEqual(savedBounds);
          for (const theme of width === 390 ? (['light'] as const) : (['light', 'dark'] as const)) {
            await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
            await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
            // Capture before asserting so teardown cannot hide a failing layout.
            await page.screenshot({
              path: `test-results/theme-screenshots/spn-043-${kind}-failed-${width === 390 ? 'phone' : theme}-${info.project.name}.png`,
              fullPage: true,
              animations: 'disabled',
            });
            if (
              (await page.evaluate(() => document.documentElement.scrollWidth)) > savedDocumentWidth
            ) {
              console.info(
                'Save overflow diagnostic',
                await page.evaluate(() => ({
                  viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
                  documentWidth: document.documentElement.scrollWidth,
                  controls: [
                    ...document.querySelectorAll(
                      '.save-slot, .save-trigger, .save-positioner, .save-detail',
                    ),
                  ].map((element) => ({
                    className: element.className,
                    rect: element.getBoundingClientRect().toJSON(),
                    position: getComputedStyle(element).position,
                  })),
                  overflow: [...document.body.querySelectorAll('*')]
                    .map((element) => ({
                      tag: element.tagName,
                      className: element.className,
                      text: element.textContent?.slice(0, 120),
                      rect: element.getBoundingClientRect().toJSON(),
                      position: getComputedStyle(element).position,
                    }))
                    .filter(
                      (element) =>
                        element.rect.width > 0 &&
                        element.rect.height > 0 &&
                        element.rect.right > innerWidth,
                    )
                    .sort((a, b) => b.rect.right - a.rect.right)
                    .slice(0, 16),
                })),
              );
            }
            // Native phone content already overflows in the base screenshots.
            // This control must fit the viewport and must add no document overflow.
            await expect
              .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
              .toBeLessThanOrEqual(savedDocumentWidth);
            for (const control of [saveTrigger, saveDetails]) {
              await expect
                .poll(() =>
                  control.evaluate((element) => {
                    const rect = element.getBoundingClientRect();
                    return (
                      rect.left >= 0 &&
                      rect.right <= innerWidth &&
                      rect.top >= 0 &&
                      rect.bottom <= innerHeight
                    );
                  }),
                )
                .toBe(true);
            }
            await expect(
              page.getByRole('button', { name: 'Retry saving', exact: true }),
            ).toBeInViewport();
          }
          await page.getByRole('button', { name: 'Retry saving', exact: true }).click();
          recoveryHeld = false;
          releaseRecovery();
          await page.keyboard.press('Escape');
          await expect(saveTrigger).toBeFocused();
          await expect.poll(() => documentBounds(canvas)).toEqual(savedBounds);
          await connection(page, 'Online');
          await capture(page, info, `${kind}-online-unsaved`, width === 390 ? 'phone' : 'light');
          holdWrite = false;
          releaseWrite();
          await saved();
          await expect(saveTrigger).toHaveText('Saved');
          await expect.poll(() => documentBounds(canvas)).toEqual(savedBounds);
          await expect.poll(() => documentBounds(saveTrigger)).toEqual(slotBounds);
          for (const theme of width === 390 ? (['light'] as const) : (['light', 'dark'] as const)) {
            await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
            await page.screenshot({
              path: `test-results/theme-screenshots/spn-043-${kind}-saved-${width === 390 ? 'phone' : theme}-${info.project.name}.png`,
              fullPage: true,
              animations: 'disabled',
            });
          }
          await page.evaluate(() => window.scrollTo(0, 0));
          await captureEditor('Online');
          const bounds = await canvas.boundingBox();
          expect(bounds).not.toBeNull();

          // Chromium can leave the socket connected when only its browser
          // offline switch changes. The app must restart that old socket after
          // discarding its proof, rather than wait forever for a no-op retry.
          network.holdJoinAcknowledgements();
          await context.setOffline(true);
          await connection(page, 'Offline');
          await expect.poll(() => canvas.boundingBox()).toEqual(bounds);
          await context.setOffline(false);
          await expect
            .poll(() => network.joinAcknowledgementHeld(), { timeout: 15_000 })
            .toBe(true);
          await connection(page, 'Reconnecting');
          await expect.poll(() => canvas.boundingBox()).toEqual(bounds);
          network.releaseJoinAcknowledgements();
          await connection(page, 'Online');
          await saved();

          // Keep this one catalog request unavailable through connection recovery
          // so its stale timestamp cannot disappear merely because the room joins.
          await page.route('**/api/items/shared', (route) =>
            route.fulfill({
              status: 503,
              json: { error: 'Shared files are temporarily unavailable.' },
            }),
          );
          await network.setOffline(true);
          await connection(page, 'Offline');
          // Wait for the actual five-second shared-list poll to fail as well.
          // Its background alert must remain available without moving the editor.
          const refreshShared = page.getByRole('button', {
            name: 'Refresh shared items',
            exact: true,
          });
          await expect(refreshShared).toBeVisible({ timeout: 10_000 });
          await expect.poll(() => canvas.boundingBox()).toEqual(bounds);
          await captureEditor('Offline');
          await expect.poll(() => canvas.boundingBox()).toEqual(bounds);

          network.holdJoinAcknowledgements();
          await network.setOffline(false);
          await expect
            .poll(() => network.joinAcknowledgementHeld(), { timeout: 15_000 })
            .toBe(true);
          expect(await page.evaluate(() => navigator.onLine)).toBe(true);
          expect((await context.request.get('/api/health')).ok()).toBe(true);
          await connection(page, 'Reconnecting');
          await expect.poll(() => canvas.boundingBox()).toEqual(bounds);
          // Capture the actual withheld-room state, then promptly release the real reply.
          await detail(page, 'Reconnecting', width === 390);
          await capture(page, info, `${kind}-reconnecting`, width === 390 ? 'phone' : 'light');
          network.releaseJoinAcknowledgements();
          await closeDetail(page);
          await connection(page, 'Online');
          await saved();
          await expect(refreshShared).toBeVisible();
          await detail(page, 'Online', width === 390);
          await expect(
            page.getByRole('dialog', { name: 'Connection details', exact: true }),
          ).toContainText('Files as of');
          await closeDetail(page);
          await page.unroute('**/api/items/shared');
          await expect(refreshShared).toHaveCount(0, { timeout: 10_000 });
          await expect.poll(() => canvas.boundingBox()).toEqual(bounds);
        } finally {
          recoveryHeld = false;
          releaseRecovery();
          failWrites = false;
          holdWrite = false;
          releaseWrite();
          network.releaseJoinAcknowledgements();
          await page.unrouteAll({ behavior: 'ignoreErrors' });
          await page.close();
          db.prepare('DELETE FROM workspace_items WHERE owner_id=?').run(user.id);
          db.prepare('DELETE FROM auth_users WHERE id=?').run(user.id);
          db.close();
        }
      });
    }
  });
}
