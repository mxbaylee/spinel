import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { WorkspaceFiles } from '../src/server/workspace/files.ts';

async function capture(page: Page, info: TestInfo, name: string) {
  if (process.env.SPINEL_CAPTURE_SCREENSHOTS !== '1') return;
  await mkdir('test-results/theme-screenshots', { recursive: true });
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `test-results/theme-screenshots/spn-071-${name}-${theme}-${info.project.name}.png`,
      animations: 'disabled',
    });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

test('a collaborator hides and restores a Doc and Space without changing the owner’s grants', async ({
  page,
  context,
  baseURL,
}, info) => {
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db);
  const files = new WorkspaceFiles(new WorkspaceStore(auth, { spacesEnabled: true }));
  const owner = auth.createUser(`Hide owner ${info.testId}`);
  const reader = auth.createUser(`Hide reader ${info.testId}`);
  const doc = files.create(owner.id, { name: 'Finished journey', kind: 'doc', parentId: null });
  const space = files.create(owner.id, { name: 'Previous project', kind: 'space', parentId: null });
  for (const item of [doc, space]) files.share(owner.id, item.id, reader.id, 'viewer');
  const grants = () =>
    db.prepare('SELECT * FROM workspace_grants WHERE user_id=? ORDER BY item_id').all(reader.id);
  const before = grants();
  await context.addCookies([
    {
      name: COOKIE_NAME,
      value: auth.createSession(reader.id).token,
      url: baseURL!.replace('http:', 'https:'),
      secure: true,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  const viewMenu = async (label: string) => {
    await page
      .getByRole('button', { name: 'More actions for Shared with me', exact: true })
      .click();
    await page.getByRole('menuitem', { name: label, exact: true }).click();
  };
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/?shared=1');
    await page.getByRole('button', { name: `More actions for ${doc.name}`, exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Make a copy…', exact: true })).toBeEnabled();
    await capture(page, info, 'shared-menu-desktop');
    await page.getByRole('menuitem', { name: 'Access details…', exact: true }).click();
    const access = page.getByRole('dialog', { name: `Access to ${doc.name}`, exact: true });
    await expect(access.getByText('Viewer', { exact: true })).toBeVisible();
    await expect(access.getByText('Shared directly with you.', { exact: true })).toBeVisible();
    await capture(page, info, 'access-details-desktop');
    await access.getByRole('button', { name: 'Close dialog', exact: true }).click();
    for (const item of [doc, space]) {
      await page
        .getByRole('button', { name: `More actions for ${item.name}`, exact: true })
        .click();
      await page.getByRole('menuitem', { name: 'Hide', exact: true }).click();
      await expect(
        page.getByText(`${item.name} is hidden from Shared with me and search.`, { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', {
          name: `${item.name} ${item.kind === 'doc' ? 'Doc' : 'Space'}`,
          exact: true,
        }),
      ).toHaveCount(0);
    }
    expect(grants()).toEqual(before);
    await page.getByRole('searchbox', { name: 'Search files', exact: true }).fill(doc.name);
    await expect(page.getByRole('status').filter({ hasText: '0 results' })).toHaveText('0 results');
    expect((await context.request.get(`/api/items/${doc.id}/doc`)).status()).toBe(200);
    await page.reload();
    await expect(page.getByRole('button', { name: `${doc.name} Doc`, exact: true })).toHaveCount(0);
    await viewMenu('Show hidden');
    await expect(
      page.getByRole('list', { name: 'Shared with me files' }).getByText('Hidden', { exact: true }),
    ).toHaveCount(2);
    await page.getByRole('radio', { name: 'Grid', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await capture(page, info, 'hidden-shares-phone');
    for (const item of [doc, space]) {
      await page
        .getByRole('button', { name: `More actions for ${item.name}`, exact: true })
        .click();
      await page.getByRole('menuitem', { name: 'Show', exact: true }).click();
      await expect(
        page.getByText(`${item.name} is shown in Shared with me and search.`, { exact: true }),
      ).toBeVisible();
    }
    await viewMenu('Hide hidden');
    await expect(page.getByRole('button', { name: `${doc.name} Doc`, exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: `${space.name} Space`, exact: true }),
    ).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search files', exact: true }).fill(doc.name);
    await expect(
      page.getByRole('button', { name: `Open result ${doc.name}`, exact: true }),
    ).toBeVisible();
    expect(grants()).toEqual(before);
  } finally {
    db.close();
  }
});
