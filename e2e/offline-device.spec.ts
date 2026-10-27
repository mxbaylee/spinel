import { createHash, randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { CDPSession, Page, TestInfo } from '@playwright/test';
import sharp from 'sharp';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { mapNativeImageSources } from '../src/shared/nativeImageSources.ts';
import {
  edit,
  fixture,
  offlineSheetImages,
  pending,
  savedLocally,
  saveStatus,
  usableCanvas,
} from './offline-fixture.ts';
import type { OfflineFixture, Stored } from './offline-fixture.ts';

type Copy = { item?: Stored; images: { source: string; bytes: number[] }[] };

/** A noncreating observation, independent of indexedDB.databases availability. */
async function deviceCopy(page: Page, accountId: string, itemId: string): Promise<Copy | null> {
  return page.evaluate(
    ({ accountId, itemId }) =>
      new Promise<Copy | null>((resolve, reject) => {
        const opening = indexedDB.open(`spinel-offline-${accountId}`);
        let absent = false;
        opening.onupgradeneeded = () => {
          absent = true;
          opening.transaction?.abort();
        };
        opening.onerror = () => (absent ? resolve(null) : reject(opening.error));
        opening.onsuccess = () => {
          const db = opening.result;
          const tx = db.transaction(['items', 'images']);
          const item = tx.objectStore('items').get(itemId);
          const images = tx
            .objectStore('images')
            .getAll(IDBKeyRange.bound([itemId, ''], [itemId, '\uffff']));
          tx.onabort = tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
          tx.oncomplete = () => {
            db.close();
            resolve({
              item: item.result,
              images: images.result.map((image: { source: string; bytes: Uint8Array }) => ({
                source: image.source,
                bytes: [...image.bytes],
              })),
            });
          };
        };
      }),
    { accountId, itemId },
  );
}

const panel = (page: Page) => page.getByRole('region', { name: 'Offline documents', exact: true });
const row = (page: Page, name: string) =>
  panel(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name, exact: true }) });
async function device(page: Page) {
  await page.goto('/profile#device');
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled({
    timeout: 30_000,
  });
}
async function refresh(page: Page) {
  await panel(page).getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled({
    timeout: 30_000,
  });
}
async function removeDialog(page: Page, name: string) {
  await panel(page)
    .getByRole('button', { name: `Remove ${name} from device`, exact: true })
    .click();
}
async function listDownload(page: Page, name: string) {
  await page.getByRole('button', { name: `More actions for ${name}`, exact: true }).click();
  await page
    .getByRole('menuitem', { name: 'Available offline on this device', exact: true })
    .click();
}
async function downloaded(page: Page, name: string) {
  await expect(
    page.getByRole('status').filter({ hasText: `${name} is available offline on this device.` }),
  ).toHaveText(`${name} is available offline on this device.`, { timeout: 120_000 });
}
async function accountDatabases(cdp: CDPSession, origin: string) {
  const result = await cdp.send('IndexedDB.requestDatabaseNames', { securityOrigin: origin });
  return result.databaseNames
    .filter((name: string) => /^spinel-offline-[a-f\d-]{36}$/i.test(name))
    .sort();
}
async function importImages(f: OfflineFixture, origin: string, name: string, large = false) {
  let snapshot = await offlineSheetImages();
  if (large) {
    const png = await sharp(randomBytes(640 * 640 * 3), {
      raw: { width: 640, height: 640, channels: 3 },
    })
      .png()
      .toBuffer();
    snapshot = mapNativeImageSources(
      snapshot,
      () => `data:image/png;base64,${png.toString('base64')}`,
    );
  }
  const response = await f.control.request.post('/api/items/import', {
    headers: { Origin: origin },
    data: { filename: `${name}.univer.json`, parentId: null, snapshot },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).item as { id: string; name: string };
}
async function capture(page: Page, info: TestInfo, state: string) {
  await mkdir('test-results/theme-screenshots', { recursive: true });
  for (const [theme, width] of [
    ['light', 1440],
    ['dark', 1440],
    ['light', 390],
    ['dark', 390],
  ] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: `test-results/theme-screenshots/spn-055-${state}-${theme}-${width}-${info.project.name}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
}
function assertImageBytes(copy: Copy) {
  for (const image of copy.item!.bundle.images) {
    const stored = copy.images.find((entry) => entry.source === image.source)!;
    expect(stored.bytes.length).toBe(image.byteLength);
    expect(createHash('sha256').update(new Uint8Array(stored.bytes)).digest('hex')).toBe(
      image.sha256,
    );
  }
}
function displayedBytes(text: string) {
  const match = text.match(/([\d.]+) (B|KB|MB|GB)\b/);
  expect(match, 'A verified device item reports an estimated size.').not.toBeNull();
  return Number(match![1]) * 1024 ** ['B', 'KB', 'MB', 'GB'].indexOf(match![2]);
}

test('device storage reports actual image bytes, pending Space work, persistence and exact links', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(240_000);
  const f = await fixture(browser, baseURL!, info, 'sheet', { images: true });
  try {
    await f.download();
    const sheet = await deviceCopy(f.page, f.actor.id, f.item.id);
    assertImageBytes(sheet!);
    const root = f.spaces.createRoot(f.owner.id, { name: 'Prepared trip', parentId: null }).space;
    const doc = f.spaces.createChild(f.owner.id, root.id, {
      name: 'Unsent trip journal',
      kind: 'doc',
      parentId: root.id,
    }).item;
    const prefix = `/api/spaces/${root.id}/items/${doc.id}`;
    const preparing = await f.control.request.post(`${prefix}/collaboration`, {
      headers: { Origin: baseURL! },
      data: {},
    });
    expect(preparing.status()).toBe(200);
    const unitId = (await preparing.json()).unitId as string;
    const original = await f.control.request
      .get(`/sync-api/spaces/${root.id}/items/${doc.id}/snapshot?unitId=${unitId}`)
      .then((response) => response.json());
    await f.page.goto(`/spaces/${root.id}?item=${doc.id}`);
    await expect(saveStatus(f.page)).toHaveText('All changes saved.', { timeout: 30_000 });
    await f.page.getByRole('button', { name: 'Document actions', exact: true }).click();
    await f.page.getByRole('menuitem', { name: 'Offline copies', exact: true }).click();
    const downloads = f.page.getByRole('dialog', { name: 'Offline copies', exact: true });
    await downloads
      .getByRole('button', { name: `Make ${doc.name} available offline on this device` })
      .click();
    await downloaded(f.page, doc.name);
    await downloads.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await f.network.setOffline(true);
    await edit(f.page, 'doc', 'Saved offline travel note 551 ');
    await savedLocally(f.page);
    const retained = await deviceCopy(f.page, f.actor.id, doc.id);
    expect(pending(retained?.item?.outbox?.checkpoint)).toBe(true);
    await device(f.page);
    await expect(
      row(f.page, f.item.name).getByText('Available offline', { exact: true }),
    ).toBeVisible();
    await expect(row(f.page, doc.name).getByText('Pending changes', { exact: true })).toBeVisible();
    await expect(row(f.page, doc.name).getByRole('link')).toHaveAttribute(
      'href',
      `/?offlineRecovery=${doc.id}`,
    );
    await expect(row(f.page, f.item.name).getByRole('link')).toHaveAttribute(
      'href',
      `/?item=${f.item.id}`,
    );
    const measured = await deviceCopy(f.page, f.actor.id, f.item.id);
    assertImageBytes(measured!);
    const estimate =
      new TextEncoder().encode(JSON.stringify(measured!.item)).byteLength +
      measured!.images.reduce((sum, image) => sum + image.bytes.length, 0);
    const shown = displayedBytes(
      await row(f.page, f.item.name).locator('.device-storage-meta').innerText(),
    );
    expect(shown).toBeGreaterThan(estimate * 0.95);
    expect(shown).toBeLessThan(estimate * 1.05);
    const protectedStorage = await f.page.evaluate(() => navigator.storage.persisted());
    await expect(
      panel(f.page).getByText(
        protectedStorage
          ? 'Your browser granted storage protection.'
          : 'Your browser did not grant storage protection.',
      ),
    ).toBeVisible();
    await expect(panel(f.page).getByText('Browser storage for this site')).toBeVisible();
    expect(await deviceCopy(f.page, f.actor.id, doc.id)).toEqual(retained);
    await capture(f.page, info, 'device-documents');
    await panel(f.page).getByRole('button', { name: 'About device storage' }).click();
    await expect(
      f.page.getByRole('dialog').getByText(/Protection is not a backup or a guarantee/),
    ).toBeVisible();
    await f.page.keyboard.press('Escape');
    await expect(panel(f.page).getByRole('button', { name: 'About device storage' })).toBeFocused();
    // Keep real resume messages delayed so opening the ordinary online Space UI
    // cannot consume the pending queue before testing its removal handoff.
    f.network.holdResume();
    await f.network.setOffline(false);
    await f.page.setViewportSize({ width: 1440, height: 900 });
    await f.page.goto(`/spaces/${root.id}?item=${doc.id}`);
    await usableCanvas(f.page);
    await f.page.getByRole('button', { name: 'Document actions', exact: true }).click();
    await f.page.getByRole('menuitem', { name: 'Offline copies', exact: true }).click();
    await f.page
      .getByRole('button', { name: `Remove ${doc.name} from this device`, exact: true })
      .click();
    await expect(f.page.getByRole('link', { name: 'Open recovery', exact: true })).toHaveAttribute(
      'href',
      `/?offlineRecovery=${doc.id}`,
    );
    expect(await deviceCopy(f.page, f.actor.id, doc.id)).toEqual(retained);
    expect(
      await f.control.request
        .get(`/sync-api/spaces/${root.id}/items/${doc.id}/snapshot?unitId=${unitId}`)
        .then((response) => response.json()),
    ).toEqual(original);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('real browser quota failure retains pending work and images without a partial new download', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(240_000);
  const f = await fixture(browser, baseURL!, info, 'sheet', { images: true });
  const cdp = await f.context.newCDPSession(f.page);
  try {
    await f.download();
    const original = await f.read();
    await f.network.setOffline(true);
    await edit(f.page, 'sheet', '552');
    await savedLocally(f.page);
    const retained = await deviceCopy(f.page, f.actor.id, f.item.id);
    expect(pending(retained?.item?.outbox?.checkpoint)).toBe(true);
    await device(f.page);
    await f.network.setOffline(false);
    const target = await importImages(f, baseURL!, 'Large offline image', true);
    await f.page.goto('/');
    let fetchedImages = 0;
    f.page.on('response', (response) => {
      if (response.url().includes(`/api/items/${target.id}/images/`) && response.ok())
        fetchedImages++;
    });
    const usage = await cdp.send('Storage.getUsageAndQuota', { origin: baseURL! });
    await cdp.send('Storage.overrideQuotaForOrigin', {
      origin: baseURL!,
      quotaSize: usage.usage + 64 * 1024,
    });
    await listDownload(f.page, target.name);
    await expect(f.page.getByRole('alert').filter({ hasText: /space/i })).toBeVisible({
      timeout: 120_000,
    });
    expect(fetchedImages).toBeGreaterThan(0);
    expect((await deviceCopy(f.page, f.actor.id, target.id))?.item).toBeUndefined();
    expect(await deviceCopy(f.page, f.actor.id, f.item.id)).toEqual(retained);
    assertImageBytes(retained!);
    expect(await f.read()).toEqual(original);
    await cdp.send('Storage.overrideQuotaForOrigin', { origin: baseURL! });
    await listDownload(f.page, target.name);
    await downloaded(f.page, target.name);
    const copied = await deviceCopy(f.page, f.actor.id, target.id);
    expect(copied?.item?.bundle.itemId).toBe(target.id);
    assertImageBytes(copied!);
    expect(await deviceCopy(f.page, f.actor.id, f.item.id)).toEqual(retained);
    expect(f.errors).toEqual([]);
  } finally {
    await cdp.send('Storage.overrideQuotaForOrigin', { origin: baseURL! }).catch(() => {});
    await f.close();
  }
});

test('failed required-image reads keep an earlier complete copy and never mark a first download available', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(180_000);
  const f = await fixture(browser, baseURL!, info, 'sheet', { images: true });
  try {
    await f.download();
    const complete = await deviceCopy(f.page, f.actor.id, f.item.id);
    const target = await importImages(f, baseURL!, 'Image download interrupted');
    const failed = new Set<string>();
    const pattern = '**/api/items/*/images/*';
    await f.page.route(pattern, (route) => {
      failed.add(new URL(route.request().url()).pathname.split('/')[3]);
      return route.abort('failed');
    });
    await f.page.goto('/');
    await expect.poll(() => failed.has(f.item.id), { timeout: 60_000 }).toBe(true);
    await listDownload(f.page, target.name);
    await expect(
      f.page
        .getByRole('alert')
        .filter({ hasText: 'Could not download. Check your connection and try again.' }),
    ).toBeVisible({ timeout: 60_000 });
    expect(failed.has(target.id)).toBe(true);
    expect(await deviceCopy(f.page, f.actor.id, f.item.id)).toEqual(complete);
    expect((await deviceCopy(f.page, f.actor.id, target.id))?.item).toBeUndefined();
    await device(f.page);
    await expect(
      row(f.page, f.item.name).getByText('Available offline', { exact: true }),
    ).toBeVisible();
    await expect(panel(f.page).getByRole('link', { name: target.name })).toHaveCount(0);
    await f.page.unroute(pattern);
    await f.page.goto('/');
    await listDownload(f.page, target.name);
    await downloaded(f.page, target.name);
    assertImageBytes((await deviceCopy(f.page, f.actor.id, target.id))!);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('external store and image deletion are reported honestly; damaged pending data needs explicit discard', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(240_000);
  const f = await fixture(browser, baseURL!, info, 'sheet', { images: true });
  const cdp = await f.context.newCDPSession(f.page);
  try {
    await f.download();
    const original = await f.read();
    await f.network.setOffline(true);
    await edit(f.page, 'sheet', '554');
    await savedLocally(f.page);
    await device(f.page);
    const marker = await f.page.evaluate(() => localStorage.getItem('spinel.offline.account'));
    expect(marker).toBe(f.actor.id);
    await cdp.send('IndexedDB.deleteDatabase', {
      securityOrigin: baseURL!,
      databaseName: `spinel-offline-${f.actor.id}`,
    });
    await refresh(f.page);
    await expect(panel(f.page).getByText(/The saved device data is missing/)).toBeVisible();
    await expect(panel(f.page).getByRole('listitem')).toHaveCount(0);
    expect(await accountDatabases(cdp, baseURL!)).not.toContain(`spinel-offline-${f.actor.id}`);
    await f.network.setOffline(false);
    await device(f.page);
    expect(await accountDatabases(cdp, baseURL!)).not.toContain(`spinel-offline-${f.actor.id}`);
    // Explicit preparation is allowed to make a new store; passive observation was not.
    await f.download();
    await f.network.setOffline(true);
    await edit(f.page, 'sheet', '555');
    await savedLocally(f.page);
    const retained = await deviceCopy(f.page, f.actor.id, f.item.id);
    await device(f.page);
    const missingImage = retained!.images[0].source;
    await f.page.evaluate(
      ({ account, item, source }) =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open(`spinel-offline-${account}`);
          open.onerror = () => reject(open.error);
          open.onupgradeneeded = () => {
            open.transaction?.abort();
            reject(new Error('The test copy is absent.'));
          };
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction('images', 'readwrite');
            tx.objectStore('images').delete([item, source]);
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onabort = tx.onerror = () => {
              db.close();
              reject(tx.error);
            };
          };
        }),
      { account: f.actor.id, item: f.item.id, source: missingImage },
    );
    await refresh(f.page);
    await expect(
      row(f.page, f.item.name).getByText('Needs attention', { exact: true }),
    ).toBeVisible();
    await expect(
      row(f.page, f.item.name).getByText('Pending changes', { exact: true }),
    ).toBeVisible();
    const damaged = await deviceCopy(f.page, f.actor.id, f.item.id);
    expect(damaged?.item).toEqual(retained?.item);
    expect(damaged?.images).toEqual(
      retained!.images.filter((image) => image.source !== missingImage),
    );
    await removeDialog(f.page, f.item.name);
    await f.page.getByRole('button', { name: 'Discard offline changes…', exact: true }).click();
    await f.page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await deviceCopy(f.page, f.actor.id, f.item.id)).toEqual(damaged);
    await removeDialog(f.page, f.item.name);
    await f.page.getByRole('button', { name: 'Discard offline changes…', exact: true }).click();
    await f.page.getByRole('button', { name: 'Discard offline changes', exact: true }).click();
    await expect(panel(f.page).getByRole('status')).toContainText('was removed from this device');
    expect((await deviceCopy(f.page, f.actor.id, f.item.id))?.item).toBeUndefined();
    expect(await f.read()).toEqual(original);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('browsers without database enumeration create account stores only through explicit preparation', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(180_000);
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth);
  const users = [
    auth.createUser('Device account A'),
    auth.createUser('Device account B'),
    auth.createUser('Device account C'),
    auth.createUser('Device operator', true),
  ];
  const document = workspace.create(users[0].id, {
    name: 'Only account A can see this download',
    kind: 'doc',
    parentId: null,
  });
  const context = await browser.newContext({ baseURL });
  await context.addInitScript(() =>
    Object.defineProperty(IDBFactory.prototype, 'databases', {
      configurable: true,
      value: undefined,
    }),
  );
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const signIn = async (user: (typeof users)[number]) => {
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
    await page.goto('/profile#device');
    await expect(page.getByRole('heading', { name: 'Your profile', exact: true })).toBeVisible();
    expect(await page.evaluate(() => typeof indexedDB.databases)).toBe('undefined');
  };
  try {
    for (const user of users) {
      await signIn(user);
      if (user.is_admin) await expect(panel(page)).toHaveCount(0);
      else
        await expect(
          panel(page).getByText('No documents are downloaded for this account.'),
        ).toBeVisible();
      expect(await accountDatabases(cdp, baseURL!)).toEqual([]);
    }
    await signIn(users[0]);
    await page.goto('/');
    await listDownload(page, document.name);
    await downloaded(page, document.name);
    const expected = [`spinel-offline-${users[0].id}`];
    expect(await accountDatabases(cdp, baseURL!)).toEqual(expected);
    await device(page);
    await expect(panel(page).getByRole('link', { name: document.name })).toHaveAttribute(
      'href',
      `/?item=${document.id}`,
    );
    await page.reload();
    await expect(panel(page).getByRole('link', { name: document.name })).toBeVisible();
    for (const user of [users[1], users[3]]) {
      await signIn(user);
      await expect(page.getByText(document.name, { exact: true })).toHaveCount(0);
      expect(await accountDatabases(cdp, baseURL!)).toEqual(expected);
    }
    await signIn(users[0]);
    await expect(panel(page).getByRole('link', { name: document.name })).toBeVisible();
    await cdp.send('IndexedDB.deleteDatabase', {
      securityOrigin: baseURL!,
      databaseName: expected[0],
    });
    await refresh(page);
    await expect(panel(page).getByRole('link', { name: document.name })).toHaveCount(0);
    await page.reload();
    await expect(panel(page).getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
    expect(await accountDatabases(cdp, baseURL!)).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    db.close();
  }
});

test('writer locks and a newly pending copy prevent clean removal; explicit discard preserves the original', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(240_000);
  const f = await fixture(browser, baseURL!, info, 'sheet');
  try {
    await f.download();
    const original = await f.read();
    const complete = await deviceCopy(f.page, f.actor.id, f.item.id);
    const management = await f.context.newPage();
    await device(management);
    await removeDialog(management, f.item.name);
    await management.getByRole('button', { name: 'Remove from device', exact: true }).click();
    await expect(management.getByRole('dialog').getByRole('alert')).toContainText(
      'Close this document',
    );
    expect(await deviceCopy(management, f.actor.id, f.item.id)).toEqual(complete);
    await management.getByRole('button', { name: 'Cancel', exact: true }).click();
    await device(f.page); // Close the native writer without starting a background download refresh.
    await removeDialog(management, f.item.name);
    await management.getByRole('button', { name: 'Remove from device', exact: true }).click();
    await expect(panel(management).getByRole('status')).toContainText(
      'was removed from this device',
    );
    expect((await deviceCopy(management, f.actor.id, f.item.id))?.item).toBeUndefined();
    expect(await f.read()).toEqual(original);
    await f.download();
    await refresh(management);
    await removeDialog(management, f.item.name);
    await expect(
      management.getByRole('dialog', { name: 'Remove device copy?', exact: true }),
    ).toBeVisible();
    await f.network.setOffline(true);
    await edit(f.page, 'sheet', '556');
    await savedLocally(f.page);
    const retained = await deviceCopy(f.page, f.actor.id, f.item.id);
    await device(f.page); // Retire the real writer, keeping its committed pending queue.
    await management.getByRole('button', { name: 'Remove from device', exact: true }).click();
    const protectedDialog = management.getByRole('dialog', {
      name: 'Keep your offline changes',
      exact: true,
    });
    await expect(protectedDialog.getByRole('status')).toContainText('Nothing was removed.');
    expect(await deviceCopy(management, f.actor.id, f.item.id)).toEqual(retained);
    await protectedDialog.getByRole('button', { name: 'Keep on device', exact: true }).click();
    await expect(
      panel(management).getByRole('button', { name: `Remove ${f.item.name} from device` }),
    ).toBeFocused();
    f.network.holdResume();
    await f.network.setOffline(false);
    await f.page.goto('/');
    await f.page
      .getByRole('button', { name: `More actions for ${f.item.name}`, exact: true })
      .click();
    await f.page.getByRole('menuitem', { name: 'Remove from device', exact: true }).click();
    await expect(f.page.getByRole('link', { name: 'Open recovery', exact: true })).toHaveAttribute(
      'href',
      `/?offlineRecovery=${f.item.id}`,
    );
    expect(await deviceCopy(f.page, f.actor.id, f.item.id)).toEqual(retained);
    await removeDialog(management, f.item.name);
    await management.getByRole('button', { name: 'Discard offline changes…', exact: true }).click();
    await management.getByRole('button', { name: 'Discard offline changes', exact: true }).click();
    await expect(panel(management).getByRole('status')).toContainText(
      'was removed from this device',
    );
    expect((await deviceCopy(management, f.actor.id, f.item.id))?.item).toBeUndefined();
    expect(await f.read()).toEqual(original);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});
