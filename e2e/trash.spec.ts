import { expect, test } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { TrashStore } from '../src/server/workspace/trash.ts';

test('trash restores nested native documents, preserves prior deletions and confirms a fresh exact purge count', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  // This flow opens four collaboration editors as well as exercising trash.
  test.setTimeout(90_000);
  const db = openDatabase(
    testInfo.project.name === 'development'
      ? 'test-results/development/app.sqlite'
      : 'test-results/production/app.sqlite',
  );
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth),
    trash = new TrashStore(workspace);
  const user = auth.createUser(`Trash ${testInfo.testId}`);
  const { token } = auth.createSession(user.id);
  await context.addCookies([
    {
      name: COOKIE_NAME,
      value: token,
      url: baseURL!.replace('http:', 'https:'),
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
  ]);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const files = page.getByRole('region', { name: 'Your files', exact: true });
  const contents = page.getByRole('list', { name: 'Folder contents', exact: true });
  const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
  const bin = page.getByRole('region', { name: 'Trash', exact: true });
  async function folderAction(name: string, action: string) {
    await files.getByRole('button', { name: `More actions for ${name}`, exact: true }).click();
    await page.getByRole('menuitem', { name: action, exact: true }).click();
  }
  async function create(name: string, kind: string, parentId: string | null) {
    const response = await context.request.post('/api/items', {
      headers: { Origin: baseURL! },
      data: { name, kind, parentId },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).item as { id: string };
  }
  try {
    const root = await create('Keep folder', 'folder', null),
      sub = await create('Nested', 'folder', root.id);
    const sheet = await create('Budget', 'sheet', sub.id),
      doc = await create('Journal', 'doc', sub.id);
    const refreshed = await create('Refresh item', 'doc', sub.id);
    const earlier = await create('Previously deleted', 'doc', root.id);
    trash.trash(user.id, earlier.id);
    await page.goto(`/?item=${sheet.id}`);
    await expect(page.getByRole('region', { name: 'Sheet document', exact: true })).toContainText(
      'All changes saved.',
      { timeout: 20000 },
    );
    await page.goto(`/?item=${doc.id}`);
    await expect(page.getByRole('region', { name: 'Doc document', exact: true })).toContainText(
      'All changes saved.',
      { timeout: 20000 },
    );
    await breadcrumb.getByRole('button', { name: 'My files', exact: true }).click();
    await folderAction('Keep folder', 'Move to Trash');
    await expect(
      contents.getByRole('button', { name: 'Keep folder Folder', exact: true }),
    ).toBeHidden();
    await contents.getByRole('button', { name: /^Trash/ }).click();
    await expect(bin.getByRole('button', { name: /^Restore / })).toHaveCount(6);
    await page.reload();
    await expect(bin.getByRole('button', { name: /^Restore / })).toHaveCount(6);
    await bin.getByRole('button', { name: 'Restore Keep folder', exact: true }).click();
    await expect(bin.getByRole('button', { name: /^Restore / })).toHaveCount(1);
    await expect(
      bin.getByRole('button', { name: 'Restore Previously deleted', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'My files', exact: true }).click();
    await contents.getByRole('button', { name: 'Keep folder Folder', exact: true }).click();
    await contents.getByRole('button', { name: 'Nested Folder', exact: true }).click();
    await expect(
      files.getByRole('button', { name: 'Refresh item Doc', exact: true }),
    ).toBeVisible();
    trash.trash(user.id, refreshed.id);
    await folderAction('Nested', 'Refresh folder');
    await expect(files.getByRole('button', { name: 'Refresh item Doc', exact: true })).toBeHidden();
    trash.restore(user.id, refreshed.id);
    await folderAction('Nested', 'Refresh folder');
    await expect(
      files.getByRole('button', { name: 'Refresh item Doc', exact: true }),
    ).toBeVisible();

    await files.getByRole('button', { name: 'Budget Sheet', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Sheet document', exact: true })).toContainText(
      'All changes saved.',
      { timeout: 20000 },
    );
    await breadcrumb.getByRole('button', { name: 'Nested', exact: true }).click();
    await files.getByRole('button', { name: 'Journal Doc', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Doc document', exact: true })).toContainText(
      'All changes saved.',
      { timeout: 20000 },
    );
    await breadcrumb.getByRole('button', { name: 'My files', exact: true }).click();
    await contents.getByRole('button', { name: /^Trash/ }).click();
    await bin.getByRole('button', { name: 'Empty trash', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Empty trash confirmation' });
    await expect(confirm).toContainText('Permanently delete 1 item?');
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(
      bin.getByRole('button', { name: 'Restore Previously deleted', exact: true }),
    ).toBeVisible();
    await bin.getByRole('button', { name: 'Empty trash', exact: true }).click();
    // Another tab changes the target set after confirmation: the old approval cannot purge it.
    const another = await create('From another tab', 'folder', null);
    trash.trash(user.id, another.id);
    await confirm.getByRole('button', { name: 'Permanently delete 1 item', exact: true }).click();
    await expect(bin.getByRole('alert')).toContainText('Your trash changed');
    await expect(bin.getByRole('button', { name: /^Restore / })).toHaveCount(2);
    await bin.getByRole('button', { name: 'Empty trash', exact: true }).click();
    await confirm.getByRole('button', { name: 'Permanently delete 2 items', exact: true }).click();
    await expect(bin.getByText('Your trash is empty.', { exact: true })).toBeVisible();
    await page.goBack();
    await expect(files.getByRole('heading', { name: 'My files', exact: true })).toBeVisible();
    await page.goForward();
    await expect(bin.getByText('Your trash is empty.', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    while (db.prepare('SELECT id FROM workspace_items WHERE owner_id=?').get(user.id))
      db.prepare(
        'DELETE FROM workspace_items WHERE owner_id=? AND id NOT IN (SELECT parent_id FROM workspace_items WHERE parent_id IS NOT NULL)',
      ).run(user.id);
    db.prepare('DELETE FROM auth_users WHERE id=?').run(user.id);
    db.close();
  }
});
