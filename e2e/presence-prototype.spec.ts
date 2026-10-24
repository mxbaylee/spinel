import { SheetStore } from '../src/server/workspace/sheets.ts';
import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { Profiles } from '../src/server/auth/profile.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { palettes } from '../src/ui/palette.ts';

test('saved profile: picker, rail and two Sheet peers share icons and colours', async ({
  page,
  context,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth),
    profiles = new Profiles(auth);
  const owner = auth.createUser('Moss'),
    editor = auth.createUser('Iris');
  profiles.save(owner.id, { name: 'Moss', icon: 'lucide:cat', color: 'success-strong' });
  const item = workspace.create(owner.id, {
    name: 'Profile presence',
    kind: 'sheet',
    parentId: null,
  });
  new SheetStore(workspace).save(owner.id, item.id, {
    revision: 0,
    writeId: crypto.randomUUID(),
    snapshot: {
      id: item.id,
      name: 'Profile presence',
      appVersion: '1.1.0',
      locale: 'enUS',
      styles: {},
      sheetOrder: ['first', 'second'],
      sheets: Object.fromEntries(
        ['first', 'second'].map((id, index) => [
          id,
          { id, name: `Sheet${index + 1}`, rowCount: 200, columnCount: 30, cellData: {} },
        ]),
      ),
    },
  });
  workspace.share(owner.id, item.id, editor.id, 'editor');
  const second = await browser.newContext({ viewport: { width: 1440, height: 1100 } }),
    other = await second.newPage();
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
  for (const target of [page, other]) target.on('pageerror', (error) => errors.push(error.message));
  const saved = (target: typeof page) =>
    expect(target.getByRole('status', { name: 'Save status' })).toHaveText('All changes saved.', {
      timeout: 30_000,
    });
  const address = (target: typeof page) =>
    target.getByRole('region', { name: 'Sheet document', exact: true }).getByRole('textbox').nth(2);
  const select = async (target: typeof page, value: string) => {
    await address(target).fill(value);
    await address(target).press('Enter');
  };
  const theme = async (target: typeof page, value: string) => {
    await target.evaluate((value) => {
      localStorage.setItem('spinel-theme', value);
      window.dispatchEvent(new StorageEvent('storage', { key: 'spinel-theme', newValue: value }));
    }, value);
  };
  const captureProfile = async (name: string) => {
    // Even an invisible account tooltip must not widen the profile page.
    await expect
      .poll(() => other.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await other.screenshot({
      path: `test-results/theme-screenshots/${name}-${info.project.name}.png`,
      fullPage: true,
    });
  };
  try {
    await other.goto(`${baseURL}/settings`);
    await other.getByLabel('Display name', { exact: true }).fill('Iris Garden');
    await mkdir('test-results/theme-screenshots', { recursive: true });
    await other.getByRole('button', { name: 'Choose icon', exact: true }).click();
    await expect(other.getByRole('dialog').locator('.profile-icon-grid button')).toHaveCount(60);
    await other.getByRole('button', { name: 'Show more', exact: true }).click();
    await expect(other.getByRole('dialog').locator('.profile-icon-grid button')).toHaveCount(120);
    await other.keyboard.press('Escape');
    await expect(other.getByRole('dialog')).not.toBeVisible();
    await expect(other.getByRole('button', { name: 'Choose icon', exact: true })).toBeFocused();
    await other.getByRole('button', { name: 'Choose icon', exact: true }).click();
    await other.getByLabel('Search icons', { exact: true }).fill('flowre');
    await expect(other.getByRole('button', { name: 'Flower', exact: true })).toBeVisible();
    for (const mode of ['light', 'dark'] as const) {
      await theme(other, mode);
      await captureProfile(`profile-picker-${mode}`);
    }
    await other.setViewportSize({ width: 390, height: 844 });
    await captureProfile('profile-picker-phone');
    await other.setViewportSize({ width: 1440, height: 1100 });
    await other.getByLabel('Search icons', { exact: true }).press('ArrowDown');
    await expect(other.getByRole('button', { name: 'Flower', exact: true })).toBeFocused();
    await other.keyboard.press('Enter');
    await other.getByRole('button', { name: 'Choose color', exact: true }).click();
    await other.getByRole('button', { name: 'Profile colour: Info, strong', exact: true }).click();
    await other.getByRole('button', { name: 'Save profile', exact: true }).click();
    await expect(other.getByRole('status').filter({ hasText: 'Profile saved.' })).toBeVisible();
    await expect(
      other.locator('.profile-rail-avatar [data-profile-icon="lucide:flower"]'),
    ).toBeVisible();
    // Reopen the picker after saving so review captures show the persisted selection.
    await other.getByRole('button', { name: 'Choose color', exact: true }).click();
    const colorPicker = other.getByRole('dialog', { name: 'Choose your color', exact: true });
    await expect(colorPicker).toBeVisible();
    await expect(
      colorPicker.getByRole('button', { name: 'Profile colour: Info, strong', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    for (const mode of ['light', 'dark'] as const) {
      await theme(other, mode);
      await captureProfile(`profile-color-picker-${mode}`);
    }
    await other.setViewportSize({ width: 390, height: 844 });
    await captureProfile('profile-color-picker-phone');
    await other.keyboard.press('Escape');
    await expect(colorPicker).not.toBeVisible();
    await other.setViewportSize({ width: 1440, height: 1100 });
    await mkdir('test-results/theme-screenshots', { recursive: true });
    for (const mode of ['light', 'dark'] as const) {
      await theme(other, mode);
      await captureProfile(`profile-settings-${mode}`);
    }
    await other.setViewportSize({ width: 390, height: 844 });
    await captureProfile('profile-settings-phone');
    await other.setViewportSize({ width: 1440, height: 1100 });
    await other.reload();
    await expect(other.getByLabel('Display name', { exact: true })).toHaveValue('Iris Garden');
    await page.goto(`/?item=${item.id}`);
    await saved(page);
    await other.goto(`${baseURL}/?item=${item.id}`);
    await saved(other);
    await select(page, 'A1');
    await page.keyboard.type('Moss');
    await page.keyboard.press('Enter');
    await select(other, 'B2');
    await other.keyboard.type('Iris');
    await other.keyboard.press('Enter');
    await select(other, 'B2:C4');
    await saved(page);
    await saved(other);
    const label = page.locator('[data-presence-label]').filter({ hasText: 'Iris Garden' });
    const badge = page
      .getByRole('group', { name: 'People in this document' })
      .getByRole('button', { name: 'Go to Iris Garden', exact: true });
    await expect(label).toBeVisible();
    await expect(label.locator('[data-profile-icon="lucide:flower"]')).toBeVisible();
    await expect(badge.locator('[data-profile-icon="lucide:flower"]')).toBeVisible();
    await select(page, 'D5');
    const own = await address(page).inputValue();
    // Selection changes rebuild the popup before its canvas position settles.
    // Compare real, stable geometry rather than a detached/offscreen placeholder.
    let before: Awaited<ReturnType<typeof label.boundingBox>> = null;
    let stableSamples = 0;
    await expect
      .poll(async () => {
        const box = await label.boundingBox();
        const viewport = page.viewportSize()!;
        if (
          !box ||
          !(await label.isVisible()) ||
          box.width <= 0 ||
          box.height <= 0 ||
          box.x < 0 ||
          box.y < 0 ||
          box.x + box.width > viewport.width ||
          box.y + box.height > viewport.height
        ) {
          before = null;
          stableSamples = 0;
          return false;
        }
        stableSamples = JSON.stringify(box) === JSON.stringify(before) ? stableSamples + 1 : 0;
        before = box;
        return stableSamples >= 2;
      })
      .toBe(true);
    await badge.click();
    await expect.poll(() => label.boundingBox()).toEqual(before);
    await expect(address(page)).toHaveValue(own);
    await select(other, 'Z100');
    await expect(badge).toHaveAttribute('data-selection', /!Z100$/);
    await badge.click();
    await expect(label).toBeVisible();
    await expect(address(page)).toHaveValue(own);
    await select(other, 'B2:C4');
    await expect(badge).toHaveAttribute('data-selection', /!B2:C4$/);
    await badge.click();
    await expect(label).toBeVisible();
    // Another tab's coordinates must not paint the same cells on this tab.
    await other.locator('.univer-container').getByText('Sheet2', { exact: true }).click();
    await select(other, 'F7');
    await expect(badge).toHaveAttribute('data-selection', 'second!F7');
    await expect(label).not.toBeVisible();
    await expect(address(page)).toHaveValue(own);
    await badge.click();
    await expect(label).toBeVisible();
    await expect(address(page)).not.toHaveValue('F7');
    await page.locator('.univer-container').getByText('Sheet1', { exact: true }).click();
    await other.locator('.univer-container').getByText('Sheet1', { exact: true }).click();
    await select(other, '2:2');
    await expect(badge).toHaveAttribute('data-selection', 'first!A2:AD2');
    await select(other, 'B2:C4');
    await expect(label).toBeVisible();
    const pixels = (color: string) =>
      page.locator('.univer-container canvas').evaluateAll((canvases, hex) => {
        const rgb = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
        let count = 0;
        for (const canvas of canvases as HTMLCanvasElement[]) {
          const ctx = canvas.getContext('2d');
          if (!ctx || !canvas.width || !canvas.height) continue;
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          for (let i = 0; i < data.length; i += 4)
            if (data[i + 3] > 200 && rgb.every((value, j) => Math.abs(data[i + j] - value) < 5))
              count++;
        }
        return count;
      }, color);
    for (const mode of ['light', 'dark'] as const) {
      await theme(page, mode);
      await expect(label).toBeVisible();
      const bg = await badge.evaluate((node) => getComputedStyle(node).backgroundColor);
      await expect(label).toHaveCSS('background-color', bg);
      await expect(label).toHaveCSS('border-radius', '6px');
      await expect.poll(() => pixels(palettes[mode]['fill-info-strong-bg'])).toBeGreaterThan(5);
      await expect.poll(() => pixels(palettes[mode]['fill-success-strong-bg'])).toBeGreaterThan(5);
      await page.screenshot({
        path: `test-results/theme-screenshots/presence-sheet-${mode}-${info.project.name}.png`,
        fullPage: true,
      });
    }
    // A newly joined touch client must receive an idle peer's unchanged cursor.
    const touch = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    try {
      await touch.addCookies([cookie(owner.id)]);
      const phone = await touch.newPage();
      phone.on('pageerror', (error) => errors.push(error.message));
      await phone.goto(`${baseURL}/?item=${item.id}`);
      await saved(phone);
      await theme(phone, 'dark');
      await phone.locator('.univer-container').scrollIntoViewIfNeeded();
      await expect(
        phone.getByRole('button', { name: 'Go to Iris Garden', exact: true }),
      ).toHaveAttribute('data-selection', 'first!B2:C4');
      const marker = phone.locator('[data-presence-label]').filter({ hasText: 'Iris Garden' });
      await expect(marker).toBeVisible();
      await expect
        .poll(async () => {
          const label = await marker.boundingBox(),
            editor = await phone.locator('.univer-container').boundingBox();
          return !!label && !!editor && label.y >= editor.y && label.y < editor.y + editor.height;
        })
        .toBe(true);
      await phone.screenshot({
        path: `test-results/theme-screenshots/presence-sheet-phone-${info.project.name}.png`,
      });
    } finally {
      await touch.close();
    }
    await page.reload();
    await saved(page);
    await expect(label).toBeVisible();
    await select(page, 'D4');
    await page.keyboard.type('Still editing');
    await page.keyboard.press('Enter');
    await saved(page);
    await saved(other);
    const snapshot = (await (await context.request.get(`/api/items/${item.id}/sheet`)).json())
      .snapshot;
    expect(snapshot.sheets[snapshot.sheetOrder[0]].cellData[3][3].v).toBe('Still editing');
    expect(errors).toEqual([]);
  } finally {
    await second.close();
    db.prepare('DELETE FROM workspace_items WHERE id=?').run(item.id);
    for (const user of [owner, editor])
      db.prepare('DELETE FROM auth_users WHERE id=?').run(user.id);
    db.close();
  }
});
