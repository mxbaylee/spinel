import { expect, test } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';

test('builds and renames a nested tree, opens all document types, moves safely and persists', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const database = openDatabase(
    testInfo.project.name === 'development'
      ? 'test-results/development/app.sqlite'
      : 'test-results/production/app.sqlite',
  );
  const auth = new AuthStore(database);
  const owner = auth.createUser(`Folders ${testInfo.testId}`);
  const { token } = auth.createSession(owner.id);
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
  const tree = page.getByRole('complementary', { name: 'Folders' });
  const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
  const files = page.getByRole('region', { name: 'Your files' });
  async function create(name: string, type = 'Folder') {
    await page.getByRole('button', { name: 'New', exact: true }).click();
    const form = page.getByRole('form', { name: 'New item' });
    // SPN-074 removes unsupported Slides, which never shipped to production.
    await expect(
      form.getByRole('combobox', { name: 'Type', exact: true }).locator('option'),
    ).toHaveText(['Folder', 'Sheet', 'Doc']);
    await form.getByRole('combobox', { name: 'Type', exact: true }).selectOption({ label: type });
    await form.getByLabel('Name', { exact: true }).fill(name);
    await form.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(form).toBeHidden();
  }
  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(page.getByText('This folder is empty.', { exact: false })).toBeVisible();
    // A marker survives every tree mutation/navigation until the explicit reload.
    await page.evaluate(() => {
      document.body.dataset.navigationMarker = 'kept';
    });
    for (const name of ['Personal', 'Finance', '2026']) {
      await create(name);
      await tree.getByRole('button', { name, exact: true }).click();
    }
    await expect(breadcrumb).toHaveText('My files / Personal / Finance / 2026');
    await files.getByRole('button', { name: 'Rename 2026', exact: true }).click();
    const rename = page.getByRole('form', { name: 'Rename item' });
    await rename.getByLabel('Name').fill('2027');
    await rename.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(breadcrumb).toHaveText('My files / Personal / Finance / 2027');
    await expect(tree.getByRole('button', { name: '2027', exact: true })).toBeVisible();
    for (const type of ['Sheet', 'Doc']) {
      await create(`${type} example`, type);
      await expect(
        page.getByRole('region', { name: `${type} document`, exact: true }),
      ).toContainText('All changes saved.', {
        timeout: 20000,
      });
      await expect(page).toHaveTitle(`${type} example — Spinel`);
      await breadcrumb.getByRole('button', { name: '2027', exact: true }).click();
      await expect(page).toHaveTitle('Spinel');
    }
    await files.getByRole('button', { name: 'Move Sheet example', exact: true }).click();
    const move = page.getByRole('form', { name: 'Move item' });
    await move
      .getByRole('combobox', { name: 'Destination', exact: true })
      .selectOption({ label: 'Personal' });
    await move.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      files.getByRole('button', { name: 'Sheet example Sheet', exact: true }),
    ).toBeHidden();
    await tree.getByRole('button', { name: 'Personal', exact: true }).click();
    await expect(
      files.getByRole('button', { name: 'Sheet example Sheet', exact: true }),
    ).toBeVisible();
    await files.getByRole('button', { name: 'Move Personal', exact: true }).click();
    await expect(
      move.getByRole('combobox', { name: 'Destination', exact: true }).locator('option'),
    ).toHaveCount(1);
    await move.getByRole('button', { name: 'Cancel', exact: true }).click();
    const items = (await (await context.request.get('/api/items')).json()).items as {
      id: string;
      name: string;
    }[];
    const id = (name: string) => items.find((item) => item.name === name)!.id;
    const badMove = await context.request.patch(`/api/items/${id('Personal')}`, {
      headers: { Origin: baseURL! },
      data: { parentId: id('2027') },
    });
    expect(badMove.status()).toBe(409);
    expect(await page.evaluate(() => document.body.dataset.navigationMarker)).toBe('kept');
    await page.reload();
    await expect(breadcrumb).toHaveText('My files / Personal');
    await expect(
      files.getByRole('button', { name: 'Sheet example Sheet', exact: true }),
    ).toBeVisible();
    await files.getByRole('button', { name: 'Sheet example Sheet', exact: true }).click();
    await page.reload();
    await expect(page.getByRole('region', { name: 'Sheet document', exact: true })).toContainText(
      'All changes saved.',
      { timeout: 20000 },
    );
    await page.goBack();
    await expect(breadcrumb).toHaveText('My files / Personal');
    await page.setViewportSize({ width: 375, height: 812 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await tree.getByRole('button', { name: 'All my files', exact: true }).click();
    await create('Personal projects');
    await expect(tree.locator('li button')).toHaveText([
      'Personal',
      'Finance',
      '2027',
      'Personal projects',
    ]);
    // Duplicate names cannot sort one parent's children into another subtree.
    async function fixtureFolder(name: string, parentId: string | null = null) {
      const response = await context.request.post('/api/items', {
        headers: { Origin: baseURL! },
        data: { name, parentId, kind: 'folder' },
      });
      expect(response.status()).toBe(201);
      return (await response.json()).item as { id: string; name: string };
    }
    const twinA = await fixtureFolder('Twin');
    const twinB = await fixtureFolder('Twin');
    await fixtureFolder('Alpha child', twinA.id);
    await fixtureFolder('Beta child', twinB.id);
    await page.reload();
    const firstChild = twinA.id.localeCompare(twinB.id) < 0 ? 'Alpha child' : 'Beta child';
    const secondChild = firstChild === 'Alpha child' ? 'Beta child' : 'Alpha child';
    await expect(tree.locator('li button')).toHaveText([
      'Personal',
      'Finance',
      '2027',
      'Personal projects',
      'Twin',
      firstChild,
      'Twin',
      secondChild,
    ]);
    expect(errors).toEqual([]);
  } finally {
    // Remove only this fixture's leaves, then parents, to respect the no-delete schema.
    while (database.prepare('SELECT id FROM workspace_items WHERE owner_id=?').get(owner.id)) {
      database
        .prepare(
          'DELETE FROM workspace_items WHERE owner_id=? AND id NOT IN (SELECT parent_id FROM workspace_items WHERE parent_id IS NOT NULL)',
        )
        .run(owner.id);
    }
    database.prepare('DELETE FROM auth_users WHERE id=?').run(owner.id);
    database.close();
  }
});
