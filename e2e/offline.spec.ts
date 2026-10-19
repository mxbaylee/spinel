import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { sheetImageFixture } from './sheet-image-fixture.ts';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';

// Offline downloads need the production build's shell manifest (docs/offline.md).
test('downloaded Sheets and Docs open read-only offline with local images; nothing else does', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth);
  const user = auth.createUser(`Offline ${info.testId}`);
  const doc = workspace.create(user.id, { name: 'Offline notes', kind: 'doc', parentId: null });
  workspace.create(user.id, { name: 'Online only', kind: 'sheet', parentId: null });
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
    const imported = await context.request.post('/api/items/import', {
      headers: { Origin: baseURL! },
      data: {
        filename: 'Sheet images.univer.json',
        parentId: null,
        snapshot: await sheetImageFixture(),
      },
    });
    expect(imported.status(), await imported.text()).toBe(201);
    const sheet = (await imported.json()).item as { id: string; name: string };
    // The saved pin list is part of the catalog that opens offline.
    workspace.pin(user.id, doc.id);

    await page.goto('/');
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);
    // An unprepared device keeps nothing (pwa.spec.ts checks the same on HTTPS).
    expect(await page.evaluate(() => caches.keys())).toEqual([]);
    for (const name of [sheet.name, doc.name]) {
      await page
        .getByRole('button', { name: `Make ${name} available offline on this device` })
        .click();
      await expect(page.getByRole('status').filter({ hasText: 'available offline' })).toHaveText(
        `${name} is available offline on this device.`,
        { timeout: 120_000 },
      );
    }
    // Only the public app shell is cached; documents live in IndexedDB.
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const paths: string[] = [];
      for (const name of names)
        for (const request of await (await caches.open(name)).keys())
          paths.push(new URL(request.url).pathname);
      return { names, paths };
    });
    expect(cached.names).toHaveLength(1);
    expect(cached.names[0]).toMatch(/^spinel-shell-[0-9a-f]{16}$/);
    expect(cached.paths).toContain('/');
    for (const path of cached.paths) expect(path).toMatch(/^\/$|^\/assets\/[^/]+$/);
    expect(
      await page.evaluate(async () => (await indexedDB.databases()).map((entry) => entry.name)),
    ).toContain(`spinel-offline-${user.id}`);

    // A failed background refresh keeps the last complete copy.
    let refused = 0;
    await page.route('**/api/items/*/images/*', (route) => {
      refused++;
      return route.abort();
    });
    await page.reload();
    await expect.poll(() => refused, { timeout: 60_000 }).toBeGreaterThan(0);
    await expect(
      page.getByRole('button', { name: `Remove ${sheet.name} from this device` }),
    ).toBeVisible();
    await page.unrouteAll({ behavior: 'wait' });

    const api: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/items')) api.push(request.url());
    });
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('status').filter({ hasText: 'Files as of' })).toBeVisible({
      timeout: 30_000,
    });
    const row = (name: string) =>
      page
        .getByRole('list', { name: 'Folder contents' })
        .getByRole('listitem')
        .filter({
          has: page.locator('.item-open', { hasText: name }),
        });
    await expect(row(sheet.name)).toContainText('Available offline');
    await expect(row(doc.name)).toContainText('Available offline');
    await expect(row('Online only')).toContainText('Needs a connection');
    await expect(page.getByRole('complementary', { name: 'Pinned items' })).toContainText(doc.name);
    // Local mode offers nothing that would reach the server.
    await expect(
      page.getByRole('button', { name: /available offline on this device/ }),
    ).toHaveCount(0);

    await row(sheet.name).locator('.item-open').click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Read only on this device' }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel('Spreadsheet grid', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled();
    const rgb = [
      [255, 153, 0],
      [34, 85, 238],
      [34, 187, 102],
    ];
    const pixels = async () => {
      const { data, info: meta } = await sharp(await page.locator('.univer-container').screenshot())
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const counts = [0, 0, 0];
      for (let offset = 0; offset < data.length; offset += meta.channels)
        rgb.forEach((color, index) => {
          if (color.every((value, channel) => Math.abs(data[offset + channel] - value) < 12))
            counts[index]++;
        });
      return counts;
    };
    // Floating, in-cell and background images all come from verified local bytes.
    await expect
      .poll(async () => (await pixels()).every((count) => count > 1000), { timeout: 25_000 })
      .toBe(true);

    await page.goBack();
    await row(doc.name).locator('.item-open').click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Read only on this device' }),
    ).toBeVisible({ timeout: 30_000 });
    await page.goBack();
    await row('Online only').locator('.item-open').click();
    await expect(page.getByText('Online only needs a connection.')).toBeVisible();
    expect(api).toEqual([]);

    // Pages that need the server get the generic offline page, never the shell.
    await page.goto('/share/offline-link');
    await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();

    // A session the server ended (a 401) stops offline access on this device,
    // so the next offline launch opens no local data.
    await context.setOffline(false);
    await context.clearCookies();
    await page.goto('/');
    await expect(page).toHaveURL(/\/sign-in/);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('spinel.offline.account')))
      .toBeNull();
    await context.setOffline(true);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
    await expect(page.getByText(sheet.name)).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    db.close();
  }
});
