import { expect, test } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';

test('personal pins reorder, survive reload, appear across pages and lose revoked shares', async ({
  page,
  context,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(90_000);
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db),
    store = new WorkspaceStore(auth);
  const owner = auth.createUser('Pin owner'),
    viewer = auth.createUser('Pin viewer');
  const folder = store.create(owner.id, { name: 'Daily folder', kind: 'folder', parentId: null });
  const sheet = store.create(owner.id, { name: 'Daily budget', kind: 'sheet', parentId: null });
  const doc = store.create(owner.id, { name: 'Daily journal', kind: 'doc', parentId: null });
  store.share(owner.id, folder.id, viewer.id, 'viewer');
  const cookie = (id: string) => ({
    name: COOKIE_NAME,
    value: auth.createSession(id).token,
    url: baseURL!.replace('http:', 'https:'),
    secure: true,
    httpOnly: true,
    sameSite: 'Strict' as const,
  });
  await context.addCookies([cookie(owner.id)]);
  const other = await browser.newContext(),
    otherPage = await other.newPage();
  await other.addCookies([cookie(viewer.id)]);
  const sidebar = page.getByRole('complementary', { name: 'Pinned items' });
  const links = sidebar.getByRole('link');
  try {
    await page.goto('/');
    for (const item of [folder, sheet, doc]) {
      await page.getByRole('button', { name: `Pin ${item.name}`, exact: true }).click();
      await expect(
        sidebar.getByRole('link', {
          name: `${item.name} ${item.kind === 'folder' ? 'Folder' : item.kind === 'sheet' ? 'Sheet' : 'Doc'}`,
          exact: true,
        }),
      ).toBeVisible();
    }
    await expect(links).toHaveText([
      'Daily folder Folder',
      'Daily budget Sheet',
      'Daily journal Doc',
    ]);
    await sidebar
      .getByRole('button', { name: 'Drag Daily journal to reorder', exact: true })
      .dragTo(sidebar.getByRole('listitem').first());
    await expect(links).toHaveText([
      'Daily journal Doc',
      'Daily folder Folder',
      'Daily budget Sheet',
    ]);
    await page.reload();
    await expect(links).toHaveText([
      'Daily journal Doc',
      'Daily folder Folder',
      'Daily budget Sheet',
    ]);
    await sidebar.getByRole('button', { name: 'Move Daily journal down', exact: true }).click();
    await expect(links).toHaveText([
      'Daily folder Folder',
      'Daily journal Doc',
      'Daily budget Sheet',
    ]);
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await expect(links).toHaveText([
      'Daily folder Folder',
      'Daily journal Doc',
      'Daily budget Sheet',
    ]);
    await sidebar.getByRole('link', { name: 'Daily budget Sheet', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Save status' })).toHaveText(
      'All changes saved.',
      { timeout: 30000 },
    );
    await expect(links).toHaveCount(3);
    await sidebar
      .getByRole('button', { name: 'Unpin Daily journal from sidebar', exact: true })
      .click();
    await expect(links).toHaveText(['Daily folder Folder', 'Daily budget Sheet']);
    await otherPage.goto(`${baseURL}/?item=${folder.id}`);
    const otherSidebar = otherPage.getByRole('complementary', { name: 'Pinned items' });
    await expect(otherSidebar.getByRole('link')).toHaveCount(0);
    await otherPage.getByRole('button', { name: 'Pin Daily folder', exact: true }).click();
    await expect(
      otherSidebar.getByRole('link', { name: 'Daily folder Folder', exact: true }),
    ).toBeVisible();
    await expect(otherSidebar.getByText('Shared', { exact: true })).toBeVisible();
    store.share(owner.id, folder.id, viewer.id, null);
    await otherPage.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(otherSidebar.getByRole('link')).toHaveCount(0);
    expect(store.pins(owner.id).map((item) => item.id)).toEqual([folder.id, sheet.id]);
    await page
      .getByRole('navigation', { name: 'Workspace' })
      .getByRole('link', { name: 'Dashboard', exact: true })
      .click();
    await page.getByRole('button', { name: 'Move Daily folder to trash', exact: true }).click();
    await expect(links).toHaveText(['Daily budget Sheet']);
    await page.reload();
    await expect(links).toHaveText(['Daily budget Sheet']);
  } finally {
    await other.close();
    db.close();
  }
});
