import sharp from 'sharp';
import { expect, test } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import { CustomRangeType, getDocsEmptySnapshot, validateDocumentStructure } from '@univerjs/core';
import type { IDocumentBody, IDocumentData } from '@univerjs/core';
import { interruptibleNetwork } from './live-network.ts';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { DocumentStore } from '../src/server/workspace/documents.ts';
import {
  permissionNotices,
  protectionMessage,
  recordPermissionNotices,
} from './permission-notices.ts';
import { textPoint } from './doc-touch.ts';

function storedDateField(id: string): IDocumentBody {
  const cached = '2000-01-01';
  const dataStream = `\x1f${cached}\x1e\r\n`;
  return {
    dataStream,
    paragraphs: [{ startIndex: dataStream.length - 2, paragraphId: `${id}-paragraph` }],
    customRanges: [
      {
        rangeId: id,
        rangeType: CustomRangeType.FIELD,
        startIndex: 0,
        endIndex: cached.length + 1,
        wholeEntity: false,
        properties: {
          fieldType: 'DATE',
          instruction: 'DATE \\@ "yyyy-MM-dd"',
          cachedResult: cached,
        },
      },
    ],
  };
}

for (const phone of [false, true])
  for (const role of ['account', 'guest'] as const)
    test(`${phone ? 'phone' : 'desktop'} ${role} Doc viewer opens plain and dated documents without a protection warning`, async ({
      browser,
      baseURL,
    }, info) => {
      test.setTimeout(150_000);
      const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
      const auth = new AuthStore(db),
        workspace = new WorkspaceStore(auth);
      const owner = auth.createUser(`Startup owner ${info.testId}`);
      const viewer = auth.createUser(`Startup viewer ${info.testId}`);
      const contexts: BrowserContext[] = [];
      const failures: string[] = [];
      const cookie = (userId: string) => ({
        name: COOKIE_NAME,
        value: auth.createSession(userId).token,
        url: baseURL!.replace('http:', 'https:'),
        secure: true,
        httpOnly: true,
        sameSite: 'Strict' as const,
      });
      try {
        const ownerContext = await browser.newContext({
          baseURL,
          viewport: { width: 1280, height: 960 },
        });
        contexts.push(ownerContext);
        await ownerContext.addCookies([cookie(owner.id)]);
        for (const fields of [true, false]) {
          const item = workspace.create(owner.id, {
            name: fields ? 'Saved date fields' : 'Plain reading',
            kind: 'doc',
            parentId: null,
          });
          const snapshot = getDocsEmptySnapshot(item.id);
          snapshot.body = {
            dataStream: 'Phone journal\r\n',
            paragraphs: [{ startIndex: 13, paragraphId: 'body-paragraph' }],
            sectionBreaks: [{ startIndex: 14, sectionId: 'body-section' }],
          };
          if (fields) {
            snapshot.headers = { top: { headerId: 'top', body: storedDateField('header-date') } };
            snapshot.footers = {
              bottom: { footerId: 'bottom', body: storedDateField('footer-date') },
            };
            snapshot.documentStyle.defaultHeaderId = 'top';
            snapshot.documentStyle.defaultFooterId = 'bottom';
          }
          expect(validateDocumentStructure(snapshot)).toEqual([]);
          new DocumentStore(workspace).save(owner.id, item.id, {
            snapshot,
            revision: 0,
            writeId: crypto.randomUUID(),
          });
          workspace.share(owner.id, item.id, viewer.id, 'viewer');
          const context = await browser.newContext({
            baseURL,
            viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 960 },
            isMobile: phone,
            hasTouch: phone,
            deviceScaleFactor: 1,
            colorScheme: 'light',
            reducedMotion: 'reduce',
          });
          contexts.push(context);
          await recordPermissionNotices(context);
          let path = `/?item=${item.id}`;
          if (role === 'account') await context.addCookies([cookie(viewer.id)]);
          else {
            const link = workspace.links.begin(item.id, 'viewer');
            workspace.links.finish(item.id, link.epoch, true);
            path = `/share/${item.id}#${link.token}`;
          }
          const read = async () => {
            const response = await ownerContext.request.get(`/api/items/${item.id}/doc`);
            expect(response.ok()).toBe(true);
            return (await response.json()).snapshot as IDocumentData;
          };
          const original = await read();
          const page = await context.newPage();
          page.on('pageerror', (error) => failures.push(error.message));
          const status = page.getByRole('status', { name: 'Save status' });
          await page.goto(path);
          for (const reload of [false, true]) {
            if (reload) await page.reload();
            await expect(status).toContainText('View only', { timeout: 30_000 });
            await expect(page.getByLabel('Document canvas', { exact: true })).toBeVisible();
            expect(await permissionNotices(page)).toEqual([]);
            await expect(page.getByText(protectionMessage, { exact: true })).toHaveCount(0);
            expect(await read()).toEqual(original);
          }
          if (fields && ((role === 'account' && !phone) || (role === 'guest' && phone))) {
            for (const theme of ['light', 'dark'] as const) {
              await page.emulateMedia({ colorScheme: theme });
              await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
              await page.screenshot({
                path: info.outputPath(
                  `spn-106-${role}-${phone ? '390px' : 'desktop'}-${theme}.png`,
                ),
                fullPage: true,
              });
            }
          }
          // This journey owns startup/persistence and the actual HTTP fence.
          // Native mutation refusal and its visible warning are exercised by
          // the ViewerDeniedEdit story through the mounted public Doc API.
          if (role === 'account') {
            const denied = await context.request.put(`/api/items/${item.id}/doc`, {
              headers: { Origin: baseURL! },
              data: { snapshot: original, revision: 1, writeId: crypto.randomUUID() },
            });
            expect(denied.status()).toBe(403);
          } else expect((await context.request.get('/api/items')).status()).toBe(401);
          expect(await read()).toEqual(original);

          if (!fields) {
            // Keep an authorized native editor alongside the reader; its real
            // edit must persist while the viewer grant remains unchanged.
            const editor = await ownerContext.newPage();
            editor.on('pageerror', (error) => failures.push(error.message));
            await editor.goto(`/?item=${item.id}`);
            await expect(editor.getByRole('status', { name: 'Save status' })).toHaveText(
              'All changes saved.',
              { timeout: 30_000 },
            );
            const point = await textPoint(editor);
            await editor.mouse.click(point.x, point.y);
            await editor.keyboard.type('Authorized ');
            await expect.poll(async () => (await read()).body?.dataStream).toContain('Authorized ');
            await expect(status).toContainText('View only');
            if (role === 'guest') {
              const revoke = await ownerContext.request.put(`/api/items/${item.id}/link`, {
                headers: { Origin: baseURL! },
                data: { role: null },
              });
              expect(revoke.ok()).toBe(true);
              await expect(
                page.getByText('This link no longer works.', { exact: true }),
              ).toBeVisible({ timeout: 30_000 });
              await expect(page.getByLabel('Document canvas', { exact: true })).toHaveCount(0);
            }
            await editor.close();
          }
          await page.close();
          await context.close();
        }
        expect(failures).toEqual([]);
      } finally {
        for (const context of contexts) await context.close();
        db.prepare('DELETE FROM workspace_items WHERE owner_id=?').run(owner.id);
        for (const user of [owner, viewer])
          db.prepare('DELETE FROM auth_users WHERE id=?').run(user.id);
        db.close();
      }
    });

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
    await page.getByRole('button', { name: 'Back to files', exact: true }).click();
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
    // Theatre resizes the existing editor; unsaved work must survive both toggles.
    const mountedCanvas = await surface.elementHandle();
    await expect(page.getByRole('searchbox', { name: 'Search files' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Enter theatre mode', exact: true }).click();
    await expect(editor).toBeVisible();
    expect(await mountedCanvas!.evaluate((node) => node.isConnected)).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath('unsaved-editor-theatre.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Exit theatre mode', exact: true }).click();
    await expect(editor.getByRole('status', { name: 'Save status' })).toContainText('not saved');
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: 'Back to files', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(item.id));
    expect(await mountedCanvas!.evaluate((node) => node.isConnected)).toBe(true);
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
