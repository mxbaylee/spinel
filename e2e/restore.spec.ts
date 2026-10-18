import { expect, test } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { interruptibleNetwork } from './live-network.ts';

for (const kind of ['sheet', 'doc'] as const) {
  test(`${kind} preview is read only and restore preserves the state seen by both editors`, async ({
    page,
    context,
    browser,
    baseURL,
  }, info) => {
    test.setTimeout(120_000);
    page.setDefaultTimeout(15_000);
    const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
    const auth = new AuthStore(db),
      workspace = new WorkspaceStore(auth);
    const owner = auth.createUser('Restore owner'),
      editor = auth.createUser('Restore collaborator');
    const item = workspace.create(owner.id, { name: 'Restore example', kind, parentId: null });
    workspace.share(owner.id, item.id, editor.id, 'editor');
    const second = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const offline = await interruptibleNetwork(second);
    const other = await second.newPage();
    other.setDefaultTimeout(15_000);
    const cookie = (user: string) => ({
      name: COOKIE_NAME,
      value: auth.createSession(user).token,
      url: baseURL!.replace('http:', 'https:'),
      secure: true,
      httpOnly: true,
      sameSite: 'Strict' as const,
    });
    await context.addCookies([cookie(owner.id)]);
    await second.addCookies([cookie(editor.id)]);
    await page.setViewportSize({ width: 1440, height: 1100 });
    let preview: typeof page | undefined;
    const saved = (target: typeof page) =>
      expect(target.getByRole('status', { name: 'Save status' })).toHaveText('All changes saved.', {
        timeout: 30_000,
      });
    const read = async () =>
      await (await context.request.get(`/api/items/${item.id}/${kind}`)).json();
    const edit = async (target: typeof page, text: string, cell = 'A1') => {
      const region = target.getByRole('region', {
        name: kind === 'sheet' ? 'Sheet document' : 'Doc document',
        exact: true,
      });
      if (kind === 'sheet') {
        const box = region.getByRole('textbox').nth(2);
        await box.fill(cell);
        await box.press('Enter');
      } else await region.locator('.univer-container').click({ position: { x: 130, y: 200 } });
      await target.keyboard.type(text);
      if (kind === 'sheet') await target.keyboard.press('Enter');
    };
    try {
      await page.goto(`/?item=${item.id}`);
      await saved(page);
      await edit(page, 'Original');
      await expect.poll(async () => JSON.stringify((await read()).snapshot)).toContain('Original');
      await saved(page);
      await page.getByRole('button', { name: 'Versions', exact: true }).click();
      await page.getByRole('button', { name: 'Name this version', exact: true }).click();
      await page.getByLabel('Version name', { exact: true }).fill('Original version');
      await page.getByRole('button', { name: 'Save version name' }).click();
      const original = page.getByRole('listitem').filter({ hasText: 'Original version' });
      await expect(original).toBeVisible();
      const popup = page.waitForEvent('popup');
      await original.getByRole('link', { name: 'Preview version' }).click();
      preview = await popup;
      preview.setDefaultTimeout(15_000);
      await expect(
        preview.getByRole('heading', { name: 'Preview — Restore example' }),
      ).toBeVisible();
      await expect(preview.getByRole('button', { name: 'Restore this version' })).toBeEnabled({
        timeout: 30_000,
      });
      await expect(preview.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled();
      await preview.screenshot({
        path: info.outputPath(`${kind}-restore-preview.png`),
        animations: 'disabled',
      });
      const untouched = await read();
      await preview.locator('.univer-container').click({ position: { x: 130, y: 200 } });
      await preview.keyboard.type('must not edit');
      if (kind === 'sheet') {
        await expect(
          preview.getByText('The range is protected, and you do not have edit permission.', {
            exact: false,
          }),
        ).toBeVisible();
        await preview.getByRole('button', { name: 'ok', exact: true }).click();
      }
      expect((await read()).revision).toBe(untouched.revision);
      await other.goto(`${baseURL}/?item=${item.id}`);
      await saved(other);
      await edit(other, 'Latest collaborative change');
      await expect
        .poll(async () => JSON.stringify((await read()).snapshot))
        .toContain('Latest collaborative change');
      await saved(other);
      await saved(page);
      const latest = await read();
      if (kind === 'sheet') {
        await offline.setOffline(true);
        await edit(other, 'Old offline edit', 'B2');
      }
      preview.once('dialog', (dialog) => void dialog.accept());
      await preview.getByRole('button', { name: 'Restore this version' }).click();
      await saved(preview);
      const restored = await read();
      expect(restored.revision).toBe(latest.revision + 1);
      expect(JSON.stringify(restored.snapshot)).toContain('Original');
      expect(JSON.stringify(restored.snapshot)).not.toContain('Latest collaborative change');
      await edit(preview, 'Editing after restore', 'C3');
      await expect
        .poll(async () => JSON.stringify((await read()).snapshot))
        .toContain('Editing after restore');
      await saved(preview);
      if (kind === 'sheet') await offline.setOffline(false);
      await expect(other.getByRole('status', { name: 'Save status' })).toContainText(
        'has been restored',
        { timeout: 15_000 },
      );
      await expect(page.getByRole('status', { name: 'Save status' })).toContainText(
        'has been restored',
      );
      expect(JSON.stringify((await read()).snapshot)).not.toContain('Old offline edit');
      other.on('dialog', (dialog) => void dialog.accept());
      await other.reload();
      await saved(other);
      await other.getByRole('button', { name: 'Versions', exact: true }).click();
      const before = other.getByRole('listitem').filter({ hasText: 'Before restore' });
      await expect(before).toBeVisible();
      // The collaborator can recover their accepted work from the retained pre-state.
      const undoPopup = other.waitForEvent('popup');
      await before.getByRole('link', { name: 'Preview version' }).click();
      const undo = await undoPopup;
      undo.setDefaultTimeout(15_000);
      await expect(undo.getByRole('button', { name: 'Restore this version' })).toBeEnabled({
        timeout: 30_000,
      });
      undo.once('dialog', (dialog) => void dialog.accept());
      await undo.getByRole('button', { name: 'Restore this version' }).click();
      await saved(undo);
      expect(JSON.stringify((await read()).snapshot)).toContain('Latest collaborative change');
      await undo.close();
    } finally {
      await preview?.close();
      await second.close();
      db.close();
    }
  });
}
