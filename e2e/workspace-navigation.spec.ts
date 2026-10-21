import { expect, test } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';

test('files and settings remain reachable without personal pin UI or requests', async ({
  page,
  context,
  baseURL,
}, info) => {
  const database = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(database);
  const workspace = new WorkspaceStore(auth);
  const user = auth.createUser('Navigation owner');
  const folder = workspace.create(user.id, {
    name: 'Daily folder',
    kind: 'folder',
    parentId: null,
  });
  workspace.create(user.id, { name: 'Daily journal', kind: 'doc', parentId: folder.id });
  const pinRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/items/pins') pinRequests.push(request.url());
  });
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
  try {
    await page.goto('/');
    const files = page.getByRole('list', { name: 'Folder contents' });
    await expect(
      files.getByRole('button', { name: 'Daily folder Folder', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Pinned items' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^(Pin|Unpin) / })).toHaveCount(0);
    await page
      .getByRole('complementary', { name: 'Folders' })
      .getByRole('button', { name: 'Daily folder', exact: true })
      .click();
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveText(
      'My files / Daily folder',
    );
    await expect(
      files.getByRole('button', { name: 'Daily journal Doc', exact: true }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Pinned items' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await expect(
      files.getByRole('button', { name: 'Daily folder Folder', exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      files.getByRole('button', { name: 'Daily folder Folder', exact: true }),
    ).toBeVisible();
    expect(pinRequests).toEqual([]);
  } finally {
    database.prepare('DELETE FROM auth_users WHERE id=?').run(user.id);
    database.close();
  }
});
