import { expect, test } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';

test('operator removes a passkey from an open editor, then disables the account without deleting its document', async ({
  page,
  context,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(90_000);
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`),
    auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth);
  const runId = `${info.testId}-${info.retry}`;
  const operator = auth.createUser('Device operator ' + runId, true),
    user = auth.createUser('Device owner ' + runId),
    collaborator = auth.createUser('Retained collaborator ' + runId);
  const item = workspace.create(user.id, {
    name: 'Preserved budget',
    kind: 'sheet',
    parentId: null,
  });
  workspace.share(user.id, item.id, collaborator.id, 'editor');
  for (const key of ['Lost browser', 'Backup passkey'])
    db.prepare('INSERT INTO auth_passkeys VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
      `${runId}-${key}`,
      user.id,
      Buffer.from([1]),
      0,
      '[]',
      key,
      'Browser',
      auth.now(),
      null,
      0,
      'singleDevice',
    );
  const adminSession = auth.createSession(operator.id),
    device = auth.createSession(user.id, undefined, `${runId}-Lost browser`),
    kept = auth.createSession(user.id, undefined, `${runId}-Backup passkey`),
    collaboratorSession = auth.createSession(collaborator.id);
  const editorContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } }),
    editor = await editorContext.newPage();
  const cookie = (token: string) => ({
    name: COOKIE_NAME,
    value: token,
    url: baseURL!.replace('http:', 'https:'),
    secure: true,
    httpOnly: true,
    sameSite: 'Strict' as const,
  });
  await context.addCookies([cookie(adminSession.token)]);
  await editorContext.addCookies([cookie(device.token)]);
  let closed = 0;
  editor.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname !== `/sync-api/items/${item.id}/socket`) return;
    socket.on('close', () => {
      closed++;
    });
  });
  const saved = editor.getByRole('status', { name: 'Save status' });
  const expectRevoked = async (closedBefore: number) => {
    await expect.poll(() => closed).toBeGreaterThan(closedBefore);
    // Native sync fences the editor; another authenticated request may already
    // have redirected to sign-in. Both are valid, unlike a generic page error.
    await expect(
      saved
        .filter({ hasText: /^Access changed\./ })
        .or(editor.getByRole('button', { name: 'Sign in with a passkey', exact: true })),
    ).toBeVisible({ timeout: 10_000 });
    expect(
      (await editorContext.request.get(`${baseURL}/api/items/${item.id}/sheet`)).status(),
    ).toBe(401);
  };
  const failures: unknown[] = [];
  try {
    await editor.goto(`${baseURL}/?item=${item.id}`);
    await expect(saved).toHaveText('All changes saved.', { timeout: 30_000 });
    const box = editor
      .getByRole('region', { name: 'Sheet document', exact: true })
      .getByRole('textbox')
      .nth(2);
    await box.fill('A1');
    await box.press('Enter');
    await editor.keyboard.type('Keep this');
    await editor.keyboard.press('Enter');
    await expect
      .poll(async () =>
        JSON.stringify(
          (await (await editorContext.request.get(`${baseURL}/api/items/${item.id}/sheet`)).json())
            .snapshot,
        ),
      )
      .toContain('Keep this');
    await expect(saved).toHaveText('All changes saved.');
    await page.goto('/admin');
    const account = page.getByRole('region', { name: `${user.name} account`, exact: true });
    await expect(account.getByText('Member · Active', { exact: true })).toBeVisible();
    await account.getByRole('button', { name: `Actions for ${user.name}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Manage passkeys' }).click();
    const passkeys = page.getByRole('dialog', { name: `Passkeys for ${user.name}`, exact: true });
    await expect(passkeys.getByText(/Last used Never/)).toHaveCount(2);
    await passkeys
      .getByRole('button', { name: 'Actions for passkey Lost browser', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Remove passkey…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Remove Lost browser?', exact: true });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(auth.session(device.token)).toBeDefined();
    await passkeys
      .getByRole('button', { name: 'Actions for passkey Lost browser', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Remove passkey…' }).click();
    const closedBeforeRemoval = closed;
    await dialog.getByRole('button', { name: 'Confirm removal' }).click();
    await expect(passkeys.getByText('Lost browser', { exact: true })).toHaveCount(0);
    await expectRevoked(closedBeforeRemoval);
    expect(auth.session(device.token)).toBeUndefined();
    expect(auth.session(kept.token)?.user_id).toBe(user.id);
    // A revoked page can navigate to sign-in. Start the retained device at the
    // actual item address after unloading its old session's pending work.
    await editor.goto('about:blank');
    await editorContext.clearCookies();
    await editorContext.addCookies([cookie(kept.token)]);
    await editor.goto(`${baseURL}/?item=${item.id}`);
    await expect(saved).toHaveText('All changes saved.', { timeout: 30_000 });
    const keptCopy = await editorContext.request.get(`${baseURL}/api/items/${item.id}/sheet`);
    expect(keptCopy.status()).toBe(200);
    expect(JSON.stringify((await keptCopy.json()).snapshot)).toContain('Keep this');
    await passkeys.getByRole('button', { name: 'Done', exact: true }).click();
    await account.getByRole('button', { name: `Actions for ${user.name}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Disable account…' }).click();
    const closedBeforeDisable = closed;
    await page
      .getByRole('dialog', { name: `Disable ${user.name}?`, exact: true })
      .getByRole('button', { name: 'Confirm removal' })
      .click();
    await expect(account.getByText('Member · Disabled', { exact: true })).toBeVisible();
    await expectRevoked(closedBeforeDisable);
    expect(auth.session(kept.token)).toBeUndefined();
    expect(workspace.get(collaborator.id, item.id, 'edit').access).toBe('editor');
    const sharedCopy = await context.request.get(`/api/items/${item.id}/sheet`, {
      headers: { Cookie: `${COOKIE_NAME}=${collaboratorSession.token}` },
    });
    expect(sharedCopy.status()).toBe(200);
    expect(JSON.stringify((await sharedCopy.json()).snapshot)).toContain('Keep this');
    expect(
      db.prepare('SELECT owner_id FROM workspace_items WHERE id=?').get(item.id)?.owner_id,
    ).toBe(user.id);
    expect((await context.request.get(`/api/items/${item.id}/sheet`)).status()).toBe(403);
    expect((await context.request.get('/api/auth/invites')).status()).toBe(200);
  } catch (error) {
    failures.push(error);
  }
  try {
    await editorContext.close();
  } catch (error) {
    failures.push(error);
  }
  try {
    db.close();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, 'Revocation or resource cleanup failed.', {
      cause: failures[0],
    });
});
