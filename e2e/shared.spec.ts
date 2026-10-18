import { expect, test } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';

test('shared drawer files by drag and keyboard, removes only personal placement, and clears revoked references', async ({
  page,
  context,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(60_000);
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`),
    auth = new AuthStore(db),
    store = new WorkspaceStore(auth);
  const owner = auth.createUser('Filing owner'),
    viewer = auth.createUser('Filing collaborator');
  const sourceFolder = store.create(owner.id, {
    name: 'Private parent',
    kind: 'folder',
    parentId: null,
  });
  const doc = store.create(owner.id, {
    name: 'Shared journal',
    kind: 'doc',
    parentId: sourceFolder.id,
  });
  const folder = store.create(owner.id, { name: 'My filed work', kind: 'folder', parentId: null });
  const mine = store.create(viewer.id, { name: 'My filed work', kind: 'folder', parentId: null });
  store.share(owner.id, doc.id, viewer.id, 'viewer');
  store.share(owner.id, folder.id, viewer.id, 'viewer');
  const cookie = (id: string) => ({
    name: COOKIE_NAME,
    value: auth.createSession(id).token,
    url: baseURL!.replace('http:', 'https:'),
    secure: true,
    httpOnly: true,
    sameSite: 'Strict' as const,
  });
  await context.addCookies([cookie(viewer.id)]);
  const ownerContext = await browser.newContext({ baseURL }),
    ownerPage = await ownerContext.newPage();
  await ownerContext.addCookies([cookie(owner.id)]);
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Shared with me', exact: true }).click();
    const drawer = page.getByRole('region', { name: 'Shared with me', exact: true });
    await expect(
      drawer.getByRole('button', { name: 'Open Shared journal', exact: true }),
    ).toBeVisible();
    await expect(drawer.getByText('Filing owner', { exact: true })).toHaveCount(2);
    await expect(drawer.getByText('Private parent', { exact: true })).toHaveCount(0);
    const folders = page.getByRole('complementary', { name: 'Folders', exact: true });
    await drawer
      .getByRole('button', { name: 'Drag Shared journal into a folder', exact: true })
      .dragTo(folders.getByRole('button', { name: mine.name, exact: true }));
    await expect
      .poll(() => store.shared(viewer.id).find((i) => i.id === doc.id)?.placementParentId)
      .toBe(mine.id);
    await folders.getByRole('button', { name: mine.name, exact: true }).click();
    const contents = page.getByRole('list', { name: 'Folder contents', exact: true });
    await expect(contents.getByText('Shared', { exact: true })).toBeVisible();
    await expect(contents.getByText(owner.name, { exact: true })).toBeVisible();
    await contents.getByRole('button', { name: 'Pin Shared journal', exact: true }).click();
    const pins = page.getByRole('complementary', { name: 'Pinned items' });
    await expect(pins.getByText(owner.name, { exact: true })).toBeVisible();
    await contents
      .getByRole('button', { name: 'Remove Shared journal from my folder', exact: true })
      .click();
    await expect(contents.getByRole('button', { name: /^Shared journal/ })).toHaveCount(0);
    await expect(
      drawer.getByRole('button', { name: 'Open Shared journal', exact: true }),
    ).toBeVisible();
    expect(store.get(owner.id, doc.id).parentId).toBe(sourceFolder.id);
    expect(store.get(viewer.id, doc.id).access).toBe('viewer');
    await drawer.getByRole('button', { name: 'File Shared journal', exact: true }).click();
    const form = page.getByRole('form', { name: 'File shared item', exact: true });
    await form.getByRole('combobox', { name: 'Destination', exact: true }).selectOption(mine.id);
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(form).toBeHidden();
    await page.reload();
    await expect(contents.getByRole('button', { name: /^Shared journal/ })).toBeVisible();
    await page.getByRole('button', { name: 'Shared with me', exact: true }).click();
    await ownerPage.goto(`/?item=${sourceFolder.id}`);
    await ownerPage.getByRole('button', { name: 'Share Shared journal', exact: true }).click();
    const sharing = ownerPage.getByRole('region', { name: 'Share Shared journal', exact: true });
    await sharing
      .getByRole('combobox', { name: `Access for ${viewer.name}`, exact: true })
      .selectOption('');
    await sharing
      .getByRole('button', { name: `Apply access for ${viewer.name}`, exact: true })
      .click();
    await expect(sharing.getByRole('status')).toHaveText(`Access updated for ${viewer.name}.`);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(contents.getByRole('button', { name: /^Shared journal/ })).toHaveCount(0);
    await expect(
      drawer.getByRole('button', { name: 'Open Shared journal', exact: true }),
    ).toHaveCount(0);
    await expect(pins.getByRole('link', { name: 'Shared journal Doc', exact: true })).toHaveCount(
      0,
    );
    expect(store.get(owner.id, doc.id).parentId).toBe(sourceFolder.id);
    expect(store.get(viewer.id, mine.id).name).toBe(mine.name);
  } finally {
    await ownerContext.close();
    db.close();
  }
});
