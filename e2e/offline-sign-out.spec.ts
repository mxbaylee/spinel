import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { InvitationService } from '../src/server/auth/invitations.ts';
import { SetupService } from '../src/server/auth/setup.ts';
import { copy, edit, fixture, savedLocally, stored, usableCanvas } from './offline-fixture.ts';
import { startApp } from './app-process.ts';

// Real shell/download acceptance and CDP passkeys run in the production partition.
test.beforeEach(({ browserName }, info) => {
  test.skip(info.project.name !== 'production' || browserName !== 'chromium');
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function virtualPasskey(
  context: BrowserContext,
  page: Page,
  automaticPresenceSimulation = true,
) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation,
    },
  });
  return { cdp, authenticatorId };
}
async function capture(page: Page, info: TestInfo) {
  await mkdir('test-results/theme-screenshots', { recursive: true });
  for (const [theme, width] of [
    ['light', 1440],
    ['dark', 1440],
    ['light', 390],
  ] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `test-results/theme-screenshots/spn-055-locked-exit-${theme}-${width}-${info.project.name}.png`,
      fullPage: true,
    });
  }
}

/** Observe public compatibility holds without creating a missing control store. */
async function runtimeAccounts(page: Page) {
  return page.evaluate(
    () =>
      new Promise<Record<string, { format: number; sdkVersion: string }>>((resolve, reject) => {
        const opening = indexedDB.open('spinel-offline-runtime');
        opening.onupgradeneeded = () => {
          opening.transaction?.abort();
          reject(new Error('The prepared public runtime store is missing.'));
        };
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const database = opening.result;
          if (!database.objectStoreNames.contains('runtime')) {
            database.close();
            reject(new Error('The public runtime store is incomplete.'));
            return;
          }
          const transaction = database.transaction('runtime');
          const read = transaction.objectStore('runtime').get('state');
          transaction.onerror = transaction.onabort = () => {
            database.close();
            reject(transaction.error);
          };
          transaction.oncomplete = () => {
            database.close();
            if (!read.result?.accounts) reject(new Error('The runtime has no account holds.'));
            else resolve(read.result.accounts);
          };
        };
      }),
  );
}

test('offline exit locks both tabs, keeps exact Space changes, drains before an invitation and isolates the next account', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(180_000);
  const f = await fixture(browser, baseURL!, info, 'doc', { space: true, actor: 'editor' });
  let allowLogout = false;
  let refused = 0;
  const entryRequests: string[] = [];
  try {
    await f.download();
    const before = await f.read();
    await f.network.setOffline(true);
    await edit(f.page, 'doc', 'Kept through account exit 5581 ');
    await savedLocally(f.page);
    const checkpoint = await stored(f.page, f.actor.id, f.item.id);
    expect(checkpoint?.outbox).toBeDefined();
    const initialCookie = (await f.context.cookies()).find(
      (cookie) => cookie.name === COOKIE_NAME,
    )!.value;
    const profile = await f.context.newPage();
    await profile.goto('/profile');
    await expect(profile.getByRole('heading', { name: 'Your profile', exact: true })).toBeVisible();
    await f.context.route('**/api/auth/sign-out', async (route) => {
      if (!allowLogout) {
        refused++;
        await route.fulfill({ status: 503, json: { error: 'Temporary fixture outage' } });
      } else await route.continue();
    });
    await profile.getByRole('button', { name: 'Sign out', exact: true }).click();
    for (const page of [f.page, profile]) {
      await expect(
        page.getByRole('heading', { name: 'Local access is locked.', exact: true }),
      ).toBeVisible();
      await expect(page.locator('.univer-container')).toHaveCount(0);
      await expect(page.getByText(f.item.name, { exact: true })).toHaveCount(0);
    }
    await expect(profile.getByText(/1 document has pending or unchecked changes/)).toBeVisible();
    expect(f.auth.session(initialCookie)?.user_id).toBe(f.actor.id);
    expect(await stored(profile, f.actor.id, f.item.id)).toEqual(checkpoint);
    await capture(profile, info);
    await profile.setViewportSize({ width: 1440, height: 1100 });
    await profile.emulateMedia({ colorScheme: 'light' });
    await profile.getByRole('button', { name: 'Keep changes', exact: true }).click();
    await expect(
      profile.getByRole('status').filter({ hasText: 'Sign-out is saved for retry.' }),
    ).toBeVisible();
    // A normal cold entry also stays behind the exit barrier.
    await f.page.goto('/');
    await expect(
      f.page.getByRole('heading', { name: 'Local access is locked.', exact: true }),
    ).toBeVisible();
    expect(await stored(f.page, f.actor.id, f.item.id)).toEqual(checkpoint);
    const operator = f.auth.createUser('Exit fixture operator', true);
    const invite = new InvitationService(f.auth, baseURL!).create(operator.id);
    f.context.on('request', (request) => {
      if (
        /\/api\/auth\/(?:invite\/(?:details|options)|authentication\/options)/.test(request.url())
      )
        entryRequests.push(new URL(request.url()).pathname);
    });
    await f.network.setOffline(false);
    await expect.poll(() => refused).toBeGreaterThan(0);
    expect(f.auth.session(initialCookie)?.user_id).toBe(f.actor.id);
    await profile.goto(invite.url);
    await expect(profile).toHaveURL(baseURL! + '/invite');
    await expect(
      profile.getByRole('heading', { name: 'Local access is locked.', exact: true }),
    ).toBeVisible();
    await expect(profile.getByRole('button', { name: 'Join with a passkey' })).toHaveCount(0);
    expect(entryRequests).toEqual([]);
    await profile.getByRole('button', { name: 'Keep changes', exact: true }).click();
    allowLogout = true;
    await profile.getByRole('button', { name: 'Try sign-out again', exact: true }).click();
    await expect(
      profile.getByRole('button', { name: 'Join with a passkey', exact: true }),
    ).toBeVisible();
    expect(f.auth.session(initialCookie)).toBeUndefined();
    expect(await stored(profile, f.actor.id, f.item.id)).toEqual(checkpoint);
    // Complete the original invitation task after the barrier; no token was persisted.
    await f.page.close();
    await virtualPasskey(f.context, profile);
    await profile.getByLabel('Your name').fill('Next account');
    await profile.getByRole('button', { name: 'Join with a passkey', exact: true }).click();
    await expect(profile.getByRole('heading', { name: 'My files', exact: true })).toBeVisible();
    await expect(profile.getByText(f.item.name, { exact: true })).toHaveCount(0);
    await profile.goto(`/?offlineRecovery=${f.item.id}`);
    await expect(profile.getByRole('region', { name: 'Offline copy', exact: true })).toHaveCount(0);
    await expect(profile.locator('.univer-container')).toHaveCount(0);
    expect(await stored(profile, f.actor.id, f.item.id)).toEqual(checkpoint);
    expect(
      await profile.evaluate(() => JSON.stringify(Object.entries(localStorage))),
    ).not.toContain(new URL(invite.url).searchParams.get('token'));
    // Preparing B through the real Dashboard must preserve A's compatibility
    // hold and private checkpoint, even while B cannot see A's documents.
    const nextSession = await f.context.request.get('/api/auth/session');
    expect(nextSession.status()).toBe(200);
    const nextAccount = (await nextSession.json()).user.id as string;
    expect(nextAccount).not.toBe(f.actor.id);
    const created = await f.context.request.post('/api/items', {
      headers: { Origin: baseURL! },
      data: { name: 'Second account offline Doc', kind: 'doc', parentId: null },
    });
    expect(created.status(), await created.text()).toBe(201);
    const nextItem = (await created.json()).item as { id: string; name: string };
    await profile.goto('/');
    await profile
      .getByRole('button', { name: `More actions for ${nextItem.name}`, exact: true })
      .click();
    await profile
      .getByRole('menuitem', { name: 'Available offline on this device', exact: true })
      .click();
    await expect(
      profile
        .getByRole('status')
        .filter({ hasText: `${nextItem.name} is available offline on this device.` }),
    ).toHaveText(`${nextItem.name} is available offline on this device.`, { timeout: 120_000 });
    const holds = await runtimeAccounts(profile);
    expect(holds[f.actor.id]).toEqual({ format: 1, sdkVersion: '1.1.0' });
    expect(holds[nextAccount]).toEqual({ format: 1, sdkVersion: '1.1.0' });
    expect(
      await profile.evaluate(
        async () => (await caches.keys()).filter((name) => name.startsWith('spinel-shell-')).length,
      ),
    ).toBeLessThanOrEqual(3);
    expect(await stored(profile, f.actor.id, f.item.id)).toEqual(checkpoint);
    await expect(profile.getByText(f.item.name, { exact: true })).toHaveCount(0);
    // A fresh server-verified original account reclaims only its own unchanged queue.
    await f.context.addCookies([f.cookie(f.actor.id)]);
    await profile.goto('/');
    await expect(
      profile.getByRole('link', { name: `Recover ${f.item.name}`, exact: true }),
    ).toBeVisible();
    await f.network.setOffline(true);
    await profile.goto(f.href);
    await usableCanvas(profile);
    await savedLocally(profile);
    expect(await copy(profile, 'doc')).toContain('Kept through account exit 5581');
    expect(await f.read()).toEqual(before);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('locked deletion is explicit, refuses an active writer and clears only this account’s local changes', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(150_000);
  const f = await fixture(browser, baseURL!, info, 'sheet');
  try {
    await f.download();
    const original = await f.read();
    await f.network.setOffline(true);
    await edit(f.page, 'sheet', '5582');
    await savedLocally(f.page);
    const retained = await stored(f.page, f.actor.id, f.item.id);
    const profile = await f.context.newPage();
    await profile.goto('/profile');
    await profile.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(profile.getByText(/1 document has pending or unchecked changes/)).toBeVisible();
    await expect(f.page.locator('.univer-container')).toHaveCount(0);
    const key = `spinel-offline:${f.actor.id}:${f.item.id}`;
    await f.page.evaluate(
      (name) =>
        new Promise<void>((acquired) => {
          let release!: () => void;
          const held = new Promise<void>((done) => {
            release = done;
          });
          (window as Window & { releaseExitWriter?: () => void }).releaseExitWriter = release;
          void navigator.locks.request(name, async () => {
            acquired();
            await held;
          });
        }),
      key,
    );
    const remove = profile.getByRole('button', { name: 'Delete offline data…', exact: true });
    const open = () => remove.click();
    const dialog = profile.getByRole('dialog', {
      name: 'Delete this account’s offline data?',
      exact: true,
    });
    await open();
    await expect(dialog).toBeVisible();
    await profile.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(remove).toBeFocused();
    expect(await stored(profile, f.actor.id, f.item.id)).toEqual(retained);
    await open();
    await dialog.getByRole('button', { name: 'Delete offline data', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText(/Close|another tab|open/i);
    expect(await stored(profile, f.actor.id, f.item.id)).toEqual(retained);
    await f.page.evaluate(() =>
      (window as Window & { releaseExitWriter?: () => void }).releaseExitWriter?.(),
    );
    await dialog.getByRole('button', { name: 'Delete offline data', exact: true }).click();
    await expect(
      profile.getByText(
        'Offline data for this account was deleted from this device. Server documents were not changed.',
        { exact: true },
      ),
    ).toBeVisible();
    expect(await stored(profile, f.actor.id, f.item.id)).toBeUndefined();
    expect(await f.read()).toEqual(original);
    await expect(
      profile.getByRole('status').filter({ hasText: 'Sign-out is saved for retry.' }),
    ).toBeVisible();
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('ordinary passkeys work without Web Locks and an old logout response cannot clear the new cookie', async ({
  browser,
  baseURL,
}, info) => {
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db);
  const operator = auth.createUser('No-lock enrollment operator ' + info.testId, true);
  const invite = new InvitationService(auth, baseURL!).create(operator.id);
  const context = await browser.newContext({ baseURL });
  await context.addInitScript(() =>
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true }),
  );
  const oldPage = await context.newPage();
  const responseReady = deferred(),
    release = deferred();
  let pending: Promise<number> | undefined;
  try {
    const first = await virtualPasskey(context, oldPage);
    // Initial enrollment uses the real invitation ceremony. An unverified
    // legacy session cannot add a first passkey after SPN-070.
    await oldPage.goto(invite.url);
    await oldPage.getByLabel('Your name').fill('No-lock passkey ' + info.testId);
    await oldPage.getByRole('button', { name: 'Join with a passkey', exact: true }).click();
    await expect(oldPage.getByRole('heading', { name: 'My files', exact: true })).toBeVisible();
    const token = (await context.cookies()).find((cookie) => cookie.name === COOKIE_NAME)!.value;
    const user = auth.user(auth.session(token)!.user_id!)!;
    await oldPage.goto('/profile#passkeys');
    await expect(oldPage.getByRole('listitem').filter({ hasText: 'Passkey' })).toHaveCount(1);
    const credentials = await first.cdp.send('WebAuthn.getCredentials', {
      authenticatorId: first.authenticatorId,
    });
    // A static JSON response hosts a legacy client's fetch, without a current App
    // reacting to another tab's sign-in and navigating this pending request away.
    await oldPage.goto('/api/auth/session');
    await oldPage.route('**/api/auth/sign-out', async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(204);
      expect(response.headers()['set-cookie']).toBeUndefined();
      responseReady.resolve();
      await release.promise;
      await route.fulfill({ response });
    });
    pending = oldPage.evaluate(
      async () =>
        (
          await fetch('/api/auth/sign-out', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          })
        ).status,
    );
    await responseReady.promise;
    expect(auth.session(token)).toBeUndefined();
    const nextPage = await context.newPage();
    const second = await virtualPasskey(context, nextPage);
    for (const credential of credentials.credentials)
      await second.cdp.send('WebAuthn.addCredential', {
        authenticatorId: second.authenticatorId,
        credential,
      });
    await nextPage.goto('/sign-in');
    await nextPage.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();
    await expect(nextPage.getByRole('heading', { name: 'My files', exact: true })).toBeVisible();
    expect(await nextPage.evaluate(() => navigator.locks)).toBeUndefined();
    const before = (await context.cookies()).find((cookie) => cookie.name === COOKIE_NAME)!.value;
    expect(before).not.toBe(token);
    expect(auth.session(before)?.user_id).toBe(user.id);
    release.resolve();
    expect(await pending).toBe(204);
    expect((await context.cookies()).find((cookie) => cookie.name === COOKIE_NAME)!.value).toBe(
      before,
    );
    expect((await (await context.request.get('/api/auth/session')).json()).user.id).toBe(user.id);
  } finally {
    release.resolve();
    await pending?.catch(() => {});
    await context.close();
    db.close();
  }
});

test('a crashed local passkey prompt can reopen and complete authentication and logout', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(90_000);
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db);
  const operator = auth.createUser('Interrupted enrollment operator ' + info.testId, true);
  const invite = new InvitationService(auth, baseURL!).create(operator.id);
  const context = await browser.newContext({ baseURL });
  try {
    const interrupted = await context.newPage();
    const first = await virtualPasskey(context, interrupted);
    await interrupted.goto(invite.url);
    await interrupted.getByLabel('Your name').fill('Interrupted passkey ' + info.testId);
    await interrupted.getByRole('button', { name: 'Join with a passkey', exact: true }).click();
    await expect(interrupted.getByRole('heading', { name: 'My files', exact: true })).toBeVisible();
    const token = (await context.cookies()).find((cookie) => cookie.name === COOKIE_NAME)!.value;
    const user = auth.user(auth.session(token)!.user_id!)!;
    await first.cdp.send('WebAuthn.setAutomaticPresenceSimulation', {
      authenticatorId: first.authenticatorId,
      enabled: false,
    });
    await interrupted.goto('/profile#passkeys');
    const options = interrupted.waitForResponse(
      (response) =>
        response.url().endsWith('/api/auth/registration/options') && response.status() === 200,
    );
    await interrupted.getByRole('button', { name: 'Add a passkey', exact: true }).click();
    expect(await (await options).finished()).toBeNull();
    const readMarker = () =>
      interrupted.evaluate(() => {
        const entry = Object.entries(localStorage).find(([key]) =>
          key.startsWith('spinel.auth.active:'),
        );
        return entry ? { key: entry[0], raw: entry[1], marker: JSON.parse(entry[1]) } : null;
      });
    await expect.poll(readMarker).toMatchObject({
      marker: {
        version: 1,
        coordination: 'web-lock',
        phase: 'prompt',
      },
    });
    const retained = (await readMarker())!;
    // Kill the actual renderer while WebAuthn waits for presence. No application
    // finally block, fabricated marker, or fake auth response can perform cleanup.
    const crashed = interrupted.waitForEvent('crash');
    const crashing = first.cdp.send('Page.crash').catch(() => {});
    await crashed;
    await interrupted.close();
    await crashing;

    const reopened = await context.newPage();
    // This real JSON document has no App code to retire the abandoned marker.
    await reopened.goto('/api/auth/session');
    expect(await reopened.evaluate((key) => localStorage.getItem(key), retained.key)).toBe(
      retained.raw,
    );
    expect(auth.session(token)?.user_id).toBe(user.id);
    await virtualPasskey(context, reopened);
    await reopened.goto('/profile#passkeys');
    await expect(
      reopened.getByRole('button', { name: 'Add a passkey', exact: true }),
    ).toBeEnabled();
    expect(await reopened.evaluate((key) => localStorage.getItem(key), retained.key)).toBeNull();
    await reopened.getByRole('button', { name: 'Add a passkey', exact: true }).click();
    await expect(reopened.getByRole('listitem').filter({ hasText: 'Passkey' })).toHaveCount(2);
    await reopened.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(
      reopened.getByRole('button', { name: 'Sign in with a passkey', exact: true }),
    ).toBeVisible();
    expect(auth.session(token)).toBeUndefined();
    await reopened.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();
    await expect(reopened.getByRole('heading', { name: 'My files', exact: true })).toBeVisible();
    const current = await context.request.get('/api/auth/session');
    expect(current.status()).toBe(200);
    expect((await current.json()).user.id).toBe(user.id);
    expect(
      await reopened.evaluate(() =>
        Object.keys(localStorage).filter((key) => key.startsWith('spinel.auth.active:')),
      ),
    ).toEqual([]);
  } finally {
    await context.close();
    db.close();
  }
});

test('a retained pending exit finishes before a real fresh-instance setup task', async ({
  browser,
}, info) => {
  test.setTimeout(180_000);
  const directory = await mkdtemp(join(tmpdir(), 'spinel-offline-setup-'));
  const oldPath = join(directory, 'old.sqlite'),
    freshPath = join(directory, 'fresh.sqlite');
  const origin = 'http://localhost:3209';
  let app = await startApp({ databasePath: oldPath, origin, development: false });
  const f = await fixture(browser, origin, info, 'doc', { databasePath: oldPath });
  let fresh: ReturnType<typeof openDatabase> | undefined;
  let allowLogout = false;
  try {
    await f.download();
    await f.network.setOffline(true);
    await edit(f.page, 'doc', 'Retained across a fresh setup 5583 ');
    await savedLocally(f.page);
    const retained = await stored(f.page, f.actor.id, f.item.id);
    await f.page.goto('/profile');
    await f.page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(f.page.getByText(/1 document has pending or unchecked changes/)).toBeVisible();
    await f.context.route('**/api/auth/sign-out', (route) =>
      allowLogout
        ? route.continue()
        : route.fulfill({ status: 503, json: { error: 'Temporary fixture outage' } }),
    );
    await app.close();
    app = await startApp({ databasePath: freshPath, origin, development: false });
    fresh = openDatabase(freshPath);
    const auth = new AuthStore(fresh);
    const setup = new SetupService(auth, origin).issue();
    const secret = new URL(setup.url).hash.slice(1).split('.')[1];
    const requests: string[] = [];
    f.page.on('request', (request) => requests.push(request.url() + (request.postData() ?? '')));
    await f.network.setOffline(false);
    await f.page.goto(setup.url);
    await expect(f.page).toHaveURL(origin + '/setup');
    await expect(
      f.page.getByRole('heading', { name: 'Local access is locked.', exact: true }),
    ).toBeVisible();
    await expect(
      f.page.getByRole('button', { name: 'Create admin passkey', exact: true }),
    ).toHaveCount(0);
    expect(requests.some((request) => request.includes('/api/auth/setup/options'))).toBe(false);
    await f.page.getByRole('button', { name: 'Keep changes', exact: true }).click();
    allowLogout = true;
    await f.page.getByRole('button', { name: 'Try sign-out again', exact: true }).click();
    await expect(
      f.page.getByRole('button', { name: 'Create admin passkey', exact: true }),
    ).toBeVisible();
    expect(await stored(f.page, f.actor.id, f.item.id)).toEqual(retained);
    expect(await f.page.evaluate(() => localStorage.getItem('spinel.offline.sign-out'))).toBeNull();
    await virtualPasskey(f.context, f.page);
    await f.page.getByRole('button', { name: 'Create admin passkey', exact: true }).click();
    await expect(
      f.page.getByRole('heading', { name: 'Administration', exact: true }),
    ).toBeVisible();
    expect(auth.userCount()).toBe(1);
    expect(await stored(f.page, f.actor.id, f.item.id)).toEqual(retained);
    expect(requests.some((request) => request.includes(secret))).toBe(false);
    await expect(f.page.getByText(f.item.name, { exact: true })).toHaveCount(0);
  } finally {
    await f.close();
    fresh?.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
