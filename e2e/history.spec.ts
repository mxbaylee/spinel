import { gunzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';

for (const kind of ['sheet', 'doc'] as const) {
  test(`${kind} versions can be named, renamed, unnamed and read by a viewer`, async ({
    page,
    context,
    browser,
    baseURL,
  }, info) => {
    test.setTimeout(90_000);
    const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
    const auth = new AuthStore(db),
      workspace = new WorkspaceStore(auth);
    const owner = auth.createUser('Version owner'),
      viewer = auth.createUser('Version viewer');
    const item = workspace.create(owner.id, { name: 'Version test', kind, parentId: null });
    workspace.share(owner.id, item.id, viewer.id, 'viewer');
    const cookie = (user: string) => ({
      name: COOKIE_NAME,
      value: auth.createSession(user).token,
      url: baseURL!.replace('http:', 'https:'),
      secure: true,
      httpOnly: true,
      sameSite: 'Strict' as const,
    });
    let viewerContext: BrowserContext | undefined;
    const cleanupFailures: unknown[] = [];
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await context.addCookies([cookie(owner.id)]);
      viewerContext = await browser.newContext({ baseURL });
      await viewerContext.addCookies([cookie(viewer.id)]);
      await page.goto(`/?item=${item.id}`);
      const editor = page.getByRole('region', {
        name: kind === 'sheet' ? 'Sheet document' : 'Doc document',
        exact: true,
      });
      const saved = editor.getByRole('status', { name: 'Save status' });
      await expect(saved).toHaveText('All changes saved.', { timeout: 30_000 });
      if (kind === 'sheet') {
        const box = editor.getByRole('textbox').nth(2);
        await box.fill('A1');
        await box.press('Enter');
      } else await editor.locator('.univer-container').click({ position: { x: 130, y: 200 } });
      await page.keyboard.type('Keep this content');
      if (kind === 'sheet') await page.keyboard.press('Enter');
      await expect
        .poll(async () =>
          JSON.stringify(
            (await (await context.request.get(`/api/items/${item.id}/${kind}`)).json()).snapshot,
          ),
        )
        .toContain('Keep this content');
      await expect(saved).toHaveText('All changes saved.');
      await page.getByRole('button', { name: 'Document actions', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Versions', exact: true }).click();
      const panel = page.getByRole('region', { name: 'Version names' });
      await panel.getByRole('button', { name: 'Name this version', exact: true }).click();
      await panel.getByLabel('Version name', { exact: true }).fill('Q3 Final Lock');
      await panel.getByRole('button', { name: 'Save version name' }).click();
      const named = panel.getByRole('listitem').filter({ hasText: 'Q3 Final Lock' });
      await expect(named.getByText('Q3 Final Lock', { exact: true })).toBeVisible();
      const stored = db
        .prepare('SELECT id,snapshot FROM history_checkpoints WHERE item_id=? AND name=?')
        .get(item.id, 'Q3 Final Lock')!;
      expect(gunzipSync(stored.snapshot as Uint8Array).toString()).toContain('Keep this content');
      await named.getByRole('button', { name: 'Rename version' }).click();
      await panel.getByLabel('Version name', { exact: true }).fill('Final approved');
      await panel.getByRole('button', { name: 'Save version name' }).click();
      await expect(panel.getByText('Final approved', { exact: true })).toBeVisible();
      // The original collaboration baseline remains a distinct past version.
      const past = panel.getByRole('listitem').filter({ hasText: 'Unnamed version' }).last();
      await past.getByRole('button', { name: 'Name version', exact: true }).click();
      await panel.getByLabel('Version name', { exact: true }).fill('Before editing');
      await panel.getByRole('button', { name: 'Save version name' }).click();
      await expect(panel.getByText('Before editing', { exact: true })).toBeVisible();
      await page.reload();
      await expect(saved).toHaveText('All changes saved.', { timeout: 30_000 });
      await page.getByRole('button', { name: 'Document actions', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Versions', exact: true }).click();
      await panel
        .getByRole('listitem')
        .filter({ hasText: 'Final approved' })
        .getByRole('button', { name: 'Remove name' })
        .click();
      await expect(panel.getByText('Final approved', { exact: true })).toHaveCount(0);
      expect(
        db.prepare('SELECT name FROM history_checkpoints WHERE id=?').get(String(stored.id))?.name,
      ).toBeNull();
      // History visibility belongs to a second account, not a cookie replacement
      // in the live owner's tab. Retire that editor before opening the viewer so
      // an owner request or authentication redirect cannot choose the viewer's URL.
      await page.close();
      const viewerPage = await viewerContext.newPage();
      viewerPage.on('pageerror', (error) => errors.push(error.message));
      await viewerPage.goto(`/?item=${item.id}`);
      const viewerEditor = viewerPage.getByRole('region', {
        name: kind === 'sheet' ? 'Sheet document' : 'Doc document',
        exact: true,
      });
      await expect(viewerEditor.getByRole('status', { name: 'Save status' })).toContainText(
        'View only',
        { timeout: 30_000 },
      );
      await expect(viewerPage).toHaveURL(new URL(`/?item=${item.id}`, baseURL!).href);
      await expect(viewerPage.getByRole('link', { name: 'Your profile' })).toContainText(
        'Version viewer',
      );
      await viewerPage.getByRole('button', { name: 'Document actions', exact: true }).click();
      await viewerPage.getByRole('menuitem', { name: 'Versions', exact: true }).click();
      const viewerPanel = viewerPage.getByRole('region', { name: 'Version names' });
      await expect(viewerPanel.getByText('Before editing', { exact: true })).toBeVisible();
      await expect(
        viewerPanel.getByRole('button', {
          name: /Name this version|Rename version|Remove name|^Name version$/,
        }),
      ).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      try {
        await viewerContext?.close();
      } catch (cause) {
        cleanupFailures.push(cause);
      } finally {
        try {
          db.close();
        } catch (cause) {
          cleanupFailures.push(cause);
        }
      }
      for (const failure of cleanupFailures)
        console.error('History fixture cleanup failed:', failure);
    }
    if (cleanupFailures.length) throw cleanupFailures[0];
  });
}
