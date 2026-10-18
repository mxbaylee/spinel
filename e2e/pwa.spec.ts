import { expect, test } from '@playwright/test';
import type { IWorkbookData, ICellData } from '@univerjs/core';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';

test('configured HTTPS installs, supports sheet touch editing and opens only a generic offline page', async ({
  page,
  context,
  baseURL,
}, info) => {
  test.setTimeout(150_000);
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
    const canvas = sheet.locator('.univer-container canvas').first();
    async function edit(value: string) {
      await canvas.scrollIntoViewIfNeeded();
      const box = (await canvas.boundingBox())!;
      // Touch the first visible data cell twice to open the SDK's mobile editor.
      await page.touchscreen.tap(box.x + 80, box.y + 40);
      await page.touchscreen.tap(box.x + 80, box.y + 40);
      const bar = sheet.locator('[data-u-comp="mobile-formula-bar"]');
      await expect(bar).toBeVisible();
      await page.keyboard.type(value);
      const confirm = bar.getByRole('button', { name: 'OK', exact: true });
      const button = (await confirm.boundingBox())!;
      expect(button.height).toBeGreaterThanOrEqual(44);
      await confirm.tap();
      await saved();
    }
    await edit('17');
    await expect
      .poll(
        async () => cells(await read()).find((cell) => cell.row === 0 && cell.column === 0)?.value,
      )
      .toBe(17);
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
      path: `test-results/theme-screenshots/mobile-sheet-${info.project.name}.png`,
      fullPage: true,
    });
    await page.reload();
    await saved();
    expect(
      cells(await read()).filter((cell) => [17, 29].includes(Number(cell.value))),
    ).toHaveLength(2);
    expect(await page.evaluate(() => caches.keys())).toEqual([]);
    expect(errors).toEqual([]);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
    await expect(page.getByText('Private phone budget')).toHaveCount(0);
    const guestPath = `/share/${item.id}#private-link-token`;
    await page.goto(guestPath);
    await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
    expect(await page.content()).not.toContain('private-link-token');
    expect(await page.evaluate(() => caches.keys())).toEqual([]);
    await page.goto('/');
    await context.clearCookies();
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Try again', exact: true }).tap();
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByText('Private phone budget')).toHaveCount(0);
  } finally {
    await context.setOffline(false);
    db.close();
  }
});
