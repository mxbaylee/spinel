import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import type { IWorkbookData } from '@univerjs/core';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';

test('native fill picker persists colors in both themes and remains disabled for a viewer', async ({
  page,
  context,
  baseURL,
}, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db);
  const store = new WorkspaceStore(auth);
  const owner = auth.createUser('Fill owner');
  const viewer = auth.createUser('Fill viewer');
  const item = store.create(owner.id, { name: 'Native colors', kind: 'sheet', parentId: null });
  store.share(owner.id, item.id, viewer.id, 'viewer');
  const signIn = async (id: string) => {
    await context.clearCookies();
    await context.addCookies([
      {
        name: COOKIE_NAME,
        value: auth.createSession(id).token,
        url: baseURL!.replace('http:', 'https:'),
        secure: true,
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
  };
  const region = page.getByRole('region', { name: 'Sheet document', exact: true });
  const fill = region.locator('[data-u-command="sheet.command.set-background-color"]').first();
  const saved = () =>
    expect(page.getByRole('status', { name: 'Save status' })).toHaveText('All changes saved.', {
      timeout: 20000,
    });
  const read = async () =>
    (await (await context.request.get(`/api/items/${item.id}/sheet`)).json()) as {
      snapshot: IWorkbookData;
      revision: number;
    };
  const storedColor = async (column: number) => {
    const { snapshot } = await read();
    const style = snapshot.sheets[snapshot.sheetOrder[0]].cellData?.[0]?.[column]?.s;
    return (typeof style === 'string' ? snapshot.styles[style] : style)?.bg?.rgb?.toUpperCase();
  };
  try {
    await signIn(owner.id);
    await page.goto(`/?item=${item.id}`);
    await saved();
    await expect(page.getByText('Cell fill presets', { exact: true })).toHaveCount(0);
    for (const [theme, address, column, color, rgb] of [
      ['light', 'A1', 0, '#F05252', 'rgb(240, 82, 82)'],
      ['dark', 'B1', 1, '#0DA471', 'rgb(13, 164, 113)'],
    ] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const nameBox = region.getByRole('textbox').nth(2);
      await nameBox.fill(address);
      await nameBox.press('Enter');
      await expect(fill).toHaveAttribute('aria-disabled', 'false');
      await fill.locator('.univer-toolbar-button-selector-trigger').click();
      // Native SDK swatches have no accessible names; their visible CSS color identifies them.
      await page.locator(`[data-u-comp="color-picker-presets"] button[style*="${rgb}"]`).click();
      await page.keyboard.press('Escape');
      await expect.poll(() => storedColor(column)).toBe(color);
      await saved();
      await page.reload();
      await saved();
      expect(await storedColor(column)).toBe(color);
      await mkdir('test-results/theme-screenshots', { recursive: true });
      await page.screenshot({
        path: `test-results/theme-screenshots/native-fills-${theme}-${info.project.name}.png`,
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 390, height: 900 });
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.screenshot({
      path: `test-results/theme-screenshots/native-fills-phone-${info.project.name}.png`,
      fullPage: true,
    });
    await page.goto('/');
    await signIn(viewer.id);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/?item=${item.id}`);
    await expect(region.locator('canvas').first()).toBeVisible();
    await expect(fill).toHaveAttribute('aria-disabled', 'true');
    expect(await storedColor(0)).toBe('#F05252');
    expect(await storedColor(1)).toBe('#0DA471');
    const canvas = page.locator(`#univer-sheet-main-canvas_${item.id}`);
    for (const rgb of [
      [240, 82, 82],
      [13, 164, 113],
    ]) {
      await expect
        .poll(() =>
          canvas.evaluate((element, color) => {
            const surface = element as HTMLCanvasElement;
            const pixels = surface
              .getContext('2d')!
              .getImageData(0, 0, surface.width, surface.height).data;
            let count = 0;
            for (let offset = 0; offset < pixels.length; offset += 4)
              if (
                pixels[offset] === color[0] &&
                pixels[offset + 1] === color[1] &&
                pixels[offset + 2] === color[2] &&
                pixels[offset + 3] === 255
              )
                count++;
            return count;
          }, rgb),
        )
        .toBeGreaterThan(100);
    }
    await expect(page.getByText('Cell fill presets', { exact: true })).toHaveCount(0);
  } finally {
    await page.goto('/sign-in');
    db.prepare('DELETE FROM workspace_items WHERE owner_id=?').run(owner.id);
    db.prepare('DELETE FROM auth_users WHERE id IN (?,?)').run(owner.id, viewer.id);
    db.close();
  }
});
