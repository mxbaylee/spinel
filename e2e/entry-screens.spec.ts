import { mkdir } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page, TestInfo } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';

async function capture(page: Page, info: TestInfo, state: string) {
  await mkdir('test-results/theme-screenshots', { recursive: true });
  for (const [theme, width, variant] of [
    ['light', 1280, 'light'], ['dark', 1280, 'dark'],
    ['light', 390, 'phone-light'], ['dark', 390, 'phone-dark'],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/theme-screenshots/spn-083-${state}-${variant}-${info.project.name}.png`, fullPage: true });
  }
}

test('entry keeps cancellation, retry and help on one task without losing the pending request', async ({ page }, info) => {
  const request = 'abcdef12-1234-4123-8123-abcdef123456';
  await page.goto(`/sign-in?connect=${request}`);
  await expect(page.getByRole('heading', { name: 'Your workspace.', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in with a passkey', exact: true })).toHaveCount(1);
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await capture(page, info, 'sign-in');

  let release = () => {};
  const released = new Promise<void>((resolve) => { release = resolve; });
  let received = (_id: string) => {};
  const challenge = new Promise<string>((resolve) => { received = resolve; });
  await page.route('**/api/auth/authentication/options', async (route) => {
    const response = await route.fetch();
    const body = await response.json() as { challengeId: string };
    received(body.challengeId);
    await released;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    const id = await challenge;
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await capture(page, info, 'passkey-pending');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Passkey request cancelled.');
    await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeFocused();
    const cancelled = page.waitForRequest((r) => r.url().endsWith('/api/auth/cancel') && r.postDataJSON().challengeId === id);
    release();
    await cancelled;
    await expect(page).toHaveURL(new RegExp(`/sign-in\\?connect=${request}$`));
    await capture(page, info, 'passkey-cancelled');
  } finally { release(); }

  await page.unroute('**/api/auth/authentication/options');
  await page.route('**/api/auth/authentication/options', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Passkey service is unavailable. Try again.' }) }));
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expect(page.getByRole('alert')).toHaveText('Passkey service is unavailable. Try again.');
  await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeFocused();
  await capture(page, info, 'passkey-error');

  const help = page.getByRole('button', { name: 'Need help?', exact: true });
  await expect(help).toHaveCount(1);
  await help.click();
  const dialog = page.getByRole('dialog', { name: 'Access to this workspace' });
  await expect(dialog).toContainText('recovery invitation');
  await expect(dialog.getByText('npm run setup', { exact: true })).not.toBeVisible();
  await capture(page, info, 'help');
  await dialog.getByText('Operator help and commands').click();
  await expect(dialog.getByText('npm run setup', { exact: true })).toBeVisible();
  await expect(dialog).toContainText('These commands are not run by this page.');
  await capture(page, info, 'operator-help');
  await page.keyboard.press('Escape');
  await expect(help).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`/sign-in\\?connect=${request}$`));
});

async function assistantRequest(api: APIRequestContext, baseURL: string, name: string) {
  const callback = 'https://assistant.example/callback';
  const registration = await api.post('/register', { data: {
    client_name: name, redirect_uris: [callback], grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'], token_endpoint_auth_method: 'none',
  } });
  expect(registration.status()).toBe(201);
  const { client_id } = await registration.json() as { client_id: string };
  const verifier = randomBytes(32).toString('base64url');
  const authorize = new URL('/authorize', baseURL);
  authorize.search = new URLSearchParams({
    client_id, redirect_uri: callback, response_type: 'code', scope: 'documents:read',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256', state: 'entry-switch-state', resource: `${baseURL}/mcp`,
  }).toString();
  return { authorize, callback, client_id, verifier };
}

test('an unbound consent request survives Operator sign-out and permits only the everyday account grant', async ({ page, context, baseURL }, info) => {
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db);
  const admin = auth.createUser(`Entry Operator ${info.testId}`, true);
  const member = auth.createUser(`Entry member ${info.testId}`);
  const assistant = await assistantRequest(context.request, baseURL!, 'Entry switch assistant');
  try {
    await context.addCookies([{ name: COOKIE_NAME, value: auth.createSession(admin.id).token,
      url: baseURL!.replace('http:', 'https:'), secure: true, httpOnly: true, sameSite: 'Strict' }]);
    await page.route(`${assistant.callback}**`, (route) => route.fulfill({ contentType: 'text/html', body: '<h1>Assistant callback</h1>' }));
    await page.goto(assistant.authorize.href);
    await expect(page).toHaveURL(/\/connect\?request=[0-9a-f-]{36}$/i);
    const request = new URL(page.url()).searchParams.get('request')!;
    await expect(page.getByRole('alert')).toContainText('Admin accounts cannot connect assistants');
    await expect(page.getByRole('button', { name: 'Allow', exact: true })).toHaveCount(0);
    expect((await context.request.get(`/api/auth/oauth/pending/${request}`)).status()).toBe(403);
    expect(db.prepare('SELECT session_hash FROM oauth_pending WHERE id=?').get(request)?.session_hash).toBeNull();
    await capture(page, info, 'consent-operator');
    await page.goto(`/connect?request=${request}&return=https://untrusted.example`);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}/sign-in?connect=${request}`);
    await expect(page.getByRole('heading', { name: 'Your workspace.', exact: true })).toBeVisible();
    expect((await context.request.get('/api/auth/session')).status()).toBe(401);

    // Session fixtures isolate the account-switch contract. The existing OAuth
    // round-trip test separately proves the actual passkey sign-in ceremony.
    await context.addCookies([{ name: COOKIE_NAME, value: auth.createSession(member.id).token,
      url: baseURL!.replace('http:', 'https:'), secure: true, httpOnly: true, sameSite: 'Strict' }]);
    await page.reload();
    await expect(page).toHaveURL(`${baseURL}/connect?request=${request}`);
    const consent = page.getByRole('region', { name: 'Assistant consent' });
    await expect(consent.getByRole('heading', { name: 'Entry switch assistant', exact: true })).toBeVisible();
    await expect(consent).toContainText(member.name);
    await expect(consent).toContainText('This connection cannot edit documents.');
    await consent.getByRole('button', { name: 'Allow', exact: true }).click();
    await expect(page).toHaveURL(/^https:\/\/assistant\.example\/callback\?/);
    const returned = new URL(page.url());
    expect(returned.searchParams.get('state')).toBe('entry-switch-state');
    expect(returned.searchParams.get('error')).toBeNull();
    const code = returned.searchParams.get('code');
    expect(code).toBeTruthy();
    const issued = await context.request.post(`${baseURL}/token`, { form: {
      grant_type: 'authorization_code', client_id: assistant.client_id, code: code!,
      redirect_uri: assistant.callback, code_verifier: assistant.verifier, resource: `${baseURL}/mcp`,
    } });
    expect(issued.ok()).toBe(true);
    expect(db.prepare('SELECT user_id FROM oauth_connections WHERE client_id=?').get(assistant.client_id)?.user_id).toBe(member.id);
    // Invalid opaque IDs still cannot turn an arbitrary return URL into a redirect.
    await context.clearCookies();
    await page.goto('/connect?request=not-a-transaction&return=https://untrusted.example');
    await expect(page).toHaveURL(`${baseURL}/sign-in`);
  } finally {
    db.close();
  }
});

test('viewed consent stays bound after account switching and requires a fresh assistant request', async ({ page, context, baseURL }, info) => {
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db);
  const first = auth.createUser(`First approval ${info.testId}`);
  const second = auth.createUser(`Second approval ${info.testId}`);
  const firstSession = auth.createSession(first.id);
  const assistant = await assistantRequest(context.request, baseURL!, 'Bound request assistant');
  try {
    await context.addCookies([{ name: COOKIE_NAME, value: firstSession.token,
      url: baseURL!.replace('http:', 'https:'), secure: true, httpOnly: true, sameSite: 'Strict' }]);
    await page.route(`${assistant.callback}**`, (route) => route.fulfill({ contentType: 'text/html', body: '<h1>Assistant callback</h1>' }));
    await page.goto(assistant.authorize.href);
    await expect(page.getByRole('button', { name: 'Allow', exact: true })).toBeVisible();
    const request = new URL(page.url()).searchParams.get('request')!;
    const bound = db.prepare('SELECT session_hash FROM oauth_pending WHERE id=?').get(request)?.session_hash;
    expect(bound).toBeTruthy();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}/sign-in?connect=${request}`);
    expect(auth.session(firstSession.token)).toBeUndefined();
    await context.addCookies([{ name: COOKIE_NAME, value: auth.createSession(second.id).token,
      url: baseURL!.replace('http:', 'https:'), secure: true, httpOnly: true, sameSite: 'Strict' }]);
    await page.reload();
    await expect(page).toHaveURL(`${baseURL}/connect?request=${request}`);
    await expect(page.getByRole('alert')).toHaveText('This connection request is not available in this session. Start again from your assistant.');
    await expect(page.getByRole('button', { name: 'Allow', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Bound request assistant', exact: true })).toHaveCount(0);
    expect((await context.request.get(`/api/auth/oauth/pending/${request}`)).status()).toBe(403);
    expect((await context.request.post(`/api/auth/oauth/pending/${request}`, { headers: { Origin: baseURL! }, data: { allow: true } })).status()).toBe(403);
    expect(db.prepare('SELECT session_hash,used FROM oauth_pending WHERE id=?').get(request)).toMatchObject({ session_hash: bound, used: 0 });
    expect(db.prepare('SELECT user_id FROM oauth_connections WHERE client_id=?').all(assistant.client_id)).toEqual([]);
    await capture(page, info, 'consent-bound-session');

    // A new authorization request is the safe restart; the old request is never rebound.
    await page.goto(assistant.authorize.href);
    await expect(page.getByRole('button', { name: 'Allow', exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('request')).not.toBe(request);
    await expect(page.getByRole('region', { name: 'Assistant consent' })).toContainText(second.name);
    await page.getByRole('button', { name: 'Allow', exact: true }).click();
    await expect(page).toHaveURL(/^https:\/\/assistant\.example\/callback\?/);
    expect(new URL(page.url()).searchParams.get('code')).toBeTruthy();
    expect(db.prepare('SELECT user_id FROM oauth_connections WHERE client_id=?').get(assistant.client_id)?.user_id).toBe(second.id);
    expect(db.prepare('SELECT session_hash,used FROM oauth_pending WHERE id=?').get(request)).toMatchObject({ session_hash: bound, used: 0 });
  } finally { db.close(); }
});
