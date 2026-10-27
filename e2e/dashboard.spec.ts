import { expect, test } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';

test('signed-out pages redirect and APIs expose no workspace data', async ({ page, request }) => {
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('heading', { name: 'Your workspace.', exact: true })).toBeVisible();
  for (const path of ['/api/health', '/api/missing', '/api/auth/passkeys', '/api/auth/session'])
    expect((await request.get(path)).status()).toBe(401);
  expect(
    (
      await request.post('/api/auth/registration/options', {
        headers: { Origin: new URL(page.url()).origin },
        data: {},
      })
    ).status(),
  ).toBe(401);
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('registers two devices, signs in with either, persists and revokes sessions', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const database = openDatabase(
    testInfo.project.name === 'development'
      ? 'test-results/development/app.sqlite'
      : 'test-results/production/app.sqlite',
  );
  const store = new AuthStore(database);
  const user = store.createUser(`Owner ${testInfo.testId}`);
  const initial = store.createSession(user.id);
  await context.addCookies([
    {
      name: COOKIE_NAME,
      value: initial.token,
      // CDP requires a secure source URL for __Host- cookie injection.
      // The app still issues and rotates real Secure cookies over localhost.
      url: baseURL!.replace('http:', 'https:'),
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
  ]);
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const options = {
    protocol: 'ctap2' as const,
    transport: 'internal' as const,
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    automaticPresenceSimulation: true,
  };
  const first = (await cdp.send('WebAuthn.addVirtualAuthenticator', { options })).authenticatorId;
  try {
    await page.goto('/settings#passkeys');
    await page.getByRole('button', { name: 'Add a passkey' }).click();
    await expect(page.getByRole('listitem')).toHaveCount(1);
    await expect(page.getByRole('listitem')).toContainText('Passkey');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(
      page.getByRole('button', { name: 'Sign in with a passkey', exact: true }),
    ).toBeVisible();
    expect(store.session(initial.token)).toBeUndefined();
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await expect(page.getByRole('heading', { name: 'My files', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'My files', exact: true })).toBeVisible();
    const cookie = (await context.cookies()).find((cookie) => cookie.name === COOKIE_NAME)!;
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict' });
    expect(cookie.value).not.toBe(initial.token);
    expect((await context.request.get('/api/health')).ok()).toBe(true);
    await cdp.send('WebAuthn.setAutomaticPresenceSimulation', {
      authenticatorId: first,
      enabled: false,
    });
    const second = (
      await cdp.send('WebAuthn.addVirtualAuthenticator', {
        options: { ...options, transport: 'usb' },
      })
    ).authenticatorId;
    await page.getByRole('link', { name: 'Your profile' }).click();
    await page.getByRole('link', { name: 'Passkeys', exact: true }).click();
    await page.getByRole('button', { name: 'Add a passkey' }).click();
    await expect(page.getByRole('listitem')).toHaveCount(2);
    await expect(page.getByRole('listitem').filter({ hasText: 'Passkey 2' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await expect(page.getByRole('heading', { name: 'My files', exact: true })).toBeVisible();
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: second });
    await cdp.send('WebAuthn.setAutomaticPresenceSimulation', {
      authenticatorId: first,
      enabled: true,
    });
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await expect(page.getByRole('heading', { name: 'My files', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Your profile' }).click();
    await page.getByRole('link', { name: 'Passkeys', exact: true }).click();
    // Cancel before the authenticator responds; the UI remains immediately usable.
    await cdp.send('WebAuthn.setAutomaticPresenceSimulation', {
      authenticatorId: first,
      enabled: false,
    });
    await page.getByRole('button', { name: 'Add a passkey' }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add a passkey' })).toBeEnabled();
    await expect(
      page.getByRole('status').filter({ hasText: 'Passkey request cancelled.' }),
    ).toHaveText('Passkey request cancelled.');
    expect(errors).toEqual([]);
    const current = (await context.cookies()).find((cookie) => cookie.name === COOKIE_NAME)!;
    store.revokeSession(store.session(current.value)!.token_hash);
    // Expiry while Settings is already open must send the next action to sign-in.
    await page.getByRole('button', { name: 'Add a passkey' }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await cdp.send('WebAuthn.setAutomaticPresenceSimulation', {
      authenticatorId: first,
      enabled: true,
    });
    const credential = store.passkeys(user.id)[0];
    store.database.prepare('UPDATE auth_passkeys SET counter=1000 WHERE id=?').run(credential.id);
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await expect(page.getByRole('alert')).toHaveText('Could not verify this passkey. Try again.');
    expect((await context.request.get('/api/auth/session')).status()).toBe(401);
    store.database
      .prepare('UPDATE auth_passkeys SET counter=? WHERE id=?')
      .run(credential.counter, credential.id);
    // A correctly signed response with a tampered client origin must fail, and
    // the original response must not be reusable after that failed attempt.
    let original: unknown;
    await page.route('**/api/auth/authentication/verify', async (route) => {
      const body = route.request().postDataJSON();
      original = structuredClone(body);
      const client = JSON.parse(
        Buffer.from(body.response.response.clientDataJSON, 'base64url').toString(),
      );
      client.origin = 'https://wrong.example';
      body.response.response.clientDataJSON = Buffer.from(JSON.stringify(client)).toString(
        'base64url',
      );
      await route.continue({ postData: JSON.stringify(body) });
    });
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await expect(page.getByRole('alert')).toHaveText('Could not verify this passkey. Try again.');
    await page.unroute('**/api/auth/authentication/verify');
    const replay = await context.request.post('/api/auth/authentication/verify', {
      headers: { Origin: baseURL! },
      data: original,
    });
    expect(replay.status()).toBe(400);
    expect((await context.request.get('/api/auth/session')).status()).toBe(401);
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await expect(page.getByRole('heading', { name: 'My files', exact: true })).toBeVisible();
  } finally {
    store.database.prepare('DELETE FROM auth_users WHERE id=?').run(user.id);
    database.close();
  }
});
