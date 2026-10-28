import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { startApp } from './app-process.ts';
import { DatabaseSync, openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { SetupService } from '../src/server/auth/setup.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { restoreArchive } from '../src/server/backup/archive.ts';

async function capture(page: Page, info: TestInfo, state: string) {
  await mkdir('test-results/theme-screenshots', { recursive: true });
  for (const [theme, width, variant] of [
    ['light', 1280, 'light'],
    ['dark', 1280, 'dark'],
    ['light', 390, 'phone'],
  ] as const) {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    const modal = page.getByRole('dialog');
    const subject = (await modal.count())
      ? modal
      : page.getByRole('region', { name: 'Backups', exact: true });
    if (!(await modal.count()))
      await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
    const primary = subject.locator('button.sp-primary:enabled').first();
    if (await primary.count())
      await expect
        .poll(() =>
          primary.evaluate((button) => {
            const probe = document.createElement('span');
            probe.style.backgroundColor = 'var(--sp-accent)';
            probe.style.color = 'var(--sp-on-accent)';
            button.append(probe);
            const expected = getComputedStyle(probe);
            const actual = getComputedStyle(button);
            const matches =
              actual.backgroundColor === expected.backgroundColor &&
              actual.color === expected.color;
            probe.remove();
            return matches;
          }),
        )
        .toBe(true);
    await page.screenshot({
      path: `test-results/theme-screenshots/spn-109-${state}-${variant}-${info.project.name}.png`,
      animations: 'disabled',
      fullPage: true,
    });
    if (variant === 'phone' && !(await modal.count())) {
      for (const button of await subject.getByRole('button').all()) {
        if (!(await button.isVisible())) continue;
        const size = await button.boundingBox();
        expect(size!.width).toBeGreaterThanOrEqual(44);
        expect(size!.height).toBeGreaterThanOrEqual(44);
      }
    }
  }
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
}

test('Operator creates and downloads a real encrypted workspace without cloud credentials, cancels another and sees key failure', async ({
  playwright,
}, info) => {
  test.setTimeout(150_000);
  const directory = await mkdtemp(join(tmpdir(), 'spinel-manual-download-'));
  const databasePath = join(directory, 'spinel.sqlite');
  const keyFile = join(directory, 'recovery.key');
  const runtimeEnvironmentFile = join(directory, 'runtime.env');
  const configPath = join(directory, 'backup.json');
  const key = randomBytes(32);
  await writeFile(keyFile, key, { mode: 0o600 });
  await writeFile(runtimeEnvironmentFile, 'PRIVATE_SETTING=encrypted-browser-fixture\n', {
    mode: 0o600,
  });
  await writeFile(
    configPath,
    JSON.stringify({
      version: 1,
      type: 'manual',
      prefix: 'browser-download',
      dataset: 'workspace',
      keyId: 'browser-recovery',
      keyFile,
      runtimeEnvironmentFile,
    }),
    { mode: 0o600 },
  );
  const origin = `http://localhost:${info.project.name === 'development' ? 3206 : 3207}`;
  const app = await startApp({
    databasePath,
    origin,
    development: info.project.name === 'development',
    backupConfigPath: configPath,
    image: `sha256:${'a'.repeat(64)}`,
  });
  const db = openDatabase(databasePath);
  const auth = new AuthStore(db);
  const setup = new SetupService(auth, origin).issue();
  const browser = await playwright.chromium.launch(info.project.use.launchOptions);
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    await page.goto(setup.url);
    await page.getByRole('button', { name: 'Create admin passkey', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Administration', exact: true })).toBeVisible();
    const workspace = new WorkspaceStore(auth);
    const owner = auth.createUser('Retained owner');
    const file = workspace.create(owner.id, {
      name: 'Private browser backup document',
      kind: 'doc',
      parentId: null,
    });
    // The download must perform a fresh real WebAuthn ceremony, independent of setup proof.
    db.exec('UPDATE auth_sessions SET verified_at=NULL,verified_passkey_id=NULL');
    await page.goto(`${origin}/admin#health`);
    const backups = page.getByRole('region', { name: 'Backups', exact: true });
    const downloads = page.getByRole('region', { name: 'Workspace backup download', exact: true });
    await expect(backups.getByText('Automatic backups off', { exact: true })).toBeVisible();
    await expect(backups.getByText('Destination: Manual downloads only')).toBeVisible();
    await expect(
      downloads.getByRole('button', { name: 'Prepare workspace backup', exact: true }),
    ).toBeEnabled();
    await capture(page, info, 'manual-policy');
    await downloads.getByRole('button', { name: 'Prepare workspace backup', exact: true }).click();
    const prepare = page.getByRole('dialog', { name: 'Prepare encrypted backup', exact: true });
    await capture(page, info, 'passkey-confirmation');
    await prepare.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(
      downloads.getByRole('button', { name: 'Prepare workspace backup', exact: true }),
    ).toBeFocused();
    expect((await context.request.get(`${origin}/api/admin/backups/exports`)).status()).toBe(200);
    expect(
      (await (await context.request.get(`${origin}/api/admin/backups/exports`)).json()).job,
    ).toBeNull();
    await downloads.getByRole('button', { name: 'Prepare workspace backup', exact: true }).click();
    await prepare.getByRole('button', { name: 'Verify and prepare backup', exact: true }).click();
    await expect(prepare).toHaveCount(0);
    await expect(downloads.getByText('Encrypted backup ready.', { exact: true })).toBeVisible();
    const cookie = (await context.cookies()).find((entry) => entry.name === COOKIE_NAME)!;
    expect(auth.verifiedUntil(auth.session(cookie.value)!)).not.toBeNull();
    await capture(page, info, 'ready');
    await downloads.getByRole('button', { name: 'Download encrypted backup', exact: true }).click();
    const delivered = page.waitForEvent('download');
    await page
      .getByRole('dialog', { name: 'Download encrypted backup', exact: true })
      .getByRole('button', { name: 'Verify and download', exact: true })
      .click();
    const download = await delivered;
    expect(download.suggestedFilename()).toBe('spinel-workspace-backup.spinel');
    const archive = join(directory, 'download.spinel');
    await download.saveAs(archive);
    expect(await download.failure()).toBeNull();
    await expect(downloads.getByText(/^Backup sent to your browser\./)).toBeVisible();
    const bytes = await readFile(archive);
    expect(bytes.subarray(0, 8).toString()).toBe('SPINEL01');
    expect(bytes.includes(Buffer.from(file.name))).toBe(false);
    expect(bytes.includes(Buffer.from('encrypted-browser-fixture'))).toBe(false);
    expect(bytes.includes(key)).toBe(false);
    expect(urls.filter((url) => url.includes('/backups/')).every((url) => !url.includes('?'))).toBe(
      true,
    );
    const restored = join(directory, 'restored');
    const metadata = await restoreArchive(archive, key, directory, restored);
    expect(metadata.keyId).toBe('browser-recovery');
    const recovered = new DatabaseSync(join(restored, 'spinel.sqlite'));
    try {
      expect(
        recovered.prepare('SELECT name FROM workspace_items WHERE id=?').get(file.id)?.name,
      ).toBe(file.name);
      expect(recovered.prepare('SELECT COUNT(*) AS count FROM auth_passkeys').get()?.count).toBe(1);
    } finally {
      recovered.close();
    }
    await expect(backups.getByText('Last successful backup: None yet')).toBeVisible();
    await capture(page, info, 'browser-handoff');

    await downloads.getByRole('button', { name: 'Prepare workspace backup', exact: true }).click();
    await prepare.getByRole('button', { name: 'Verify and prepare backup', exact: true }).click();
    await expect(downloads.getByText('Encrypted backup ready.', { exact: true })).toBeVisible();
    await downloads.getByRole('button', { name: 'Cancel backup', exact: true }).click();
    await expect(
      downloads.getByText('Backup preparation or delivery was cancelled.'),
    ).toBeVisible();
    await expect(
      downloads.getByRole('button', { name: 'Prepare workspace backup', exact: true }),
    ).toBeFocused();
    await expect
      .poll(async () =>
        (await readdir(directory)).filter((name) => name.startsWith('.backup-export-')),
      )
      .toEqual([]);

    await rm(keyFile);
    await downloads.getByRole('button', { name: 'Prepare workspace backup', exact: true }).click();
    await prepare.getByRole('button', { name: 'Verify and prepare backup', exact: true }).click();
    await expect(
      downloads.getByText(
        'The backup could not be prepared or delivered. Check the backup guide and try again.',
      ),
    ).toBeVisible();
    await capture(page, info, 'missing-key');
    expect(await backups.innerText()).not.toContain(file.name);
    expect(await backups.innerText()).not.toContain(directory);
    expect(errors).toEqual([]);
  } catch (error) {
    await info.attach('backup-download-failure', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
    throw error;
  } finally {
    await browser.close();
    db.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
