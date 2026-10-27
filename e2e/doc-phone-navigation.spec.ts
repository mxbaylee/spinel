import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { expect, test } from '@playwright/test';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { nativeTheme } from './native-theme.ts';

// These exercise the shipped desktop Doc preset at phone width. Wheel input is
// intentional: physical touch/pinch and the software keyboard remain SPN-072/090.
async function changedContent(before: Buffer, after: Buffer) {
  const first = await sharp(before).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const second = await sharp(after).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  expect(second.info).toEqual(first.info);
  const rows = new Set<number>(),
    columns = new Set<number>();
  let pixels = 0;
  let left = first.info.width,
    right = -1,
    top = first.info.height,
    bottom = -1;
  // Exclude the outer canvas edges/scrollbars. Requiring spatially distributed
  // changes rejects a blinking caret, a hover scrollbar, or PNG metadata changes.
  for (let y = 20; y < first.info.height - 20; y++) {
    for (let x = 20; x < first.info.width - 20; x++) {
      const offset = (y * first.info.width + x) * first.info.channels;
      if (
        [0, 1, 2].some(
          (channel) =>
            Math.abs(first.data[offset + channel]! - second.data[offset + channel]!) > 24,
        )
      ) {
        pixels++;
        rows.add(y);
        columns.add(x);
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  return {
    pixels,
    rows: rows.size,
    columns: columns.size,
    width: pixels ? right - left + 1 : 0,
    height: pixels ? bottom - top + 1 : 0,
  };
}

async function renderedChange(canvas: Locator, before: Buffer) {
  await expect
    .poll(async () => {
      const change = await changedContent(before, await canvas.screenshot());
      return change.pixels > 1000 && change.rows > 25 && change.columns > 60;
    })
    .toBe(true);
}

async function settledCanvas(canvas: Locator) {
  let reference = await canvas.screenshot(),
    alternate: Buffer | undefined,
    current = reference,
    stable = 0;
  // The OSS native caret has a timer independent of DOM focus. At this
  // fixture's DPR1/default font, permit two recurring raster states only when
  // their difference fits one small caret-sized rectangle. A third state resets
  // the fixed references, so gradual drift or oscillating document content
  // cannot accumulate as "stable". Movement assertions below remain unchanged.
  await expect
    .poll(
      async () => {
        current = await canvas.screenshot();
        const change = await changedContent(reference, current);
        if (
          change.pixels === 0 ||
          (alternate && (await changedContent(alternate, current)).pixels === 0)
        ) {
          stable++;
        } else if (!alternate && change.width <= 3 && change.height <= 32 && change.pixels <= 96) {
          alternate = current;
          stable = 0;
        } else {
          reference = current;
          alternate = undefined;
          stable = 0;
        }
        return { settled: stable >= 3, stable, change };
      },
      { intervals: [100], timeout: 10_000 },
    )
    .toMatchObject({ settled: true });
  return current;
}

async function capture(page: Page, info: TestInfo, name: string) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await mkdir('test-results/theme-screenshots', { recursive: true });
  await page.screenshot({
    path: `test-results/theme-screenshots/spn-049-doc-phone-${name}-${info.project.name}.png`,
    fullPage: true,
    animations: 'disabled',
  });
}

for (const role of ['editor', 'guest-viewer'] as const) {
  test(`phone Doc native pan, zoom and ${role} behavior preserve the document`, async ({
    browser,
    page: seed,
    context,
    baseURL,
  }, info) => {
    test.setTimeout(150_000);
    const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
    const auth = new AuthStore(db),
      store = new WorkspaceStore(auth);
    const owner = auth.createUser('Private phone Doc owner');
    const item = store.create(owner.id, {
      name: 'Phone reading and navigation',
      kind: 'doc',
      parentId: null,
    });
    await context.addCookies([
      {
        name: COOKIE_NAME,
        value: auth.createSession(owner.id).token,
        url: baseURL!.replace('http:', 'https:'),
        secure: true,
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
    const read = async () => {
      const response = await context.request.get(`/api/items/${item.id}/doc`);
      expect(response.status()).toBe(200);
      return (await response.json()).snapshot;
    };
    const guest =
      role === 'guest-viewer'
        ? await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } })
        : undefined;
    const page = guest ? await guest.newPage() : seed;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      // Seed through the real editor; the viewer subsequently opens populated
      // content, rather than proving only that a blank canvas can be resized.
      await seed.setViewportSize({ width: 1440, height: 1000 });
      await seed.goto(`/?item=${item.id}`);
      await expect(seed.getByRole('status', { name: 'Save status' })).toHaveText(
        'All changes saved.',
        { timeout: 30_000 },
      );
      await seed.locator('.univer-container').click({ position: { x: 130, y: 200 } });
      await expect(seed.locator('[contenteditable="true"][data-u-comp="editor"]')).toBeFocused();
      const paragraphs = Array.from(
        { length: 16 },
        (_, index) =>
          `Line ${index + 1}: Read the whole paragraph, including the far right edge. ` +
          'Keep the original page size and all of this text when navigating.',
      );
      for (const [index, paragraph] of paragraphs.entries()) {
        if (index > 0) await seed.keyboard.press('Enter');
        await seed.keyboard.type(paragraph);
      }
      // The visible native text can precede room acknowledgement and the
      // recovery-cache flush. Observe that lifecycle before reading its saved
      // snapshot; this seed is not a per-keystroke latency measurement.
      await expect(seed.getByRole('status', { name: 'Save status' })).toHaveText(
        'All changes saved.',
        { timeout: 30_000 },
      );
      // As in the collaboration tests, the first API read may cold-materialize
      // the native snapshot. Require every paragraph, not just the final marker.
      await expect
        .poll(async () => (await read()).body.dataStream, { timeout: 30_000 })
        .toBe(paragraphs.join('\r') + '\r\n');
      const original = await read();
      let expectedText: string = original.body.dataStream;
      let expectedBody = original.body;
      if (guest) {
        const link = await context.request.put(`/api/items/${item.id}/link`, {
          headers: { Origin: baseURL! },
          data: { role: 'viewer' },
        });
        expect(link.status()).toBe(200);
        await page.goto((await link.json()).url);
        await seed.close();
      } else {
        await page.setViewportSize({ width: 390, height: 844 });
      }
      const editor = page.getByRole('region', { name: 'Doc document', exact: true });
      await expect(page.getByRole('status', { name: 'Connection status', exact: true })).toHaveText(
        'Online',
        { timeout: 30_000 },
      );
      await page.getByRole('button', { name: 'Enter theatre mode', exact: true }).click();
      const exit = page.getByRole('button', { name: 'Exit theatre mode', exact: true });
      expect(await page.evaluate(() => devicePixelRatio)).toBe(1);
      const canvas = editor.locator('canvas').first();
      const mounted = await canvas.elementHandle();
      expect(mounted).not.toBeNull();
      const zoom = editor.getByRole('textbox', { name: 'Zoom', exact: true });
      const nativeBox = editor.locator('.univer-container');
      const setZoom = async (percent: number) => {
        await expect(zoom).toBeVisible();
        const displayed = await zoom.inputValue();
        expect(displayed).toMatch(/^\d+%$/);
        // Native focus changes the controlled value from e.g. '100%' to '100'.
        // Let that transition finish before selecting/replacing the input text.
        await zoom.click();
        await expect(zoom).toBeFocused();
        await expect(zoom).toHaveValue(displayed.slice(0, -1));
        await zoom.fill(String(percent));
        await expect(zoom).toHaveValue(String(percent));
        await zoom.press('Enter');
        await expect(zoom).toHaveValue(`${percent}%`);
        await exit.focus(); // Blur native input before every pixel comparison.
      };
      const pan = async (x: number, y: number) => {
        const box = await canvas.boundingBox();
        expect(box).not.toBeNull();
        await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
        await page.mouse.wheel(x, y);
      };
      for (const theme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await nativeTheme(page, canvas, theme);
        await setZoom(100);
        await pan(-10_000, -10_000);
        await settledCanvas(canvas);
        await capture(page, info, `${role}-${theme}-native-100`);
        let before = await settledCanvas(canvas);
        await pan(220, 0);
        await renderedChange(canvas, before);
        await capture(page, info, `${role}-${theme}-pan-right`);
        before = await settledCanvas(canvas);
        await pan(0, 300);
        await renderedChange(canvas, before);
        await capture(page, info, `${role}-${theme}-pan-down`);
        // Return gestures must also move actual content, not merely dispatch input.
        before = await settledCanvas(canvas);
        await pan(-10_000, -10_000);
        await renderedChange(canvas, before);
        before = await settledCanvas(canvas);
        await setZoom(50);
        await renderedChange(canvas, before);
        await capture(page, info, `${role}-${theme}-native-50`);
        before = await settledCanvas(canvas);
        await setZoom(100);
        await renderedChange(canvas, before);
        await capture(page, info, `${role}-${theme}-native-100-restored`);
        expect(await mounted!.evaluate((node) => node.isConnected)).toBe(true);
        expect(await canvas.evaluate((node) => getComputedStyle(node).transform)).toBe('none');
        const unchanged = await read();
        expect(unchanged.body).toEqual(expectedBody);
        expect(unchanged.documentStyle).toEqual(original.documentStyle);

        if (role === 'editor') {
          await expect(editor.getByRole('button', { name: 'Bold', exact: true })).toBeEnabled();
          await nativeBox.click({ position: { x: 130, y: 200 } });
          // Zoom comparisons leave focus on Exit theatre. Verify that the canvas
          // click returned keyboard input to this document before the shortcut.
          await expect(
            editor.locator('[contenteditable="true"][data-u-comp="editor"]'),
          ).toBeFocused();
          await page.keyboard.press('Control+Home');
          const input = await page.evaluateHandle(() => document.activeElement as HTMLElement);
          expect(await input.evaluate((node) => node.isContentEditable)).toBe(true);
          const caretInView = async (phase: 'start' | 'end') => {
            // The OSS selection renderer positions this native input host at its
            // canvas caret anchor. Geometry is an assertion, not a substitute for
            // reviewing the captured, actually rendered caret and readable text.
            let lastGeometry: unknown;
            try {
              await expect
                .poll(async () => {
                  const geometry = await input.evaluate((node) => {
                    const host = node.closest('[id^="univer-doc-selection-container-"]');
                    const box = host?.getBoundingClientRect();
                    const active = document.activeElement;
                    return {
                      connected: node.isConnected,
                      focused: active === node,
                      active: active
                        ? {
                            tag: active.tagName,
                            role: active.getAttribute('role'),
                            component: active.getAttribute('data-u-comp'),
                          }
                        : null,
                      anchor: box ? { x: box.x, y: box.y } : null,
                    };
                  });
                  const bounds = await canvas.boundingBox();
                  lastGeometry = { ...geometry, bounds };
                  const { anchor } = geometry;
                  return (
                    !!anchor &&
                    !!bounds &&
                    anchor.x >= bounds.x &&
                    anchor.y >= bounds.y &&
                    anchor.x < bounds.x + bounds.width &&
                    anchor.y < bounds.y + bounds.height
                  );
                })
                .toBe(true);
            } catch (error) {
              console.info(
                'Phone Doc caret geometry:',
                JSON.stringify({ theme, phase, lastGeometry }),
              );
              throw error;
            }
          };
          await caretInView('start');
          await capture(page, info, `${role}-${theme}-caret-start`);
          const prefix = `${theme} start `;
          await page.keyboard.type(prefix);
          expectedText = prefix + expectedText;
          await expect.poll(async () => (await read()).body.dataStream).toBe(expectedText);
          await page.keyboard.press('Control+End');
          await caretInView('end');
          await capture(page, info, `${role}-${theme}-caret-end`);
          const suffix = ` ${theme} end`;
          await page.keyboard.type(suffix);
          expectedText = expectedText.slice(0, -2) + suffix + '\r\n';
          await expect.poll(async () => (await read()).body.dataStream).toBe(expectedText);
          await expect(page.getByRole('status', { name: 'Save status' })).toHaveText(
            'All changes saved.',
          );
          expectedBody = (await read()).body;
          await input.dispose();
        } else {
          await expect(editor.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled();
          await nativeBox.click({ position: { x: 130, y: 200 } });
          await page.keyboard.type('FORBIDDEN VIEWER EDIT');
          await exit.focus();
          await capture(page, info, `${role}-${theme}-read-only`);
          expect((await read()).body).toEqual(original.body);
          for (const name of ['Document actions', 'Versions', 'Download Univer file']) {
            await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
          }
          await expect(page.getByRole('link', { name: 'Your profile', exact: true })).toHaveCount(
            0,
          );
        }
      }
      await exit.click();
      await page.getByRole('button', { name: 'Enter theatre mode', exact: true }).click();
      expect(await mounted!.evaluate((node) => node.isConnected)).toBe(true);
      await expect(zoom).toHaveValue('100%');
      const final = await read();
      expect(final.body).toEqual(expectedBody);
      expect(final.documentStyle).toEqual(original.documentStyle);
      await page.reload();
      await expect(page.getByRole('status', { name: 'Connection status', exact: true })).toHaveText(
        'Online',
        { timeout: 30_000 },
      );
      await expect(zoom).toHaveValue('100%');
      expect((await read()).body).toEqual(expectedBody);
      expect(errors).toEqual([]);
    } finally {
      await guest?.close();
      db.close();
    }
  });
}
