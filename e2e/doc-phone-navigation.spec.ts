import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { expect, test } from '@playwright/test';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { nativeTheme } from './native-theme.ts';

// Keep the original failing attempt; this fixture has no per-keystroke latency assertion.
test.use({ trace: 'retain-on-failure' });

async function nativeSelectionEvidence(page: Page) {
  return page.evaluate(() => {
    let native: unknown = null;
    const observe = (event: Event) => {
      native = (event as CustomEvent<unknown>).detail;
    };
    window.addEventListener('spinel-doc-selection-evidence', observe);
    window.dispatchEvent(new Event('spinel-doc-selection-read'));
    window.removeEventListener('spinel-doc-selection-evidence', observe);
    const active = document.activeElement;
    const inputHost = active?.closest('[id^="univer-doc-selection-container-"]');
    const nativeBox = document.querySelector(
      '.sheet-editor[aria-label="Doc document"] .univer-container',
    );
    const box = nativeBox?.getBoundingClientRect();
    const point =
      box && nativeBox
        ? { x: box.x + nativeBox.clientLeft + 130, y: box.y + nativeBox.clientTop + 200 }
        : null;
    const hit = point ? document.elementFromPoint(point.x, point.y) : null;
    const describe = (node: Element | null | undefined) =>
      node ? { tag: node.tagName, id: node.id, component: node.getAttribute('data-u-comp') } : null;
    return {
      native,
      active: describe(active),
      inputHost: inputHost?.getBoundingClientRect().toJSON() ?? null,
      nativeBox: box?.toJSON() ?? null,
      clickPoint: point,
      clickTarget: describe(hit),
      coarsePointer: matchMedia('(pointer: coarse)').matches,
    };
  });
}

// These retain desktop-preset wheel coverage at phone width. doc-mobile.spec.ts
// separately exercises the coarse-pointer preset with browser touch input.
// Physical-device touch, keyboard, and IME checks remain unrun under the owner's
// browser-only acceptance.
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

/** Observe only DOM geometry/input ownership; never record authored text or URLs. */
async function traceCaret(nativeBox: Locator) {
  return nativeBox.evaluateHandle((root) => {
    const input = root.querySelector('[contenteditable="true"][data-u-comp="editor"]');
    const host = input?.closest('[id^="univer-doc-selection-container-"]') as HTMLElement | null;
    const canvas = root.querySelector('canvas');
    const events: unknown[] = [];
    const started = performance.now();
    const target = (node: EventTarget | null) => {
      if (node === input) return 'native-input';
      if (node instanceof Element) return node.tagName.toLowerCase();
      return null;
    };
    const bounds = (node: Element | null | undefined) => {
      if (!node) return null;
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    };
    const record = (event: string, detail?: unknown) => {
      events.push({
        time: Math.round(performance.now() - started),
        event,
        detail,
        host: bounds(host),
        style: host ? { left: host.style.left, top: host.style.top } : null,
        canvas: bounds(canvas),
        connected: input?.isConnected ?? false,
        focused: document.activeElement === input,
        active: target(document.activeElement),
      });
      if (events.length > 120) events.shift();
    };
    const observer = new MutationObserver(() => record('host-style'));
    if (host) observer.observe(host, { attributes: true, attributeFilter: ['style'] });
    const observe = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (!['Home', 'End', 'Enter', 'Control'].includes(event.key)) return;
        record(event.type, { key: event.key, target: target(event.target) });
      } else if (event instanceof PointerEvent)
        record(event.type, { x: event.clientX, y: event.clientY, target: target(event.target) });
      else record(event.type, { target: target(event.target) });
    };
    const types = ['keydown', 'keyup', 'pointerdown', 'pointerup', 'focusin', 'focusout'];
    for (const type of types)
      document.addEventListener(type, observe, { capture: true, passive: true });
    record('start');
    return () => {
      record('stop');
      observer.disconnect();
      for (const type of types) document.removeEventListener(type, observe, true);
      return events;
    };
  });
}

for (const role of ['editor', 'guest-viewer'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`phone Doc ${theme} native pan, zoom and ${role} behavior preserve the document`, async ({
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
      let caretTrace: Awaited<ReturnType<typeof traceCaret>> | undefined;
      let caretEvents: unknown[] = [];
      const finishCaretTrace = async () => {
        if (!caretTrace) return;
        const trace = caretTrace;
        caretTrace = undefined;
        caretEvents = await trace.evaluate((stop) => stop()).catch(() => caretEvents);
        await trace.dispose().catch(() => {});
      };
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
          // Seed through real native input without thousands of unrelated layout
          // cycles. The short caret edits below still exercise individual keys.
          await seed.keyboard.insertText(paragraph);
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
        await expect(
          page.getByRole('status', { name: 'Connection status', exact: true }),
        ).toHaveText('Online', { timeout: 30_000 });
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
        caretTrace = await traceCaret(nativeBox);
        await setZoom(100);
        await renderedChange(canvas, before);
        // A first changed raster is not proof that native zoom/layout finished.
        // Establish the same settled surface used before every earlier gesture.
        await settledCanvas(canvas);
        await capture(page, info, `${role}-${theme}-native-100-restored`);
        expect(await mounted!.evaluate((node) => node.isConnected)).toBe(true);
        expect(await canvas.evaluate((node) => getComputedStyle(node).transform)).toBe('none');
        const unchanged = await read();
        expect(unchanged.body).toEqual(expectedBody);
        expect(unchanged.documentStyle).toEqual(original.documentStyle);

        if (role === 'editor') {
          const nativeEvidence: Array<{ phase: string; state: unknown }> = [];
          const observeNative = async (phase: string) => {
            nativeEvidence.push({ phase, state: await nativeSelectionEvidence(page) });
          };
          await expect(editor.getByRole('button', { name: 'Bold', exact: true })).toBeEnabled();
          await observeNative('before-click');
          await nativeBox.click({ position: { x: 130, y: 200 } });
          await observeNative('after-click');
          // Zoom comparisons leave focus on Exit theatre. Verify that the canvas
          // click returned keyboard input to this document before the shortcut.
          await expect(
            editor.locator('[contenteditable="true"][data-u-comp="editor"]'),
          ).toBeFocused();
          const input = await page.evaluateHandle(() => document.activeElement as HTMLElement);
          expect(await input.evaluate((node) => node.isContentEditable)).toBe(true);
          const caretInView = async (phase: 'clicked' | 'start' | 'end') => {
            // The OSS selection renderer positions this native input host at its
            // canvas caret anchor. Geometry is an assertion, not a substitute for
            // reviewing the captured, actually rendered caret and readable text.
            let lastGeometry: unknown;
            let previous = '';
            let stable = 0;
            try {
              await expect
                .poll(
                  async () => {
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
                    const { anchor } = geometry;
                    const inView =
                      geometry.connected &&
                      geometry.focused &&
                      !!anchor &&
                      !!bounds &&
                      anchor.x >= bounds.x &&
                      anchor.y >= bounds.y &&
                      anchor.x < bounds.x + bounds.width &&
                      anchor.y < bounds.y + bounds.height;
                    const current = JSON.stringify({ anchor, bounds });
                    stable = inView ? (current === previous ? stable + 1 : 1) : 0;
                    previous = current;
                    lastGeometry = { ...geometry, bounds, stable };
                    // The native host can briefly enter the viewport before a
                    // queued selection refresh resets it. Require stable samples.
                    return stable >= 3;
                  },
                  { intervals: [100] },
                )
                .toBe(true);
            } catch (error) {
              await observeNative(`caret-${phase}-failure`);
              const diagnostic = { theme, phase, lastGeometry, nativeEvidence };
              const body = JSON.stringify(diagnostic, null, 2);
              await writeFile(info.outputPath('phone-doc-selection-evidence.json'), body);
              console.info('Phone Doc caret geometry:', body);
              throw error;
            }
          };
          // Focus alone can precede a real native caret. Establish that the
          // click completed before issuing the one navigation shortcut.
          await caretInView('clicked');
          await page.keyboard.press('Control+Home');
          await observeNative('after-home');
          await caretInView('start');
          await capture(page, info, `${role}-${theme}-caret-start`);
          const prefix = `${theme} start `;
          await page.keyboard.type(prefix);
          expectedText = prefix + expectedText;
          await expect.poll(async () => (await read()).body.dataStream).toBe(expectedText);
          await page.keyboard.press('Control+End');
          await observeNative('after-end');
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
        await finishCaretTrace();
        await exit.click();
        await page.getByRole('button', { name: 'Enter theatre mode', exact: true }).click();
        expect(await mounted!.evaluate((node) => node.isConnected)).toBe(true);
        await expect(zoom).toHaveValue('100%');
        const final = await read();
        expect(final.body).toEqual(expectedBody);
        expect(final.documentStyle).toEqual(original.documentStyle);
        await page.reload();
        await expect(
          page.getByRole('status', { name: 'Connection status', exact: true }),
        ).toHaveText('Online', { timeout: 30_000 });
        await expect(zoom).toHaveValue('100%');
        expect((await read()).body).toEqual(expectedBody);
        expect(errors).toEqual([]);
      } catch (error) {
        await finishCaretTrace();
        if (caretEvents.length) {
          const diagnostic = JSON.stringify({ role, theme, events: caretEvents });
          console.info('Phone Doc caret events:', diagnostic);
          try {
            await mkdir(info.outputPath(), { recursive: true });
            const path = info.outputPath('phone-doc-caret-events.json');
            await writeFile(path, diagnostic);
            await info.attach('phone-doc-caret-events', {
              path,
              contentType: 'application/json',
            });
          } catch {
            // Preserve the original assertion failure if diagnostics cannot save.
          }
        }
        throw error;
      } finally {
        await finishCaretTrace();
        await guest?.close();
        db.close();
      }
    });
  }
}
