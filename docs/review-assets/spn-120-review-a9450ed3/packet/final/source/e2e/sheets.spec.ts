import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { interruptibleNetwork } from './live-network.ts';
import { expectNativeSheetValue } from './native-sheet-value.ts';
import type { IWorkbookData, ICellData } from '@univerjs/core';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';

test('spreadsheet UI saves values, formulas, formatting and tabs; recovers offline and merges simultaneous writers', async ({
  page,
  context,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(90_000);
  const network = await interruptibleNetwork(context);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1440, height: 1100 });
  const db = openDatabase(
    testInfo.project.name === 'development'
      ? 'test-results/development/app.sqlite'
      : 'test-results/production/app.sqlite',
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
  const second = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await second.addCookies([cookie]);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const sheet = page.getByRole('region', { name: 'Sheet document', exact: true });
  const saved = () =>
    expect(sheet.getByRole('status', { name: 'Save status' })).toHaveText('All changes saved.', {
      timeout: 20000,
    });
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
    expect(cell((await read()).snapshot, 1)?.f).toBe('=A1*2');
    await expectNativeSheetValue(page, 'B1', '24');
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
    // Materialization allocates style IDs; compare every resolved style and cell,
    // not those incidental IDs, to prove formatting survives reconstruction.
    const resolvedSheets = (snapshot: IWorkbookData) => {
      const sheets = structuredClone(snapshot.sheets);
      for (const tab of Object.values(sheets))
        for (const row of Object.values(tab.cellData ?? {}))
          for (const value of Object.values(row ?? {}) as (ICellData | null)[])
            if (value && typeof value.s === 'string') value.s = snapshot.styles[value.s];
      return sheets;
    };
    expect(resolvedSheets(after)).toEqual(resolvedSheets(before));
    await expectNativeSheetValue(page, 'B1', '24');
    const other = await second.newPage();
    await other.goto(`${baseURL}/?item=${item.id}`);
    await expect(other.getByRole('status', { name: 'Save status' })).toHaveText(
      'All changes saved.',
      { timeout: 20000 },
    );
    await other.getByRole('tab', { name: 'Sheet1', exact: true }).click();
    await select(other, 'A1');
    await expect(other.getByRole('button', { name: 'Bold', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await network.setOffline(true);
    await select(page, 'A1');
    await page.keyboard.type('21');
    await expect(sheet.getByRole('status', { name: 'Save status' })).toContainText('not saved');
    await page.keyboard.press('Enter');
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: 'Back to files', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(item.id));
    await expect(sheet.getByRole('status', { name: 'Save status' })).toContainText('not saved');
    await network.setOffline(false);
    await saved();
    expect(cell((await read()).snapshot, 1)?.f).toBe('=A1*2');
    await expectNativeSheetValue(page, 'B1', '42');
    await expectNativeSheetValue(other, 'B1', '42');
    // Lose both acknowledgement paths after a real commit. A repeated cell value
    // alone could hide a duplicate, so also require exactly one durable revision.
    const priorRevision = (await read()).revision;
    network.loseAcknowledgement();
    await type(page, 'A2', 'retry safely');
    await expect.poll(() => network.acknowledgementLost()).toBe(true);
    await expect(sheet.getByRole('status', { name: 'Save status' })).toContainText('not saved');
    expect((await read()).revision).toBe(priorRevision + 1);
    await network.setOffline(false);
    await saved();
    const recoveredCommit = await read();
    expect(cell(recoveredCommit.snapshot, 0, 1)?.v).toBe('retry safely');
    expect(recoveredCommit.revision).toBe(priorRevision + 1);
    await page.reload();
    await saved();
    expect((await read()).revision).toBe(priorRevision + 1);
    await expectNativeSheetValue(page, 'B1', '42');
    // A second editor merges its UI edit instead of replacing the newer snapshot.
    await type(other, 'C1', 'concurrent edit');
    await expect(other.getByRole('status', { name: 'Save status' })).toHaveText(
      'All changes saved.',
    );
    expect(cell((await read()).snapshot, 2)?.v).toBe('concurrent edit');
    expect(cell((await read()).snapshot, 0)?.v).toBe(21);
    expect(errors).toEqual([]);
    expect(network.incoming.filter((frame) => frame.type === 'resync')).toEqual([]);
  } catch (error) {
    await writeFile(
      testInfo.outputPath('sync-diagnostics.json'),
      JSON.stringify({ errors, outgoing: network.outgoing, incoming: network.incoming }),
    );
    throw error;
  } finally {
    await network.setOffline(false);
    await second.close();
    db.prepare('DELETE FROM workspace_items WHERE owner_id=?').run(user.id);
    db.prepare('DELETE FROM auth_users WHERE id=?').run(user.id);
    db.close();
  }
});
