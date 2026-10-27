import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { projectRoot, startApp } from './app-process.ts';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { filesystemIdentity } from '../src/server/backup/filesystem.ts';
import type { BackupStatusResponse } from '../web/BackupStatus.tsx';

test('operator sees missing configuration, backup failure and the last good backup after reopening Admin', async ({
  playwright,
}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-backup-e2e-'));
  const databasePath = join(directory, 'spinel.sqlite');
  const port = testInfo.project.name === 'development' ? 3194 : 3195;
  const origin = `http://localhost:${port}`;
  const app = await startApp({
    databasePath,
    origin,
    development: testInfo.project.name === 'development',
  });
  const db = openDatabase(databasePath),
    auth = new AuthStore(db);
  const admin = auth.createUser('Operator', true),
    session = auth.createSession(admin.id);
  let browser: Browser | undefined;
  let page: Page | undefined;
  try {
    browser = await playwright.chromium.launch(testInfo.project.use.launchOptions);
    const context = await browser.newContext();
    page = await context.newPage();
    await context.addCookies([
      {
        name: COOKIE_NAME,
        value: session.token,
        url: origin.replace('http:', 'https:'),
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
      },
    ]);
    await page.goto(`${origin}/admin#health`);
    const panel = page.getByRole('region', { name: 'Backups' });
    await expect(
      panel.getByText('Offsite backups are not configured.', { exact: false }),
    ).toBeVisible();
    await expect(panel.getByText('Last successful backup: None yet')).toBeVisible();
    db.prepare('UPDATE backup_state SET last_good=?, last_attempt=?, error=?').run(
      Date.now() - 86400_000,
      Date.now(),
      'Backup or retention failed. Check storage access.',
    );
    db.prepare(
      'UPDATE verification_state SET last_good=?, last_attempt=?, error=?, key_id=? WHERE id=1',
    ).run(
      Date.now() - 86400_000,
      Date.now(),
      'Restore verification failed. Keep the backup and check the recovery guide.',
      'retained-key',
    );
    await page.reload();
    await expect(
      panel.getByRole('alert').filter({ hasText: 'Backup or retention failed' }),
    ).toBeVisible();
    await expect(panel.getByText('Last successful backup:', { exact: false })).not.toContainText(
      'None yet',
    );
    const verification = panel.getByRole('region', { name: 'Restore verification' });
    await expect(verification.getByRole('alert')).toContainText('Restore verification failed');
    await expect(verification.getByText(/Last successful restore check:/)).not.toContainText(
      'None yet',
    );
    await expect(verification.getByText('Verified encryption key: retained-key')).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Administration sections' })
      .getByRole('link', { name: 'Invites', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'Invites', exact: true })).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Administration sections' })
      .getByRole('link', { name: 'Backups & health', exact: true })
      .click();
    db.exec('UPDATE backup_state SET error=NULL');
    db.exec('UPDATE verification_state SET error=NULL');
    await page.reload();
    await expect(panel.getByText('Backup or retention failed', { exact: false })).toHaveCount(0);
    await expect(
      verification.getByText('Restore verification failed', { exact: false }),
    ).toHaveCount(0);
  } catch (error) {
    const screenshot = await page?.screenshot({ fullPage: true }).catch(() => undefined);
    if (screenshot)
      await testInfo.attach('backup-status-failure', {
        body: screenshot,
        contentType: 'image/png',
      });
    throw error;
  } finally {
    await browser?.close();
    db.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('a real scheduled filesystem backup is verified locally and never presented as offsite protection', async ({
  playwright,
  request,
}, info) => {
  test.skip(
    process.platform !== 'linux',
    'The supported filesystem destination uses the Linux profile.',
  );
  test.setTimeout(90_000);
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'spinel-local-backup-e2e-')));
  const root = join(directory, 'destination');
  const databasePath = join(directory, 'spinel.sqlite');
  const configPath = join(directory, 'backup.json');
  const keyFile = join(directory, 'backup.key');
  const runtimeEnvironmentFile = join(directory, 'runtime.env');
  const origin = `http://localhost:${info.project.name === 'development' ? 3196 : 3197}`;
  let app: Awaited<ReturnType<typeof startApp>> | undefined;
  let operatorToken: string;
  let memberToken: string;
  try {
    const seed = openDatabase(databasePath);
    try {
      const auth = new AuthStore(seed);
      operatorToken = auth.createSession(auth.createUser('Operator', true).id).token;
      memberToken = auth.createSession(auth.createUser('Member', false).id).token;
    } finally {
      seed.close();
    }
    await mkdir(root, { mode: 0o700 });
    await writeFile(keyFile, randomBytes(32), { mode: 0o600 });
    await writeFile(runtimeEnvironmentFile, 'NODE_ENV=production\n', { mode: 0o600 });
    await writeFile(
      configPath,
      JSON.stringify({
        type: 'filesystem',
        ...(await filesystemIdentity(root)),
        prefix: 'browser-recovery',
        keyFile,
        runtimeEnvironmentFile,
        keyId: 'local-e2e',
      }),
      { mode: 0o600 },
    );
    app = await startApp({
      databasePath,
      origin,
      development: info.project.name === 'development',
      backupConfigPath: configPath,
      image: `sha256:${'a'.repeat(64)}`,
    });
    const cookie = (value: string) => ({
      name: COOKIE_NAME,
      value,
      url: origin.replace('http:', 'https:'),
      httpOnly: true,
      secure: true,
      sameSite: 'Strict' as const,
    });
    const operatorHeaders = { Cookie: `${COOKIE_NAME}=${operatorToken}` };
    let status: BackupStatusResponse | undefined;
    await expect
      .poll(
        async () => {
          const response = await request.get(`${origin}/api/admin/backups`, {
            headers: operatorHeaders,
          });
          expect(response.status()).toBe(200);
          status = (await response.json()) as BackupStatusResponse;
          return (
            status.lastGood !== null &&
            status.verification.lastGood !== null &&
            !status.running &&
            !status.verification.running
          );
        },
        { timeout: 60_000, message: 'The real scheduled backup and isolated restore must finish.' },
      )
      .toBe(true);
    expect(status).toMatchObject({
      destination: 'filesystem',
      offsite: false,
      keyId: 'local-e2e',
      error: null,
      verification: { error: null, keyId: 'local-e2e' },
    });
    expect(JSON.stringify(status)).not.toContain(directory);
    const archives = (await readdir(join(root, 'browser-recovery'))).filter((file) =>
      file.endsWith('.spinel'),
    );
    expect(archives.length).toBeGreaterThan(0);
    expect(
      (await readFile(join(root, 'browser-recovery', archives[0]))).subarray(0, 8).toString(),
    ).toBe('SPINEL01');

    expect(
      (
        await request.get(`${origin}/api/admin/backups`, {
          headers: { Cookie: `${COOKIE_NAME}=${memberToken}` },
        })
      ).status(),
    ).toBe(404);

    async function capture(state: 'verified' | 'failed') {
      // Start the browser only after the recovery job finishes. Keeping an idle
      // browser beside the app and isolated verifier wastes the local 2 GiB budget.
      const browser = await playwright.chromium.launch(info.project.use.launchOptions);
      let page: Page | undefined;
      try {
        const context = await browser.newContext();
        const currentPage = await context.newPage();
        page = currentPage;
        await context.addCookies([cookie(operatorToken)]);
        await page.goto(`${origin}/admin#health`);
        const panel = page.getByRole('region', { name: 'Backups', exact: true });
        const verification = panel.getByRole('region', { name: 'Restore verification' });
        await expect(panel.getByText('Local backup saved', { exact: true })).toBeVisible();
        await expect(panel.getByText('OK', { exact: true })).toHaveCount(0);
        await expect(
          panel.getByRole('alert').filter({ hasText: 'independent offsite copy' }),
        ).toBeVisible();
        await expect(verification.getByText(/Last successful restore check:/)).not.toContainText(
          'None yet',
        );
        if (state === 'failed') await expect(verification.getByRole('alert')).toBeVisible();
        await mkdir('test-results/theme-screenshots', { recursive: true });
        for (const variant of [
          { name: 'light', theme: 'light', width: 1440 },
          { name: 'dark', theme: 'dark', width: 1440 },
          { name: 'phone', theme: 'light', width: 390 },
        ] as const) {
          await page.evaluate(
            (theme) => localStorage.setItem('spinel-theme', theme),
            variant.theme,
          );
          await page.setViewportSize({ width: variant.width, height: 1000 });
          await page.reload();
          await expect(
            verification.getByText(state === 'verified' ? 'Verified' : 'Failed', { exact: true }),
          ).toBeVisible();
          await expect
            .poll(() =>
              currentPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            )
            .toBe(true);
          if (variant.name === 'phone') {
            for (const target of [
              panel.getByRole('button', { name: 'Refresh backup status' }),
              panel.getByRole('link', { name: 'Open backup guide' }),
            ]) {
              const bounds = await target.boundingBox();
              expect(bounds!.height).toBeGreaterThanOrEqual(44);
              expect(bounds!.width).toBeGreaterThanOrEqual(44);
            }
          }
          await panel.screenshot({
            path: `test-results/theme-screenshots/spn-063-local-${state}-${variant.name}-${info.project.name}.png`,
          });
        }
      } catch (error) {
        const screenshot = await page?.screenshot({ fullPage: true }).catch(() => undefined);
        if (screenshot)
          await info.attach(`backup-${state}-failure`, {
            body: screenshot,
            contentType: 'image/png',
          });
        throw error;
      } finally {
        await browser.close();
      }
    }
    await capture('verified');

    // Exercise a real failed restore, not a status-only fixture: the isolated
    // verifier must reject tampered ciphertext while keeping its previous success.
    const archivePath = join(root, 'browser-recovery', archives[0]);
    const damaged = await readFile(archivePath);
    damaged[30] ^= 1;
    await writeFile(archivePath, damaged);
    const code = await new Promise<number>((resolve, reject) => {
      execFile(
        process.execPath,
        ['--max-old-space-size=256', 'scripts/deploy/backup.ts', 'verify'],
        {
          cwd: projectRoot,
          env: {
            ...process.env,
            DATABASE_PATH: databasePath,
            BACKUP_CONFIG_PATH: configPath,
            APP_ORIGIN: origin,
            SPINEL_IMAGE: `sha256:${'a'.repeat(64)}`,
          },
          timeout: 30_000,
          maxBuffer: 64 * 1024,
        },
        (error) => {
          if (!error) resolve(0);
          else if (typeof error.code === 'number') resolve(error.code);
          else reject(new Error('The recovery verification command could not complete.'));
        },
      );
    });
    expect(code).toBe(1);
    const failed = (await (
      await request.get(`${origin}/api/admin/backups`, { headers: operatorHeaders })
    ).json()) as BackupStatusResponse;
    expect(failed.verification.lastGood).toBe(status!.verification.lastGood);
    expect(failed.verification.error).not.toBeNull();
    expect(await readFile(archivePath)).toEqual(damaged);
    await capture('failed');
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
