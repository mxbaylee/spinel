import { expect, test } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';

test('personal tags work in the dashboard and editor, suggest earlier names and stay private on shared files', async ({
  page,
  context,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(90_000);
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db),
    store = new WorkspaceStore(auth);
  const owner = auth.createUser('Tag owner'),
    viewer = auth.createUser('Tag viewer');
  const item = store.create(owner.id, { name: 'Tagged budget', kind: 'sheet', parentId: null });
  store.share(owner.id, item.id, viewer.id, 'viewer');
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
  const dialog = page.getByRole('dialog', { name: 'Tags for Tagged budget' });
  async function add(value: string) {
    await dialog.getByLabel('Tag', { exact: true }).fill(value);
    await dialog.getByRole('button', { name: 'Add tag', exact: true }).click();
  }
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Tags Tagged budget', exact: true }).click();
    await add('#BUDGET');
    await expect(dialog.getByRole('button', { name: 'Remove #budget', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByText('#budget', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Tagged budget Sheet', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Save status' })).toHaveText(
      'All changes saved.',
      { timeout: 30000 },
    );
    await page.getByRole('button', { name: 'Tags Tagged budget', exact: true }).click();
    await add('recipes');
    await expect(
      dialog.getByRole('button', { name: 'Remove #recipes', exact: true }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Remove #budget', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Remove #budget', exact: true })).toHaveCount(
      0,
    );
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page.reload();
    await expect(page.getByText('#recipes', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Tags Tagged budget', exact: true }).click();
    await expect(dialog.locator('datalist option[value="budget"]')).toHaveCount(1);
    await add('BUDGET');
    await expect(dialog.getByRole('button', { name: 'Remove #budget', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('button', { name: 'My files', exact: true })
      .click();
    await expect(page.getByText('#budget', { exact: true })).toBeVisible();
    await expect(page.getByText('#recipes', { exact: true })).toBeVisible();
    await otherPage.goto(`${baseURL}/?item=${item.id}`);
    await expect(otherPage.getByRole('status', { name: 'Save status' })).toContainText(
      'View only',
      { timeout: 30000 },
    );
    await expect(otherPage.getByText('#budget', { exact: true })).toHaveCount(0);
    await otherPage.getByRole('button', { name: 'Tags Tagged budget', exact: true }).click();
    const ownDialog = otherPage.getByRole('dialog', { name: 'Tags for Tagged budget' });
    await expect(ownDialog.locator('datalist option')).toHaveCount(0);
    await ownDialog.getByLabel('Tag', { exact: true }).fill('reading');
    await ownDialog.getByRole('button', { name: 'Add tag', exact: true }).click();
    await expect(
      ownDialog.getByRole('button', { name: 'Remove #reading', exact: true }),
    ).toBeVisible();
    await ownDialog.getByRole('button', { name: 'Done', exact: true }).click();
    await otherPage.reload();
    await expect(otherPage.getByText('#reading', { exact: true })).toBeVisible();
    expect(store.get(owner.id, item.id).tags).toEqual(['budget', 'recipes']);
    expect(store.get(viewer.id, item.id).tags).toEqual(['reading']);
    await page.getByRole('button', { name: 'Tagged budget Sheet', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Save status' })).toHaveText(
      'All changes saved.',
      { timeout: 30000 },
    );
    await page.getByRole('button', { name: 'Tags Tagged budget', exact: true }).click();
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let received = false;
    const endpoint = `**/api/items/${item.id}/tags`;
    await page.route(endpoint, async (route) => {
      const response = await route.fetch();
      received = true;
      await held;
      await route.fulfill({ response });
    });
    try {
      await add('late-tag');
      await expect.poll(() => received).toBe(true);
      await page.goBack();
      await expect(page).toHaveURL(`${baseURL}/`);
      await expect(dialog).toHaveCount(0);
      const completed = page.waitForResponse((response) =>
        response.url().endsWith(`/${item.id}/tags`),
      );
      release();
      await (await completed).finished();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(dialog).toHaveCount(0);
      await page.reload();
      await expect(page.getByText('#late-tag', { exact: true })).toBeVisible();
    } finally {
      release();
      await page.unroute(endpoint);
    }
  } finally {
    await other.close();
    db.close();
  }
});
