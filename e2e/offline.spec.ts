import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';
import sharp from 'sharp';
import { sheetImageFixture } from './sheet-image-fixture.ts';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import type { OfflineBundle } from '../src/shared/offlineBundle.ts';

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
  // IMAGE() loads its URL directly; offline copies show stored values only.
  const tracked: string[] = [];
  context.on('request', (request) => {
    if (new URL(request.url()).hostname === 'tracker.invalid') tracked.push(request.url());
  });
  try {
    const snapshot = await sheetImageFixture();
    (snapshot.sheets.tab.cellData as Record<number, unknown>)[4] = {
      // No stored value: the default mode would compute it on open.
      0: { f: '=IMAGE("https://tracker.invalid/pixel.png")' },
    };
    const imported = await context.request.post('/api/items/import', {
      headers: { Origin: baseURL! },
      data: { filename: 'Sheet images.univer.json', parentId: null, snapshot },
    });
    expect(imported.status(), await imported.text()).toBe(201);
    const sheet = (await imported.json()).item as { id: string; name: string };

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
    const stored = () =>
      page.evaluate(
        ({ name, itemId }) =>
          new Promise<{ revision: number; downloadedAt: number }>((resolve, reject) => {
            const open = indexedDB.open(name);
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const request = open.result
                .transaction('items', 'readonly')
                .objectStore('items')
                .get(itemId);
              request.onerror = () => reject(request.error);
              request.onsuccess = () => {
                open.result.close();
                const { revision, downloadedAt } = request.result;
                resolve({ revision, downloadedAt });
              };
            };
          }),
        { name: `spinel-offline-${user.id}`, itemId: sheet.id },
      );
    const before = await stored();
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
    expect(await stored()).toEqual(before);

    const api: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/items')) api.push(request.url());
    });
    await context.setOffline(true);
    // A catalog saved by an older app may still contain pins. Opening it must
    // preserve the downloaded files without restoring the removed feature.
    await page.evaluate(
      ({ accountId, legacyPin }) =>
        new Promise<void>((resolve, reject) => {
          const opening = indexedDB.open(`spinel-offline-${accountId}`);
          opening.onerror = () => reject(opening.error);
          opening.onsuccess = () => {
            const database = opening.result;
            const transaction = database.transaction('meta', 'readwrite');
            const meta = transaction.objectStore('meta');
            const catalog = meta.get('catalog');
            catalog.onsuccess = () => meta.put({ ...catalog.result, pins: [legacyPin] }, 'catalog');
            transaction.oncomplete = () => {
              database.close();
              resolve();
            };
            transaction.onabort = () => {
              database.close();
              reject(transaction.error);
            };
          };
        }),
      { accountId: user.id, legacyPin: doc },
    );
    await page.reload();
    const connection = page.getByRole('button', {
      name: 'Offline — not connected to Spinel',
      exact: true,
    });
    await expect(connection).toBeVisible({ timeout: 30_000 });
    await connection.hover();
    await expect(
      page.getByRole('dialog', { name: 'Connection details', exact: true }),
    ).toContainText('Files as of');
    await expect(page.locator('.banner').filter({ hasText: 'Files as of' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Connection details', exact: true })).toHaveCount(
      0,
    );
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
    await expect(page.getByRole('complementary', { name: 'Pinned items' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^(Pin|Unpin) / })).toHaveCount(0);
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
    expect(tracked).toEqual([]);

    // Pages that need the server get the generic offline page, never the shell.
    await page.goto('/share/offline-link');
    await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();

    // Another tab releasing the device closes local data here too.
    await page.goto('/');
    await expect(connection).toBeVisible({ timeout: 30_000 });
    await connection.hover();
    await expect(
      page.getByRole('dialog', { name: 'Connection details', exact: true }),
    ).toContainText('Files as of');
    await page.keyboard.press('Escape');
    const other = await context.newPage();
    await other.goto('/');
    await other.evaluate(() => localStorage.removeItem('spinel.offline.account'));
    await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
    await expect(page.getByText(sheet.name)).toHaveCount(0);
    await other.close();

    // Signing in online again claims the device back for its downloads.
    await context.setOffline(false);
    await page.goto('/');
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('spinel.offline.account')))
      .toBe(user.id);
    // Let the background refresh finish before the session ends under it.
    await page.waitForLoadState('networkidle');

    // A session the server ended (a 401) stops offline access on this device,
    // so the next offline launch opens no local data.
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

test('a prepared Space Doc opens natively offline from its normal link and My files, without substituting an unavailable child', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(180_000);
  // Reuse the production fixture and keep one native browser editor resident.
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1100 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db);
  const user = auth.createUser(`Offline Space ${info.testId}`);
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
  const orangePixels = async (surface: Locator) => {
    const { data, info: image } = await sharp(await surface.screenshot())
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let count = 0;
    for (let offset = 0; offset < data.length; offset += image.channels)
      if ([255, 153, 0].every((value, channel) => Math.abs(data[offset + channel] - value) < 12))
        count++;
    return count;
  };
  try {
    // The everyday API is enabled by default; no review flag or special server.
    const created = await context.request.post('/api/items', {
      headers: { Origin: baseURL! },
      data: { name: 'Offline field kit', kind: 'space', parentId: null },
    });
    expect(created.status(), await created.text()).toBe(201);
    const root = (await created.json()).item as { id: string; name: string };
    const child = async (name: string) => {
      const response = await context.request.post(`/api/spaces/${root.id}/items`, {
        headers: { Origin: baseURL! },
        data: { name, kind: 'doc', parentId: root.id },
      });
      expect(response.status(), await response.text()).toBe(201);
      return (await response.json()).item as { id: string; name: string };
    };
    const doc = await child('Prepared field notes');
    const missing = await child('Unprepared field notes');
    const rootHref = `/spaces/${root.id}`;
    const docHref = `${rootHref}?item=${doc.id}`;
    const childApi = `/api/spaces/${root.id}/items/${doc.id}`;
    const text = 'Native offline field notes 314';

    // Preparing a directly opened child must also retain its outer Space root,
    // even when this browser has never visited My files to cache a catalog.
    await page.goto(docHref);
    await expect(page).toHaveURL(baseURL! + docHref);
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);
    const editor = page.getByRole('region', { name: 'Doc document', exact: true });
    const saved = () =>
      expect(editor.getByRole('status', { name: 'Save status', exact: true })).toHaveText(
        'All changes saved.',
        { timeout: 30_000 },
      );
    await saved();
    await editor.locator('.univer-container').click({ position: { x: 130, y: 200 } });
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
    await saved();
    const insert = editor.getByRole('tab', { name: 'Insert', exact: true });
    await insert.click();
    await expect(insert).toHaveAttribute('aria-selected', 'true');
    const uploaded = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `${childApi}/images`,
    );
    const chooser = page.waitForEvent('filechooser');
    await editor.getByRole('button', { name: 'Image', exact: true }).click();
    await (
      await chooser
    ).setFiles({
      name: 'field-marker.png',
      mimeType: 'image/png',
      buffer: await sharp({
        create: { width: 120, height: 72, channels: 4, background: '#ff9900' },
      })
        .png()
        .toBuffer(),
    });
    expect((await uploaded).status()).toBe(201);
    await expect
      .poll(() => orangePixels(editor.locator('.univer-container')), { timeout: 25_000 })
      .toBeGreaterThan(1000);
    await saved();

    const availability = page.getByRole('region', { name: 'Offline availability', exact: true });
    const downloaded = page.waitForResponse(
      (response) => new URL(response.url()).pathname === `${childApi}/offline-bundle`,
      { timeout: 120_000 },
    );
    await availability
      .getByRole('button', { name: `Make ${doc.name} available offline on this device` })
      .click();
    const response = await downloaded;
    expect(response.status()).toBe(200);
    const bundle = (await response.json()) as OfflineBundle;
    expect(bundle).toMatchObject({
      accountId: user.id,
      spaceId: root.id,
      itemId: doc.id,
      kind: 'doc',
    });
    if (bundle.kind !== 'doc') throw new Error('The prepared child must be a Doc.');
    expect(bundle.snapshot.body?.dataStream).toContain(text);
    expect(bundle.snapshot.drawingsOrder).toHaveLength(1);
    expect(bundle.images).toHaveLength(1);
    await expect(availability.getByRole('status')).toHaveText(
      `${doc.name} is available offline on this device.`,
      { timeout: 120_000 },
    );

    const assertPreparedDoc = async () => {
      await expect(page.getByRole('heading', { name: doc.name, exact: true })).toBeVisible();
      const copy = page.getByRole('region', { name: 'Offline copy', exact: true });
      await expect(copy.getByRole('status')).toHaveText(
        'Read only on this device. Reconnect to edit.',
        { timeout: 30_000 },
      );
      await expect(copy.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled();
      const surface = copy.locator('.univer-container');
      // Inspect the native drawing itself: a cached manifest or image URL alone
      // would not prove that verified image bytes reach the offline renderer.
      await expect.poll(() => orangePixels(surface), { timeout: 25_000 }).toBeGreaterThan(1000);
      // Focus the text row above the drawing, not the image selection. Native
      // copy of a selected drawing legitimately has no plain-text payload.
      await surface.click({ position: { x: 220, y: 175 } });
      await page.keyboard.press('Control+a');
      await page.evaluate(() => navigator.clipboard.writeText('not copied'));
      await page.keyboard.press('Control+c');
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(text);
      await page.keyboard.press('ArrowRight');
    };

    await context.setOffline(true);
    await page.reload();
    await expect(page).toHaveURL(baseURL! + docHref);
    await assertPreparedDoc();
    await mkdir('test-results/theme-screenshots', { recursive: true });
    for (const [theme, width, variant] of [
      ['light', 1440, 'light'],
      ['dark', 1440, 'dark'],
      ['light', 390, 'phone'],
    ] as const) {
      await page.setViewportSize({ width, height: 1100 });
      await page
        .getByRole('radio', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true })
        .click();
      await expect(
        page.getByRole('region', { name: 'Offline copy', exact: true }).getByRole('status'),
      ).toHaveText('Read only on this device. Reconnect to edit.');
      await expect(
        page
          .getByRole('region', { name: 'Offline copy', exact: true })
          .getByRole('button', { name: 'Bold', exact: true }),
      ).toBeDisabled();
      const screenshot = `test-results/theme-screenshots/spn-092-space-native-doc-offline-${variant}-${info.project.name}.png`;
      await page.screenshot({ path: screenshot, fullPage: true });
      await info.attach(`Native prepared Space Doc and image (${variant})`, {
        path: screenshot,
        contentType: 'image/png',
      });
    }
    await page.setViewportSize({ width: 1440, height: 1100 });

    const remoteReads: string[] = [];
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (/^\/(?:api\/(?:spaces|items)(?:\/|$)|space-api\/)/.test(path)) remoteReads.push(path);
    });
    await page.getByRole('button', { name: 'My files', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'My files', exact: true })).toBeVisible();
    const contents = page.getByRole('list', { name: 'Folder contents', exact: true });
    const rootRow = contents.getByRole('listitem').filter({
      has: page.locator('.item-open', { hasText: root.name }),
    });
    await expect(rootRow).toContainText('Space');
    await expect(contents.getByText(doc.name, { exact: true })).toHaveCount(0);
    await expect(contents.getByText(missing.name, { exact: true })).toHaveCount(0);
    await rootRow.locator('.item-open').click();
    await expect(page).toHaveURL(baseURL! + rootHref);
    await assertPreparedDoc();

    const missingHref = `${rootHref}?item=${missing.id}`;
    await page.goto(missingHref);
    await expect(page).toHaveURL(baseURL! + missingHref);
    await expect(
      page.getByRole('status').filter({ hasText: 'This page needs a connection.' }),
    ).toHaveText(
      'This page needs a connection. It has not been prepared in this Space on this device.',
    );
    await expect(page.getByRole('heading', { name: root.name, exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Offline copy', exact: true })).toHaveCount(0);
    await expect(page.locator('.univer-container')).toHaveCount(0);
    // A prepared sibling remains a deliberate navigation choice, never a
    // substitute for the explicit child in the address bar.
    await expect(
      page
        .getByRole('navigation', { name: 'Prepared pages', exact: true })
        .getByRole('link', { name: doc.name, exact: true }),
    ).toHaveAttribute('href', docHref);
    expect(remoteReads).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    db.close();
  }
});
