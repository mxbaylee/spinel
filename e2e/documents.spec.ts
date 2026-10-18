import sharp from 'sharp';
import { expect, test } from '@playwright/test';
import { interruptibleNetwork } from './live-network.ts';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';

test('document UI preserves rich text and embedded images through reload and offline recovery', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  test.setTimeout(90_000);
  const network = await interruptibleNetwork(context);
  page.setDefaultTimeout(10000);
  await page.setViewportSize({ width: 1440, height: 1100 });
  const db = openDatabase(
    testInfo.project.name === 'development'
      ? 'test-results/development/app.sqlite'
      : 'test-results/production/app.sqlite',
  );
  const auth = new AuthStore(db);
  const user = auth.createUser('Docs ' + testInfo.testId);
  const item = new WorkspaceStore(auth).create(user.id, {
    name: 'Journal',
    kind: 'doc',
    parentId: null,
  });
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
  const errors: string[] = [];
  let releaseImage = () => {};
  page.on('pageerror', (error) => errors.push(error.message));
  const read = async () =>
    (await (await context.request.get(`/api/items/${item.id}/doc`)).json()).snapshot;
  try {
    await page.goto(`/?item=${item.id}`);
    const editor = page.getByRole('region', { name: 'Doc document', exact: true });
    await expect(editor.getByRole('status', { name: 'Save status' })).toHaveText(
      'All changes saved.',
      { timeout: 20000 },
    );
    await expect(editor.getByRole('button', { name: 'Bold', exact: true })).toBeEnabled();
    await editor.locator('.univer-container').click({ position: { x: 130, y: 200 } });
    await page.keyboard.type('/');
    await expect(page.getByText('Insert Image', { exact: true })).toBeVisible();
    await expect(page.getByText('Insert Shape', { exact: true })).not.toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('My journal');
    await expect
      .poll(
        async () =>
          (await (await context.request.get(`/api/items/${item.id}/doc`)).json()).snapshot.body
            .dataStream,
      )
      .toContain('My journal');
    await editor
      .getByRole('toolbar', { name: 'Start' })
      .getByText('Normal', { exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Heading 1', exact: true }).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('First item');
    await page.keyboard.press('Control+Shift+8');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second item');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Reference link');
    // Finish the text edit before selecting a different toolbar. A pending editor
    // update can otherwise restore Start after the test has already clicked Insert.
    await expect.poll(async () => (await read()).body.dataStream).toContain('Reference link');
    await expect(editor.getByRole('status', { name: 'Save status' })).toHaveText(
      'All changes saved.',
    );
    await page.keyboard.press('Shift+Home');
    const insertTab = editor.getByRole('tab', { name: 'Insert', exact: true });
    await insertTab.click();
    await expect(insertTab).toHaveAttribute('aria-selected', 'true');
    await editor.getByRole('button', { name: 'Add link', exact: true }).click();
    const linkInput = page.getByRole('textbox', { name: '', exact: true });
    await linkInput.fill('https://example.com/journal');
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).not.toBeVisible();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(editor.getByRole('button', { name: 'Image', exact: true })).toBeEnabled();
    let imageRequested = false;
    const delayedImage = new Promise<void>((resolve) => {
      releaseImage = resolve;
    });
    await page.route(`**/api/items/${item.id}/images/*`, async (route) => {
      imageRequested = true;
      await delayedImage;
      await route.continue();
    });
    const chooser = page.waitForEvent('filechooser', { timeout: 10000 });
    await editor.getByRole('button', { name: 'Image', exact: true }).click();
    await (
      await chooser
    ).setFiles({
      name: 'orange.png',
      mimeType: 'image/png',
      buffer: await sharp({ create: { width: 20, height: 10, channels: 4, background: '#ff9900' } })
        .png()
        .toBuffer(),
    });
    await expect.poll(() => imageRequested).toBe(true);
    await expect(editor.getByRole('status', { name: 'Save status' })).toContainText(
      'Inserting image',
    );
    const navigationWarning = page.waitForEvent('dialog');
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await navigationWarning;
    await expect(page).toHaveURL(new RegExp(item.id));
    releaseImage();
    await expect
      .poll(
        async () =>
          (await (await context.request.get(`/api/items/${item.id}/doc`)).json()).snapshot
            .drawingsOrder.length,
      )
      .toBe(1);
    await page.unroute(`**/api/items/${item.id}/images/*`);

    const surface = editor.locator('.univer-container');
    // The document is canvas-rendered; click the visible heading to restore text focus.
    await surface.click({ position: { x: 130, y: 200 } });
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await editor.getByRole('button', { name: 'Table', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Insert Table', exact: true }).click();
    const tableDialog = page.getByRole('dialog', { name: 'Insert Table' });
    await tableDialog.getByRole('textbox').nth(0).fill('2');
    await tableDialog.getByRole('textbox').nth(1).fill('2');
    await tableDialog.getByRole('button', { name: 'ok', exact: true }).click();
    await expect(tableDialog).not.toBeVisible();
    await surface.click({ position: { x: 115, y: 350 } });
    await page.keyboard.type('Table cell');
    await expect(editor.getByRole('status', { name: 'Save status' })).toHaveText(
      'All changes saved.',
    );
    await page.keyboard.press('Control+End');
    await page.keyboard.press('ArrowDown');

    await expect.poll(async () => (await read()).body.dataStream).toContain('Table cell');
    const before = await read();
    expect(before.body.paragraphs[0].paragraphStyle.namedStyleType).toBe(4);
    expect(
      before.body.paragraphs.filter((paragraph: { bullet?: unknown }) => paragraph.bullet),
    ).toHaveLength(2);
    expect(before.body.customRanges[0].properties.url).toBe('https://example.com/journal');
    expect(before.body.tables).toHaveLength(1);
    expect(Object.keys(before.tableSource)).toHaveLength(1);
    expect(before.drawingsOrder).toHaveLength(1);
    const imageUrl = before.drawings[before.drawingsOrder[0]].source;
    const imageResponse = await context.request.get(imageUrl);
    expect(imageResponse.ok()).toBe(true);
    expect((await sharp(await imageResponse.body()).metadata()).width).toBe(20);
    await page.reload();
    await expect(editor.getByRole('status', { name: 'Save status' })).toHaveText(
      'All changes saved.',
      { timeout: 20000 },
    );
    await expect(editor.getByRole('button', { name: 'Bold', exact: true })).toBeVisible();
    await editor.getByRole('tab', { name: 'Insert', exact: true }).click();
    const after = await read();
    for (const key of ['body', 'tableSource', 'drawings', 'drawingsOrder', 'resources'])
      expect(after[key]).toEqual(before[key]);
    await page.screenshot({ path: testInfo.outputPath('document-reloaded.png') });
    await surface.click({ position: { x: 130, y: 200 } });
    await page.keyboard.press('Home');
    await network.setOffline(true);
    await page.keyboard.type('Offline ');
    await expect(editor.getByRole('status', { name: 'Save status' })).toContainText('not saved');
    // Search must preserve the mounted editor and its unsaved offline edits.
    await page.getByRole('searchbox', { name: 'Search files', exact: true }).fill('Journal');
    await expect(editor).toBeHidden();
    await page.getByRole('button', { name: 'Clear search and filters', exact: true }).click();
    await expect(editor).toBeVisible();
    await expect(editor.getByRole('status', { name: 'Save status' })).toContainText('not saved');
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(item.id));
    await network.setOffline(false);
    await expect(editor.getByRole('status', { name: 'Save status' })).toHaveText(
      'All changes saved.',
      { timeout: 20000 },
    );
    await expect.poll(async () => (await read()).body.dataStream).toContain('Offline ');
    await page.reload();
    await expect(editor.getByRole('status', { name: 'Save status' })).toHaveText(
      'All changes saved.',
      { timeout: 20000 },
    );
    expect((await read()).body.dataStream).toContain('Offline ');
    expect(errors).toEqual([]);
  } finally {
    releaseImage();
    await network.setOffline(false);
    db.prepare('DELETE FROM workspace_items WHERE owner_id=?').run(user.id);
    db.prepare('DELETE FROM auth_users WHERE id=?').run(user.id);
    db.close();
  }
});
