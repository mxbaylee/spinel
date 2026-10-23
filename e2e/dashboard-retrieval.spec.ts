import { expect, test } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { WorkspaceFiles } from '../src/server/workspace/files.ts';

test('folder search preserves draft, scope, view and scroll across browser Back and explicit Space return', async ({
  page,
  context,
  baseURL,
}, info) => {
  const database = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(database),
    store = new WorkspaceStore(auth, { spacesEnabled: true });
  const user = auth.createUser(`Retrieval ${info.testId}`);
  const folder = store.create(user.id, { name: 'Research', kind: 'folder', parentId: null });
  const child = store.create(user.id, {
    name: 'Research child',
    kind: 'folder',
    parentId: folder.id,
  });
  store.create(user.id, { name: 'Research elsewhere', kind: 'folder', parentId: null });
  const space = new WorkspaceFiles(store).create(user.id, {
    name: 'Research Space',
    kind: 'space',
    parentId: folder.id,
  });
  for (let index = 0; index < 28; index++)
    store.create(user.id, { name: `Research notes ${index}`, kind: 'folder', parentId: folder.id });
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
  const query = page.getByRole('searchbox', { name: 'Search files', exact: true });
  const draft = 'Research   type:folder';
  database
    .prepare('UPDATE workspace_items SET updated_at=? WHERE id=?')
    .run(Date.now() - 86_400_000, child.id);
  try {
    await page.goto(`/?item=${folder.id}`);
    await page.getByRole('radio', { name: 'Grid', exact: true }).click();
    await query.fill(draft);
    await expect(
      page.getByRole('button', { name: 'Open result Research child', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Open result Research elsewhere', exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Open result Research child', exact: true })
      .scrollIntoViewIfNeeded();
    const scroll = await page.evaluate(() => window.scrollY);
    expect(scroll).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Open result Research child', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(child.id));
    await page.goBack();
    await expect(query).toHaveValue(draft);
    await expect(page.getByRole('radio', { name: 'Grid', exact: true })).toBeChecked();
    await expect(
      page.getByRole('button', { name: 'Open result Research child', exact: true }),
    ).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(scroll, 0);
    await query.fill('Research type:space');
    await page.getByRole('button', { name: 'Open result Research Space', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/spaces/${space.id}`));
    await page.getByRole('button', { name: 'My files', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`item=${folder.id}$`));
    await expect(query).toHaveValue('Research type:space');
    await expect(page.getByRole('radio', { name: 'Grid', exact: true })).toBeChecked();
    await expect(
      page.getByRole('button', { name: 'Open result Research Space', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Clear search and filters', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Folder contents' })).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('button', { name: 'My files', exact: true })
      .click();
    await page.getByRole('button', { name: 'Trash Recently deleted files', exact: true }).click();
    await page.getByRole('button', { name: 'Back to files', exact: true }).click();
    await expect(page).toHaveURL(baseURL! + '/');
    await expect(query).toHaveValue('');
  } finally {
    database.close();
  }
});

test('invalid draft pauses refresh and ignores an old response without dropping filters or widening scope', async ({
  page,
  context,
  baseURL,
}, info) => {
  const database = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(database),
    store = new WorkspaceStore(auth, { spacesEnabled: true });
  const user = auth.createUser(`Invalid draft ${info.testId}`);
  const folder = store.create(user.id, { name: 'Private folder', kind: 'folder', parentId: null });
  store.create(user.id, { name: 'Budget', kind: 'sheet', parentId: folder.id });
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
  let requests = 0;
  let release: (() => void) | undefined;
  await page.route('**/api/items/search', async (route) => {
    requests++;
    const response = await route.fetch();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({ response });
  });
  try {
    await page.goto(`/?item=${folder.id}`);
    const query = page.getByRole('searchbox', { name: 'Search files', exact: true });
    await query.fill('Budget type:sheet');
    await expect.poll(() => requests).toBe(1);
    await expect.poll(() => Boolean(release)).toBe(true);
    await query.fill('Budget type:sheet type:doc');
    await expect(query).toHaveAttribute('aria-invalid', 'true');
    await expect(
      page.getByRole('button', { name: 'Remove Type: Sheet', exact: true }),
    ).toBeDisabled();
    await expect(page.getByText(/Results are paused until the search is valid/)).toBeVisible();
    release!();
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(400);
    expect(requests).toBe(1);
    await expect(page.getByRole('button', { name: 'Open result Budget', exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByText('Searching:', { exact: false })).toContainText('Private folder');
    await page.unroute('**/api/items/search');
    await page.getByRole('button', { name: 'Search this as plain text', exact: true }).click();
    await expect(query).toHaveAttribute('aria-invalid', 'false');
    await expect(
      page.getByRole('button', { name: 'Remove Type: Sheet', exact: true }),
    ).toBeEnabled();
    await expect(page.getByText('Searching:', { exact: false })).toContainText('Private folder');
    await page.getByRole('button', { name: 'Clear search and filters', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Private folder', exact: true })).toBeVisible();
  } finally {
    release?.();
    database.close();
  }
});
