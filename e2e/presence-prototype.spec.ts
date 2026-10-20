import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';

for (const kind of ['sheet', 'doc'] as const) {
  test(`profile presence prototype: real ${kind} peers, icons and colours`, async ({
    page,
    context,
    browser,
    baseURL,
  }, info) => {
    test.setTimeout(120_000);
    const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
    const auth = new AuthStore(db),
      workspace = new WorkspaceStore(auth);
    const owner = auth.createUser('Moss'),
      editor = auth.createUser('Iris');
    const item = workspace.create(owner.id, {
      name: 'Profile presence prototype',
      kind,
      parentId: null,
    });
    workspace.share(owner.id, item.id, editor.id, 'editor');
    const second = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const other = await second.newPage();
    const errors: string[] = [];
    const cookie = (id: string) => ({
      name: COOKIE_NAME,
      value: auth.createSession(id).token,
      url: baseURL!.replace('http:', 'https:'),
      secure: true,
      httpOnly: true,
      sameSite: 'Strict' as const,
    });
    await context.addCookies([cookie(owner.id)]);
    await second.addCookies([cookie(editor.id)]);
    await page.setViewportSize({ width: 1440, height: 1100 });
    for (const target of [page, other])
      target.on('pageerror', (error) => errors.push(error.message));
    const saved = (target: typeof page) =>
      expect(target.getByRole('status', { name: 'Save status' })).toHaveText('All changes saved.', {
        timeout: 30_000,
      });
    const read = async () =>
      (await (await context.request.get(`/api/items/${item.id}/${kind}`)).json()).snapshot;
    const focusDoc = (target: typeof page) =>
      target.locator('.univer-container').click({ position: { x: 130, y: 200 } });
    const select = async (target: typeof page, address: string) => {
      const box = target
        .getByRole('region', { name: 'Sheet document', exact: true })
        .getByRole('textbox')
        .nth(2);
      await box.fill(address);
      await box.press('Enter');
    };
    try {
      await page.goto(`/?item=${item.id}&presencePrototype=1`);
      await saved(page);
      if (kind === 'doc') {
        await focusDoc(page);
        await page.keyboard.type('A shared garden');
        await saved(page);
      }
      await other.goto(`${baseURL}/?item=${item.id}&presencePrototype=1`);
      await saved(other);
      if (kind === 'sheet') {
        await select(page, 'A1');
        await page.keyboard.type('Moss');
        await page.keyboard.press('Enter');
        await select(other, 'B2');
        await other.keyboard.type('Iris');
        await other.keyboard.press('Enter');
        await select(other, 'B2:C4');
        await expect
          .poll(async () => {
            const data = await read();
            return data.sheets[data.sheetOrder[0]].cellData[1]?.[1]?.v;
          })
          .toBe('Iris');
      } else {
        await focusDoc(other);
        await other.keyboard.press('End');
        await other.keyboard.type(' with flowers');
        await saved(other);
        await other.keyboard.press('Shift+Home');
        await expect
          .poll(async () => (await read()).body.dataStream)
          .toBe('A shared garden with flowers\r\n');
      }
      await saved(page);
      await saved(other);
      const label = page.locator('[data-presence-prototype="label"]').filter({ hasText: 'Iris' });
      await expect(label).toBeVisible({ timeout: 15_000 });
      await expect(label.locator('[data-profile-icon="flower"]')).toBeVisible();
      // Native remote labels must be off: this test uses only the replacement.
      await mkdir('test-results/theme-screenshots', { recursive: true });
      for (const theme of ['light', 'dark'] as const) {
        await page.evaluate((value) => {
          localStorage.setItem('spinel-theme', value);
          window.dispatchEvent(
            new StorageEvent('storage', { key: 'spinel-theme', newValue: value }),
          );
        }, theme);
        await expect(label).toBeVisible();
        await page.screenshot({
          path: `test-results/theme-screenshots/presence-${kind}-${theme}-${info.project.name}.png`,
          fullPage: true,
        });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: `test-results/theme-screenshots/presence-${kind}-phone-${info.project.name}.png`,
        fullPage: true,
      });
      // Both peers can still edit after replacing the cursor UI.
      if (kind === 'sheet') {
        await select(page, 'D4');
        await page.keyboard.type('Still editing');
        await page.keyboard.press('Enter');
      } else {
        await focusDoc(page);
        await page.keyboard.press('End');
        await page.keyboard.type(' together');
      }
      await saved(page);
      await saved(other);
      expect(errors).toEqual([]);
    } finally {
      await second.close();
      db.prepare('DELETE FROM workspace_items WHERE id=?').run(item.id);
      for (const user of [owner, editor])
        db.prepare('DELETE FROM auth_users WHERE id=?').run(user.id);
      db.close();
    }
  });
}
