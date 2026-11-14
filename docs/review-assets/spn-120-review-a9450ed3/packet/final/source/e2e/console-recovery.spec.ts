import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { startApp, projectRoot } from './app-process.ts';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';

const run = promisify(execFile);

test('console recovery replaces a lost admin passkey on the existing account and enables member recovery', async ({
  page,
  context,
  browser,
}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-admin-recovery-e2e-'));
  const databasePath = join(directory, 'instance.sqlite');
  const port = testInfo.project.name === 'development' ? 3196 : 3197;
  const origin = `http://localhost:${port}`;
  const app = await startApp({
    databasePath,
    origin,
    development: testInfo.project.name === 'development',
  });
  const database = openDatabase(databasePath);
  const store = new AuthStore(database);
  const env = { ...process.env, DATABASE_PATH: databasePath, APP_ORIGIN: origin };
  const cdp = await context.newCDPSession(page);
  const options = {
    protocol: 'ctap2' as const,
    transport: 'internal' as const,
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    automaticPresenceSimulation: true,
  };
  const memberContext = await browser.newContext();
  try {
    await cdp.send('WebAuthn.enable');
    const oldAuthenticator = (await cdp.send('WebAuthn.addVirtualAuthenticator', { options }))
      .authenticatorId;
    const setup = await run(process.execPath, ['server/setup.ts'], { cwd: projectRoot, env });
    await page.goto(setup.stdout.trim().split('\n').at(-1)!);
    await page.getByRole('button', { name: 'Create admin passkey' }).click();
    await expect(page).toHaveURL(`${origin}/admin`);
    const admin = (await (await context.request.get(`${origin}/api/auth/session`)).json()).user as {
      id: string;
      name: string;
    };
    const oldKey = store.passkeys(admin.id)[0].id;
    const oldCookie = (await context.cookies()).find((cookie) => cookie.name === COOKIE_NAME)!;
    const member = store.createUser('Recovery teammate');
    const accountCount = store.userCount();

    // Lose the authenticator while its registered key and session still exist server-side.
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: oldAuthenticator });
    // Close the mounted admin document before dropping its cookie. Otherwise a
    // late admin request can redirect to sign-in during recovery navigation.
    await page.goto('about:blank');
    await context.clearCookies();
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options });
    const recovery = await run(process.execPath, ['server/setup.ts', '--recover-admin'], {
      cwd: projectRoot,
      env,
    });
    const link = recovery.stdout.trim().split('\n').at(-1)!;
    const secret = new URL(link).hash.slice(1).split('.')[1];
    const requests: string[] = [];
    page.on('request', (request) =>
      requests.push(request.url() + JSON.stringify(request.headers()) + (request.postData() ?? '')),
    );
    await page.goto(link);
    await expect(page).toHaveURL(`${origin}/recover-admin`);
    await expect(page.getByRole('heading', { name: admin.name, exact: true })).toBeVisible();
    await expect(page.getByText(/This replaces all its old passkeys/)).toBeVisible();
    await mkdir('test-results/theme-screenshots', { recursive: true });
    for (const [theme, width, label] of [
      ['light', 1280, 'light'],
      ['dark', 1280, 'dark'],
      ['light', 390, 'phone'],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const path = `test-results/theme-screenshots/console-recovery-${label}-${testInfo.project.name}.png`;
      await page.screenshot({ path, fullPage: true });
      await testInfo.attach(`console-recovery-${label}`, { path, contentType: 'image/png' });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    // Hold verification after submission: cancellation must no longer claim it can
    // undo a credential swap, and the eventual server success must still navigate.
    let releaseVerification!: () => void;
    const verificationGate = new Promise<void>((resolve) => {
      releaseVerification = resolve;
    });
    await page.route('**/api/auth/recover-admin/verify', async (route) => {
      await verificationGate;
      await route.continue();
    });
    await page.getByRole('button', { name: 'Recover admin with a passkey' }).click();
    try {
      await expect(page.getByRole('status')).toHaveText(
        'Finishing admin recovery… Keep this page open.',
      );
      await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
    } finally {
      releaseVerification();
    }
    await expect(page).toHaveURL(`${origin}/admin`);
    expect(store.userCount()).toBe(accountCount);
    expect(store.session(oldCookie.value)).toBeUndefined();
    expect(store.passkeys(admin.id)).toHaveLength(1);
    expect(store.passkeys(admin.id)[0].id).not.toBe(oldKey);
    expect(requests.some((request) => request.includes(secret))).toBe(false);
    await page.getByRole('link', { name: 'Your profile', exact: true }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await expect(page).toHaveURL(`${origin}/admin`);
    const recovered = await (await context.request.get(`${origin}/api/auth/session`)).json();
    expect(recovered.user.id).toBe(admin.id);

    await page
      .getByRole('navigation', { name: 'Administration sections' })
      .getByRole('link', { name: 'Invites', exact: true })
      .click();
    await page.getByRole('button', { name: 'Create invite', exact: true }).click();
    await page.getByLabel('Invite for').selectOption(member.id);
    await page
      .getByRole('dialog', { name: 'Create invite', exact: true })
      .getByRole('button', { name: 'Create invite', exact: true })
      .click();
    const memberLink = await page.getByLabel('New invite link').inputValue();
    const memberPage = await memberContext.newPage();
    const memberCdp = await memberContext.newCDPSession(memberPage);
    await memberCdp.send('WebAuthn.enable');
    await memberCdp.send('WebAuthn.addVirtualAuthenticator', { options });
    await memberPage.goto(memberLink);
    await expect(memberPage.getByRole('heading', { name: 'Recover your account' })).toBeVisible();
    await memberPage.getByRole('button', { name: 'Recover with a passkey' }).click();
    await expect(memberPage.getByRole('heading', { name: 'My files', exact: true })).toBeVisible();
    const recoveredMember = await (
      await memberContext.request.get(`${origin}/api/auth/session`)
    ).json();
    expect(recoveredMember.user.id).toBe(member.id);
    expect(store.userCount()).toBe(accountCount);

    await page.goto(link);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Recover admin with a passkey' })).toHaveCount(0);
  } finally {
    await memberContext.close();
    database.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
