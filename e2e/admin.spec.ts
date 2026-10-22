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
    kept = auth.createSession(user.id, undefined, `${runId}-Backup passkey`);
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
  editor.on('websocket', (socket) =>
    socket.on('close', () => {
      closed++;
    }),
  );
  try {
    await editor.goto(`${baseURL}/?item=${item.id}`);
    const saved = editor.getByRole('status', { name: 'Save status' });
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
    await expect(account.getByText(/Last used Never/)).toHaveCount(2);
    await account.getByRole('button', { name: 'Remove Lost browser', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Confirm access removal' });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(auth.session(device.token)).toBeDefined();
    await account.getByRole('button', { name: 'Remove Lost browser', exact: true }).click();
    await dialog.getByRole('button', { name: 'Confirm removal' }).click();
    await expect(
      account.getByRole('button', { name: 'Remove Lost browser', exact: true }),
    ).toHaveCount(0);
    await expect.poll(() => closed).toBeGreaterThan(0);
    await expect(saved).toContainText('Access changed', { timeout: 10_000 });
    expect(
      (await editorContext.request.get(`${baseURL}/api/items/${item.id}/sheet`)).status(),
    ).toBe(401);
    expect(auth.session(kept.token)?.user_id).toBe(user.id);
    // A revoked page can navigate to sign-in. Start the retained device at the
    // actual item address after unloading its old session's pending work.
    await editor.goto('about:blank');
    await editorContext.clearCookies();
    await editorContext.addCookies([cookie(kept.token)]);
    await editor.goto(`${baseURL}/?item=${item.id}`);
    await expect(saved).toHaveText('All changes saved.', { timeout: 30_000 });
    await account.getByRole('button', { name: 'Disable account', exact: true }).click();
    await dialog.getByRole('button', { name: 'Confirm removal' }).click();
    await expect(account.getByText('Member · Disabled', { exact: true })).toBeVisible();
    await expect(saved).toContainText('Access changed', { timeout: 10_000 });
    expect(auth.session(kept.token)).toBeUndefined();
    expect(workspace.get(collaborator.id, item.id, 'edit').access).toBe('editor');
    expect(
      db.prepare('SELECT owner_id FROM workspace_items WHERE id=?').get(item.id)?.owner_id,
    ).toBe(user.id);
    expect((await context.request.get(`/api/items/${item.id}/sheet`)).status()).toBe(403);
    expect((await context.request.get('/api/auth/invites')).status()).toBe(200);
  } finally {
    await editorContext.close();
    db.close();
  }
});
