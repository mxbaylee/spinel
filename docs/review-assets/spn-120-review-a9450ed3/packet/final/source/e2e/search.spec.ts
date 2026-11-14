import { expect, test } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';

test('dashboard search combines filters across folders without private paths and removes revoked shares', async ({
  page,
  context,
  baseURL,
}, info) => {
  test.setTimeout(60_000);
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`),
    auth = new AuthStore(db),
    store = new WorkspaceStore(auth);
  const owner = auth.createUser('Search owner'),
    viewer = auth.createUser(`Search viewer ${owner.id}`);
  const hidden = store.create(owner.id, {
    name: 'Hidden owner ancestor',
    kind: 'folder',
    parentId: null,
  });
  const shared = store.create(owner.id, {
    name: 'Shared budget',
    kind: 'sheet',
    parentId: hidden.id,
  });
  const mine = store.create(viewer.id, { name: 'My budget', kind: 'sheet', parentId: null });
  const old = store.create(viewer.id, { name: 'Old budget', kind: 'doc', parentId: null });
  const folder = store.create(viewer.id, {
    name: 'Personal filing',
    kind: 'folder',
    parentId: null,
  });
  db.prepare('UPDATE workspace_items SET updated_at=? WHERE id=?').run(
    Date.now() - 3 * 86400000,
    old.id,
  );
  store.share(owner.id, shared.id, viewer.id, 'viewer');
  store.changeTag(owner.id, shared.id, 'owner-private-label');
  store.changeTag(viewer.id, shared.id, 'reading');
  store.place(viewer.id, shared.id, folder.id);
  await context.addCookies([
    {
      name: COOKIE_NAME,
      value: auth.createSession(viewer.id).token,
      url: baseURL!.replace('http:', 'https:'),
      secure: true,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  const query = page.getByRole('searchbox', { name: 'Search files', exact: true });
  const results = page.getByRole('region', { name: 'Search results', exact: true });
  const type = page.getByRole('combobox', { name: 'File type', exact: true });
  const ownership = page.getByRole('combobox', { name: 'Ownership', exact: true });
  const tag = page.getByLabel('Tag', { exact: true });
  const modified = page.getByRole('combobox', { name: 'Last modified', exact: true });
  const clear = page.getByRole('button', { name: 'Clear search and filters', exact: true });
  const count = (n: number) =>
    expect(results.getByRole('status')).toHaveText(`${n} ${n === 1 ? 'result' : 'results'}`);
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Search options', exact: true }).click();
    await expect(type.locator('option')).toHaveText([
      'All types',
      'Folder',
      'Sheet',
      'Doc',
      'Space',
    ]);
    await page.getByRole('button', { name: 'Apply search', exact: true }).click();
    await query.fill('budget');
    await count(3);
    // Searching keeps the folder mounted, but must not import into that hidden folder.
    const transfer = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.items.add(new File(['%PDF-'], 'not-a-univer.pdf'));
      return data;
    });
    try {
      await page.getByRole('region', { name: 'Your files', exact: true }).dispatchEvent('drop', {
        dataTransfer: transfer,
      });
    } finally {
      await transfer.dispose();
    }
    await clear.click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await query.fill('budget');
    await count(3);
    await query.fill('budget modified:day');
    await count(2);
    await page.getByRole('button', { name: 'Search options', exact: true }).click();
    await type.selectOption('sheet');
    await ownership.selectOption('shared');
    await tag.fill('reading');
    await expect(modified).toHaveValue('day');
    await page.getByRole('button', { name: 'Apply search', exact: true }).click();
    await count(1);
    await expect(
      results.getByRole('button', { name: 'Open result Shared budget', exact: true }),
    ).toBeVisible();
    await expect(results.getByText('Owner: Search owner', { exact: true })).toBeVisible();
    await expect(results.getByText('Personal filing', { exact: true })).toBeVisible();
    await expect(results.getByText('Hidden owner ancestor', { exact: true })).toHaveCount(0);
    await query.fill('owner-private-label type:sheet owner:shared tag:reading modified:day');
    await count(0);
    await query.fill('Hidden owner ancestor type:sheet owner:shared tag:reading modified:day');
    await count(0);
    await query.fill('personal filing budget type:sheet owner:shared tag:reading modified:day');
    await count(1);
    await page.screenshot({
      path: `test-results/theme-screenshots/search-${info.project.name}.png`,
      fullPage: true,
    });
    await clear.click();
    await expect(results).toBeHidden();
    await query.fill('Personal filing type:folder owner:mine');
    await count(1);
    await results.getByRole('button', { name: 'Open result Personal filing', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(folder.id));
    await expect(results).toBeHidden();
    await query.fill('My budget type:sheet owner:mine');
    await count(0);
    await expect(page.getByText('Searching:', { exact: false })).toContainText('Personal filing');
    await page.getByRole('button', { name: 'Search all files', exact: true }).click();
    await count(1);
    await expect(
      results.getByRole('button', { name: `Open result ${mine.name}`, exact: true }),
    ).toBeVisible();
    await query.fill('Shared budget type:sheet owner:shared');
    await count(1);
    store.share(owner.id, shared.id, viewer.id, null);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await count(0);
    await clear.click();
    await expect(
      page
        .getByRole('list', { name: 'Folder contents' })
        .getByRole('button', { name: 'Shared budget Sheet', exact: true }),
    ).toHaveCount(0);
    expect(store.get(owner.id, shared.id).parentId).toBe(hidden.id);
    let failNext = true;
    await page.route('**/api/items/search**', async (route) => {
      if (failNext) {
        failNext = false;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Search temporarily unavailable.' }),
        });
      } else await route.continue();
    });
    await page.getByRole('button', { name: 'Search all files', exact: true }).click();
    await query.fill('My budget');
    await expect(results.getByRole('alert')).toContainText('Search temporarily unavailable.');
    await expect(
      results.getByRole('button', { name: 'Open result My budget', exact: true }),
    ).toHaveCount(0);
    await results.getByRole('button', { name: 'Retry search', exact: true }).click();
    await count(1);
    await expect(
      results.getByRole('button', { name: 'Open result My budget', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Shared with me', exact: true }).click();
    await expect(results).toBeHidden();
    await expect(query).toHaveValue('');
    await expect(page.getByRole('heading', { name: 'Shared with me', exact: true })).toBeVisible();
    await expect(
      page.getByText('Nothing has been shared with you yet.', { exact: true }),
    ).toBeVisible();
    // Revocation leaves an empty list with no box; the visible empty state proves
    // navigation completed, while no row may expose the revoked document.
    await expect(page.getByRole('list', { name: 'Shared with me files', exact: true })).toHaveCount(
      1,
    );
    await expect(
      page.getByRole('list', { name: 'Shared with me files', exact: true }).getByRole('listitem'),
    ).toHaveCount(0);
  } finally {
    db.close();
  }
});
