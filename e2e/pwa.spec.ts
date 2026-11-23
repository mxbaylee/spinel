import { expect, test } from '@playwright/test';
import type { IWorkbookData, ICellData } from '@univerjs/core';
import { DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY } from '@univerjs/core';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { interruptibleNetwork } from './live-network.ts';
import { keyboardOcclusion } from './mobile-keyboard.ts';

test('configured HTTPS installs, supports sheet touch editing and opens only a generic offline page', async ({
  page,
  context,
  baseURL,
}, info) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  const network = await interruptibleNetwork(context);
  const db = openDatabase('test-results/mobile-https/app.sqlite'),
    auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth);
  const owner = auth.createUser('Phone owner'),
    item = workspace.create(owner.id, {
      name: 'Private phone budget',
      kind: 'sheet',
      parentId: null,
    });
  await context.addCookies([
    {
      name: COOKIE_NAME,
      value: auth.createSession(owner.id).token,
      url: baseURL!,
      secure: true,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const sheet = page.getByRole('region', { name: 'Sheet document', exact: true });
  const saved = () =>
    expect(sheet.getByRole('status', { name: 'Save status' })).toHaveText('All changes saved.', {
      timeout: 30_000,
    });
  const read = async () =>
    (await (await context.request.get(`/api/items/${item.id}/sheet`)).json())
      .snapshot as IWorkbookData;
  const cells = (snapshot: IWorkbookData) =>
    Object.entries(snapshot.sheets[snapshot.sheetOrder[0]].cellData ?? {}).flatMap(
      ([row, columns]) =>
        Object.entries(columns ?? {}).map(([column, cell]) => ({
          row: Number(row),
          column: Number(column),
          value: (cell as ICellData).v,
        })),
    );
  try {
    await page.goto('/');
    // Ordinary mobile HTTPS owns absence of the opt-in, identity-free boot witness.
    if (process.env.CI) expect(process.env.VITE_SYNC_EVIDENCE).toBe('0');
    if (process.env.VITE_SYNC_EVIDENCE === '0')
      expect(await page.evaluate(() => Object.hasOwn(window, '__spinelBootstrapEvidence'))).toBe(
        false,
      );
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);
    const cdp = await context.newCDPSession(page);
    const manifest = await cdp.send('Page.getAppManifest');
    expect(manifest.errors).toEqual([]);
    expect(JSON.parse(manifest.data!)).toMatchObject({
      name: 'Spinel',
      display: 'standalone',
      start_url: '/',
    });
    await expect
      .poll(async () => (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors)
      .toEqual([]);
    expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
    await page.goto(`/?item=${item.id}`);
    await saved();
    await expect(sheet).toHaveAttribute('data-mobile', 'true');
    // The mobile SDK also renders an invisible embedded text-editor canvas.
    const canvas = sheet.getByLabel('Spreadsheet grid', { exact: true });
    const selectFirstCell = async () => {
      const box = (await canvas.boundingBox())!;
      // Inspect another cell first. Two rapid canvas taps at the same location
      // intentionally mean native double-tap editing, even across toolbar clicks.
      await page.touchscreen.tap(box.x + 168, box.y + 40);
      await expect(sheet.getByRole('button', { name: 'Read B1', exact: true })).toBeVisible();
      await page.touchscreen.tap(box.x + 80, box.y + 40);
    };
    async function startEdit(value: string, entry: 'pen' | 'double-tap' = 'double-tap') {
      await canvas.scrollIntoViewIfNeeded();
      const box = (await canvas.boundingBox())!;
      // Selection alone never opens input; both pen and native double tap do.
      expect(
        await canvas.evaluate(
          (node, point) => document.elementFromPoint(point.x, point.y) === node,
          {
            x: box.x + 80,
            y: box.y + 40,
          },
        ),
      ).toBe(true);
      const scrollBefore = await page.evaluate(() => scrollY);
      await page.touchscreen.tap(box.x + 80, box.y + 40);
      expect(await page.evaluate(() => scrollY)).toBe(scrollBefore);
      if (entry === 'pen') {
        await expect(sheet.locator('[data-u-comp="mobile-formula-bar"]')).toBeHidden();
        await expect(sheet.getByRole('group', { name: 'Selected cell' })).toBeVisible();
        await expect(sheet.getByRole('button', { name: 'Read A1', exact: true })).toHaveText(
          'Empty cell',
        );
        await sheet.getByRole('button', { name: /^Edit [A-Z]+\d+$/ }).tap();
      } else await page.touchscreen.tap(box.x + 80, box.y + 40);
      const bar = sheet.locator('[data-u-comp="mobile-formula-bar"]');
      await expect(bar).toBeVisible();
      await expect(
        page.locator(`[id="__editor_${DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY}"]`),
      ).toBeFocused();
      await page.keyboard.type(value);
      const confirm = bar.getByRole('button', { name: 'OK', exact: true });
      const button = (await confirm.boundingBox())!;
      expect(button.height).toBeGreaterThanOrEqual(44);
      return confirm;
    }
    async function edit(value: string, entry?: 'pen' | 'double-tap') {
      const confirm = await startEdit(value, entry);
      await confirm.tap();
      await saved();
    }
    await edit('17', 'pen');
    await expect
      .poll(
        async () => cells(await read()).find((cell) => cell.row === 0 && cell.column === 0)?.value,
      )
      .toBe(17);
    // Native OK advances the selection. Read the authored cell after selecting it.
    await selectFirstCell();
    await expect(sheet.getByRole('button', { name: 'Read A1', exact: true })).toHaveText('17');
    await sheet.getByRole('button', { name: 'Edit A1', exact: true }).tap();
    const nativeBar = sheet.locator('[data-u-comp="mobile-formula-bar"]');
    const inputBefore = await page
      .locator(`[id="__editor_${DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY}"]`)
      .elementHandle();
    await page.keyboard.type('-discarded');
    const unchangedCanvas = await canvas.elementHandle();
    await cdp.send('Emulation.setSafeAreaInsetsOverride', {
      insets: { bottom: 34, bottomMax: 34 },
    });
    await expect
      .poll(() => nativeBar.evaluate((node) => getComputedStyle(node).paddingBottom))
      .toBe('34px');
    for (const inset of [320, 240, 320, 0]) {
      await keyboardOcclusion(page, inset);
      await expect
        .poll(async () => {
          const box = (await nativeBar.boundingBox())!;
          const bottom = await page.evaluate(
            () => visualViewport!.offsetTop + visualViewport!.height,
          );
          return Math.round(box.y + box.height - bottom);
        })
        .toBe(0);
      expect(await inputBefore!.evaluate((node) => node.isConnected)).toBe(true);
      expect(await unchangedCanvas!.evaluate((node) => node.isConnected)).toBe(true);
      const tools = await sheet
        .getByRole('button', { name: 'Open sheet tools', exact: true })
        .boundingBox();
      expect(tools!.y + tools!.height).toBeLessThanOrEqual((await nativeBar.boundingBox())!.y);
    }
    await nativeBar.getByRole('button', { name: 'Cancel', exact: true }).tap();
    await saved();
    expect(cells(await read()).find((cell) => cell.row === 0 && cell.column === 0)?.value).toBe(17);
    await expect(sheet.getByRole('button', { name: 'Read A1', exact: true })).toHaveText('17');
    await sheet.getByRole('button', { name: 'Edit A1', exact: true }).tap();
    await expect(
      page.locator(`[id="__editor_${DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY}"]`),
    ).toBeFocused();
    // This project emulates Android; ControlOrMeta follows the Mac test host.
    await page.keyboard.press('Control+A');
    await page.keyboard.type('=SUM(1,2)');
    // The nonterminal native caret must stay before ')' across both viewport
    // changes. Continued typing proves the draft and caret, not just DOM identity.
    await page.keyboard.press('ArrowLeft');
    const nativeInput = page.locator(`[id="__editor_${DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY}"]`);
    const formulaInput = await nativeInput.elementHandle();
    for (const inset of [320, 0]) {
      await keyboardOcclusion(page, inset);
      await expect
        .poll(async () => {
          const box = (await nativeBar.boundingBox())!;
          const bottom = await page.evaluate(
            () => visualViewport!.offsetTop + visualViewport!.height,
          );
          return Math.round(box.y + box.height - bottom);
        })
        .toBe(0);
      await expect(nativeInput).toBeFocused();
      expect(await formulaInput!.evaluate((node) => node.isConnected)).toBe(true);
      const operator = nativeBar.getByRole('button', { name: '=', exact: true });
      await expect(operator).toBeVisible();
      const tools = (await sheet
        .getByRole('button', { name: 'Open sheet tools', exact: true })
        .boundingBox())!;
      const operatorBounds = (await operator.boundingBox())!;
      expect(tools.y + tools.height).toBeLessThanOrEqual(operatorBounds.y);
      expect(tools.x).toBeGreaterThanOrEqual(0);
      expect(tools.x + tools.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      expect(operatorBounds.y).toBeGreaterThanOrEqual(0);
      await page.keyboard.type('0');
    }
    await nativeBar.getByRole('button', { name: 'OK', exact: true }).tap();
    await saved();
    const formulaSnapshot = await read();
    expect(formulaSnapshot.sheets[formulaSnapshot.sheetOrder[0]].cellData?.[0]?.[0]?.f).toBe(
      '=SUM(1,200)',
    );
    await selectFirstCell();
    await expect(sheet.getByRole('button', { name: 'Read A1', exact: true })).toHaveText(
      '=SUM(1,200)',
    );
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: {} });
    await sheet.getByRole('button', { name: 'Undo', exact: true }).tap();
    await saved();
    expect(cells(await read()).find((cell) => cell.row === 0 && cell.column === 0)?.value).toBe(17);
    await canvas.scrollIntoViewIfNeeded();
    let box = (await canvas.boundingBox())!;
    const x = box.x + 150,
      y = box.y + 260;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y, id: 1 }],
    });
    for (let step = 1; step <= 12; step++)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y - step * 12, id: 1 }],
      });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await edit('29');
    await expect
      .poll(async () => cells(await read()).some((cell) => cell.row > 0 && cell.value === 29))
      .toBe(true);
    await canvas.scrollIntoViewIfNeeded();
    box = (await canvas.boundingBox())!;
    const center = { x: box.x + box.width / 2, y: box.y + 220 };
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: center.x - 35, y: center.y, id: 1 },
        { x: center.x + 35, y: center.y, id: 2 },
      ],
    });
    for (let step = 1; step <= 8; step++)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: center.x - 35 - step * 4, y: center.y, id: 1 },
          { x: center.x + 35 + step * 4, y: center.y, id: 2 },
        ],
      });
    const zoom = sheet.getByText(/^\d+%$/).last();
    await expect(zoom).toBeVisible();
    expect(Number((await zoom.textContent())!.replace('%', ''))).toBeGreaterThan(100);
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.screenshot({
      path: `test-results/theme-screenshots/mobile-sheet-light-${info.project.name}.png`,
      fullPage: true,
    });
    const activeCanvas = await canvas.elementHandle();
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await activeCanvas!.evaluate((node) => node.isConnected)).toBe(true);
    await page.screenshot({
      path: `test-results/theme-screenshots/mobile-sheet-dark-${info.project.name}.png`,
      fullPage: true,
    });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.reload();
    await saved();
    expect(
      cells(await read()).filter((cell) => [17, 29].includes(Number(cell.value))),
    ).toHaveLength(2);
    // Start the native cell edit while online, before disconnecting.
    const confirm = await startEdit('offline-phone');
    const status = sheet.getByRole('status', { name: 'Save status' });
    await expect(status).toHaveText('Editing cell — changes not saved yet.');
    // An already-open editor must retain that edit after both HTTP and its
    // established live socket disconnect, without allowing silent navigation.
    await network.setOffline(true);
    await expect(status).toContainText('not saved');
    await confirm.tap();
    await expect(status).toContainText('not saved');
    const navigationWarning = page.waitForEvent('dialog');
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: 'Back to files', exact: true }).tap();
    await navigationWarning;
    await expect(page).toHaveURL(new RegExp(item.id));
    await expect(status).toContainText('not saved');
    await network.setOffline(false);
    await saved();
    const retainedInput = async () =>
      cells(await read()).some((cell) => String(cell.value).endsWith('offline-phone'));
    await expect.poll(retainedInput).toBe(true);
    await page.reload();
    await saved();
    expect(await retainedInput()).toBe(true);
    // Nothing is cached until a download prepares this device (offline.spec.ts).
    expect(await page.evaluate(() => caches.keys())).toEqual([]);
    expect(errors).toEqual([]);
    await network.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
    await expect(page.getByText('Private phone budget')).toHaveCount(0);
    // The offline page permits images, not fetch/connect requests. Exercise
    // the browser's actual image-loading path under its restrictive CSP.
    expect(
      await page.evaluate(async () => {
        const icon = new Image();
        icon.src = '/favicon.svg';
        await icon.decode();
        return icon.naturalWidth > 0;
      }),
    ).toBe(true);
    const guestPath = `/share/${item.id}#private-link-token`;
    await page.goto(guestPath);
    await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
    expect(await page.content()).not.toContain('private-link-token');
    expect(await page.evaluate(() => caches.keys())).toEqual([]);
    await page.goto('/');
    await context.clearCookies();
    await network.setOffline(false);
    await page.getByRole('button', { name: 'Try again', exact: true }).tap();
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByText('Private phone budget')).toHaveCount(0);
  } finally {
    await keyboardOcclusion(page, 0).catch(() => undefined);
    await network.setOffline(false);
    db.close();
  }
});
