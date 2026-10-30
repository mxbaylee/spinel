import { randomUUID } from 'node:crypto';
import { copyFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page, Request, TestInfo } from '@playwright/test';
import type { MaintenancePublicStatus } from '../src/shared/maintenance.ts';
import { startMaintenanceFixture } from './maintenance-fixture.ts';

/** SPN-112's Verify list in real browsers against the Linux supervisor: catalog
 * selection, double-click, cancel, a lost confirmation reply, an expired passkey
 * window, and old tabs and offline queues meeting the restored workspace. */

type Fixture = Awaited<ReturnType<typeof startMaintenanceFixture>>;

async function passkey(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
}

async function credentialsOf({ cdp, authenticatorId }: Awaited<ReturnType<typeof passkey>>) {
  return (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials;
}

/** A virtual authenticator belongs to one page. Signing in from a new tab copies its passkey. */
async function signInFromNewPage(
  context: BrowserContext,
  credentials: Awaited<ReturnType<typeof credentialsOf>>,
) {
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const next = await passkey(context, page);
  for (const credential of credentials)
    await next.cdp.send('WebAuthn.addCredential', {
      authenticatorId: next.authenticatorId,
      credential,
    });
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();
  return page;
}

async function publicStatus(origin: string) {
  const response = await fetch(`${origin}/api/maintenance`);
  expect(response.status).toBe(200);
  return (await response.json()) as MaintenancePublicStatus;
}

const saveStatus = (page: Page) => page.getByRole('status', { name: 'Save status', exact: true });
const restoreRegion = (page: Page) =>
  page.getByRole('region', { name: 'Restore workspace', exact: true });

async function selectCell(page: Page, cell: string) {
  const address = page
    .getByRole('region', { name: 'Sheet document', exact: true })
    .locator('[data-u-comp="defined-name"] input');
  await address.fill(cell);
  await address.press('Enter');
}

async function typeCell(page: Page, cell: string, text: string) {
  await selectCell(page, cell);
  await page.keyboard.insertText(text);
  await page.keyboard.press('Enter');
}

function outbox(page: Page, accountId: string, itemId: string) {
  return page.evaluate(
    async ({ accountId, itemId }) => {
      const name = `spinel-offline-${accountId}`;
      if (!(await indexedDB.databases()).some((database) => database.name === name)) return '';
      return new Promise<string>((resolve, reject) => {
        const opening = indexedDB.open(name);
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const database = opening.result;
          const read = database.transaction('items').objectStore('items').get(itemId);
          read.onerror = () => {
            database.close();
            reject(read.error);
          };
          read.onsuccess = () => {
            database.close();
            resolve(JSON.stringify(read.result?.outbox ?? null));
          };
        };
      });
    },
    { accountId, itemId },
  );
}

/** Counts real requests by route so double-clicks and retries are observable. */
function requests(page: Page) {
  const counts = new Map<string, number>();
  page.on('request', (request: Request) => {
    const path = new URL(request.url()).pathname;
    const key =
      path === '/api/auth/reauthentication/verify'
        ? 'verify'
        : path === '/api/admin/restores/preparations' && request.method() === 'POST'
          ? 'prepare'
          : /^\/api\/admin\/restores\/preparations\/[^/]+\/(confirm|cancel|upload)$/.exec(
              path,
            )?.[1];
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return (key: string) => counts.get(key) ?? 0;
}

async function enrollOperator(browser: Browser, app: Fixture) {
  const context = await browser.newContext({
    baseURL: app.origin,
    acceptDownloads: true,
    viewport: { width: 1280, height: 900 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const key = await passkey(context, page);
  await page.goto(app.setupLink);
  await page.getByRole('button', { name: 'Create admin passkey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Administration', exact: true })).toBeVisible();
  return { context, page, key };
}

async function invite(operator: Page) {
  await operator.goto('/admin#invites');
  await operator.getByRole('button', { name: 'Create invite', exact: true }).click();
  await operator
    .getByRole('dialog', { name: 'Create invite', exact: true })
    .getByRole('button', { name: 'Create invite', exact: true })
    .click();
  const link = await operator.getByLabel('New invite link', { exact: true }).inputValue();
  await operator.keyboard.press('Escape');
  return link;
}

/** An everyday account joins through the real invitation and creates one item. */
async function joinWorkspace(
  browser: Browser,
  app: Fixture,
  invitation: string,
  name: string,
  item: { name: string; kind: 'sheet' | 'doc' },
) {
  const context = await browser.newContext({
    baseURL: app.origin,
    viewport: { width: 1280, height: 900 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const key = await passkey(context, page);
  await page.goto(invitation);
  await page.getByLabel('Your name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Join with a passkey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My files', exact: true })).toBeVisible();
  const accountId = (await (await context.request.get('/api/auth/session')).json()).user
    .id as string;
  const created = await context.request.post('/api/items', {
    headers: { Origin: app.origin, 'X-Spinel-Epoch': (await publicStatus(app.publicOrigin)).epoch },
    data: { ...item, parentId: null },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { id } = (await created.json()).item as { id: string };
  return { context, page, key, accountId, item: { ...item, id } };
}

/** The Operator's real encrypted download, saved where the configured catalog lists it. */
async function downloadBackup(operator: Page) {
  await operator.goto('/admin#health');
  const downloads = operator.getByRole('region', {
    name: 'Workspace backup download',
    exact: true,
  });
  await downloads.getByRole('button', { name: 'Prepare workspace backup', exact: true }).click();
  await operator
    .getByRole('dialog', { name: 'Prepare encrypted backup', exact: true })
    .getByRole('button', { name: 'Verify and prepare backup', exact: true })
    .click();
  await expect(downloads.getByText('Encrypted backup ready.', { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await downloads.getByRole('button', { name: 'Download encrypted backup', exact: true }).click();
  const downloaded = operator.waitForEvent('download');
  await operator
    .getByRole('dialog', { name: 'Download encrypted backup', exact: true })
    .getByRole('button', { name: 'Verify and download', exact: true })
    .click();
  const path = await (await downloaded).path();
  expect(path).not.toBeNull();
  return path!;
}

async function saveToCatalog(app: Fixture, archive: string) {
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const target = join(app.catalogDirectory!, `${stamp}-${randomUUID()}.spinel`);
  await copyFile(archive, target);
  await chmod(target, 0o600);
}

async function chooseSavedBackup(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Prepare workspace restore', exact: true });
  await dialog.getByRole('combobox', { name: 'Backup source', exact: true }).click();
  await page.getByRole('option', { name: 'Previously saved backup', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Saved backup', exact: true }).click();
  const options = page.getByRole('option');
  await expect(options).toHaveCount(2);
  await expect(options.first()).toHaveText(/Choose a recovery point/);
  await options.nth(1).click();
  return dialog;
}

async function attachFailure(browser: Browser | undefined, info: TestInfo) {
  let index = 0;
  for (const context of browser?.contexts() ?? [])
    for (const page of context.pages()) {
      if (page.isClosed()) continue;
      await info.attach(`restore-failure-${index}`, {
        body: await page.screenshot({ animations: 'disabled' }).catch(() => Buffer.alloc(0)),
        contentType: 'image/png',
      });
      await info.attach(`restore-state-${index++}`, {
        body: await page
          .locator('body')
          .ariaSnapshot()
          .catch(() => 'Page unavailable.'),
        contentType: 'text/plain',
      });
    }
}

const skipUnsupported = (info: TestInfo) =>
  test.skip(
    info.project.name !== 'supervised-restore' || process.platform !== 'linux',
    'Supervised restore uses the Linux production supervisor and a filesystem catalog.',
  );

test('a catalog restore survives double-clicks, cancel and a lost reply, and fences old clients', async ({
  playwright,
}, info) => {
  skipUnsupported(info);
  test.setTimeout(600_000);
  const app = await startMaintenanceFixture({ catalog: true });
  let browser: Browser | undefined;
  const failures: string[] = [];
  try {
    browser = await playwright.chromium.launch(info.project.use.launchOptions);
    const operator = await enrollOperator(browser, app);
    operator.page.on('pageerror', (error) => failures.push(error.message));
    const ownerInvitation = await invite(operator.page);
    const memberInvitation = await invite(operator.page);

    // The Owner keeps a Doc open; a Collaborator keeps a Sheet available offline.
    const owner = await joinWorkspace(browser, app, ownerInvitation, 'Restore owner', {
      name: 'Owner plan',
      kind: 'doc',
    });
    const {
      context: memberContext,
      page: member,
      key: memberKey,
      accountId,
      item,
    } = await joinWorkspace(browser, app, memberInvitation, 'Restore collaborator', {
      name: 'Restore field notes',
      kind: 'sheet',
    });
    for (const page of [owner.page, member])
      page.on('pageerror', (error) => failures.push(error.message));
    const remote = async () => {
      const response = await memberContext.request.get(`/api/items/${item.id}/sheet`);
      return response.ok() ? JSON.stringify((await response.json()).snapshot) : '';
    };
    await member.reload();
    await expect
      .poll(() => member.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);
    await member
      .getByRole('button', { name: `More actions for ${item.name}`, exact: true })
      .click();
    await member
      .getByRole('menuitem', { name: 'Available offline on this device', exact: true })
      .click();
    await expect(member.getByRole('status').filter({ hasText: 'available offline' })).toHaveText(
      `${item.name} is available offline on this device.`,
      { timeout: 90_000 },
    );
    await member.getByRole('button', { name: `${item.name} Sheet`, exact: true }).click();
    const synced = 'Synced. All changes are saved on the server and this device.';
    await expect(saveStatus(member)).toHaveText(synced, { timeout: 30_000 });
    await typeCell(member, 'A1', 'Kept by the saved backup');
    await expect(saveStatus(member)).toHaveText(synced, { timeout: 30_000 });
    await expect.poll(remote).toContain('Kept by the saved backup');

    const docText = async () => {
      const response = await owner.context.request.get(`/api/items/${owner.item.id}/doc`);
      return response.ok() ? String((await response.json()).snapshot?.body?.dataStream ?? '') : '';
    };
    const docTab = owner.page;
    await docTab.goto(`/?item=${owner.item.id}`);
    const docEditor = docTab.getByRole('region', { name: 'Doc document', exact: true });
    await expect(docEditor.getByRole('button', { name: 'Bold', exact: true })).toBeEnabled();
    await docEditor.locator('.univer-container').click({ position: { x: 130, y: 200 } });
    await docTab.keyboard.type('Owner plan in the backup.');
    await expect.poll(docText, { timeout: 30_000 }).toContain('Owner plan in the backup.');

    await saveToCatalog(app, await downloadBackup(operator.page));

    await docEditor.locator('.univer-container').click({ position: { x: 130, y: 200 } });
    await docTab.keyboard.type(' Acknowledged Owner change.');
    await expect.poll(docText, { timeout: 30_000 }).toContain('Acknowledged Owner change.');

    // Work after the backup: one acknowledged edit, then one queued offline.
    await typeCell(member, 'A2', 'Acknowledged after the backup');
    await expect(saveStatus(member)).toHaveText(synced, { timeout: 30_000 });
    await expect.poll(remote).toContain('Acknowledged after the backup');
    await memberContext.setOffline(true);
    await typeCell(member, 'A3', 'Queued offline after the backup');
    await expect(saveStatus(member)).toHaveText('Saved on this device — waiting to sync.', {
      timeout: 30_000,
    });
    await expect
      .poll(() => outbox(member, accountId, item.id))
      .toContain('Queued offline after the backup');

    // Catalog selection with a double-click: one passkey check, one preparation.
    const page = operator.page;
    const count = requests(page);
    const restore = restoreRegion(page);
    await restore.getByRole('button', { name: 'Prepare restore', exact: true }).click();
    let dialog = await chooseSavedBackup(page);
    await dialog.getByRole('button', { name: 'Verify and prepare', exact: true }).dblclick();
    const ready = 'Backup prepared. Review its source and consequences before restoring.';
    await expect(restore.getByText(ready, { exact: true })).toBeVisible({ timeout: 120_000 });
    expect([count('verify'), count('prepare')]).toEqual([1, 1]);

    // Cancel leaves the live workspace alone and frees the next preparation.
    await restore.getByRole('button', { name: 'Cancel preparation', exact: true }).click();
    await expect(
      restore.getByText('Restore preparation was cancelled. The live workspace was not replaced.', {
        exact: true,
      }),
    ).toBeVisible();
    expect(count('cancel')).toBe(1);
    await expect(
      restore.getByRole('button', { name: 'Prepare restore', exact: true }),
    ).toBeEnabled();
    expect((await publicStatus(app.publicOrigin)).phase).toBe('running');

    await restore.getByRole('button', { name: 'Prepare restore', exact: true }).click();
    dialog = await chooseSavedBackup(page);
    await dialog.getByRole('button', { name: 'Verify and prepare', exact: true }).click();
    await expect(restore.getByText(ready, { exact: true })).toBeVisible({ timeout: 120_000 });
    expect([count('verify'), count('prepare')]).toEqual([2, 2]);

    // The first confirmation never reaches the server; its reply is lost.
    let dropped = 0;
    await page.route('**/api/admin/restores/preparations/*/confirm', async (route) => {
      if (dropped++ === 0) await route.abort('connectionreset');
      else await route.continue();
    });
    const before = await publicStatus(app.publicOrigin);
    await restore.getByRole('button', { name: 'Review restore', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Restore this workspace?', exact: true });
    await dialog.getByRole('checkbox').check();
    await dialog
      .getByRole('button', { name: 'Verify and restore workspace', exact: true })
      .dblclick();
    await expect(
      restore.getByText(
        'The confirmation response was lost. Its outcome is unconfirmed. Refresh status before taking another action.',
        { exact: true },
      ),
    ).toBeVisible();
    expect([count('verify'), count('confirm')]).toEqual([3, 1]);

    // The retry repeats the same confirmation under the original passkey check.
    await restore.getByRole('button', { name: 'Retry confirmed restore', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Restore this workspace?', exact: true });
    await expect(
      dialog.getByText(/The original source and confirmation remain fixed\./),
    ).toBeVisible();
    await dialog.getByRole('checkbox').check();
    const accepted = page.waitForResponse((response) =>
      /\/preparations\/[^/]+\/confirm$/.test(new URL(response.url()).pathname),
    );
    await dialog.getByRole('button', { name: 'Retry confirmed restore', exact: true }).click();
    expect((await accepted).status()).toBe(202);
    expect([count('verify'), count('confirm')]).toEqual([3, 2]);

    // The supervisor commits the restore once and resumes in a new epoch.
    await expect
      .poll(
        async () => {
          const status = await publicStatus(app.publicOrigin).catch(() => undefined);
          return status?.phase === 'running' && status.epoch !== before.epoch;
        },
        { timeout: 240_000, intervals: [1000] },
      )
      .toBe(true);
    await expect(page).toHaveURL(/\/sign-in/, { timeout: 60_000 });
    await expect(docTab).toHaveURL(/\/sign-in/, { timeout: 60_000 });

    // The old offline tab reconnects, finds its sign-in ended, and leaves for sign-in.
    const credentials = await credentialsOf(memberKey);
    await memberContext.setOffline(false);
    await expect(member).toHaveURL(/\/sign-in/, { timeout: 60_000 });
    await member.close();

    const signedIn = await signInFromNewPage(memberContext, credentials);
    signedIn.on('pageerror', (error) => failures.push(error.message));
    await expect(signedIn.getByRole('heading', { name: 'My files', exact: true })).toBeVisible();
    await expect(
      signedIn.getByRole('region', { name: 'Workspace restored', exact: true }),
    ).toBeVisible();
    await signedIn.getByRole('button', { name: `${item.name} Sheet`, exact: true }).click();
    // The queued edit stays on this device for the Collaborator to copy; it is never sent.
    await expect(saveStatus(signedIn)).toHaveText(
      'Needs attention. Maintenance changed the workspace. Keep your pending work, then create a separate copy or export it before reloading.',
      { timeout: 30_000 },
    );
    expect(await outbox(signedIn, accountId, item.id)).toContain('Queued offline after the backup');
    const restored = await remote();
    expect(restored).toContain('Kept by the saved backup');
    expect(restored).not.toContain('Acknowledged after the backup');
    expect(restored).not.toContain('Queued offline after the backup');

    // The Operator signs in again and sees one recorded, completed restore.
    await page.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();
    await expect(page).not.toHaveURL(/\/sign-in/);
    await page.goto('/admin#health');
    await expect(
      restoreRegion(page).getByText(/^Backup restored\. This records the completed restore;/),
    ).toBeVisible();
    await docTab.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();
    await expect(docTab.getByRole('heading', { name: 'My files', exact: true })).toBeVisible();
    const ownerDoc = await docText();
    expect(ownerDoc).toContain('Owner plan in the backup.');
    expect(ownerDoc).not.toContain('Acknowledged Owner change.');
    expect(count('confirm')).toBe(2);
    expect(failures).toEqual([]);
  } catch (error) {
    await attachFailure(browser, info);
    throw error;
  } finally {
    await browser?.close();
    await app.close();
  }
});

test('a passkey check that expires during a slow upload starts no restore', async ({
  playwright,
}, info) => {
  skipUnsupported(info);
  test.setTimeout(600_000);
  const app = await startMaintenanceFixture();
  let browser: Browser | undefined;
  try {
    browser = await playwright.chromium.launch(info.project.use.launchOptions);
    const { page } = await enrollOperator(browser, app);
    const archive = await downloadBackup(page);
    const count = requests(page);
    const restore = restoreRegion(page);
    // Hold the upload until the browser's own five-minute bound gives up on it.
    await page.route('**/api/admin/restores/preparations/*/upload', () => {});
    await restore.getByRole('button', { name: 'Prepare restore', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Prepare workspace restore', exact: true });
    await dialog.getByLabel('Encrypted workspace backup', { exact: true }).setInputFiles(archive);
    await dialog.getByLabel('Separate recovery key', { exact: true }).setInputFiles(app.keyFile);
    await dialog.getByRole('button', { name: 'Verify and prepare', exact: true }).click();
    await expect(restore.getByText('Uploading and checking the encrypted backup…')).toBeVisible();
    await expect(restore.getByRole('alert')).toHaveText(
      'Passkey verification or preparation did not finish. Refresh restore status before trying another source.',
      { timeout: 330_000 },
    );
    await page.unroute('**/api/admin/restores/preparations/*/upload');
    await restore.getByRole('button', { name: 'Refresh restore status', exact: true }).click();
    await expect(
      restore.getByText('Waiting for the encrypted backup upload.', { exact: true }),
    ).toBeVisible();

    // Continuing reuses the expired check, so the server refuses the upload itself.
    await restore.getByRole('button', { name: 'Continue upload', exact: true }).click();
    const resume = page.getByRole('dialog', { name: 'Continue encrypted upload', exact: true });
    await resume.getByLabel('Encrypted workspace backup', { exact: true }).setInputFiles(archive);
    const refused = page.waitForResponse((response) =>
      /\/preparations\/[^/]+\/upload$/.test(new URL(response.url()).pathname),
    );
    await resume.getByRole('button', { name: 'Upload encrypted backup', exact: true }).click();
    expect((await refused).status()).toBe(428);
    await expect(restore.getByRole('alert')).toHaveText(
      'Passkey verification expired. Refresh restore status before continuing.',
    );
    await restore.getByRole('button', { name: 'Cancel preparation', exact: true }).click();
    await expect(
      restore.getByText('Restore preparation was cancelled. The live workspace was not replaced.', {
        exact: true,
      }),
    ).toBeVisible();
    expect([count('verify'), count('upload')]).toEqual([1, 2]);
    expect(count('confirm')).toBe(0);
    const status = await publicStatus(app.publicOrigin);
    expect([status.phase, status.epoch]).toEqual(['running', app.running.epoch]);
  } catch (error) {
    await attachFailure(browser, info);
    throw error;
  } finally {
    await browser?.close();
    await app.close();
  }
});
