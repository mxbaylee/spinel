import { expect, test } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { WorkspaceFiles } from '../src/server/workspace/files.ts';

test('sharing keeps confirmed access on failure, retries, traps focus and returns to its trigger', async ({ page, context, baseURL }, info) => {
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db), files = new WorkspaceFiles(new WorkspaceStore(auth, { spacesEnabled: true }));
  const owner = auth.createUser('Dialog owner ' + info.testId), peer = auth.createUser('Dialog peer ' + info.testId);
  const item = files.create(owner.id, { kind: 'space', name: 'Sharing dialog Space', parentId: null });
  files.share(owner.id, item.id, peer.id, 'editor');
  await context.addCookies([{ name: COOKIE_NAME, value: auth.createSession(owner.id).token,
    url: baseURL!.replace('http:', 'https:'), secure: true, httpOnly: true, sameSite: 'Strict' }]);
  // Clipboard denial is a real supported browser condition; manual copy remains available.
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async () => { throw new DOMException('Clipboard denied', 'NotAllowedError'); },
  } }));
  let writes = 0;
  await page.route(`**/api/items/${item.id}/sharing`, async (route) => {
    if (route.request().method() === 'PUT' && ++writes === 1) {
      await route.fulfill({ status: 503, json: { error: 'Temporary access update failure.' } });
    } else await route.continue();
  });
  try {
    await page.goto(`/spaces/${item.id}`);
    const trigger = page.getByRole('button', { name: `Space actions for ${item.name}`, exact: true });
    await trigger.click();
    await page.getByRole('menuitem', { name: 'Share', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Share ${item.name}`, exact: true });
    await expect(page.getByRole('dialog')).toHaveCount(1);
    const choice = dialog.getByRole('combobox', { name: `Access for ${peer.name}`, exact: true });
    const row = dialog.locator('.sharing-person').filter({ has: choice });
    await choice.selectOption('viewer');
    await dialog.getByRole('button', { name: `Apply access for ${peer.name}`, exact: true }).click();
    await expect(row.getByRole('alert')).toContainText('Temporary access update failure.');
    await expect(row.getByText('Effective access: Can edit.', { exact: true })).toBeVisible();
    await expect(choice).toHaveValue('viewer');
    expect(files.get(peer.id, item.id).access).toBe('editor');
    await dialog.getByRole('button', { name: `Retry access update for ${peer.name}`, exact: true }).click();
    await expect(row.getByText('Effective access: View only.', { exact: true })).toBeVisible();
    expect(files.get(peer.id, item.id).access).toBe('viewer');
    await dialog.getByRole('button', { name: 'Copy account link', exact: true }).click();
    await expect(dialog.getByLabel('Share address', { exact: true })).toHaveValue(`${baseURL}/spaces/${item.id}`);
    await expect(dialog.getByRole('status').filter({ hasText: 'Could not copy automatically.' })).toBeVisible();
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await choice.scrollIntoViewIfNeeded();
      expect((await choice.boundingBox())!.height).toBeGreaterThanOrEqual(width === 390 ? 44 : 40);
      await choice.focus();
      for (let count = 0; count < 8; count++) {
        await page.keyboard.press(count % 2 ? 'Shift+Tab' : 'Tab');
        await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
      }
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.press('Enter');
    await page.getByRole('menuitem', { name: 'Share', exact: true }).click();
    await expect(choice).toHaveValue('viewer');
    const link = dialog.getByRole('region', { name: 'Guest link', exact: true });
    await link.getByRole('button', { name: 'Create link', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Share the whole Space?', exact: true });
    await expect(confirmation).toContainText('every current and future page and folder');
    await confirmation.getByRole('button', { name: 'Create view link', exact: true }).click();
    const address = await link.getByLabel('Guest link address', { exact: true }).inputValue();
    expect(address).toMatch(/#.+$/);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await trigger.click();
    await page.getByRole('menuitem', { name: 'Share', exact: true }).click();
    await expect(link.getByText('Replace the link to copy a new address.')).toBeVisible();
    await expect(link.getByLabel('Guest link address', { exact: true })).toHaveCount(0);
    await link.getByRole('button', { name: 'Guest link actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Replace link…', exact: true }).click();
    const replace = page.getByRole('dialog', { name: 'Replace the link?', exact: true });
    await replace.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(link.getByRole('button', { name: 'Guest link actions', exact: true })).toBeFocused();
    await expect(link.getByText('Guests can view.', { exact: true })).toBeVisible();
  } finally { db.close(); }
});
