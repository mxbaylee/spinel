import { expect, test } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';

test('shared files are filed by pointer and keyboard, remove only personal placement, and clear revoked references', async ({
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
    // The test database survives retries; account-access labels must stay unique.
    viewer = auth.createUser(`Filing collaborator ${owner.id}`);
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
  const contents = page.getByRole('list', { name: 'Folder contents', exact: true });
  const shared = page.getByRole('list', { name: 'Shared with me files', exact: true });
  const form = page.getByRole('form', { name: 'File shared item', exact: true });
  const openMine = async () => {
    await page.getByRole('button', { name: 'My files', exact: true }).click();
    await contents.getByRole('button', { name: `${mine.name} Folder`, exact: true }).click();
  };
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Shared with me', exact: true }).click();
    await expect(
      shared.getByRole('button', { name: 'Shared journal Doc', exact: true }),
    ).toBeVisible();
    await expect(shared.getByText('Owner: Filing owner', { exact: true })).toHaveCount(2);
    await expect(shared.getByText('Private parent', { exact: true })).toHaveCount(0);
    await shared
      .getByRole('button', { name: 'More actions for Shared journal', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'File into folder…', exact: true }).click();
    await form.getByRole('combobox', { name: 'Destination', exact: true }).selectOption(mine.id);
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(form).toBeHidden();
    await expect
      .poll(() => store.shared(viewer.id).find((i) => i.id === doc.id)?.placementParentId)
      .toBe(mine.id);
    await openMine();
    await expect(contents.getByText('Shared · View only', { exact: true })).toBeVisible();
    await expect(contents.getByText(`Owner: ${owner.name}`, { exact: true })).toBeVisible();
    await contents
      .getByRole('button', { name: 'More actions for Shared journal', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Remove from my folder', exact: true }).click();
    await expect(contents.getByRole('button', { name: /^Shared journal/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Shared with me', exact: true }).click();
    await expect(
      shared.getByRole('button', { name: 'Shared journal Doc', exact: true }),
    ).toBeVisible();
    expect(store.get(owner.id, doc.id).parentId).toBe(sourceFolder.id);
    expect(store.get(viewer.id, doc.id).access).toBe('viewer');
    await shared
      .getByRole('button', { name: 'More actions for Shared journal', exact: true })
      .focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: 'File into folder…', exact: true }).focus();
    await page.keyboard.press('Enter');
    await form.getByRole('combobox', { name: 'Destination', exact: true }).selectOption(mine.id);
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(form).toBeHidden();
    await openMine();
    await page.reload();
    await expect(contents.getByRole('button', { name: /^Shared journal/ })).toBeVisible();
    await page.getByRole('button', { name: 'Shared with me', exact: true }).click();
    await ownerPage.goto(`/?item=${sourceFolder.id}`);
    await ownerPage
      .getByRole('button', { name: 'More actions for Shared journal', exact: true })
      .click();
    await ownerPage.getByRole('menuitem', { name: 'Share…', exact: true }).click();
    const sharing = ownerPage.getByRole('dialog', { name: 'Share Shared journal', exact: true });
    await sharing
      .getByRole('combobox', { name: `Access for ${viewer.name}`, exact: true })
      .selectOption('');
    await sharing
      .getByRole('button', { name: `Apply access for ${viewer.name}`, exact: true })
      .click();
    await expect(
      sharing.getByRole('status').filter({ hasText: `Access updated for ${viewer.name}.` }),
    ).toHaveText(`Access updated for ${viewer.name}.`);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(
      shared.getByRole('button', { name: 'Shared journal Doc', exact: true }),
    ).toHaveCount(0);
    await openMine();
    await expect(contents.getByRole('button', { name: /^Shared journal/ })).toHaveCount(0);
    expect(store.get(owner.id, doc.id).parentId).toBe(sourceFolder.id);
    expect(store.get(viewer.id, mine.id).name).toBe(mine.name);
  } finally {
    await ownerContext.close();
    db.close();
  }
});
