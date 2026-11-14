import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { startApp, projectRoot } from './app-process.ts';
import { openDatabase } from '../server/database.ts';
import { AuthStore } from '../src/server/auth/store.ts';

const run = promisify(execFile);
test('console link claims a fresh instance once and keeps the setup secret off the network', async ({
  page,
  context,
}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-setup-e2e-'));
  const databasePath = join(directory, 'instance.sqlite');
  const port = testInfo.project.name === 'development' ? 3190 : 3191;
  const origin = `http://localhost:${port}`;
  const app = await startApp({
    databasePath,
    origin,
    development: testInfo.project.name === 'development',
  });
  const env = { ...process.env, DATABASE_PATH: databasePath, APP_ORIGIN: origin };
  const command = ['server/setup.ts'];
  try {
    const { stdout } = await run(process.execPath, command, { cwd: projectRoot, env });
    const link = stdout.trim().split('\n').at(-1)!;
    const secret = new URL(link).hash.slice(1).split('.')[1];
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url() + (request.postData() ?? '')));
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
    await page.goto(link);
    await expect(page).toHaveURL(`${origin}/setup`);
    await mkdir('test-results/theme-screenshots', { recursive: true });
    for (const [theme, width, label] of [
      ['light', 1280, 'light'],
      ['dark', 1280, 'dark'],
      ['light', 390, 'phone-light'],
      ['dark', 390, 'phone-dark'],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.screenshot({
        path: `test-results/theme-screenshots/spn-083-setup-${label}-${testInfo.project.name}.png`,
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('button', { name: 'Create admin passkey' }).click();
    await expect(page.getByRole('heading', { name: 'Administration', exact: true })).toBeVisible();
    await page.goto(`${origin}/`);
    await expect(page).toHaveURL(`${origin}/admin`);
    await expect(page.getByRole('link', { name: 'My files', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'Your profile', exact: true }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await expect(page).toHaveURL(`${origin}/admin`);
    const second = await page.goto(link);
    expect(second?.status()).toBe(409);
    await expect(
      page.getByText('This instance is already claimed. Setup is closed.'),
    ).toBeVisible();
    await expect(run(process.execPath, command, { cwd: projectRoot, env })).rejects.toMatchObject({
      code: 1,
    });
    const db = openDatabase(databasePath);
    try {
      expect(new AuthStore(db).userCount()).toBe(1);
    } finally {
      db.close();
    }
    expect(requests.some((request) => request.includes(secret))).toBe(false);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
