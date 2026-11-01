import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test';
import type { IWorkbookData } from '@univerjs/core';
import sharp from 'sharp';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { nativeTheme } from './native-theme.ts';

const orange = [255, 153, 0] as const;
const blue = [34, 85, 238] as const;
const green = [34, 187, 102] as const;
type ImageDecodeWindow = Window & {
  sheetImageDecodeGate?: { held: number; release(): void };
};
const saved = (page: Page) =>
  expect(page.getByRole('status', { name: 'Save status' })).toHaveText('All changes saved.', {
    timeout: 30_000,
  });

function floating(snapshot: IWorkbookData, sheetId = 'images') {
  const resource = snapshot.resources?.find((entry) => entry.name === 'SHEET_DRAWING_PLUGIN');
  return Object.values(resource ? (JSON.parse(resource.data)[sheetId]?.data ?? {}) : {}) as {
    drawingId: string;
    source: string;
    subUnitId: string;
    transform: { width: number; height: number };
  }[];
}

function cellSources(snapshot: IWorkbookData, row: number, col: number, sheetId = 'images') {
  const cell = snapshot.sheets[sheetId].cellData?.[row]?.[col];
  return Object.values(cell?.p?.drawings ?? {}).flatMap((drawing) =>
    'source' in drawing && typeof drawing.source === 'string' ? [drawing.source] : [],
  );
}

async function raster(color: readonly number[], format: 'png' | 'jpeg' | 'webp' = 'png') {
  return sharp({
    create: {
      width: 80,
      height: 60,
      channels: 3,
      background: { r: color[0], g: color[1], b: color[2] },
    },
  })
    [format]()
    .toBuffer();
}

async function selectCell(page: Page, address: string) {
  const box = page
    .getByRole('region', { name: 'Sheet document', exact: true })
    .locator('[data-u-comp="defined-name"] input');
  await box.fill(address);
  await box.press('Enter');
}

async function openImageMenu(page: Page) {
  const editor = page.getByRole('region', { name: 'Sheet document', exact: true });
  if ((await editor.getAttribute('data-mobile')) === 'true')
    await editor.getByRole('button', { name: 'Open sheet tools', exact: true }).tap();
  const insert = editor.getByRole('tab', { name: 'Insert', exact: true });
  await insert.click();
  await expect(insert).toHaveAttribute('aria-selected', 'true');
  await editor.getByRole('button', { name: 'Image', exact: true }).click();
  await expect(page.getByText('Float Image', { exact: true })).toBeVisible();
  await expect(page.getByText('Cell Image', { exact: true })).toBeVisible();
}

async function insertFile(
  page: Page,
  mode: 'Float Image' | 'Cell Image',
  buffer: Buffer,
  mimeType = 'image/png',
) {
  await openImageMenu(page);
  await chooseImageFile(page, mode, buffer, mimeType);
}

async function chooseImageFile(
  page: Page,
  mode: 'Float Image' | 'Cell Image',
  buffer: Buffer,
  mimeType = 'image/png',
) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByText(mode, { exact: true }).click();
  await (await chooser).setFiles({ name: `picture.${mimeType.split('/')[1]}`, mimeType, buffer });
}

async function holdNativeImageDecode(context: BrowserContext) {
  await context.addInitScript(() => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
    const waiting: (() => void)[] = [];
    const gate = {
      held: 0,
      release() {
        Object.defineProperty(HTMLImageElement.prototype, 'src', descriptor);
        for (const load of waiting.splice(0)) load();
      },
    };
    (window as ImageDecodeWindow).sheetImageDecodeGate = gate;
    // Hold only the native dimension load. The real server still validates
    // and stores the upload; no image or document response is fabricated.
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ...descriptor,
      set(this: HTMLImageElement, source: string) {
        if (source.startsWith('blob:')) {
          gate.held++;
          waiting.push(() => descriptor.set!.call(this, source));
        } else descriptor.set!.call(this, source);
      },
    });
  });
}

const releaseNativeImageDecode = (page: Page) =>
  page.evaluate(() => (window as ImageDecodeWindow).sheetImageDecodeGate?.release());

async function visibleColors(page: Page, colors: readonly (readonly number[])[]) {
  await expect
    .poll(
      async () => {
        const { data, info } = await sharp(await page.locator('.univer-container').screenshot())
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const counts = colors.map(() => 0);
        for (let offset = 0; offset < data.length; offset += info.channels)
          colors.forEach((rgb, index) => {
            if (rgb.every((value, channel) => Math.abs(data[offset + channel] - value) < 12))
              counts[index]++;
          });
        return counts.every((count) => count > 500);
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}

async function capture(page: Page, info: TestInfo, state: string) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await mkdir('test-results/theme-screenshots', { recursive: true });
  await page.screenshot({
    path: `test-results/theme-screenshots/spn-068-${state}-${info.project.name}.png`,
    animations: 'disabled',
    fullPage: true,
  });
}

async function fixture(browser: Browser, baseURL: string, info: TestInfo, mobile = false) {
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db);
  const user = auth.createUser(`Sheet insertion ${info.testId}`);
  const context = await browser.newContext({
    baseURL,
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    hasTouch: mobile,
    permissions: ['clipboard-read', 'clipboard-write'],
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  const cookie = (userId: string) => ({
    name: COOKIE_NAME,
    value: auth.createSession(userId).token,
    url: baseURL.replace('http:', 'https:'),
    secure: true,
    httpOnly: true,
    sameSite: 'Strict' as const,
  });
  await context.addCookies([cookie(user.id)]);
  const headers = { Origin: baseURL };
  // Only the empty workbook is seeded. Every image below enters the real upload
  // and native insertion path; the server is never given a prepared image model.
  const response = await context.request.post('/api/items/import', {
    headers,
    data: {
      filename: 'Recipe pictures.univer.json',
      parentId: null,
      snapshot: {
        id: 'image-insertion-fixture',
        name: 'Recipe pictures',
        appVersion: '1.1.0',
        locale: 'enUS',
        styles: {},
        sheetOrder: ['images'],
        sheets: {
          images: {
            id: 'images',
            name: 'Pictures',
            rowCount: 24,
            columnCount: 10,
            defaultRowHeight: 80,
            defaultColumnWidth: 140,
            cellData: { 0: { 0: { v: 'Recipe pictures' } } },
          },
        },
      },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const { item } = (await response.json()) as { item: { id: string } };
  const page = await context.newPage();
  const errors: string[] = [];
  const observe = (view: Page) => {
    view.setDefaultTimeout(15_000);
    view.on('pageerror', (error) => errors.push(error.message));
    view.on('websocket', (socket) =>
      socket.on('framereceived', (frame) => {
        const message = JSON.parse(String(frame.payload));
        if (message.type === 'resync') errors.push(`Synchronization reset: ${message.reason}`);
      }),
    );
  };
  observe(page);
  const read = async () => {
    const result = await context.request.get(`/api/items/${item.id}/sheet`);
    expect(result.ok(), await result.text()).toBe(true);
    return (await result.json()).snapshot as IWorkbookData;
  };
  const peers: BrowserContext[] = [];
  const peerIds = new Map<Page, string>();
  return {
    page,
    context,
    item,
    read,
    headers,
    errors,
    peerIds,
    async peer(role: 'editor' | 'viewer') {
      const member = auth.createUser(`Sheet image ${role} ${info.testId}`);
      const sharing = await context.request.put(`/api/items/${item.id}/sharing`, {
        headers,
        data: { userId: member.id, role },
      });
      expect(sharing.ok(), await sharing.text()).toBe(true);
      const peer = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
      peers.push(peer);
      await peer.addCookies([cookie(member.id)]);
      const view = await peer.newPage();
      peerIds.set(view, member.id);
      observe(view);
      await view.goto(`/?item=${item.id}`);
      await expect(view.getByLabel('Spreadsheet grid', { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      return view;
    },
    async open() {
      await page.goto(`/?item=${item.id}`);
      await saved(page);
      await expect(page.getByLabel('Spreadsheet grid', { exact: true })).toBeVisible();
    },
    async close() {
      await writeFile(info.outputPath('sheet-image-insertion-errors.json'), JSON.stringify(errors));
      for (const peer of peers) await peer.close();
      await context.close();
      db.close();
    },
  };
}

test('native Sheet image menu saves both placements with undo, peer delivery, reload and history', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(150_000);
  const f = await fixture(browser, baseURL!, info);
  try {
    await f.open();
    const peer = await f.peer('editor');
    await saved(peer);
    await selectCell(f.page, 'C2');
    await openImageMenu(f.page);
    await capture(f.page, info, 'menu-light');
    await f.page.keyboard.press('Escape');
    await insertFile(f.page, 'Float Image', await raster(orange));
    await expect.poll(async () => floating(await f.read()).length).toBe(1);
    await saved(f.page);
    const first = floating(await f.read())[0];
    expect(first.source).toMatch(new RegExp(`^/api/items/${f.item.id}/images/[a-f0-9]{64}$`));
    await f.page.keyboard.press('Control+z');
    await expect.poll(async () => floating(await f.read()).length).toBe(0);
    await f.page.keyboard.press('Control+y');
    await expect
      .poll(async () => floating(await f.read()).map((image) => image.source))
      .toEqual([first.source]);
    await saved(f.page);

    await selectCell(f.page, 'B4');
    await insertFile(f.page, 'Cell Image', await raster(blue));
    await expect.poll(async () => cellSources(await f.read(), 3, 1).length).toBe(1);
    await saved(f.page);
    const cell = cellSources(await f.read(), 3, 1)[0];
    expect(cell).toMatch(new RegExp(`^/api/items/${f.item.id}/images/[a-f0-9]{64}$`));
    await f.page.keyboard.press('Control+z');
    await expect.poll(async () => cellSources(await f.read(), 3, 1)).toEqual([]);
    await f.page.keyboard.press('Control+y');
    await expect.poll(async () => cellSources(await f.read(), 3, 1)).toEqual([cell]);
    await saved(f.page);
    await selectCell(f.page, 'H7');
    await visibleColors(f.page, [orange, blue]);
    await visibleColors(peer, [orange, blue]);
    await peer.context().close();
    await capture(f.page, info, 'inserted-light');
    await f.page.emulateMedia({ colorScheme: 'dark' });
    await nativeTheme(f.page, f.page.locator('.univer-container'), 'dark');
    await visibleColors(f.page, [orange, blue]);
    await capture(f.page, info, 'inserted-dark');

    await f.page.reload();
    await saved(f.page);
    await visibleColors(f.page, [orange, blue]);
    expect(floating(await f.read()).map((image) => image.source)).toEqual([first.source]);
    expect(cellSources(await f.read(), 3, 1)).toEqual([cell]);
    const named = await f.context.request.post(`/api/items/${f.item.id}/history`, {
      headers: f.headers,
      data: { name: 'Pictures added' },
    });
    expect(named.ok(), await named.text()).toBe(true);
    const checkpoint = (await named.json()).version;
    await f.page.goto(`/preview?item=${f.item.id}&version=${checkpoint.id}`);
    await expect(
      f.page.getByRole('button', { name: 'Restore this version', exact: true }),
    ).toBeEnabled({
      timeout: 30_000,
    });
    await visibleColors(f.page, [orange, blue]);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('native image cell moves with rows and cut/paste; copying the sheet retains both image kinds', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(150_000);
  const f = await fixture(browser, baseURL!, info);
  try {
    await f.open();
    await selectCell(f.page, 'E2');
    await insertFile(f.page, 'Float Image', await raster(orange));
    await expect.poll(async () => floating(await f.read()).length).toBe(1);
    await saved(f.page);
    const floatSource = floating(await f.read())[0].source;
    await selectCell(f.page, 'B4');
    await insertFile(f.page, 'Cell Image', await raster(blue));
    await expect.poll(async () => cellSources(await f.read(), 3, 1).length).toBe(1);
    await saved(f.page);
    const cellSource = cellSources(await f.read(), 3, 1)[0];
    await selectCell(f.page, 'B4');
    // The fixture's row height is 80px. Right-click the native fourth row
    // header, then use its actual Insert rows above control.
    await f.page.getByLabel('Spreadsheet grid', { exact: true }).click({
      button: 'right',
      position: { x: 20, y: 20 + 3 * 80 + 40 },
    });
    // The count input occupies the row's center; activate its native action icon.
    await f.page
      .getByRole('button')
      .filter({ hasText: 'rows above' })
      .click({ position: { x: 20, y: 18 } });
    await expect.poll(async () => cellSources(await f.read(), 4, 1)).toEqual([cellSource]);
    expect(cellSources(await f.read(), 3, 1)).toEqual([]);
    await saved(f.page);

    await selectCell(f.page, 'B5');
    const sentinel = `not-cut-${info.testId}`;
    await f.page.evaluate((text) => navigator.clipboard.writeText(text), sentinel);
    await f.page.keyboard.press('Control+x');
    await expect
      .poll(() => f.page.evaluate(() => navigator.clipboard.readText()))
      .not.toBe(sentinel);
    await selectCell(f.page, 'D7');
    await f.page.keyboard.press('Control+v');
    await expect.poll(async () => cellSources(await f.read(), 6, 3)).toEqual([cellSource]);
    expect(cellSources(await f.read(), 4, 1)).toEqual([]);
    await saved(f.page);
    const original = f.page.getByRole('tab', { name: 'Pictures', exact: true });
    await original.click({ button: 'right' });
    const sheetMenu = f.page.locator('section').filter({
      has: f.page.getByRole('button', { name: 'Rename', exact: true }),
    });
    await sheetMenu.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect.poll(async () => (await f.read()).sheetOrder.length).toBe(2);
    await saved(f.page);
    const copied = await f.read();
    const copiedId = copied.sheetOrder.find((id) => id !== 'images')!;
    expect(cellSources(copied, 6, 3, copiedId)).toEqual([cellSource]);
    expect(floating(copied, copiedId).map((image) => image.source)).toEqual([floatSource]);
    expect(floating(copied, copiedId).every((image) => image.subUnitId === copiedId)).toBe(true);
    await f.page.getByRole('tab', { name: copied.sheets[copiedId].name, exact: true }).click();
    await selectCell(f.page, 'A1');
    await visibleColors(f.page, [orange, blue]);
    await f.page.reload();
    await saved(f.page);
    await f.page.getByRole('tab', { name: copied.sheets[copiedId].name, exact: true }).click();
    await visibleColors(f.page, [orange, blue]);
    expect(cellSources(await f.read(), 6, 3, copiedId)).toEqual([cellSource]);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

async function dropFile(page: Page, buffer: Buffer, mimeType: string) {
  await page.locator('.univer-container').evaluate(
    (target, file) => {
      const bytes = Uint8Array.from(atob(file.base64), (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([bytes], `dropped.${file.mimeType.split('/')[1]}`, { type: file.mimeType }),
      );
      target.dispatchEvent(
        new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
      );
    },
    { base64: buffer.toString('base64'), mimeType },
  );
}

test('Sheet paste and drop store raster files; oversize refuses without inserting or shifting the editor', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  const f = await fixture(browser, baseURL!, info);
  try {
    await f.open();
    await selectCell(f.page, 'B2');
    await f.page.evaluate(
      async (base64) => {
        const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) }),
        ]);
      },
      (await raster(orange)).toString('base64'),
    );
    await f.page.keyboard.press('Control+v');
    await expect.poll(async () => floating(await f.read()).length).toBe(1);
    await saved(f.page);
    await selectCell(f.page, 'D4');
    await dropFile(f.page, await raster(green, 'webp'), 'image/webp');
    await expect.poll(async () => floating(await f.read()).length).toBe(2);
    await saved(f.page);
    await selectCell(f.page, 'H7');
    await visibleColors(f.page, [orange, green]);
    const before = await f.read();
    const bounds = await f.page.locator('.univer-container').boundingBox();
    await insertFile(f.page, 'Float Image', Buffer.alloc(5 * 1024 * 1024 + 1));
    await expect(f.page.locator('.editor-help[role="alert"]')).toContainText('5 MiB');
    await saved(f.page);
    expect(floating(await f.read())).toEqual(floating(before));
    expect(await f.page.locator('.univer-container').boundingBox()).toEqual(bounds);
    await capture(f.page, info, 'limit-light');
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('a Sheet image remains navigation-protected after upload until native insertion finishes', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(90_000);
  const f = await fixture(browser, baseURL!, info);
  try {
    await holdNativeImageDecode(f.context);
    await f.open();
    await selectCell(f.page, 'B2');
    const upload = f.page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/items/${f.item.id}/images` &&
        response.request().method() === 'POST',
    );
    await insertFile(f.page, 'Float Image', await raster(orange));
    expect((await upload).ok()).toBe(true);
    await expect
      .poll(() =>
        f.page.evaluate(() => (window as ImageDecodeWindow).sheetImageDecodeGate?.held ?? 0),
      )
      .toBeGreaterThan(0);
    await expect(f.page.getByRole('status', { name: 'Save status' })).toContainText(
      'Inserting image',
    );
    expect(floating(await f.read())).toEqual([]);
    const warning = f.page.waitForEvent('dialog');
    f.page.once('dialog', (dialog) => dialog.dismiss());
    await f.page.getByRole('button', { name: 'Back to files', exact: true }).click();
    expect((await warning).type()).toBe('confirm');
    await expect(f.page).toHaveURL(new RegExp(f.item.id));
    await releaseNativeImageDecode(f.page);
    await expect.poll(async () => floating(await f.read()).length).toBe(1);
    await saved(f.page);
    await visibleColors(f.page, [orange]);
    expect(f.errors).toEqual([]);
  } finally {
    await releaseNativeImageDecode(f.page).catch(() => {});
    await f.close();
  }
});

test('phone Sheet image insertion and its limit error keep the current layout within the viewport', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(90_000);
  const f = await fixture(browser, baseURL!, info, true);
  try {
    await f.open();
    await expect(
      f.page.getByRole('region', { name: 'Sheet document', exact: true }),
    ).toHaveAttribute('data-mobile', 'true');
    // Mobile uses its own native action drawer, not the desktop ribbon or a
    // synthetic drop as a substitute for its visible insertion control.
    await openImageMenu(f.page);
    await capture(f.page, info, 'menu-phone');
    await chooseImageFile(f.page, 'Float Image', await raster(orange, 'jpeg'), 'image/jpeg');
    await expect.poll(async () => floating(await f.read()).length).toBe(1);
    await saved(f.page);
    await visibleColors(f.page, [orange]);
    await capture(f.page, info, 'inserted-phone');
    const before = await f.page.locator('.univer-container').boundingBox();
    await dropFile(f.page, Buffer.alloc(5 * 1024 * 1024 + 1), 'image/png');
    await expect(f.page.locator('.editor-help[role="alert"]')).toContainText('5 MiB');
    expect(floating(await f.read()).length).toBe(1);
    expect(await f.page.locator('.univer-container').boundingBox()).toEqual(before);
    await capture(f.page, info, 'limit-phone');
    const details = f.page.getByRole('button', {
      name: 'Image not inserted · Details',
      exact: true,
    });
    await details.tap();
    const popup = f.page.getByRole('dialog', { name: 'Image not inserted · Details', exact: true });
    await expect(popup).toContainText('Choose an image no larger than 5 MiB.');
    const popupBounds = (await popup.boundingBox())!;
    expect(popupBounds.x).toBeGreaterThanOrEqual(0);
    expect(popupBounds.x + popupBounds.width).toBeLessThanOrEqual(390);
    await capture(f.page, info, 'limit-details-phone');
    await popup.getByRole('button', { name: 'Close', exact: true }).tap();
    await expect(popup).toHaveCount(0);
    await expect(details).toBeFocused();
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('changing the selected cell after upload refuses the late image and a fresh insertion succeeds', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(90_000);
  const f = await fixture(browser, baseURL!, info);
  try {
    await holdNativeImageDecode(f.context);
    await f.open();
    await selectCell(f.page, 'B4');
    const upload = f.page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/items/${f.item.id}/images` &&
        response.request().method() === 'POST',
    );
    const bytes = await raster(blue);
    await insertFile(f.page, 'Cell Image', bytes);
    expect((await upload).ok()).toBe(true);
    await expect
      .poll(() =>
        f.page.evaluate(() => (window as ImageDecodeWindow).sheetImageDecodeGate?.held ?? 0),
      )
      .toBeGreaterThan(0);
    await selectCell(f.page, 'C5');
    await releaseNativeImageDecode(f.page);
    await expect(f.page.locator('.editor-help[role="alert"]')).toContainText(
      'The selected cell changed. Select a cell and insert the image again.',
    );
    await saved(f.page);
    const refused = await f.read();
    expect(cellSources(refused, 3, 1)).toEqual([]);
    expect(cellSources(refused, 4, 2)).toEqual([]);
    expect(floating(refused)).toEqual([]);

    // Failure releases the same native insertion path; the stored bytes may be
    // deduplicated, but only the newly selected target receives a drawing.
    await insertFile(f.page, 'Cell Image', bytes);
    await expect.poll(async () => cellSources(await f.read(), 4, 2).length).toBe(1);
    await saved(f.page);
    expect(cellSources(await f.read(), 3, 1)).toEqual([]);
    await expect(f.page.locator('.editor-help[role="alert"]')).toHaveCount(0);
    await selectCell(f.page, 'H7');
    await visibleColors(f.page, [blue]);
    expect(f.errors).toEqual([]);
  } finally {
    await releaseNativeImageDecode(f.page).catch(() => {});
    await f.close();
  }
});

test('account viewers, edit-link guests and an offline owner cannot insert dropped images', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  const f = await fixture(browser, baseURL!, info);
  let guest: BrowserContext | undefined;
  const uploads: string[] = [];
  const observeUploads = (page: Page) =>
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/images'))
        uploads.push(request.url());
    });
  const denied = (page: Page) =>
    expect(page.locator('.editor-help[role="alert"]')).toContainText(
      'Image insertion needs an account with edit access.',
    );
  try {
    await f.open();
    const before = await f.read();
    const bytes = await raster(orange);
    const viewer = await f.peer('viewer');
    await expect(viewer.getByRole('status', { name: 'Save status' })).toHaveText(
      'View only — reload after your access changes.',
    );
    observeUploads(viewer);
    await dropFile(viewer, bytes, 'image/png');
    await denied(viewer);
    expect(uploads).toEqual([]);
    expect(await f.read()).toEqual(before);
    // Close the viewer before starting another native editor to keep this
    // authority scenario within the same two-editor memory envelope.
    await viewer.context().close();

    const linked = await f.context.request.put(`/api/items/${f.item.id}/link`, {
      headers: f.headers,
      data: { role: 'editor' },
    });
    expect(linked.ok(), await linked.text()).toBe(true);
    guest = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
    const visitor = await guest.newPage();
    visitor.on('pageerror', (error) => f.errors.push(error.message));
    observeUploads(visitor);
    await visitor.goto((await linked.json()).url);
    await saved(visitor);
    await dropFile(visitor, bytes, 'image/png');
    await denied(visitor);
    expect(uploads).toEqual([]);
    expect(await f.read()).toEqual(before);
    await guest.close();
    guest = undefined;

    observeUploads(f.page);
    await f.context.setOffline(true);
    await expect.poll(() => f.page.evaluate(() => navigator.onLine)).toBe(false);
    await dropFile(f.page, bytes, 'image/png');
    await expect(f.page.locator('.editor-help[role="alert"]')).toContainText(
      'Connect before inserting a new image.',
    );
    expect(uploads).toEqual([]);
    await f.context.setOffline(false);
    await saved(f.page);
    expect(await f.read()).toEqual(before);
    expect(f.errors).toEqual([]);
  } finally {
    await f.context.setOffline(false);
    await guest?.close();
    await f.close();
  }
});

test('cancelling an image chooser releases it; a peer row insertion while choosing refuses the stale target', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  const f = await fixture(browser, baseURL!, info);
  const uploads: string[] = [];
  const received: { type: string; revision?: number; mutations?: { id: string }[] }[] = [];
  f.page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === `/api/items/${f.item.id}/images`
    )
      uploads.push(request.url());
  });
  f.page.on('websocket', (socket) =>
    socket.on('framereceived', (frame) => received.push(JSON.parse(String(frame.payload)))),
  );
  try {
    await f.open();
    const peer = await f.peer('editor');
    await saved(peer);
    await selectCell(f.page, 'B4');
    const before = await f.read();
    await openImageMenu(f.page);
    const cancelledChooser = f.page.waitForEvent('filechooser');
    await f.page.getByText('Cell Image', { exact: true }).click();
    // Playwright intercepts the OS chooser. Dispatch its standard input cancel
    // event on the actual chooser element to exercise production cleanup.
    await (await cancelledChooser).element().dispatchEvent('cancel');
    await expect(f.page.locator('.univer-container input[type="file"]')).toHaveCount(0);
    await saved(f.page);
    await expect(f.page.locator('.editor-help[role="alert"]')).toHaveCount(0);
    expect(uploads).toEqual([]);
    expect(await f.read()).toEqual(before);

    await openImageMenu(f.page);
    const pendingChooser = f.page.waitForEvent('filechooser');
    await f.page.getByText('Cell Image', { exact: true }).click();
    const chooser = await pendingChooser;
    await selectCell(peer, 'B4');
    await peer.getByLabel('Spreadsheet grid', { exact: true }).click({
      button: 'right',
      position: { x: 20, y: 20 + 3 * 80 + 40 },
    });
    await peer
      .getByRole('button')
      .filter({ hasText: 'rows above' })
      .click({ position: { x: 20, y: 18 } });
    await expect.poll(async () => (await f.read()).sheets.images.rowCount).toBe(25);
    await saved(peer);
    // A verified revision follows the owner's native application and hash of
    // the real peer edit; a server snapshot alone cannot prove this delivery.
    await expect
      .poll(() =>
        received.some(
          (frame) =>
            frame.type === 'edit' &&
            frame.mutations?.some((mutation) => mutation.id === 'sheet.mutation.insert-row') &&
            received.some(
              (verification) =>
                verification.type === 'verified' && verification.revision === frame.revision,
            ),
        ),
      )
      .toBe(true);
    const afterRow = await f.read();
    const bytes = await raster(blue);
    await chooser.setFiles({ name: 'picture.png', mimeType: 'image/png', buffer: bytes });
    await expect(f.page.locator('.editor-help[role="alert"]')).toContainText(
      'The selected cell changed. Select a cell and insert the image again.',
    );
    await saved(f.page);
    expect(uploads).toEqual([]);
    expect(await f.read()).toEqual(afterRow);
    expect(floating(afterRow)).toEqual([]);
    expect(cellSources(afterRow, 3, 1)).toEqual([]);
    expect(cellSources(afterRow, 4, 1)).toEqual([]);
    await peer.context().close();

    await selectCell(f.page, 'B5');
    await insertFile(f.page, 'Cell Image', bytes);
    await expect.poll(async () => cellSources(await f.read(), 4, 1).length).toBe(1);
    await saved(f.page);
    expect(uploads).toHaveLength(1);
    expect(cellSources(await f.read(), 3, 1)).toEqual([]);
    await expect(f.page.locator('.editor-help[role="alert"]')).toHaveCount(0);
    await selectCell(f.page, 'H7');
    await visibleColors(f.page, [blue]);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('revoking account edit access after image upload refuses the late native insertion', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  const f = await fixture(browser, baseURL!, info);
  let editor: Page | undefined;
  try {
    await f.open();
    editor = await f.peer('editor');
    await holdNativeImageDecode(editor.context());
    await editor.reload();
    await saved(editor);
    await expect(editor.getByRole('button', { name: 'Bold', exact: true })).toBeEnabled();
    const before = await f.read();
    await selectCell(editor, 'B4');
    const upload = editor.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/items/${f.item.id}/images` &&
        response.request().method() === 'POST',
    );
    const bytes = await raster(blue);
    await insertFile(editor, 'Cell Image', bytes);
    expect((await upload).ok()).toBe(true);
    await expect
      .poll(() =>
        editor!.evaluate(() => (window as ImageDecodeWindow).sheetImageDecodeGate?.held ?? 0),
      )
      .toBeGreaterThan(0);
    expect(await f.read()).toEqual(before);

    await editor.getByRole('tab', { name: 'Start', exact: true }).click();
    const revoked = await f.context.request.put(`/api/items/${f.item.id}/sharing`, {
      headers: f.headers,
      data: { userId: f.peerIds.get(editor), role: 'viewer' },
    });
    expect(revoked.ok(), await revoked.text()).toBe(true);
    // Busy status remains "Inserting image" until decode finishes. Native
    // formatting becoming disabled proves the mounted editor adopted revocation.
    await expect(editor.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled({
      timeout: 15_000,
    });
    await releaseNativeImageDecode(editor);
    await expect(editor.locator('.editor-help[role="alert"]')).toContainText(
      'Image insertion needs an account with edit access.',
    );
    await expect(editor.getByRole('status', { name: 'Save status' })).toContainText(
      'Access changed.',
    );
    expect(await f.read()).toEqual(before);
    expect(cellSources(await f.read(), 3, 1)).toEqual([]);
    expect(floating(await f.read())).toEqual([]);
    await editor.context().close();

    await selectCell(f.page, 'B4');
    await insertFile(f.page, 'Cell Image', bytes);
    await expect.poll(async () => cellSources(await f.read(), 3, 1).length).toBe(1);
    await saved(f.page);
    await selectCell(f.page, 'H7');
    await visibleColors(f.page, [blue]);
    expect(f.errors).toEqual([]);
  } finally {
    if (editor) await releaseNativeImageDecode(editor).catch(() => {});
    await f.close();
  }
});

test('online images inserted into an already downloaded Sheet render after an offline reload', async ({
  browser,
  baseURL,
}, info) => {
  test.skip(info.project.name !== 'production', 'Offline downloads need the production shell.');
  test.setTimeout(180_000);
  const f = await fixture(browser, baseURL!, info);
  try {
    await f.open();
    await expect
      .poll(() => f.page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);
    await f.page.getByRole('button', { name: 'Document actions', exact: true }).click();
    await f.page
      .getByRole('menuitem', { name: 'Available offline on this device', exact: true })
      .click();
    const dialog = f.page.getByRole('dialog', { name: 'Offline availability', exact: true });
    await expect(dialog.getByRole('status')).toHaveText(
      'Recipe pictures is available offline on this device.',
      { timeout: 120_000 },
    );
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    const status = f.page.getByRole('status', { name: 'Save status' });
    await expect(status).toHaveText(
      'Synced. All changes are saved on the server and this device.',
      {
        timeout: 30_000,
      },
    );

    // Prepare an empty device copy first: neither image may come from the
    // original bundle or a second explicit download after insertion.
    expect(floating(await f.read())).toEqual([]);
    expect(cellSources(await f.read(), 3, 1)).toEqual([]);
    await selectCell(f.page, 'C2');
    await insertFile(f.page, 'Float Image', await raster(orange));
    await expect.poll(async () => floating(await f.read()).length).toBe(1);
    await expect(status).toHaveText('Synced. All changes are saved on the server and this device.');
    await selectCell(f.page, 'B4');
    await insertFile(f.page, 'Cell Image', await raster(blue));
    await expect.poll(async () => cellSources(await f.read(), 3, 1).length).toBe(1);
    await expect(status).toHaveText('Synced. All changes are saved on the server and this device.');
    const inserted = await f.read();
    const sources = [floating(inserted)[0].source, cellSources(inserted, 3, 1)[0]];
    for (const source of sources)
      expect(source).toMatch(new RegExp(`^/api/items/${f.item.id}/images/[a-f0-9]{64}$`));

    const imageRequests: string[] = [];
    f.page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith(`/api/items/${f.item.id}/images/`))
        imageRequests.push(request.url());
    });
    await f.context.setOffline(true);
    await f.page.reload();
    await expect.poll(() => f.page.evaluate(() => navigator.onLine)).toBe(false);
    await expect(status).toHaveText('Saved on this device — waiting to sync.', { timeout: 30_000 });
    await expect(f.page.getByLabel('Spreadsheet grid', { exact: true })).toBeVisible();
    await visibleColors(f.page, [orange, blue]);
    expect(imageRequests).toEqual([]);
    await f.context.setOffline(false);
    await expect(status).toHaveText(
      'Synced. All changes are saved on the server and this device.',
      {
        timeout: 30_000,
      },
    );
    const reopened = await f.read();
    expect([floating(reopened)[0].source, cellSources(reopened, 3, 1)[0]]).toEqual(sources);
    expect(f.errors).toEqual([]);
  } finally {
    await f.context.setOffline(false);
    await f.close();
  }
});
