import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';

for (const variant of [
  { name: 'light', width: 1440, height: 1000, theme: 'light' },
  { name: 'dark', width: 1440, height: 1000, theme: 'dark' },
  { name: 'phone-light', width: 390, height: 844, theme: 'light' },
  { name: 'phone-dark', width: 390, height: 844, theme: 'dark' },
]) {
  test(`dashboard composed states ${variant.name}`, async ({ page, context, baseURL }, info) => {
    test.setTimeout(120_000);
    const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
    const auth = new AuthStore(db),
      store = new WorkspaceStore(auth);
    const user = auth.createUser('Iris Garden'),
      other = auth.createUser('Alex Kim');
    const home = store.create(user.id, { name: 'Household', kind: 'folder', parentId: null });
    const nested = store.create(user.id, { name: 'Finance', kind: 'folder', parentId: home.id });
    store.create(user.id, { name: 'Quarterly budget', kind: 'sheet', parentId: null });
    store.create(user.id, { name: 'Travel notes', kind: 'doc', parentId: null });
    store.create(user.id, { name: 'Receipt archive', kind: 'sheet', parentId: nested.id });
    const shared = store.create(other.id, { name: 'Team roadmap', kind: 'doc', parentId: null });
    store.share(other.id, shared.id, user.id, 'admin');
    store.changeTag(user.id, shared.id, 'work');
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
    await page.setViewportSize({ width: variant.width, height: variant.height });
    await page.addInitScript((theme) => {
      localStorage.setItem('spinel-theme', theme);
      localStorage.setItem('spinel-files-layout', 'list');
    }, variant.theme);
    await mkdir('test-results/theme-screenshots', { recursive: true });
    const capture = async (state: string) => {
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await page.screenshot({
        path: `test-results/theme-screenshots/spn-048-${state}-${variant.name}-${info.project.name}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    };
    const place = async (name: 'My files' | 'Shared with me') => {
      const browse = page.getByRole('button', { name: 'Browse files', exact: true });
      if (await browse.isVisible()) await browse.click();
      await page.getByRole('button', { name, exact: true }).click();
    };
    const rowMenu = async (name: string, action?: string) => {
      await page.getByRole('button', { name: `More actions for ${name}`, exact: true }).click();
      if (action) await page.getByRole('menuitem', { name: action, exact: true }).click();
    };
    try {
      await page.goto('/');
      await expect(
        page.getByRole('button', { name: 'Quarterly budget Sheet', exact: true }),
      ).toBeVisible();
      await capture('list');
      await page.getByRole('radio', { name: 'Grid', exact: true }).click();
      await capture('grid');
      await page.getByRole('radio', { name: 'List', exact: true }).click();
      if (variant.width < 1024) {
        await page.getByRole('button', { name: 'Browse files', exact: true }).click();
        await capture('navigation-drawer');
        await page
          .getByRole('dialog', { name: 'Browse files', exact: true })
          .getByRole('button', { name: 'Close dialog', exact: true })
          .click();
      } else {
        await page.getByRole('button', { name: 'Collapse navigation', exact: true }).click();
        await expect(
          page.getByRole('button', { name: 'Shared with me', exact: true }),
        ).toBeVisible();
        await capture('navigation-collapsed');
        await page.getByRole('button', { name: 'Expand navigation', exact: true }).click();
      }
      await rowMenu('Quarterly budget');
      await capture('row-menu');
      await page.keyboard.press('Escape');
      await rowMenu('Quarterly budget', 'Tags…');
      await expect(
        page.getByRole('dialog', { name: 'Tags for Quarterly budget', exact: true }),
      ).toBeVisible();
      await capture('tags');
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await rowMenu('Quarterly budget', 'Share…');
      await expect(
        page.getByRole('dialog', { name: 'Share Quarterly budget', exact: true }),
      ).toBeVisible();
      await capture('sharing');
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await page.getByRole('button', { name: 'New', exact: true }).click();
      await capture('new-menu');
      await page.getByRole('menuitem', { name: 'Folder', exact: true }).click();
      await capture('new-folder');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('button', { name: 'New', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Import file…', exact: true }).click();
      await capture('import');
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await page.getByRole('button', { name: 'Search options', exact: true }).click();
      await capture('search-options');
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
      const query = page.getByRole('searchbox', { name: 'Search files', exact: true });
      await query.fill('budget type:sheet owner:mine');
      await expect(
        page.getByRole('button', { name: 'Open result Quarterly budget', exact: true }),
      ).toBeVisible();
      await capture('search-chips');
      await query.fill('budget type:sheet type:doc');
      await expect(query).toHaveAttribute('aria-invalid', 'true');
      await capture('invalid-search');
      await page.getByRole('button', { name: 'Clear search and filters', exact: true }).click();
      await place('Shared with me');
      await expect(
        page.getByRole('button', { name: 'Team roadmap Doc', exact: true }),
      ).toBeVisible();
      await capture('shared');
      await rowMenu('Team roadmap');
      await expect(page.getByRole('menuitem', { name: 'Share…', exact: true })).toBeVisible();
      await capture('shared-admin-menu');
      await page.keyboard.press('Escape');
      await place('My files');
      await page.getByRole('button', { name: 'Household Folder', exact: true }).click();
      await page.getByRole('button', { name: 'Finance Folder', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Finance', exact: true })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveText(
        'My files / Household',
      );
      await capture('nested-folder');
      await rowMenu('Finance');
      await capture('folder-menu');
    } finally {
      db.close();
    }
  });
}
