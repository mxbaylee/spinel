import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { sheetImageFixture } from './sheet-image-fixture.ts';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';

for (const mobile of [false, true]) {
  test(`imported Sheet images render in ${mobile ? 'mobile' : 'desktop'} live and readonly history views`, async ({
    browser,
    baseURL,
  }, info) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({
      baseURL,
      hasTouch: mobile,
      viewport: mobile ? { width: 412, height: 915 } : { width: 1440, height: 1100 },
    });
    const page = await context.newPage();
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(mobile);
    const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
    const auth = new AuthStore(db);
    const user = auth.createUser(`Sheet images ${info.testId}`);
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
    await page.setViewportSize(
      mobile ? { width: 412, height: 915 } : { width: 1440, height: 1100 },
    );
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const snapshot = await sheetImageFixture();
    let releaseImages = () => {};
    try {
      const imported = await context.request.post('/api/items/import', {
        headers: { Origin: baseURL! },
        data: {
          filename: 'Sheet images.univer.json',
          parentId: null,
          snapshot,
        },
      });
      expect(imported.status(), await imported.text()).toBe(201);
      const { item } = await imported.json();
      const pixels = async () => {
        const buffer = await page.locator('.univer-container').screenshot();
        const { data, info: metadata } = await sharp(buffer)
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const counts = [0, 0, 0];
        const rgb = [
          [255, 153, 0],
          [34, 85, 238],
          [34, 187, 102],
        ];
        for (let offset = 0; offset < data.length; offset += metadata.channels)
          rgb.forEach((color, index) => {
            if (color.every((value, channel) => Math.abs(data[offset + channel] - value) < 12))
              counts[index]++;
          });
        return counts;
      };
      const allImagesVisible = async () => {
        await expect
          .poll(async () => (await pixels()).every((count) => count > 1000), { timeout: 25_000 })
          .toBe(true);
      };
      await page.goto(`/?item=${item.id}`);
      await expect(page.getByLabel('Spreadsheet grid', { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await allImagesVisible();
      await page.reload();
      await expect(page.getByLabel('Spreadsheet grid', { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await allImagesVisible();
      const named = await context.request.post(`/api/items/${item.id}/history`, {
        headers: { Origin: baseURL! },
        data: { name: 'Images retained' },
      });
      expect(named.ok(), await named.text()).toBe(true);
      const checkpoint = await named.json();
      let heldImages = 0;
      const delayedImages = new Promise<void>((resolve) => {
        releaseImages = resolve;
      });
      await page.route('**/images/*', async (route) => {
        heldImages++;
        await delayedImages;
        await route.continue();
      });
      await page.goto(`/preview?item=${item.id}&version=${checkpoint.version.id}`);
      await expect(
        page.getByRole('button', { name: 'Restore this version', exact: true }),
      ).toBeEnabled({ timeout: 30_000 });
      // Complete image rendering AFTER the readonly permission setup. The
      // generic drawing renderer must not reattach drag handles at this point.
      await expect.poll(() => heldImages).toBeGreaterThan(0);
      releaseImages();
      await allImagesVisible();
      if (!mobile)
        await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled();
      const floatingBounds = async () => {
        const { data, info: meta } = await sharp(
          await page.locator('.univer-container').screenshot(),
        )
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        let left = meta.width,
          top = meta.height,
          right = 0,
          bottom = 0;
        for (let y = 0; y < meta.height; y++)
          for (let x = 0; x < meta.width; x++) {
            const i = (y * meta.width + x) * meta.channels;
            if (data[i] > 245 && Math.abs(data[i + 1] - 153) < 10 && data[i + 2] < 10) {
              left = Math.min(left, x);
              right = Math.max(right, x);
              top = Math.min(top, y);
              bottom = Math.max(bottom, y);
            }
          }
        return { left, right, top, bottom };
      };
      const assertReadOnlyImages = async () => {
        const before = await floatingBounds();
        const canvas = (await page.locator('.univer-container').boundingBox())!;
        const center = {
          x: canvas.x + (before.left + before.right) / 2,
          y: canvas.y + (before.top + before.bottom) / 2,
        };
        if (mobile) await page.touchscreen.tap(center.x, center.y);
        else await page.mouse.click(center.x, center.y);
        await page.keyboard.press('Delete');
        const refusal = page.getByText(
          'The range is protected, and you do not have edit permission. To edit, please contact the creator.',
          { exact: true },
        );
        if (await refusal.isVisible()) {
          await page.getByRole('button', { name: 'ok', exact: true }).click();
          await expect(refusal).toBeHidden();
        }
        // A locked image need not be selectable. If the underlying cell refuses
        // Delete, dismiss its backdrop before measuring the unchanged image.
        await expect.poll(floatingBounds).toEqual(before);
        const drag = async (x: number, y: number) => {
          if (mobile) {
            const session = await context.newCDPSession(page);
            try {
              await session.send('Input.dispatchTouchEvent', {
                type: 'touchStart',
                touchPoints: [{ x, y }],
              });
              for (let step = 1; step <= 6; step++)
                await session.send('Input.dispatchTouchEvent', {
                  type: 'touchMove',
                  touchPoints: [{ x: x + step * 5, y: y + step * 5 }],
                });
              await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            } finally {
              await session.detach();
            }
          } else {
            await page.mouse.move(x, y);
            await page.mouse.down();
            await page.mouse.move(x + 30, y + 30, { steps: 6 });
            await page.mouse.up();
          }
        };
        // Positive movement at the sheet's top-left scroll origin avoids
        // confusing permitted viewport panning with an image-position change.
        await drag(center.x, center.y);
        if (await refusal.isVisible()) {
          await page.getByRole('button', { name: 'ok', exact: true }).click();
          await expect(refusal).toBeHidden();
        }
        await expect.poll(floatingBounds).toEqual(before);
        // Attempt the resize handle's corner too, whether or not a locked image
        // exposes handles. No geometry or document mutation is permitted.
        await drag(canvas.x + before.right, canvas.y + before.bottom);
        if (await refusal.isVisible())
          await page.getByRole('button', { name: 'ok', exact: true }).click();
        await expect.poll(floatingBounds).toEqual(before);
        await allImagesVisible();
      };
      await assertReadOnlyImages();
      const current = async () => {
        const response = await context.request.get(`/api/items/${item.id}/sheet`);
        expect(response.ok()).toBe(true);
        return (await response.json()).snapshot;
      };
      const beforeViewer = await current();
      const viewer = auth.createUser(`Sheet image viewer ${info.testId}`);
      const shared = await context.request.put(`/api/items/${item.id}/sharing`, {
        headers: { Origin: baseURL! },
        data: { userId: viewer.id, role: 'viewer' },
      });
      expect(shared.ok(), await shared.text()).toBe(true);
      await context.addCookies([
        {
          name: COOKIE_NAME,
          value: auth.createSession(viewer.id).token,
          url: baseURL!.replace('http:', 'https:'),
          secure: true,
          httpOnly: true,
          sameSite: 'Strict',
        },
      ]);
      await page.unroute('**/images/*');
      heldImages = 0;
      const viewerImages = new Promise<void>((resolve) => {
        releaseImages = resolve;
      });
      await page.route('**/images/*', async (route) => {
        heldImages++;
        await viewerImages;
        await route.continue();
      });
      await page.goto(`/?item=${item.id}`);
      await expect(page.getByRole('status', { name: 'Save status' })).toHaveText(
        'View only — reload after your access changes.',
        { timeout: 30_000 },
      );
      await expect.poll(() => heldImages).toBeGreaterThan(0);
      releaseImages();
      await allImagesVisible();
      await assertReadOnlyImages();
      expect(await current()).toEqual(beforeViewer);
      expect(errors).toEqual([]);
    } finally {
      releaseImages();
      await context.close();
      db.close();
    }
  });
}

test('Sheet images survive browser export/import and restore, with scoped revocable guest access', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(150_000);
  const owner = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1100 } });
  const guest = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1100 } });
  const page = await owner.newPage(),
    visitor = await guest.newPage();
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`),
    auth = new AuthStore(db);
  const user = auth.createUser(`Sheet roundtrip ${info.testId}`);
  await owner.addCookies([
    {
      name: COOKIE_NAME,
      value: auth.createSession(user.id).token,
      url: baseURL!.replace('http:', 'https:'),
      secure: true,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  const headers = { Origin: baseURL! };
  let release = () => {};
  const inspectPixels = async (view: typeof page) => {
    const { data, info: meta } = await sharp(await view.locator('.univer-container').screenshot())
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const counts = [0, 0, 0];
    const colors = [
      [255, 153, 0],
      [34, 85, 238],
      [34, 187, 102],
    ];
    let x = 0,
      y = 0;
    for (let offset = 0; offset < data.length; offset += meta.channels)
      colors.forEach((rgb, index) => {
        if (rgb.every((value, channel) => Math.abs(data[offset + channel] - value) < 12)) {
          counts[index]++;
          if (index === 0) {
            x += (offset / meta.channels) % meta.width;
            y += Math.floor(offset / meta.channels / meta.width);
          }
        }
      });
    return { counts, x: x / counts[0], y: y / counts[0] };
  };
  const visible = async (view: typeof page) => {
    await expect
      .poll(async () => (await inspectPixels(view)).counts.every((n) => n > 1000), {
        timeout: 25_000,
      })
      .toBe(true);
  };
  const saved = () =>
    expect(page.getByRole('status', { name: 'Save status' })).toHaveText('All changes saved.', {
      timeout: 30_000,
    });
  try {
    const created = await owner.request.post('/api/items/import', {
      headers,
      data: { filename: 'images.json', parentId: null, snapshot: await sheetImageFixture() },
    });
    expect(created.status()).toBe(201);
    const original = (await created.json()).item;
    await page.goto(`/?item=${original.id}`);
    await saved();
    await visible(page);
    const originalPixels = await inspectPixels(page);
    const originalLive = (await (await owner.request.get(`/api/items/${original.id}/sheet`)).json())
      .snapshot;
    const originalDrawing = JSON.parse(
      originalLive.resources.find(
        (entry: { name: string }) => entry.name === 'SHEET_DRAWING_PLUGIN',
      ).data,
    ).tab.data.floating;
    await page.getByRole('button', { name: 'Document actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Export', exact: true }).click();
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Univer file', exact: true }).click();
    const download = await downloading;
    const bytes = await readFile((await download.path())!);
    const exported = JSON.parse(bytes.toString());
    expect(exported.sheetOrder).toEqual(['tab']);
    expect(exported.sheets.tab.backgroundImage.source).toMatch(/^data:image\/png;base64,/);
    const floating = JSON.parse(
      exported.resources.find((entry: { name: string }) => entry.name === 'SHEET_DRAWING_PLUGIN')
        .data,
    ).tab.data.floating;
    expect(floating.subUnitId).toBe('tab');
    expect(floating.transform).toEqual(originalDrawing.transform);
    await page.goto('/');
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Import file…', exact: true }).click();
    const importing = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/items/import' &&
        response.request().method() === 'POST',
    );
    await page
      .getByLabel('Univer file or archive', { exact: true })
      .setInputFiles({ name: 'copy.univer.json', mimeType: 'application/json', buffer: bytes });
    const imported = await importing;
    expect(imported.status()).toBe(201);
    const copy = (await imported.json()).item;
    expect(copy.id).not.toBe(original.id);
    await page.goto(`/?item=${copy.id}`);
    await saved();
    await visible(page);
    const read = async () => {
      const response = await owner.request.get(`/api/items/${copy.id}/sheet`);
      expect(response.ok()).toBe(true);
      return (await response.json()).snapshot;
    };
    const copiedPixels = await inspectPixels(page);
    expect(copiedPixels.x).toBeCloseTo(originalPixels.x, 0);
    expect(copiedPixels.y).toBeCloseTo(originalPixels.y, 0);
    const before = await read();
    const source: string = before.sheets.tab.backgroundImage.source;
    expect(source).toContain(`/api/items/${copy.id}/images/`);
    const checkpointResponse = await owner.request.post(`/api/items/${copy.id}/history`, {
      headers,
      data: { name: 'Images before removal' },
    });
    expect(checkpointResponse.ok()).toBe(true);
    const checkpoint = (await checkpointResponse.json()).version;
    const image = await inspectPixels(page),
      canvas = (await page.locator('.univer-container').boundingBox())!;
    await page.mouse.click(canvas.x + image.x, canvas.y + image.y);
    await page.keyboard.press('Delete');
    await expect.poll(async () => (await inspectPixels(page)).counts[0]).toBe(0);
    await saved();
    await expect
      .poll(async () => {
        const snapshot = await read();
        const resource = snapshot.resources.find(
          (entry: { name: string }) => entry.name === 'SHEET_DRAWING_PLUGIN',
        );
        return resource ? Boolean(JSON.parse(resource.data).tab?.data?.floating) : false;
      })
      .toBe(false);
    await page.goto(`/preview?item=${copy.id}&version=${checkpoint.id}`);
    await expect(
      page.getByRole('button', { name: 'Restore this version', exact: true }),
    ).toBeEnabled({ timeout: 30_000 });
    await visible(page);
    await page.getByRole('button', { name: 'Restore this version', exact: true }).click();
    await page
      .getByRole('dialog', { name: /Restore .* for everyone\?/ })
      .getByRole('button', { name: 'Restore version', exact: true })
      .click();
    await saved();
    await visible(page);
    const restored = await read();
    expect(restored.sheets.tab.backgroundImage.source).toBe(source);
    expect(restored.sheetOrder).toEqual(['tab']);
    const restoredDrawing = JSON.parse(
      restored.resources.find((entry: { name: string }) => entry.name === 'SHEET_DRAWING_PLUGIN')
        .data,
    ).tab.data.floating;
    expect(restoredDrawing.transform).toEqual(floating.transform);
    const link = await owner.request.put(`/api/items/${copy.id}/link`, {
      headers,
      data: { role: 'viewer' },
    });
    expect(link.ok()).toBe(true);
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = 0;
    await visitor.route('**/images/*', async (route) => {
      held++;
      await pending;
      await route.continue();
    });
    await visitor.goto((await link.json()).url);
    await expect(visitor.getByRole('status', { name: 'Save status' })).toHaveText(
      'View only — reload after your access changes.',
      { timeout: 30_000 },
    );
    await expect.poll(() => held).toBeGreaterThan(0);
    release();
    await visible(visitor);
    const guestBefore = await read(),
      guestPixels = await inspectPixels(visitor);
    const guestCanvas = (await visitor.locator('.univer-container').boundingBox())!;
    const gx = guestCanvas.x + guestPixels.x,
      gy = guestCanvas.y + guestPixels.y;
    await visitor.mouse.click(gx, gy);
    await visitor.keyboard.press('Delete');
    const refusal = visitor.getByText(
      'The range is protected, and you do not have edit permission. To edit, please contact the creator.',
      { exact: true },
    );
    // The refusal dialog fades out after dismissal; wait until it is gone so a
    // closing dialog is not mistaken for a second refusal.
    const dismissRefusal = async () => {
      if (await refusal.isVisible())
        await visitor.getByRole('button', { name: 'ok', exact: true }).click();
      await expect(refusal).toBeHidden();
    };
    await dismissRefusal();
    await visitor.mouse.move(gx, gy);
    await visitor.mouse.down();
    await visitor.mouse.move(gx + 30, gy + 30, { steps: 6 });
    await visitor.mouse.up();
    await dismissRefusal();
    await visible(visitor);
    await expect
      .poll(async () => {
        const current = await inspectPixels(visitor);
        return { x: current.x, y: current.y };
      })
      .toEqual({ x: guestPixels.x, y: guestPixels.y });
    expect(await read()).toEqual(guestBefore);
    const hash = source.split('/').at(-1)!;
    const guestImage = source;
    const allowed = await guest.request.get(guestImage);
    expect(allowed.ok()).toBe(true);
    expect(await allowed.body()).toEqual(await (await owner.request.get(source)).body());
    expect([401, 403, 404]).toContain(
      (await guest.request.get(`/api/items/${original.id}/images/${hash}`)).status(),
    );
    const revoked = await owner.request.put(`/api/items/${copy.id}/link`, {
      headers,
      data: { role: null },
    });
    expect(revoked.ok()).toBe(true);
    await expect(visitor.getByRole('alert')).toHaveText('This link no longer works.');
    expect([401, 403, 404]).toContain((await guest.request.get(guestImage)).status());
  } finally {
    release();
    await guest.close();
    await owner.close();
    db.close();
  }
});
