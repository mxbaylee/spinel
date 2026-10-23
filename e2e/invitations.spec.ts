import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { startApp } from './app-process.ts';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';

test('admin invites a second browser, rejects reuse and revocation, and recovers the same account', async ({
  page,
  context,
  browser,
}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-invite-e2e-'));
  const databasePath = join(directory, 'instance.sqlite');
  const port = testInfo.project.name === 'development' ? 3192 : 3193;
  const origin = `http://localhost:${port}`;
  const app = await startApp({
    databasePath,
    origin,
    development: testInfo.project.name === 'development',
  });
  const database = openDatabase(databasePath);
  const store = new AuthStore(database);
  const admin = store.createUser('Operator', true);
  const session = store.createSession(admin.id);
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
  const invitee = await browser.newContext();
  const guest = await browser.newContext();
  const second = await invitee.newPage();
  const third = await guest.newPage();
  const cdp = await invitee.newCDPSession(second);
  await cdp.send('WebAuthn.enable');
  const options = {
    protocol: 'ctap2' as const,
    transport: 'internal' as const,
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    automaticPresenceSimulation: true,
  };
  const authenticator = (await cdp.send('WebAuthn.addVirtualAuthenticator', { options }))
    .authenticatorId;
  try {
    await page.goto(`${origin}/admin#invites`);
    await page.getByRole('button', { name: 'Create invite', exact: true }).click();
    await expect(page.getByLabel('Expires in')).toHaveValue('168');
    await page
      .getByRole('dialog', { name: 'Create invite', exact: true })
      .getByRole('button', { name: 'Create invite', exact: true })
      .click();
    const link = await page.getByLabel('New invite link').inputValue();
    await expect(page.getByRole('button', { name: 'Copy invite link' })).toBeVisible();
    await second.goto(link);
    await expect(second).toHaveURL(`${origin}/invite`);
    await second.getByLabel('Your name').fill('Teammate');
    await second.getByRole('button', { name: 'Join with a passkey' }).click();
    await expect(second.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    const user = store.database.prepare("SELECT id FROM auth_users WHERE name='Teammate'").get()!;
    const oldCookie = (await invitee.cookies()).find((cookie) => cookie.name === COOKIE_NAME)!;
    expect((await invitee.request.get(`${origin}/api/auth/invites`)).status()).toBe(404);
    expect((await guest.request.get(`${origin}/api/auth/invites`)).status()).toBe(404);
    await third.goto(link);
    await expect(third.getByRole('alert')).toHaveText(
      'This invite is unavailable or expired. Ask the operator for a new link.',
    );
    expect(store.userCount()).toBe(2);
    await page.reload();
    await expect(page.getByRole('list', { name: 'Invites' })).toContainText('Used by Teammate');
    await page.getByRole('button', { name: 'Create invite', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Create invite', exact: true })
      .getByRole('button', { name: 'Create invite', exact: true })
      .click();
    const revoked = await page.getByLabel('New invite link').inputValue();
    await page
      .getByRole('list', { name: 'Invites' })
      .getByRole('listitem')
      .filter({ hasText: 'Available' })
      .getByRole('button', { name: /^Actions for invite/ })
      .click();
    await page.getByRole('menuitem', { name: 'Revoke invite' }).click();
    await third.goto(revoked);
    await expect(third.getByRole('alert')).toHaveText(
      'This invite is unavailable or expired. Ask the operator for a new link.',
    );
    await page.getByRole('button', { name: 'Create invite', exact: true }).click();
    await page.getByLabel('Invite for').selectOption(String(user.id));
    await page
      .getByRole('dialog', { name: 'Create invite', exact: true })
      .getByRole('button', { name: 'Create invite', exact: true })
      .click();
    const recovery = await page.getByLabel('New invite link').inputValue();
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: authenticator });
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options });
    await second.goto(recovery);
    await expect(second.getByRole('heading', { name: 'Recover your account' })).toBeVisible();
    await second.getByRole('button', { name: 'Recover with a passkey' }).click();
    await expect(second.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    expect(store.userCount()).toBe(2);
    expect(store.session(oldCookie.value)).toBeUndefined();
    expect(store.passkeys(String(user.id))).toHaveLength(1);
    await second.getByRole('button', { name: 'Sign out', exact: true }).click();
    await second.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await expect(second.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  } finally {
    await invitee.close();
    await guest.close();
    database.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
