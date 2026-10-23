import { expect, test } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';

test('an assistant returns through passkey sign-in and consent, then can be disconnected', async ({
  page,
  context,
  browser,
  baseURL,
}, info) => {
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db);
  const user = auth.createUser(`OAuth owner ${info.testId}`);
  const operator = auth.createUser(`OAuth operator ${info.testId}`, true);
  const adminContext = await browser.newContext();
  await adminContext.addCookies([
    {
      name: COOKIE_NAME,
      value: auth.createSession(operator.id).token,
      url: baseURL!.replace('http:', 'https:'),
      secure: true,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  const callback = 'https://assistant.example/callback';
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  await context.addCookies([
    {
      name: COOKIE_NAME,
      value: auth.createSession(user.id).token,
      url: baseURL!.replace('http:', 'https:'),
      secure: true,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
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
  await page.route(`${callback}**`, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Assistant callback</h1>' }),
  );
  try {
    // Use the actual passkey ceremony after the opaque authorization request survives sign-out.
    await page.goto('/settings#passkeys');
    await page.getByRole('button', { name: 'Add a passkey' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Passkey' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in$/);

    const registration = await context.request.post('/register', {
      data: {
        client_name: 'Chosen desktop assistant',
        redirect_uris: [callback],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
    });
    expect(registration.status()).toBe(201);
    const { client_id } = (await registration.json()) as { client_id: string };
    const authorize = new URL('/authorize', baseURL);
    authorize.search = new URLSearchParams({
      client_id,
      redirect_uri: callback,
      response_type: 'code',
      scope: 'documents:read documents:write',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'browser-connection-state',
      resource: `${baseURL}/mcp`,
    }).toString();
    await page.goto(authorize.href);
    await expect(page).toHaveURL(/\/sign-in\?connect=[0-9a-f-]{36}$/i);
    const opaqueRequest = new URL(page.url()).searchParams.get('connect');
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await expect(page).toHaveURL(`${baseURL}/connect?request=${opaqueRequest}`);
    const consent = page.getByRole('region', { name: 'Assistant consent' });
    await expect(consent.getByRole('heading', { name: 'Chosen desktop assistant' })).toBeVisible();
    await expect(consent).toContainText('has not been verified by Spinel');
    await expect(consent).toContainText('https://assistant.example');
    await expect(consent).toContainText(user.name);
    await expect(consent).toContainText('Edit documents you have permission to edit.');
    await mkdir('test-results/theme-screenshots', { recursive: true });
    for (const variant of ['light', 'dark', 'phone'] as const) {
      const theme = variant === 'dark' ? 'dark' : 'light';
      await page.setViewportSize({ width: variant === 'phone' ? 390 : 1280, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `test-results/theme-screenshots/mcp-${info.project.name}-consent-${variant}.png`,
        fullPage: true,
      });
    }
    await consent.getByRole('button', { name: 'Allow', exact: true }).click();
    await expect(page).toHaveURL(/^https:\/\/assistant\.example\/callback\?/);
    const returned = new URL(page.url());
    expect(returned.searchParams.get('state')).toBe('browser-connection-state');
    expect(`${returned.origin}${returned.pathname}`).toBe(callback);
    expect(returned.searchParams.has('error')).toBe(false);
    const code = returned.searchParams.get('code');
    expect(code).toBeTruthy();
    const exchange = await context.request.post(`${baseURL}/token`, {
      form: {
        grant_type: 'authorization_code',
        client_id,
        code: code!,
        redirect_uri: callback,
        code_verifier: verifier,
        resource: `${baseURL}/mcp`,
      },
    });
    expect(exchange.ok()).toBe(true);
    const issued = (await exchange.json()) as { access_token: string; refresh_token: string };
    expect(issued.access_token).toBeTruthy();
    expect(issued.refresh_token).toBeTruthy();
    const listing = await context.request.post(`${baseURL}/mcp`, {
      headers: {
        Authorization: `Bearer ${issued.access_token}`,
        Accept: 'application/json, text/event-stream',
      },
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list_documents', arguments: {} },
      },
    });
    expect(listing.status()).toBe(200);
    const listed = (await listing.json()) as { error?: unknown; result?: { isError?: boolean } };
    expect(listed.error).toBeUndefined();
    expect(listed.result).toBeDefined();
    expect(listed.result?.isError).not.toBe(true);

    await page.goto(`${baseURL}/settings#connections`);
    const connections = page.getByRole('region', { name: 'Connected assistants' });
    await expect(connections.getByRole('listitem')).toContainText('Chosen desktop assistant');
    await expect(connections.getByRole('listitem')).toContainText('https://assistant.example');
    await expect(connections.getByRole('listitem')).not.toContainText('Last used Never');
    expect(await connections.textContent()).not.toContain(issued.access_token);
    for (const variant of ['light', 'dark', 'phone'] as const) {
      const theme = variant === 'dark' ? 'dark' : 'light';
      await page.setViewportSize({ width: variant === 'phone' ? 390 : 1280, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `test-results/theme-screenshots/mcp-${info.project.name}-connections-${variant}.png`,
        fullPage: true,
      });
    }
    const admin = await adminContext.newPage();
    await admin.goto(`${baseURL}/admin`);
    const metadata = admin.getByRole('region', { name: 'Connected assistants' });
    const connectionRow = metadata.getByRole('listitem').filter({ hasText: user.name });
    await expect(connectionRow).toContainText('Chosen desktop assistant');
    await expect(connectionRow).toContainText('https://assistant.example');
    await expect(connectionRow).toContainText('Connected');
    await expect(connectionRow).toContainText('Created');
    await expect(connectionRow).toContainText('Last used');
    await expect(connectionRow).not.toContainText('Last used Never');
    await expect(metadata.getByRole('textbox')).toHaveCount(0);
    await expect(metadata.getByRole('button', { name: /Allow|Disconnect|Create/ })).toHaveCount(0);
    expect(await metadata.textContent()).not.toContain(issued.access_token);
    expect(await metadata.textContent()).not.toContain(issued.refresh_token);
    for (const variant of ['light', 'dark', 'phone'] as const) {
      const theme = variant === 'dark' ? 'dark' : 'light';
      await admin.setViewportSize({ width: variant === 'phone' ? 390 : 1280, height: 900 });
      await admin.emulateMedia({ colorScheme: theme });
      await expect(admin.locator('html')).toHaveAttribute('data-theme', theme);
      await admin.evaluate(() => window.scrollTo(0, 0));
      await admin.screenshot({
        path: `test-results/theme-screenshots/mcp-${info.project.name}-admin-connections-${variant}.png`,
        fullPage: true,
      });
    }
    await connections.getByRole('button', { name: 'Disconnect Chosen desktop assistant' }).click();
    await expect(connections.getByRole('listitem')).toContainText('Disconnected');
    expect(
      (
        await context.request.post(`${baseURL}/mcp`, {
          headers: { Authorization: `Bearer ${issued.access_token}` },
          data: {},
        })
      ).status(),
    ).toBe(401);

    // Declining returns only the protocol error, without issuing another connection.
    await page.goto(authorize.href);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page).toHaveURL(/^https:\/\/assistant\.example\/callback\?/);
    const declined = new URL(page.url());
    expect(declined.searchParams.get('error')).toBe('access_denied');
    expect(declined.searchParams.has('code')).toBe(false);
    expect(declined.searchParams.get('state')).toBe('browser-connection-state');
    const after = (await (await context.request.get(`${baseURL}/api/auth/connections`)).json()) as {
      connections: unknown[];
    };
    expect(after.connections).toHaveLength(1);
  } finally {
    await adminContext.close();
    db.close();
  }
});
