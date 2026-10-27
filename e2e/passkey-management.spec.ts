import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { InvitationService } from '../src/server/auth/invitations.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';

const authenticatorOptions = {
  protocol: 'ctap2' as const,
  transport: 'internal' as const,
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  automaticPresenceSimulation: true,
};

async function capture(page: Page, info: TestInfo, state: string) {
  await mkdir('test-results/theme-screenshots', { recursive: true });
  for (const [theme, width, variant] of [
    ['light', 1280, 'light'],
    ['dark', 1280, 'dark'],
    ['light', 390, 'phone'],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: `test-results/theme-screenshots/spn-070-${state}-${variant}-${info.project.name}.png`,
      animations: 'disabled',
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
}

test('profile signs out another browser, then verifies and removes its passkey without losing the current account', async ({
  page,
  context,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(150_000);
  page.setDefaultTimeout(15_000);
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth);
  const operator = auth.createUser(
    `Passkey enrollment operator ${info.testId}-${info.retry}`,
    true,
  );
  const invite = new InvitationService(auth, baseURL!).create(operator.id);
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const authenticator = (
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: authenticatorOptions })
  ).authenticatorId;
  const remote = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const editor = await remote.newPage();
  editor.setDefaultTimeout(15_000);
  const remoteCdp = await remote.newCDPSession(editor);
  await remoteCdp.send('WebAuthn.enable');
  await remoteCdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { ...authenticatorOptions, transport: 'usb' },
  });
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  editor.on('pageerror', (error) => failures.push(error.message));
  let userId: string | undefined;
  try {
    await page.goto(invite.url);
    await page.getByLabel('Your name').fill('Passkey account');
    await page.getByRole('button', { name: 'Join with a passkey', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'My files', exact: true })).toBeVisible();
    const current = (await context.cookies()).find((cookie) => cookie.name === COOKIE_NAME)!;
    userId = auth.session(current.value)!.user_id!;
    const firstKey = auth.passkeys(userId)[0];
    const item = workspace.create(userId, {
      name: 'Retained passkey budget',
      kind: 'sheet',
      parentId: null,
    });

    // Enrollment on another device starts with an already verified session.
    // Its subsequent sign-in creates a distinct session bound to its own key.
    await remote.addCookies([current]);
    await editor.goto(`${baseURL}/profile#passkeys`);
    await editor.getByRole('button', { name: 'Add a passkey', exact: true }).click();
    await expect(editor.getByRole('listitem')).toHaveCount(2);
    expect(auth.passkeys(userId)).toHaveLength(2);
    const lostKey = auth.passkeys(userId).find((key) => key.id !== firstKey.id)!;
    await remote.clearCookies();
    await editor.goto(`${baseURL}/sign-in`);
    await editor.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();
    await expect(editor.getByRole('heading', { name: 'My files', exact: true })).toBeVisible();
    const lostSession = (await remote.cookies()).find((cookie) => cookie.name === COOKIE_NAME)!;
    expect(auth.session(lostSession.value)?.passkey_id).toBe(lostKey.id);
    let closed = 0;
    editor.on('websocket', (socket) => {
      if (new URL(socket.url()).pathname === `/sync-api/items/${item.id}/socket`)
        socket.on('close', () => closed++);
    });
    const saved = editor.getByRole('status', { name: 'Save status' });
    const openEditor = async () => {
      await editor.goto(`${baseURL}/?item=${item.id}`);
      await expect(saved).toHaveText('All changes saved.', { timeout: 30_000 });
    };
    const expectRevoked = async (previousClosed: number) => {
      await expect.poll(() => closed).toBeGreaterThan(previousClosed);
      // Polling may redirect before the transient editor status is painted.
      // Both paths must end authenticated access and retain the stored document.
      await expect(
        saved
          .filter({ hasText: /^Access changed\./ })
          .or(editor.getByRole('button', { name: 'Sign in with a passkey', exact: true })),
      ).toBeVisible();
      expect((await remote.request.get(`${baseURL}/api/items/${item.id}/sheet`)).status()).toBe(
        401,
      );
    };
    await openEditor();
    const address = editor
      .getByRole('region', { name: 'Sheet document', exact: true })
      .getByRole('textbox')
      .nth(2);
    await address.fill('A1');
    await address.press('Enter');
    await editor.keyboard.type('Keep this saved work');
    await editor.keyboard.press('Enter');
    await expect
      .poll(async () =>
        JSON.stringify(
          (await (await remote.request.get(`${baseURL}/api/items/${item.id}/sheet`)).json())
            .snapshot,
        ),
      )
      .toContain('Keep this saved work');
    await expect(saved).toHaveText('All changes saved.');

    await page.goto('/profile#passkeys');
    await expect(
      page.getByRole('button', { name: `More actions for ${lostKey.name}`, exact: true }),
    ).toBeVisible();
    await capture(page, info, 'passkey-list');
    await page.getByRole('button', { name: 'Sign out other devices', exact: true }).click();
    const signOut = page.getByRole('dialog', { name: /^Sign out other devices/ });
    await capture(page, info, 'sign-out-confirmation');
    await signOut.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(auth.session(lostSession.value)).toBeDefined();
    await page.getByRole('button', { name: 'Sign out other devices', exact: true }).click();
    const beforeSignOut = closed;
    await signOut.getByRole('button', { name: 'Sign out other devices', exact: true }).click();
    await expect(signOut).toHaveCount(0);
    await expectRevoked(beforeSignOut);
    expect(auth.session(lostSession.value)).toBeUndefined();
    expect(auth.session(current.value)?.user_id).toBe(userId);
    expect(auth.passkeys(userId)).toHaveLength(2);
    expect((await context.request.get('/api/auth/session')).status()).toBe(200);

    // Signing out sessions deliberately does not delete credentials. Prove that
    // the retained remote credential can sign in again before its removal.
    await editor.goto(`${baseURL}/sign-in`);
    await editor.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();
    await expect(editor.getByRole('heading', { name: 'My files', exact: true })).toBeVisible();
    const replacementSession = (await remote.cookies()).find(
      (cookie) => cookie.name === COOKIE_NAME,
    )!;
    await openEditor();
    db.prepare('UPDATE auth_sessions SET verified_at=? WHERE token_hash=?').run(
      Date.now() - 300_001,
      auth.session(current.value)!.token_hash,
    );
    expect(
      (
        await context.request.post('/api/auth/registration/options', {
          headers: { Origin: baseURL! },
          data: {},
        })
      ).status(),
    ).toBe(428);
    await page.reload();
    await page
      .getByRole('button', { name: `More actions for ${lostKey.name}`, exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Remove…', exact: true }).click();
    const remove = page.getByRole('dialog', { name: `Remove ${lostKey.name}?`, exact: true });
    await expect(
      remove.getByRole('button', { name: 'Verify with a passkey', exact: true }),
    ).toBeVisible();
    await capture(page, info, 'verification-required');
    await cdp.send('WebAuthn.setAutomaticPresenceSimulation', {
      authenticatorId: authenticator,
      enabled: false,
    });
    await remove.getByRole('button', { name: 'Verify with a passkey', exact: true }).click();
    await remove.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(remove).toHaveCount(0);
    expect(auth.passkey(lostKey.id)).toBeDefined();
    expect(auth.session(replacementSession.value)).toBeDefined();
    await cdp.send('WebAuthn.setAutomaticPresenceSimulation', {
      authenticatorId: authenticator,
      enabled: true,
    });
    await page
      .getByRole('button', { name: `More actions for ${lostKey.name}`, exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Remove…', exact: true }).click();
    await remove.getByRole('button', { name: 'Verify with a passkey', exact: true }).click();
    await expect(remove.getByRole('button', { name: 'Remove passkey', exact: true })).toBeEnabled();
    expect((await context.cookies()).find((cookie) => cookie.name === COOKIE_NAME)?.value).toBe(
      current.value,
    );
    expect(auth.passkey(lostKey.id)).toBeDefined();
    await capture(page, info, 'remove-confirmation');
    const beforeRemove = closed;
    await remove.getByRole('button', { name: 'Remove passkey', exact: true }).click();
    await expect(remove).toHaveCount(0);
    await expectRevoked(beforeRemove);
    expect(auth.passkey(lostKey.id)).toBeUndefined();
    expect(auth.session(replacementSession.value)).toBeUndefined();
    expect(auth.session(current.value)?.user_id).toBe(userId);
    expect(auth.passkeys(userId)).toHaveLength(1);
    await expect(page.getByText(/add another passkey/i)).toBeVisible();
    await page
      .getByRole('button', { name: `More actions for ${firstKey.name}`, exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Remove…', exact: true }).click();
    const lastKey = page.getByRole('dialog', { name: `Remove ${firstKey.name}?`, exact: true });
    await expect(lastKey.getByRole('alert')).toHaveText(
      'Add another passkey before removing your last one. Nothing has been removed.',
    );
    await expect(lastKey.getByRole('button', { name: 'Remove passkey', exact: true })).toHaveCount(
      0,
    );
    await capture(page, info, 'last-passkey');
    await lastKey.getByRole('button', { name: 'Close', exact: true }).click();
    expect(
      (
        await context.request.post(`/api/auth/passkeys/${encodeURIComponent(firstKey.id)}/remove`, {
          headers: { Origin: baseURL! },
          data: {},
        })
      ).status(),
    ).toBe(409);
    expect(auth.passkey(firstKey.id)).toBeDefined();
    expect(auth.session(current.value)).toBeDefined();
    const retained = await context.request.get(`/api/items/${item.id}/sheet`);
    expect(retained.status()).toBe(200);
    expect(JSON.stringify((await retained.json()).snapshot)).toContain('Keep this saved work');
    await editor.goto(`${baseURL}/sign-in`);
    await editor.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();
    await expect(editor.getByRole('alert')).toContainText('This passkey is not available.');
    expect((await remote.request.get(`${baseURL}/api/auth/session`)).status()).toBe(401);
    expect(failures).toEqual([]);
  } finally {
    await remote.close();
    if (userId) {
      db.prepare('DELETE FROM workspace_items WHERE owner_id=?').run(userId);
      db.prepare('DELETE FROM auth_users WHERE id=?').run(userId);
    }
    db.prepare('DELETE FROM auth_users WHERE id=?').run(operator.id);
    db.close();
  }
});
