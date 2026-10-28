import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Browser, Locator, Page, TestInfo } from '@playwright/test';
import type {
  MaintenanceControlResult,
  MaintenancePublicStatus,
} from '../src/shared/maintenance.ts';
import { projectRoot } from './app-process.ts';
import { startMaintenanceFixture } from './maintenance-fixture.ts';
import { maintenanceInstants } from '../web/maintenanceTime.ts';

const authenticatorOptions = {
  protocol: 'ctap2' as const,
  transport: 'internal' as const,
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  automaticPresenceSimulation: true,
};

function nextRepeatedTime() {
  const now = Date.now(),
    year = new Date(now).getUTCFullYear();
  const candidates: Array<{ localTime: string; timeZone: string; startsAt: number }> = [];
  for (const candidateYear of [year, year + 1]) {
    for (const [month, hour, timeZone] of [
      [10, '01', 'America/Los_Angeles'],
      [3, '02', 'Australia/Sydney'],
    ] as const) {
      const first = new Date(Date.UTC(candidateYear, month, 1));
      const day = 1 + ((7 - first.getUTCDay()) % 7);
      const localTime = `${candidateYear}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${hour}:30`;
      const instants = maintenanceInstants(localTime, timeZone);
      if (instants.length === 2 && instants[1] > now && instants[1] < now + 365 * 86400_000)
        candidates.push({ localTime, timeZone, startsAt: instants[1] });
    }
  }
  const next = candidates.sort((a, b) => a.startsAt - b.startsAt)[0];
  if (!next) throw new Error('No repeated time inside the notice horizon.');
  return next;
}

async function passkey(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: authenticatorOptions });
}

const controls = (page: Page) =>
  page.getByRole('region', { name: 'Workspace maintenance controls', exact: true });
const banner = (page: Page) =>
  page.getByRole('region', { name: 'Workspace maintenance', exact: true });
const saveStatus = (page: Page) => page.getByRole('status', { name: 'Save status', exact: true });

async function capture(
  page: Page,
  info: TestInfo,
  state: string,
  variants = true,
  subject?: Locator,
) {
  const directory =
    process.env.SPINEL_MAINTENANCE_CAPTURE === '1'
      ? join(projectRoot, 'docs/design/review/spn-111')
      : info.outputPath('maintenance-views');
  await mkdir(directory, { recursive: true });
  const views = variants
    ? ([
        ['light', 1280, 'light'],
        ['dark', 1280, 'dark'],
        ['light', 390, 'phone'],
      ] as const)
    : ([['light', 1280, 'light']] as const);
  for (const [theme, width, variant] of views) {
    if (variants) await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    if (subject) {
      await subject.scrollIntoViewIfNeeded();
      await expect(subject.getByRole('heading', { level: 4 })).toBeInViewport();
    }
    await page.screenshot({
      path: join(directory, `${state}-${variant}.png`),
      animations: 'disabled',
      fullPage: false,
    });
  }
  if (variants) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  }
}

async function selectCell(page: Page, cell: string) {
  const address = page
    .getByRole('region', { name: 'Sheet document', exact: true })
    .locator('[data-u-comp="defined-name"] input');
  await address.fill(cell);
  await address.press('Enter');
}

type DeviceCopy = {
  bundle: { maintenanceEpoch?: string };
  outbox?: { checkpoint: { sent?: unknown; buffer: unknown[]; failure?: unknown } };
};

async function deviceCopy(page: Page, accountId: string, itemId: string) {
  return page.evaluate(
    async ({ accountId, itemId }) => {
      const name = `spinel-offline-${accountId}`;
      if (!(await indexedDB.databases()).some((database) => database.name === name)) return;
      return new Promise<DeviceCopy | undefined>((resolve, reject) => {
        const opening = indexedDB.open(name);
        opening.onerror = () => reject(opening.error);
        opening.onupgradeneeded = () => {
          opening.transaction?.abort();
          reject(new Error('The existing device database disappeared.'));
        };
        opening.onsuccess = () => {
          const database = opening.result;
          const read = database.transaction('items').objectStore('items').get(itemId);
          read.onerror = () => {
            database.close();
            reject(read.error);
          };
          read.onsuccess = () => {
            database.close();
            resolve(read.result);
          };
        };
      });
    },
    { accountId, itemId },
  );
}

async function publicStatus(origin: string) {
  const response = await fetch(`${origin}/api/maintenance`);
  expect(response.status).toBe(200);
  const status = (await response.json()) as MaintenancePublicStatus;
  expect(Object.keys(status).sort()).toEqual(['available', 'epoch', 'notice', 'phase']);
  return status;
}

async function publishNotice(
  operator: Page,
  repeated: ReturnType<typeof nextRepeatedTime>,
  info?: TestInfo,
) {
  await controls(operator)
    .getByRole('button', { name: 'Maintenance actions', exact: true })
    .click();
  await operator.getByRole('menuitem', { name: 'Schedule a notice…', exact: true }).click();
  const dialog = operator.getByRole('dialog', {
    name: 'Schedule a maintenance notice',
    exact: true,
  });
  // A repeated local time requires an explicit occurrence and persists one absolute instant.
  const localTime = dialog.getByLabel('Date and time', { exact: true });
  const timeZone = dialog.getByLabel('Time zone', { exact: true });
  await localTime.fill(repeated.localTime);
  await timeZone.fill(repeated.timeZone);
  await dialog.getByLabel('Estimated minutes', { exact: true }).fill('45');
  await expect(localTime).toHaveValue(repeated.localTime);
  await expect(timeZone).toHaveValue(repeated.timeZone);
  // The wrapping label contains the option text. Match the control's accessible
  // name, rather than getByLabel's exact concatenation of all descendants.
  const occurrence = dialog.getByRole('combobox', {
    name: 'This time occurs twice',
    exact: true,
  });
  await expect(occurrence).toBeVisible();
  await expect(occurrence).toHaveValue('');
  await expect(occurrence.locator('option')).toHaveText([
    'Choose an occurrence',
    /^First occurrence/,
    /^Second occurrence/,
  ]);
  await expect(occurrence.locator('option').nth(2)).toHaveAttribute(
    'value',
    String(repeated.startsAt),
  );
  await dialog.getByRole('button', { name: 'Verify with a passkey', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Publish notice', exact: true })).toBeDisabled();
  await expect(occurrence).toBeVisible();
  await expect(occurrence).toHaveValue('');
  await occurrence.selectOption(String(repeated.startsAt));
  await expect(occurrence).toHaveValue(String(repeated.startsAt));
  if (info) await capture(operator, info, 'notice-time-choice');
  const response = operator.waitForResponse(
    (value) => new URL(value.url()).pathname === '/api/admin/maintenance/notice',
  );
  await dialog.getByRole('button', { name: 'Publish notice', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(controls(operator).getByText('Scheduled notice', { exact: true })).toBeVisible();
}

test('supervised maintenance keeps pending native work, fences old edits, and recovers through cold controls', async ({
  playwright,
}, info) => {
  test.skip(
    info.project.name !== 'production' || process.platform !== 'linux',
    'Closed-process verification uses the Linux production supervisor.',
  );
  test.setTimeout(300_000);
  const app = await startMaintenanceFixture();
  let browser: Browser | undefined;
  const failures: string[] = [];
  try {
    // Phase A: real Operator controls without a resident native editor. Closing
    // this whole browser before Phase B releases its renderers and SDK imports.
    browser = await playwright.chromium.launch(info.project.use.launchOptions);
    const operatorContext = await browser.newContext({
      baseURL: app.origin,
      acceptDownloads: true,
      viewport: { width: 1280, height: 900 },
      colorScheme: 'light',
      reducedMotion: 'reduce',
    });
    const operator = await operatorContext.newPage();
    operator.setDefaultTimeout(15_000);
    operator.on('pageerror', (error) => failures.push(error.message));
    await passkey(operator);
    await operator.goto(app.setupLink);
    await operator.getByRole('button', { name: 'Create admin passkey', exact: true }).click();
    await expect(
      operator.getByRole('heading', { name: 'Administration', exact: true }),
    ).toBeVisible();
    await operator.goto('/admin#invites');
    await operator.getByRole('button', { name: 'Create invite', exact: true }).click();
    await operator
      .getByRole('dialog', { name: 'Create invite', exact: true })
      .getByRole('button', { name: 'Create invite', exact: true })
      .click();
    const invitation = await operator.getByLabel('New invite link', { exact: true }).inputValue();
    await operator.goto('/admin#health');
    await expect(
      controls(operator).getByRole('button', { name: 'Pause edits', exact: true }),
    ).toBeEnabled();
    const repeated = nextRepeatedTime();
    await publishNotice(operator, repeated, info);
    const announced = await publicStatus(app.publicOrigin);
    expect(announced.phase).toBe('running');
    expect(announced.notice).toMatchObject({
      startsAt: repeated.startsAt,
      timeZone: repeated.timeZone,
      durationMinutes: 45,
      state: 'scheduled',
    });
    await expect(
      banner(operator).getByText('Maintenance scheduled', { exact: true }),
    ).toBeVisible();
    await capture(operator, info, 'scheduled');

    // A ready encrypted export remains private and inert during maintenance.
    // Start it through the real passkey flow before rotating the workspace epoch.
    const downloads = operator.getByRole('region', {
      name: 'Workspace backup download',
      exact: true,
    });
    await expect(
      downloads.getByRole('button', { name: 'Prepare workspace backup', exact: true }),
    ).toBeEnabled();
    await downloads.getByRole('button', { name: 'Prepare workspace backup', exact: true }).click();
    const prepareBackup = operator.getByRole('dialog', {
      name: 'Prepare encrypted backup',
      exact: true,
    });
    const preparedBackup = operator.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/admin/backups/exports' &&
        response.request().method() === 'POST',
    );
    const backupProof = operator.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/auth/reauthentication/verify',
    );
    await prepareBackup
      .getByRole('button', { name: 'Verify and prepare backup', exact: true })
      .click();
    expect((await backupProof).status()).toBe(200);
    const preparedReply = await preparedBackup;
    expect(preparedReply.status()).toBe(202);
    expect(preparedReply.request().headers()['x-spinel-epoch']).toBe(app.running.epoch);
    const backupJobId = (await preparedReply.json()).job.id as string;
    await expect(prepareBackup).toHaveCount(0);
    await expect(downloads.getByText('Encrypted backup ready.', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    const retainedDownloads = await downloads.elementHandle();
    const retainedDelivery = await downloads
      .locator('iframe[title="Encrypted backup delivery"]')
      .elementHandle();
    expect(retainedDownloads).not.toBeNull();
    expect(retainedDelivery).not.toBeNull();
    const stableDownload = async () => {
      expect(
        await downloads.evaluate((node, original) => node === original, retainedDownloads!),
      ).toBe(true);
      expect(
        await downloads
          .locator('iframe[title="Encrypted backup delivery"]')
          .evaluate((node, original) => node === original, retainedDelivery!),
      ).toBe(true);
      expect(await retainedDelivery!.evaluate((node) => node.isConnected)).toBe(true);
    };
    await operator.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));

    // Another already-open Operator tab has the same cookie, but no resume capability.
    const unprivilegedTab = await operatorContext.newPage();
    unprivilegedTab.setDefaultTimeout(15_000);
    unprivilegedTab.on('pageerror', (error) => failures.push(error.message));
    await unprivilegedTab.goto('/admin#health');
    await expect(
      controls(unprivilegedTab).getByRole('button', { name: 'Pause edits', exact: true }),
    ).toBeEnabled();

    let pauseRequests = 0;
    operator.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/admin/maintenance/pause') pauseRequests++;
    });
    await controls(operator).getByRole('button', { name: 'Pause edits', exact: true }).click();
    const pauseDialog = operator.getByRole('dialog', {
      name: 'Pause workspace edits?',
      exact: true,
    });
    await capture(operator, info, 'pause-confirmation', false);
    const proofResponse = operator.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/auth/reauthentication/verify',
    );
    await pauseDialog.getByRole('button', { name: 'Verify with a passkey', exact: true }).click();
    const proof = (await (await proofResponse).json()) as { verifiedUntil: number };
    await expect(
      pauseDialog.getByRole('button', { name: 'Pause edits', exact: true }),
    ).toBeEnabled();
    expect(pauseRequests).toBe(0);
    const pauseResponse = operator.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/admin/maintenance/pause',
    );
    await pauseDialog.getByRole('button', { name: 'Pause edits', exact: true }).click();
    const pausedReply = await pauseResponse;
    expect(pausedReply.status()).toBe(200);
    const paused = (await pausedReply.json()) as MaintenanceControlResult;
    expect(pausedReply.request().postDataJSON().intentExpiresAt).toBe(proof.verifiedUntil);
    expect(paused.status.phase).toBe('paused');
    expect(paused.status.epoch).not.toBe(app.running.epoch);
    expect(paused.resumeToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(
      controls(operator).getByRole('button', { name: 'Resume', exact: true }),
    ).toBeEnabled();
    await expect(
      controls(unprivilegedTab).getByRole('button', { name: 'Resume', exact: true }),
    ).toBeDisabled();
    await expect(
      controls(unprivilegedTab).getByText(/Resume permission is unavailable in this tab/),
    ).toBeVisible();
    expect(
      await operator.evaluate(
        (token) =>
          [
            location.href,
            document.body.innerText,
            ...Object.values(localStorage),
            ...Object.values(sessionStorage),
          ].some((value) => value.includes(token)),
        paused.resumeToken!,
      ),
    ).toBe(false);
    await unprivilegedTab.close();
    await capture(operator, info, 'paused');
    await banner(operator).locator('summary').click();
    await expect(
      banner(operator).getByText(/Already acknowledged edits remain saved\./),
    ).toBeVisible();
    await capture(operator, info, 'paused-details');
    await banner(operator).locator('summary').click();
    await expect(downloads.getByText(/Backup actions are paused for maintenance/)).toBeVisible();
    await expect(downloads.getByText('Encrypted backup ready.', { exact: true })).toBeVisible();
    await expect(
      downloads.getByRole('button', { name: 'Download encrypted backup', exact: true }),
    ).toBeDisabled();
    await expect(
      downloads.getByRole('button', { name: 'Cancel backup', exact: true }),
    ).toBeDisabled();
    await stableDownload();
    await capture(operator, info, 'backup-paused', true, downloads);
    await operator.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));

    await controls(operator).getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(
      controls(operator).getByRole('button', { name: 'Reload Administration', exact: true }),
    ).toBeEnabled();
    await expect(
      controls(operator).getByRole('button', { name: 'Pause edits', exact: true }),
    ).toHaveCount(0);
    await expect(controls(operator).getByText(/Edits resumed\./)).toBeVisible();
    const resumed = await publicStatus(app.publicOrigin);
    expect(resumed.phase).toBe('running');
    expect(resumed.epoch).toBe(paused.status.epoch);
    await expect(downloads.getByText(/Maintenance resumed\. Reload Administration/)).toBeVisible();
    await expect(
      downloads.getByRole('button', { name: 'Download encrypted backup', exact: true }),
    ).toBeDisabled();
    await stableDownload();
    await capture(operator, info, 'resumed');
    await retainedDownloads!.dispose();
    await retainedDelivery!.dispose();
    await controls(operator)
      .getByRole('button', { name: 'Reload Administration', exact: true })
      .click();
    await expect(
      controls(operator).getByRole('button', { name: 'Pause edits', exact: true }),
    ).toBeEnabled();

    // A fresh Administration page can authorize the retained export in the new
    // epoch, then stream it through the native form (which has no custom header).
    await expect(
      downloads.getByRole('button', { name: 'Download encrypted backup', exact: true }),
    ).toBeEnabled();
    await downloads.getByRole('button', { name: 'Download encrypted backup', exact: true }).click();
    const authorizedBackup = operator.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/admin/backups/exports/${backupJobId}/authorize`,
    );
    const nativeDelivery = operator.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === `/api/admin/backups/exports/${backupJobId}/file`,
    );
    const downloadedBackup = operator.waitForEvent('download');
    await operator
      .getByRole('dialog', { name: 'Download encrypted backup', exact: true })
      .getByRole('button', { name: 'Verify and download', exact: true })
      .click();
    const authorizedReply = await authorizedBackup;
    expect(authorizedReply.status()).toBe(200);
    expect(authorizedReply.request().headers()['x-spinel-epoch']).toBe(resumed.epoch);
    const deliveryRequest = await nativeDelivery;
    expect(deliveryRequest.method()).toBe('POST');
    expect(new URL(deliveryRequest.url()).search).toBe('');
    expect(deliveryRequest.headers()['x-spinel-epoch']).toBeUndefined();
    const deliveryFields = new URLSearchParams(deliveryRequest.postData() ?? '');
    expect([...deliveryFields.keys()].sort()).toEqual(['accountId', 'token']);
    expect(deliveryFields.get('token')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const download = await downloadedBackup;
    expect(download.suggestedFilename()).toBe('spinel-workspace-backup.spinel');
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    expect(await download.failure()).toBeNull();
    const encrypted = await readFile(downloadPath!);
    expect(encrypted.byteLength).toBeGreaterThan(37);
    expect(encrypted.subarray(0, 8).toString()).toBe('SPINEL01');
    await expect(downloads.getByText(/^Backup sent to your browser\./)).toBeVisible();
    await operator.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
    await controls(operator)
      .getByRole('button', { name: 'Maintenance actions', exact: true })
      .click();
    await operator
      .getByRole('menuitem', { name: 'Cancel maintenance notice…', exact: true })
      .click();
    const cancelDialog = operator.getByRole('dialog', {
      name: 'Cancel maintenance notice?',
      exact: true,
    });
    await cancelDialog.getByRole('button', { name: 'Verify with a passkey', exact: true }).click();
    await cancelDialog.getByRole('button', { name: 'Cancel notice', exact: true }).click();
    await expect(controls(operator).getByText(/Maintenance notice cancelled/)).toBeVisible();
    await expect(banner(operator)).toHaveCount(0);
    expect((await publicStatus(app.publicOrigin)).notice?.state).toBe('cancelled');
    // Leave a new real UI-created announcement for the native geometry checks.
    await publishNotice(operator, repeated);
    expect((await publicStatus(app.publicOrigin)).notice?.state).toBe('scheduled');
    expect(failures).toEqual([]);
    await browser.close();
    browser = undefined;

    // Phase B: a fresh browser contains only the member's one native Sheet.
    // Its immutable base belongs to the epoch resumed by the Operator above.
    browser = await playwright.chromium.launch(info.project.use.launchOptions);
    const memberContext = await browser.newContext({
      baseURL: app.origin,
      viewport: { width: 1280, height: 900 },
      colorScheme: 'light',
      reducedMotion: 'reduce',
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const member = await memberContext.newPage();
    member.setDefaultTimeout(15_000);
    member.on('pageerror', (error) => failures.push(error.message));
    await passkey(member);
    await member.goto(invitation);
    await member.getByLabel('Your name', { exact: true }).fill('Maintenance member');
    await member.getByRole('button', { name: 'Join with a passkey', exact: true }).click();
    await expect(member.getByRole('heading', { name: 'My files', exact: true })).toBeVisible();
    const account = await (await memberContext.request.get('/api/auth/session')).json();
    const accountId = account.user.id as string;
    let epoch = (await publicStatus(app.publicOrigin)).epoch;
    expect(epoch).toBe(resumed.epoch);
    let headers = { Origin: app.origin, 'X-Spinel-Epoch': epoch };
    const created = await memberContext.request.post('/api/items', {
      headers,
      data: { name: 'Maintenance field notes', kind: 'sheet', parentId: null },
    });
    expect(created.status(), await created.text()).toBe(201);
    const item = (await created.json()).item as { id: string; name: string };
    const linkPath = `/api/items/${item.id}/link`;
    const inventoryPath = `/api/guest-links/${item.id}`;
    const enableLink = () =>
      memberContext.request.put(linkPath, { headers, data: { role: 'viewer', expiryDays: 7 } });
    expect((await enableLink()).status()).toBe(200);
    const linksPage = await memberContext.newPage();
    linksPage.setDefaultTimeout(15_000);
    linksPage.on('pageerror', (error) => failures.push(error.message));
    await linksPage.goto('/profile#links');
    const inventory = linksPage.getByRole('region', { name: 'Guest links', exact: true });
    const linkMenu = () =>
      inventory.getByRole('button', { name: `More actions for ${item.name}`, exact: true }).click();
    const expiryDialog = async () => {
      await linkMenu();
      await linksPage.getByRole('menuitem', { name: 'Change expiry…', exact: true }).click();
      return linksPage.getByRole('dialog', { name: 'Change link expiry', exact: true });
    };
    const inventoryReply = (method: string) =>
      linksPage.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === inventoryPath &&
          response.request().method() === method,
      );
    // These are real component requests through supervised HTTP admission.
    // Both inventory writes must carry this tab's immutable maintenance epoch.
    const expiry = await expiryDialog();
    await expiry.getByRole('combobox', { name: 'Expire link after' }).selectOption('1');
    const changingExpiry = inventoryReply('PATCH');
    const beforeExpirySave = Date.now();
    await expiry.getByRole('button', { name: 'Save expiry', exact: true }).click();
    const changedExpiry = await changingExpiry;
    const afterExpirySave = Date.now();
    expect(changedExpiry.status()).toBe(200);
    expect(changedExpiry.request().headers()['x-spinel-epoch']).toBe(epoch);
    await expect(inventory.getByRole('status')).toHaveText(
      'Expiry updated. The link is unchanged.',
    );
    const updatedLink = await (await memberContext.request.get(linkPath)).json();
    expect(updatedLink.enabled).toBe(true);
    expect(updatedLink.expiresAt).toBeGreaterThanOrEqual(beforeExpirySave + 86_400_000);
    expect(updatedLink.expiresAt).toBeLessThanOrEqual(afterExpirySave + 86_400_000);
    await linkMenu();
    await linksPage.getByRole('menuitem', { name: 'Turn off link', exact: true }).click();
    const turningOff = inventoryReply('DELETE');
    await linksPage
      .getByRole('dialog')
      .getByRole('button', { name: 'Turn off link', exact: true })
      .click();
    const turnedOff = await turningOff;
    expect(turnedOff.status()).toBe(204);
    expect(turnedOff.request().headers()['x-spinel-epoch']).toBe(epoch);
    await expect(inventory.getByRole('link', { name: item.name, exact: true })).toHaveCount(0);
    expect(await (await memberContext.request.get(linkPath)).json()).toMatchObject({
      enabled: false,
    });
    expect((await enableLink()).status()).toBe(200);
    await linksPage.reload();
    const staleExpiry = await expiryDialog();
    const beforeMaintenanceLink = await (await memberContext.request.get(linkPath)).json();
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
    await expect(saveStatus(member)).toHaveText(
      'Synced. All changes are saved on the server and this device.',
      { timeout: 30_000 },
    );
    // A verified-clean downloaded editor refreshes its saved base and opens a
    // fresh page. A React-only remount would keep the old tab's HTTP epoch.
    const beforeCleanResume = await member.evaluate(() => performance.timeOrigin);
    const cleanOperation = randomUUID();
    const cleanPaused = await app.control({ action: 'pause', operationId: cleanOperation });
    await expect(banner(member).getByText('Edits paused', { exact: true })).toBeVisible();
    const pageRestarted = member.waitForEvent('load');
    expect((await app.control({ action: 'resume', operationId: cleanOperation })).phase).toBe(
      'running',
    );
    await pageRestarted;
    await expect(saveStatus(member)).toHaveText(
      'Synced. All changes are saved on the server and this device.',
      { timeout: 30_000 },
    );
    expect(await member.evaluate(() => performance.timeOrigin)).toBeGreaterThan(beforeCleanResume);
    epoch = cleanPaused.epoch;
    headers = { Origin: app.origin, 'X-Spinel-Epoch': epoch };
    expect((await deviceCopy(member, accountId, item.id))?.bundle.maintenanceEpoch).toBe(epoch);
    await expect(
      banner(linksPage).getByText('Maintenance scheduled', { exact: true }),
    ).toBeVisible();
    await staleExpiry.getByRole('combobox', { name: 'Expire link after' }).selectOption('30');
    const staleExpiryReply = inventoryReply('PATCH');
    await staleExpiry.getByRole('button', { name: 'Save expiry', exact: true }).click();
    const refusedExpiry = await staleExpiryReply;
    expect(refusedExpiry.status()).toBe(409);
    expect((await refusedExpiry.json()).code).toBe('maintenance-epoch');
    expect(refusedExpiry.request().headers()['x-spinel-epoch']).toBe(resumed.epoch);
    await expect(inventory.getByRole('alert')).toContainText('Review current guest links');
    expect(await (await memberContext.request.get(linkPath)).json()).toEqual(beforeMaintenanceLink);
    await linkMenu();
    await linksPage.getByRole('menuitem', { name: 'Turn off link', exact: true }).click();
    const staleOffReply = inventoryReply('DELETE');
    await linksPage
      .getByRole('dialog')
      .getByRole('button', { name: 'Turn off link', exact: true })
      .click();
    const refusedOff = await staleOffReply;
    expect(refusedOff.status()).toBe(409);
    expect((await refusedOff.json()).code).toBe('maintenance-epoch');
    expect(refusedOff.request().headers()['x-spinel-epoch']).toBe(resumed.epoch);
    await expect(inventory.getByRole('alert')).toContainText('Review current guest links');
    expect(await (await memberContext.request.get(linkPath)).json()).toEqual(beforeMaintenanceLink);
    await linksPage.close();
    await selectCell(member, 'A1');
    await member.keyboard.insertText('Acknowledged before maintenance');
    await member.keyboard.press('Enter');
    await expect(saveStatus(member)).toHaveText(
      'Synced. All changes are saved on the server and this device.',
    );
    const remoteSnapshot = async () =>
      JSON.stringify(
        (await (await memberContext.request.get(`/api/items/${item.id}/sheet`)).json()).snapshot,
      );
    await expect.poll(remoteSnapshot).toContain('Acknowledged before maintenance');
    await expect(banner(member).getByText('Maintenance scheduled', { exact: true })).toBeVisible();
    const scheduledHeight = await banner(member).evaluate(
      (element) => element.getBoundingClientRect().height,
    );
    await memberContext.setOffline(true);
    await selectCell(member, 'B1');
    await member.keyboard.insertText('Pending on this device');
    await member.keyboard.press('Enter');
    await expect(saveStatus(member)).toHaveText('Saved on this device — waiting to sync.', {
      timeout: 30_000,
    });
    await expect
      .poll(async () => JSON.stringify((await deviceCopy(member, accountId, item.id))?.outbox))
      .toContain('Pending on this device');
    expect((await deviceCopy(member, accountId, item.id))?.bundle.maintenanceEpoch).toBe(epoch);
    await selectCell(member, 'C1');
    await member.keyboard.insertText('Unfinished native draft');
    const nativeDraft = await member
      .locator('[contenteditable="true"][data-u-comp="editor"]:focus')
      .elementHandle();
    expect(nativeDraft).not.toBeNull();
    const canvas = await member.locator('.editor-frame canvas').first().elementHandle();
    expect(canvas).not.toBeNull();
    const stableNativeEditor = async () => {
      expect(
        await member
          .locator('.editor-frame canvas')
          .first()
          .evaluate((node, original) => node === original, canvas!),
      ).toBe(true);
      expect(await nativeDraft!.evaluate((element) => element.isConnected)).toBe(true);
      const sentinel = `not-copied-${randomUUID()}`;
      await member.evaluate((value) => navigator.clipboard.writeText(value), sentinel);
      await nativeDraft!.focus();
      await member.keyboard.press('Control+a');
      await member.keyboard.press('Control+c');
      await expect
        .poll(async () => (await member.evaluate(() => navigator.clipboard.readText())).trim())
        .toBe('Unfinished native draft');
    };

    const memberOperation = randomUUID();
    const memberPaused = await app.control({ action: 'pause', operationId: memberOperation });
    expect(memberPaused.phase).toBe('paused');
    expect(memberPaused.epoch).not.toBe(epoch);
    expect((await publicStatus(app.publicOrigin)).phase).toBe('paused');
    const rejectedPaused = await memberContext.request.patch(`/api/items/${item.id}`, {
      headers: { ...headers, 'X-Spinel-Epoch': memberPaused.epoch },
      data: { name: 'Must stay paused' },
    });
    expect(rejectedPaused.status()).toBe(503);
    expect((await rejectedPaused.json()).code).toBe('maintenance');
    // The offline page learns the new epoch before it may open a submit channel.
    await memberContext.setOffline(false);
    await expect(banner(member).getByText('Edits paused', { exact: true })).toBeVisible();
    await expect(saveStatus(member)).toContainText('Copy the unfinished cell text');
    expect(await banner(member).evaluate((element) => element.getBoundingClientRect().height)).toBe(
      scheduledHeight,
    );
    await stableNativeEditor();
    await capture(member, info, 'native-pending', false);
    await banner(member).getByRole('button', { name: 'Dismiss for now' }).click();
    await expect(banner(member)).toHaveAttribute('data-dismissed', 'true');
    await expect(saveStatus(member)).toContainText('Copy the unfinished cell text');
    await stableNativeEditor();
    await capture(member, info, 'native-pending-dismissed');
    await banner(member).locator('summary').focus();
    await member.keyboard.press('Enter');
    await expect(banner(member).getByRole('button', { name: 'Dismiss for now' })).toBeVisible();
    await expect(banner(member).getByText(/Already acknowledged edits remain saved/)).toBeVisible();
    await stableNativeEditor();
    await capture(member, info, 'native-pending-reopened');
    await expect(saveStatus(member)).toContainText('Copy the unfinished cell text');
    expect((await memberContext.request.get(`/api/items/${item.id}/sheet`)).status()).toBe(503);
    const memberResumed = await app.control({ action: 'resume', operationId: memberOperation });
    expect(memberResumed.phase).toBe('running');
    expect(memberResumed.epoch).toBe(memberPaused.epoch);
    await expect(banner(member).getByText('Maintenance scheduled', { exact: true })).toBeVisible();
    await expect(saveStatus(member)).toContainText('Copy the unfinished cell text');
    await stableNativeEditor();
    const retained = await deviceCopy(member, accountId, item.id);
    expect(retained?.bundle.maintenanceEpoch).toBe(epoch);
    expect(JSON.stringify(retained?.outbox)).toContain('Pending on this device');
    expect(await remoteSnapshot()).toContain('Acknowledged before maintenance');
    expect(await remoteSnapshot()).not.toContain('Pending on this device');
    expect(await remoteSnapshot()).not.toContain('Unfinished native draft');
    const rejectedStale = await memberContext.request.patch(`/api/items/${item.id}`, {
      headers,
      data: { name: 'Must not replay an old edit' },
    });
    expect(rejectedStale.status()).toBe(409);
    expect((await rejectedStale.json()).code).toBe('maintenance-epoch');
    expect(failures).toEqual([]);
    const cookies = (await memberContext.cookies(app.origin))
      .map(({ name, value }) => `${name}=${value}`)
      .join('; ');
    await canvas!.dispose();
    await nativeDraft!.dispose();

    // Phase C: no browser is resident during stopped-file verification.
    await browser.close();
    browser = undefined;
    const operationId = randomUUID();
    expect((await app.control({ action: 'pause', operationId })).phase).toBe('paused');
    expect((await app.control({ action: 'stop', operationId })).phase).toBe('stopped');
    expect((await publicStatus(app.publicOrigin)).phase).toBe('stopped');
    const unavailable = await fetch(`${app.publicOrigin}/api/items`);
    expect(unavailable.status).toBe(503);
    expect((await unavailable.json()).code).toBe('MAINTENANCE');
    await expect(app.control({ action: 'start', operationId })).rejects.toThrow();
    expect((await app.control({ action: 'verify', operationId })).phase).toBe('stopped');
    const restarted = await app.control({ action: 'start', operationId });
    expect(restarted.phase).toBe('paused');
    expect(restarted.readyToResume).toBe(true);
    expect((await publicStatus(app.publicOrigin)).phase).toBe('paused');
    expect((await app.control({ action: 'resume', operationId })).phase).toBe('running');
    const saved = await fetch(`${app.origin}/api/items/${item.id}/sheet`, {
      headers: { Cookie: cookies },
    });
    expect(saved.status).toBe(200);
    const durable = JSON.stringify((await saved.json()).snapshot);
    expect(durable).toContain('Acknowledged before maintenance');
    expect(durable).not.toContain('Pending on this device');
    expect(durable).not.toContain('Unfinished native draft');
  } catch (error) {
    // This test owns its browsers, so capture the live failure state before
    // teardown; Playwright's ordinary page fixture cannot inspect it afterward.
    let index = 0;
    for (const context of browser?.contexts() ?? []) {
      for (const page of context.pages()) {
        if (page.isClosed()) continue;
        await info.attach(`maintenance-failure-${index++}`, {
          body: await page.screenshot({ animations: 'disabled' }).catch(() => Buffer.alloc(0)),
          contentType: 'image/png',
        });
        await info.attach(`maintenance-state-${index}`, {
          body: await page
            .locator('body')
            .ariaSnapshot()
            .catch(() => 'Page unavailable.'),
          contentType: 'text/plain',
        });
      }
    }
    throw error;
  } finally {
    await browser?.close();
    await app.close();
  }
});
