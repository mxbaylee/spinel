import { gunzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';

for (const kind of ['sheet', 'doc'] as const) {
  test(`${kind} versions can be named, renamed, unnamed and read by a viewer`, async ({
    page,
    context,
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
    await context.addCookies([cookie(owner.id)]);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
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
      await editor.getByRole('button', { name: 'Versions', exact: true }).click();
      const panel = editor.getByRole('region', { name: 'Version names' });
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
      await editor.getByRole('button', { name: 'Versions', exact: true }).click();
      await panel
        .getByRole('listitem')
        .filter({ hasText: 'Final approved' })
        .getByRole('button', { name: 'Remove name' })
        .click();
      await expect(panel.getByText('Final approved', { exact: true })).toHaveCount(0);
      expect(
        db.prepare('SELECT name FROM history_checkpoints WHERE id=?').get(String(stored.id))?.name,
      ).toBeNull();
      await context.clearCookies();
      await context.addCookies([cookie(viewer.id)]);
      await page.reload();
      await expect(saved).toContainText('View only', { timeout: 30_000 });
      await editor.getByRole('button', { name: 'Versions', exact: true }).click();
      await expect(panel.getByText('Before editing', { exact: true })).toBeVisible();
      await expect(
        panel.getByRole('button', {
          name: /Name this version|Rename version|Remove name|^Name version$/,
        }),
      ).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      db.close();
    }
  });
}
