/** Review built stories. --no-screenshots keeps every check and failure diagnostic; desktop/mobile may split --theme. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { preview } from 'vite';
import { chromium, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { selectStorybookReview } from './ci/storybook-review.ts';

if (
  process.platform === 'darwin' &&
  execFileSync('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], {
    encoding: 'utf8',
  }).trim() !== '1'
) {
  throw new Error('Memory pressure is elevated. Capture in CI per decision #52.');
}
const index = JSON.parse(await readFile('storybook-static/index.json', 'utf8')) as {
  entries: Record<string, { type: string; title: string; name: string }>;
};
const review = selectStorybookReview(process.argv.slice(2), index.entries);
const { requested, variants } = review;
const startedAt = Date.now();
const directory = resolve(process.env.SPINEL_SCREENSHOT_DIR ?? 'test-results/design-review');
await mkdir(directory, { recursive: true });
const server = await preview({
  configFile: false,
  root: resolve('storybook-static'),
  build: { outDir: '.' },
  preview: { host: '127.0.0.1', port: 6007, strictPort: true },
});
const browser = await chromium.launch();
const captures: { id: string; variant: string; filename: string; title: string }[] = [];
const verifications: string[] = [];
const checked: { id: string; variant: string }[] = [];
const nativeFailures: unknown[] = [];
const captureFailures: { id: string; variant: string; message: string; filename?: string }[] = [];
try {
  for (const kind of review.nativeEditorKinds) {
    for (const readOnly of [false, true]) {
      const id = `redesign-native-editors--${kind}${readOnly ? '-viewer' : ''}`;
      if (!requested.includes(id)) continue;
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      try {
        await page.goto(
          `http://127.0.0.1:6007/iframe.html?id=${id}&viewMode=story&globals=theme:light`,
        );
        await expect(page.locator('.rd-native-editor')).toBeVisible();
        await waitForNativeEditor(page);
        await page.getByText('Native editor review controls', { exact: true }).click();
        const observation = page.locator('output[data-native-snapshot]');
        await expect(observation).not.toBeEmpty();
        const read = async () => {
          await page.getByRole('button', { name: 'Read current snapshot', exact: true }).click();
          return JSON.parse((await observation.textContent())!) as {
            canEdit: boolean;
            snapshot: {
              body?: { dataStream: string };
              sheets?: Record<
                string,
                { cellData?: Record<number, Record<number, { v?: unknown }>> }
              >;
            };
          };
        };
        const beforeEdit = await read();
        expect(beforeEdit.canEdit, `${kind} native permission`).toBe(!readOnly);
        const editor = page.locator('.rd-native-editor');
        if (readOnly) {
          // Attempt normal canvas input, then inspect saved content via the public facade.
          await editor
            .locator(
              `canvas[aria-label="${kind === 'sheet' ? 'Spreadsheet grid' : 'Document canvas'}"]`,
            )
            .click({ position: { x: 130, y: 160 } });
        } else if (kind === 'sheet') {
          // Use the production Sheet test's visible name-box path, not an auxiliary
          // contenteditable (the formula input is not the active cell editor).
          const nameBox = editor.locator('[data-u-comp="defined-name"] input');
          await nameBox.fill('A16');
          await nameBox.press('Enter');
        } else {
          await page.getByRole('button', { name: 'Select document start', exact: true }).click();
          await editor.locator('[contenteditable="true"][data-u-comp="editor"]').first().focus();
        }
        const marker = 'Native keyboard proof';
        await page.keyboard.type(marker);
        if (kind === 'sheet') await page.keyboard.press('Enter');
        try {
          if (readOnly) expect((await read()).snapshot).toEqual(beforeEdit.snapshot);
          else
            await expect
              .poll(async () => {
                const current = await read();
                return kind === 'sheet'
                  ? current.snapshot.sheets?.october.cellData?.[15]?.[0]?.v
                  : current.snapshot.body?.dataStream;
              })
              .toContain(marker);
        } catch (error) {
          await read();
          await writeFile(
            resolve(directory, `native-${kind}-input-failure.json`),
            (await observation.textContent()) ?? '',
          );
          await page.screenshot({ path: resolve(directory, `native-${kind}-input-failure.png`) });
          nativeFailures.push(error);
          continue;
        }

        await page.locator('.rd-native-review-tools summary').click();
        await captureScreenshot(page, {
          path: resolve(directory, `native-${kind}-${readOnly ? 'viewer' : 'edited'}.png`),
        });
        verifications.push(
          `${kind}: native ${readOnly ? 'viewer rejects keyboard edits' : 'keyboard edit saved in local snapshot'}`,
        );
      } catch (error) {
        await recordCaptureFailure(page, id, 'native-input', error);
      } finally {
        await page.close();
      }
    }
  }
  for (const [theme, width, variant] of variants) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      isMobile: width === 390,
      hasTouch: width <= 768,
      reducedMotion: 'reduce',
      colorScheme: theme,
    });
    // Keep a reproducible date while allowing Univer's Date.now-based debounce to progress.
    await page.clock.setSystemTime(new Date('2026-10-20T16:00:00Z'));
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const id of requested) {
      console.log(`Review ${variant}: ${id}`);
      try {
        errors.length = 0;
        // A failed short-viewport check must not make the next story compare
        // the same 600px height against itself instead of exercising a resize.
        await page.setViewportSize({ width, height: 900 });
        await page.goto(
          `http://127.0.0.1:6007/iframe.html?id=${id}&viewMode=story&globals=theme:${theme}`,
        );
        await waitForStory(page, id);
        if (id.startsWith('docs-native-formulas--')) {
          // The component's dynamic viewer can still be booting after Storybook
          // finishes its synchronous render. Capture the native result, not its skeleton.
          const document = page.getByRole('region', {
            name: 'Native formula document',
            exact: true,
          });
          await expect(document).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
          await expect(document.getByRole('alert')).toHaveCount(0);
          await expect(document.getByText('Formula results (2)', { exact: true })).toBeVisible();
          await expect(document.locator('canvas').first()).toBeVisible();
          verifications.push(`${variant}: ${id} native formula viewer settled before capture`);
        }
        if (id.startsWith('redesign-')) {
          await expect(page.locator('.sp-ui, .rd-native-editor').first()).toBeVisible();
          await waitForNativeEditor(page);
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth + 1,
            ),
            `Page overflow: ${id} ${variant}`,
          ).toBe(true);
        }
        if (id.startsWith('redesign-') && width <= 768) {
          const smallTargets = await page
            .locator(
              '.sp-ui button, .sp-ui input:not([type=radio]), .sp-ui summary, .sp-ui [role=radio], .sp-ui .sp-segment',
            )
            .evaluateAll((nodes) =>
              nodes.flatMap((node) => {
                // Univer owns its toolbar targets; these assertions cover Spinel chrome.
                if (node.closest('[aria-hidden="true"], .rd-native-editor')) return [];
                const box = node.getBoundingClientRect();
                if (!box.width || !box.height) return [];
                return box.height < 43.5 || box.width < 43.5
                  ? [
                      {
                        label: node.getAttribute('aria-label') || node.textContent?.trim(),
                        width: box.width,
                        height: box.height,
                      },
                    ]
                  : [];
              }),
            );
          expect(smallTargets, `Touch targets: ${id} ${variant}`).toEqual([]);
          // A negative left edge can clip rail controls without increasing scrollWidth.
          const clippedControls = await page
            .locator('.rd-rail .sp-segment, .rd-rail button')
            .evaluateAll((nodes) =>
              nodes.flatMap((node) => {
                const box = node.getBoundingClientRect();
                if (!box.width || !box.height || node.closest('[aria-hidden="true"]')) return [];
                return box.left < -1 || box.right > window.innerWidth + 1
                  ? [node.getAttribute('aria-label') || node.textContent?.trim()]
                  : [];
              }),
            );
          expect(clippedControls, `Clipped utilities: ${id} ${variant}`).toEqual([]);
        }
        expect(errors, `Runtime errors in ${id}`).toEqual([]);
        const filename = `${id}-${variant}.png`;
        if (
          await captureScreenshot(page, {
            path: resolve(directory, filename),
            fullPage: true,
            animations: 'disabled',
          })
        ) {
          captures.push({
            id,
            variant,
            filename,
            title: `${index.entries[id].title} / ${index.entries[id].name}`,
          });
        }
        checked.push({ id, variant });
      } catch (error) {
        await recordCaptureFailure(page, id, variant, error);
      }
    }
    await page.close();
  }
  if (requested.includes('redesign-controls--default')) {
    for (const [theme, width, variant] of variants) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        hasTouch: width <= 768,
        reducedMotion: 'reduce',
      });
      await page.goto(
        `http://127.0.0.1:6007/iframe.html?id=redesign-controls--default&viewMode=story&globals=theme:${theme}`,
      );
      await verifyControls(page, variant, directory);
      verifications.push(
        `${variant}: menu/selector keyboard navigation, Escape/focus return, dialog containment and nested themed portal`,
      );
      await page.close();
    }
  }
} catch (error) {
  captureFailures.push({
    id: 'interaction-verification',
    variant: 'journey',
    message: String(error).slice(0, 6000),
  });
  console.error(error);
} finally {
  await browser.close();
  await new Promise<void>((done, reject) =>
    server.httpServer.close((error) => (error ? reject(error) : done())),
  );
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
await writeFile(
  resolve(directory, 'manifest.json'),
  JSON.stringify(
    {
      reviewedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      captureScreenshots: review.captureScreenshots,
      fixtureTime: '2026-10-20T16:00:00Z',
      viewport: review.viewport,
      theme: review.theme,
      variants: variants.map(([, , variant]) => variant),
      requested,
      checked,
      captures,
      verifications,
      failures: captureFailures,
    },
    null,
    2,
  ),
);
if (review.captureScreenshots) {
  await writeFile(
    resolve(directory, 'index.html'),
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Spinel design review</title><style>body{font:16px system-ui;margin:32px;background:#fafafa;color:#222}nav{display:flex;gap:16px;flex-wrap:wrap}section{margin:40px 0} .shots{display:flex;gap:16px;overflow:auto;align-items:start}figure{margin:0;flex:0 0 480px}img{width:100%;border:1px solid #ddd}figcaption{padding:12px}a{color:#8a1d3f}</style><h1>Spinel · component review</h1><p>Current production stories render shipped components with local API fixtures. Native fixtures isolate SDK behavior. Redesign contains only proposals owned by the open ticket shown in each title.</p><h2>All states and sizes</h2><nav>${requested.map((id) => `<a href="#${escape(id)}">${escape(index.entries[id].name)}</a>`).join('')}</nav>${requested
      .map(
        (id) =>
          `<section id="${escape(id)}"><h2>${escape(index.entries[id].title)} / ${escape(index.entries[id].name)}</h2><div class="shots">${captures
            .filter((c) => c.id === id)
            .map(
              (c) =>
                `<figure><a href="${escape(c.filename)}"><img loading="lazy" src="${escape(c.filename)}" alt="${escape(c.title + ' · ' + c.variant)}"></a><figcaption>${escape(c.variant)}</figcaption></figure>`,
            )
            .join('')}</div></section>`,
      )
      .join('')}</html>`,
  );
}
// The mockup chunk is isolated from production. Report actual emitted bytes, not npm unpacked size.
const { readdir } = await import('node:fs/promises');
const assets = await readdir('storybook-static/assets');
const bundles = [];
for (const filename of assets.filter(
  (name) => /Controls|Mockups/i.test(name) && name.endsWith('.js'),
)) {
  const bytes = await readFile(resolve('storybook-static/assets', filename));
  bundles.push({ filename, bytes: bytes.length, gzipBytes: gzipSync(bytes).length });
}
await writeFile(resolve(directory, 'bundle-size.json'), JSON.stringify(bundles, null, 2));
// Preserve visual evidence while still failing validation for any native input defect.
if (nativeFailures.length || captureFailures.length)
  throw new AggregateError(
    [
      ...nativeFailures,
      ...captureFailures.map(
        (failure) => new Error(`${failure.id} (${failure.variant}): ${failure.message}`),
      ),
    ],
    'Design review validation failed; see manifest.json and failed-* evidence',
  );
console.log(
  `Checked ${checked.length} story states; captured ${captures.length} catalog/error screenshots in ${directory}; ${verifications.length} additional interaction passes.`,
);

async function captureScreenshot(page: Page, options: Parameters<Page['screenshot']>[0]) {
  if (!review.captureScreenshots) return false;
  await page.screenshot(options);
  return true;
}

async function waitForStory(page: Page, id: string) {
  // Images and intentionally empty components are valid stories. Require
  // the root to exist, then use Storybook's lifecycle rather than text content.
  await expect(page.locator('#storybook-root')).toBeAttached();
  // Many catalogue states are established by a play function (open dialogs,
  // rejected requests, pending mutations). Storybook marks the render finished
  // after those interactions, rather than when the first component appears.
  await page.waitForFunction(() => {
    const preview = (
      window as Window & {
        __STORYBOOK_PREVIEW__?: { currentRender?: { phase?: string } };
      }
    ).__STORYBOOK_PREVIEW__;
    return preview?.currentRender?.phase === 'finished';
  });
  // A failed play function also reaches "finished". Its result must match
  // this story and succeed before a screenshot can count as state evidence.
  await page.waitForFunction((storyId) => {
    const preview = (
      window as Window & {
        __STORYBOOK_PREVIEW__?: {
          channel?: { last: (event: string) => { storyId: string }[] | undefined };
        };
      }
    ).__STORYBOOK_PREVIEW__;
    return preview?.channel?.last('storyFinished')?.[0]?.storyId === storyId;
  }, id);
  const storyResult = await page.evaluate(() => {
    const preview = (
      window as Window & {
        __STORYBOOK_PREVIEW__?: {
          channel?: {
            last: (event: string) => { storyId: string; status: string }[] | undefined;
          };
        };
      }
    ).__STORYBOOK_PREVIEW__;
    return preview?.channel?.last('storyFinished')?.[0];
  });
  expect(storyResult?.storyId).toBe(id);
  expect(storyResult?.status, `${id}: Storybook play must succeed`).toBe('success');
  // Some Storybook versions report finished after swallowing a play error.
  // Each story loads a fresh document, so recorded play exceptions belong here.
  const playErrors = await page.evaluate(() => {
    const channel = (
      window as Window & {
        __STORYBOOK_PREVIEW__?: {
          channel?: { last: (event: string) => unknown[] | undefined };
        };
      }
    ).__STORYBOOK_PREVIEW__?.channel;
    return ['playFunctionThrewException', 'unhandledErrorsWhilePlaying'].flatMap(
      (event) => channel?.last(event) ?? [],
    );
  });
  expect(playErrors, `${id}: no swallowed play exceptions`).toEqual([]);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('.sb-errordisplay')).toBeHidden();
}

async function recordCaptureFailure(page: Page, id: string, variant: string, error: unknown) {
  const message = (error instanceof Error ? (error.stack ?? error.message) : String(error)).slice(
    0,
    6000,
  );
  const filename = `failed-${id}-${variant}.png`;
  console.error(`Capture failed ${variant}: ${id}\n${message}`);
  const evidence = await Promise.allSettled([
    page.screenshot({
      path: resolve(directory, filename),
      fullPage: true,
      animations: 'disabled',
      timeout: 5000,
    }),
    page.locator('body').ariaSnapshot({ timeout: 5000 }),
    page.locator('html').evaluate(
      () => {
        const preview = (
          window as Window & {
            __STORYBOOK_PREVIEW__?: {
              currentRender?: { phase?: string };
              channel?: { last: (event: string) => unknown[] | undefined };
            };
          }
        ).__STORYBOOK_PREVIEW__;
        const finished = preview?.channel?.last('storyFinished')?.[0] as
          { storyId?: unknown; status?: unknown } | undefined;
        const describe = (value: unknown) => {
          if (value instanceof Error) return value.message.slice(0, 1000);
          try {
            return (JSON.stringify(value) ?? String(value)).slice(0, 1000);
          } catch {
            return String(value).slice(0, 1000);
          }
        };
        return {
          phase: String(preview?.currentRender?.phase ?? 'unavailable').slice(0, 100),
          storyFinished: {
            storyId: String(finished?.storyId ?? '').slice(0, 256),
            status: String(finished?.status ?? '').slice(0, 100),
          },
          playErrors: ['playFunctionThrewException', 'unhandledErrorsWhilePlaying'].map((event) => {
            const errors = preview?.channel?.last(event) ?? [];
            return { event, count: errors.length, samples: errors.slice(0, 4).map(describe) };
          }),
        };
      },
      undefined,
      { timeout: 5000 },
    ),
  ]);
  const failure = {
    id,
    variant,
    message,
    ...(evidence[0].status === 'fulfilled' ? { filename } : {}),
  };
  captureFailures.push(failure);
  if (failure.filename)
    captures.push({
      id,
      variant: `${variant} — FAILED`,
      filename,
      title: `Failed capture: ${index.entries[id]?.title ?? id}`,
    });
  await writeFile(
    resolve(directory, `failed-${id}-${variant}.json`),
    JSON.stringify(
      {
        ...failure,
        storybook:
          evidence[2].status === 'fulfilled'
            ? evidence[2].value
            : String(evidence[2].reason).slice(0, 1000),
        accessibility:
          evidence[1].status === 'fulfilled'
            ? evidence[1].value.slice(0, 16000)
            : String(evidence[1].reason).slice(0, 1000),
      },
      null,
      2,
    ),
  );
}

async function waitForNativeEditor(page: Page) {
  const editor = page.locator('.rd-native-editor:visible');
  // The connected editor loads lazily; its visible slot precedes the native host.
  if ((await page.locator('.rd-live-editor:visible').count()) || (await editor.count())) {
    try {
      await expect(editor).toBeVisible();
      await expect(editor).toHaveAttribute('data-native-ready', 'true', { timeout: 35_000 });
      const layout = editor.locator('[data-u-comp="app-layout"], [data-u-comp="workbench-layout"]');
      await expect(layout).toHaveCount(1);
      await expect
        .poll(
          async () => {
            const bounds = await layout.boundingBox();
            const host = await editor.locator('.rd-native-host').boundingBox();
            return bounds && host ? Math.abs(bounds.height - host.height) : Infinity;
          },
          { message: 'Native workbench fills its host after surrounding chrome changes' },
        )
        .toBeLessThanOrEqual(1);
      const canvas = editor.locator('canvas[aria-label]');
      await expect(canvas).toBeVisible();
      await expect(editor.locator('[data-u-comp="workbench-skeleton-toolbar"]')).toBeHidden();
      // Ready can precede the SDK's two-frame skeleton dismissal and idle resize.
      // Match its public DOM mount dimensions before taking a baseline or capture.
      await expect
        .poll(() =>
          canvas.evaluate((node) => {
            const parent = getComputedStyle(node.parentElement!);
            const box = node.getBoundingClientRect();
            return (
              Math.abs(box.width - parseFloat(parent.width)) <= 1 &&
              Math.abs(box.height - parseFloat(parent.height)) <= 1
            );
          }),
        )
        .toBe(true);
    } catch (error) {
      const id = new URL(page.url()).searchParams.get('id') ?? 'unknown';
      await page.screenshot({ path: resolve(directory, `failed-native-${id}.png`) });
      throw new Error(`Native readiness failed for ${page.url()}: ${await editor.innerText()}`, {
        cause: error,
      });
    }
  }
}

async function verifyControls(page: Page, variant: string, output: string) {
  const menu = page.getByRole('button', { name: 'File actions', exact: true });
  await menu.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await captureScreenshot(page, { path: resolve(output, `menu-open-${variant}.png`) });
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Move', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  const select = page.getByRole('combobox', { name: 'File type', exact: true });
  await select.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('listbox')).toBeVisible();
  await expect(page.getByRole('option', { name: 'Doc', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('option', { name: 'Space', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(select).toContainText('Space');
  const appearance = page.getByRole('radiogroup', { name: 'Appearance', exact: true });
  await appearance.getByRole('radio', { name: 'Follow system', exact: true }).click();
  await page.keyboard.press('ArrowRight');
  await expect(appearance.getByRole('radio', { name: 'Light', exact: true })).toBeChecked();
  await page.keyboard.press('ArrowRight');
  await expect(appearance.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
  await captureScreenshot(page, { path: resolve(output, `appearance-choice-${variant}.png`) });
  const trigger = page.getByRole('button', { name: 'Open confirmation' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Move this file?' });
  await expect(dialog).toBeVisible();
  await page.getByRole('combobox', { name: 'Destination folder' }).click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await expect(page.getByRole('listbox')).toHaveCSS(
    'color',
    await dialog.evaluate((node) => getComputedStyle(node).color),
  );
  await captureScreenshot(page, { path: resolve(output, `dialog-select-open-${variant}.png`) });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Destination folder' })).toBeFocused();
  for (const key of ['Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    await expect
      .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)), {
        message: 'Modal keeps keyboard focus inside after its focus guard settles',
      })
      .toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await writeFile(
    resolve(output, `controls-semantics-${variant}.txt`),
    await page.locator('#storybook-root').ariaSnapshot(),
  );
}
