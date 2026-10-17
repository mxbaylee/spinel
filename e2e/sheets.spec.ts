import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { IWorkbookData } from '@univerjs/core';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';

test('spreadsheet UI saves values, formulas, formatting and tabs; recovers offline and rejects stale writers', async ({
  page,
  context,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1100 });
  const db = openDatabase(
    testInfo.project.name === 'development'
      ? 'test-results/dev.sqlite'
      : 'test-results/production.sqlite',
  );
  const auth = new AuthStore(db);
  const user = auth.createUser('Sheets ' + testInfo.testId);
  const item = new WorkspaceStore(auth).create(user.id, {
    name: 'Budget',
    kind: 'sheet',
    parentId: null,
  });
  const session = auth.createSession(user.id);
  const cookie = {
    name: COOKIE_NAME,
    value: session.token,
    url: baseURL!.replace('http:', 'https:'),
    secure: true,
    httpOnly: true,
    sameSite: 'Strict' as const,
  };
  await context.addCookies([cookie]);
  const second = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await second.addCookies([cookie]);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const sheet = page.getByRole('region', { name: 'Sheet document', exact: true });
  const saved = () =>
    expect(sheet.getByRole('status')).toHaveText('All changes saved.', { timeout: 20000 });
  const read = async () =>
    (await (await context.request.get(`/api/items/${item.id}/sheet`)).json()) as {
      snapshot: IWorkbookData;
      revision: number;
    };
  const cell = (snapshot: IWorkbookData, column: number, row = 0) =>
    snapshot.sheets[snapshot.sheetOrder[0]].cellData?.[row]?.[column];
  async function select(target: Page, address: string) {
    // The visible name box follows the font and font-size textboxes in Univer1.1.
    const nameBox = target
      .getByRole('region', { name: 'Sheet document', exact: true })
      .getByRole('textbox')
      .nth(2);
    await nameBox.fill(address);
    await nameBox.press('Enter');
  }
  async function type(target: Page, address: string, value: string) {
    await select(target, address);
    await target.keyboard.type(value);
    await target.keyboard.press('Enter');
  }
  try {
    await page.goto(`/?item=${item.id}`);
    await saved();
    await type(page, 'A1', '12');
    await saved();
    await type(page, 'B1', '=A1*2');
    await saved();
    await expect.poll(async () => cell((await read()).snapshot, 1)?.v).toBe(24);
    await select(page, 'A1');
    await sheet.getByRole('button', { name: 'Bold', exact: true }).click();
    await saved();
    await sheet.locator('[data-u-comp="sheet-bar-append-button"]').first().click();
    await expect(sheet.getByRole('tablist', { name: 'Sheet tabs' }).getByRole('tab')).toHaveCount(
      2,
    );
    await saved();
    const before = (await read()).snapshot;
    const style = cell(before, 0)?.s;
    expect(typeof style === 'string' ? before.styles[style]?.bl : style?.bl).toBe(1);
    await page.reload();
    await saved();
    await expect(sheet.getByRole('tablist', { name: 'Sheet tabs' }).getByRole('tab')).toHaveCount(
      2,
    );
    await sheet.getByRole('tab', { name: 'Sheet1', exact: true }).click();
    await select(page, 'A1');
    await expect(sheet.getByRole('button', { name: 'Bold', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const after = (await read()).snapshot;
    expect(after.sheetOrder).toEqual(before.sheetOrder);
    expect(after.sheets).toEqual(before.sheets);
    expect(after.styles).toEqual(before.styles);
    const other = await second.newPage();
    await other.goto(`${baseURL}/?item=${item.id}`);
    await expect(other.getByRole('status')).toHaveText('All changes saved.', { timeout: 20000 });
    await other.getByRole('tab', { name: 'Sheet1', exact: true }).click();
    await select(other, 'A1');
    await expect(other.getByRole('button', { name: 'Bold', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await context.setOffline(true);
    await select(page, 'A1');
    await page.keyboard.type('21');
    await expect(sheet.getByRole('status')).toContainText('not saved');
    await page.keyboard.press('Enter');
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(item.id));
    await expect(sheet.getByRole('status')).toContainText('not saved');
    await context.setOffline(false);
    await saved();
    await expect.poll(async () => cell((await read()).snapshot, 1)?.v).toBe(42);
    // Lose an acknowledgement after the server has committed, then retry exactly.
    let dropped = false;
    await page.route(`**/api/items/${item.id}/sheet`, async (route) => {
      if (route.request().method() === 'PUT' && !dropped) {
        dropped = true;
        await route.fetch();
        await route.abort('failed');
      } else await route.continue();
    });
    await type(page, 'A2', 'retry safely');
    await expect.poll(() => dropped).toBe(true);
    await saved();
    await page.unroute(`**/api/items/${item.id}/sheet`);
    expect(cell((await read()).snapshot, 0, 1)?.v).toBe('retry safely');
    // The other browser loaded an old revision. Its real UI edit must not replace newer data.
    await type(other, 'C1', 'stale edit');
    await expect(other.getByRole('status')).toContainText('newer version', { timeout: 10000 });
    expect(cell((await read()).snapshot, 2)).toBeUndefined();
    expect(cell((await read()).snapshot, 0)?.v).toBe(21);
    expect(errors).toEqual([]);
  } finally {
    await context.setOffline(false);
    await second.close();
    db.prepare('DELETE FROM workspace_items WHERE owner_id=?').run(user.id);
    db.prepare('DELETE FROM auth_users WHERE id=?').run(user.id);
    db.close();
  }
});
