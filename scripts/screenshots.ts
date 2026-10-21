/** npm run screenshots -- <story ids>. Build Storybook first; one browser, one page at a time. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { preview } from 'vite';
import { chromium, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

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
const args = process.argv.slice(2);
const requested = args.length
  ? args
  : Object.keys(index.entries).filter((id) => index.entries[id].type === 'story');
for (const id of requested)
  if (index.entries[id]?.type !== 'story') throw new Error(`Unknown story: ${id}`);
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
const nativeFailures: unknown[] = [];
const captureFailures: { id: string; variant: string; message: string; filename?: string }[] = [];
const variants = [
  ['light', 1280, 'light'],
  ['dark', 1280, 'dark'],
  ['light', 390, 'phone'],
  ['dark', 390, 'phone-dark'],
  ['light', 768, 'tablet'],
] as const;
try {
  for (const kind of ['sheet', 'doc'] as const) {
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
        await page.screenshot({
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
      console.log(`Capture ${variant}: ${id}`);
      try {
        errors.length = 0;
        await page.goto(
          `http://127.0.0.1:6007/iframe.html?id=${id}&viewMode=story&globals=theme:${theme}`,
        );
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
        if (id === 'redesign-walkthrough--operator-help')
          await expect(page.getByText('npm run setup', { exact: true })).toBeVisible();
        if (id === 'redesign-screens--file-icon-hint')
          await expect(
            page.getByText(
              'Custom file icons are planned. This default icon comes from the file name.',
              { exact: true },
            ),
          ).toBeVisible();
        if (id === 'redesign-screens--history-naming')
          await expect(
            page.getByRole('dialog', { name: 'Name this version', exact: true }),
          ).toBeVisible();
        if (id === 'redesign-screens--profile-icon-picker')
          await expect(
            page.getByRole('dialog', { name: 'Choose your icon', exact: true }),
          ).toBeVisible();
        if (id === 'redesign-screens--profile-color-picker')
          await expect(
            page.getByRole('dialog', { name: 'Choose your profile color', exact: true }),
          ).toBeVisible();
        if (id === 'redesign-screens--dashboard-new-menu') {
          await expect(page.getByRole('menu', { name: 'New file', exact: true })).toBeVisible();
        }
        if (id === 'redesign-screens--filtered-no-matches') {
          await expect(
            page.getByRole('combobox', { name: 'Last modified', exact: true }),
          ).toContainText('Today');
          await expect(
            page.getByRole('textbox', { name: 'Search files', exact: true }),
          ).toHaveValue('');
          await expect(
            page.getByRole('heading', { name: 'No matching files', exact: true }),
          ).toBeVisible();
          await expect(
            page.getByRole('heading', { name: 'Room for your next idea', exact: true }),
          ).toHaveCount(0);
        }
        if (
          ['history-unsaved', 'history-saving', 'history-offline'].some(
            (state) => id === `redesign-screens--${state}`,
          )
        ) {
          await expect(
            page.getByRole('button', { name: 'Restore this version…', exact: true }),
          ).toBeDisabled();
          await expect(
            page.getByRole('button', { name: 'Name current version…', exact: true }),
          ).toBeDisabled();
          await expect(
            page.getByRole('status').filter({
              hasText: id.endsWith('-offline')
                ? 'Reconnect before naming or restoring a version.'
                : 'Save your latest changes before naming the current version or restoring. Older version names can still be changed.',
            }),
          ).toBeVisible();
          verifications.push(`${variant}: ${id} explains why naming and restore are disabled`);
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
        if (
          [
            'redesign-walkthrough--sheet',
            'redesign-walkthrough--doc',
            'redesign-walkthrough--sheet-full-editor',
            'redesign-walkthrough--doc-full-editor',
            'redesign-native-editors--sheet',
            'redesign-native-editors--doc',
          ].includes(id)
        ) {
          const testHeight = width === 390 ? 600 : 900;
          await page.setViewportSize({ width, height: testHeight });
          const editor = page.locator('.rd-native-editor');
          // Responsive Sheets replaces the ribbon with a compact row of buttons
          // (no toolbar role). Its Paint format button anchors that same row.
          const compactSheet = id.includes('--sheet') && width <= 768;
          const toolbar = compactSheet
            ? editor.getByRole('button', { name: 'Paint format', exact: true })
            : editor.getByRole('toolbar', { name: 'Start', exact: true });
          if (compactSheet) {
            await expect(
              editor.getByRole('button', { name: 'Clear All', exact: true }),
            ).toBeVisible();
            await expect(editor.getByRole('button', { name: 'More', exact: true })).toBeVisible();
          }
          await expect(toolbar).toBeVisible();
          const before = await toolbar.boundingBox();
          expect(before).not.toBeNull();
          const frame = await editor.boundingBox();
          expect(frame).not.toBeNull();
          expect(
            frame!.y + frame!.height,
            'Native editor fits below site chrome',
          ).toBeLessThanOrEqual(testHeight + 1);
          const layout = editor.locator(
            '[data-u-comp="app-layout"], [data-u-comp="workbench-layout"]',
          );
          await expect(layout).toHaveCount(1);
          await expect
            .poll(
              async () => {
                const bounds = await layout.boundingBox();
                const host = await editor.boundingBox();
                return bounds && host
                  ? bounds.y + bounds.height - (host.y + host.height)
                  : Infinity;
              },
              { message: 'Native workbench stays inside its resized host before pointer input' },
            )
            .toBeLessThanOrEqual(1);
          await editor.locator('canvas[aria-label]').hover();
          await page.mouse.wheel(0, 600);
          await page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              ),
          );
          await expect.poll(async () => (await toolbar.boundingBox())?.y).toBe(before!.y);
          expect(await page.evaluate(() => window.scrollY), 'Only editor content scrolls').toBe(0);
          await expect(toolbar).toBeInViewport();
          if (width === 390) {
            await page.screenshot({
              path: resolve(directory, `${id}-${variant}-short-scrolled.png`),
            });
          }
          await page.setViewportSize({ width, height: 900 });
          verifications.push(
            `${variant}: ${id} native toolbar remains visible after content scroll`,
          );
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
        await page.screenshot({
          path: resolve(directory, filename),
          fullPage: true,
          animations: 'disabled',
        });
        captures.push({
          id,
          variant,
          filename,
          title: `${index.entries[id].title} / ${index.entries[id].name}`,
        });
        if (id === 'redesign-screens--empty-folder') {
          await page.getByRole('button', { name: 'New file', exact: true }).click();
          await page.getByRole('menuitem', { name: 'Doc', exact: true }).click();
          await page.getByRole('textbox', { name: 'Name', exact: true }).fill('First note');
          await page.getByRole('button', { name: 'Create Doc', exact: true }).click();
          await expect(
            page.locator('.rd-file-open').filter({ hasText: 'First note' }),
          ).toBeVisible();
          verifications.push(`${variant}: creating a document replaces the empty file state`);
        }
        if (id === 'redesign-editor-recovery--offline-save-failed') {
          const saveStatus = page.getByRole('status', {
            name: 'Document save status',
            exact: true,
          });
          await expect(saveStatus).toContainText('Could not save');
          await saveStatus.getByRole('button', { name: 'Could not save', exact: true }).click();
          await expect(
            page.getByText(
              'Connection lost. Keep this page open; your latest changes have not been confirmed saved.',
              { exact: true },
            ),
          ).toBeVisible();
          const retryButtons = page.getByRole('button', { name: 'Retry saving', exact: true });
          await expect(retryButtons).toHaveCount(1);
          for (const retry of await retryButtons.all()) await expect(retry).toBeDisabled();
          await page.screenshot({
            path: resolve(directory, `${id}-details-${variant}.png`),
            fullPage: true,
          });
          verifications.push(
            `${variant}: offline failure stays unsaved and every save retry waits for reconnection`,
          );
        }
        if (id === 'redesign-screens--admin-error') {
          await expect(
            page.getByText('Could not load accounts. Try again.', { exact: true }),
          ).toBeVisible();
          await page.getByRole('button', { name: 'Try again', exact: true }).click();
          await expect(page.getByText('Alex Baylee', { exact: true })).toBeVisible();
          await expect(
            page.getByText('Could not load accounts. Try again.', { exact: true }),
          ).toHaveCount(0);
          verifications.push(`${variant}: Operator can retry an account-list error`);
        }
        if (id === 'redesign-screens--filtered-no-matches') {
          // Exercise both Clear controls with every filter set, including a query.
          for (const clearSelector of ['.rd-empty', '.rd-filter-bar']) {
            await page.getByRole('textbox', { name: 'Search files', exact: true }).fill('winter');
            await page
              .locator(clearSelector)
              .getByRole('button', { name: 'Clear filters', exact: true })
              .click();
            await expect(
              page.getByRole('textbox', { name: 'Search files', exact: true }),
            ).toHaveValue('');
            await expect(page.getByRole('textbox', { name: 'Tag', exact: true })).toHaveValue('');
            for (const [label, value] of [
              ['File type', 'All types'],
              ['Ownership', 'Mine and shared'],
              ['Last modified', 'Any time'],
            ])
              await expect(page.getByRole('combobox', { name: label, exact: true })).toContainText(
                value,
              );
            await expect(
              page.getByRole('heading', { name: 'No matching files', exact: true }),
            ).toHaveCount(0);
            await expect(
              page.getByRole('button', { name: 'Household Folder', exact: true }),
            ).toBeVisible();
            await expect(
              page.locator('.rd-file-open').filter({ hasText: 'Quarterly budget' }),
            ).toBeVisible();
            if (clearSelector === '.rd-empty') {
              await page.getByRole('textbox', { name: 'Tag', exact: true }).fill('household');
              for (const [label, value] of [
                ['File type', 'Sheets'],
                ['Ownership', 'Mine'],
                ['Last modified', 'Today'],
              ]) {
                await page.getByRole('combobox', { name: label, exact: true }).click();
                await page.getByRole('option', { name: value, exact: true }).click();
              }
            }
          }
          verifications.push(
            `${variant}: filter-only empty state and both Clear controls reset query, type, tag, ownership and date`,
          );
        }
      } catch (error) {
        await recordCaptureFailure(page, id, variant, error);
      }
    }
    await page.close();
  }
  if (requested.includes('redesign-screens--dashboard')) {
    for (const [width, hasTouch] of [
      [1280, false],
      [768, true],
      [613, false],
      [390, true],
    ] as const) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        hasTouch,
      });
      await page.goto(
        'http://127.0.0.1:6007/iframe.html?id=redesign-screens--dashboard&viewMode=story&globals=theme:light',
      );
      const network = page.getByRole('button', {
        name: 'Online — connected to Spinel',
        exact: true,
      });
      if (hasTouch) await network.tap();
      else await network.hover();
      await expect(
        page.getByText('Connected to Spinel. Open save status for details about this document.', {
          exact: true,
        }),
      ).toBeVisible();
      await page.screenshot({ path: resolve(directory, `network-explanation-${width}.png`) });
      await page.keyboard.press('Escape');
      await expect(
        page.getByText('Connected to Spinel. Open save status for details about this document.', {
          exact: true,
        }),
      ).toBeHidden();
      const namesBefore = await page
        .getByRole('list', { name: 'Files', exact: true })
        .getByRole('listitem')
        .allTextContents();
      await page.getByRole('button', { name: 'Grid view', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Grid view', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(
        await page
          .getByRole('list', { name: 'Files', exact: true })
          .getByRole('listitem')
          .allTextContents(),
      ).toEqual(namesBefore);
      await page.getByRole('button', { name: 'List view', exact: true }).click();
      if (width > 900) {
        await page.getByRole('button', { name: 'Collapse navigation', exact: true }).click();
        await expect(
          page.getByRole('button', { name: 'Expand navigation', exact: true }),
        ).toBeFocused();
        const pinned = page
          .getByRole('navigation', { name: 'File shortcuts' })
          .getByRole('button', { name: 'Quarterly budget', exact: true });
        // Use actual keyboard navigation so the browser enters :focus-visible mode.
        for (
          let step = 0;
          step < 8 && !(await pinned.evaluate((node) => node === document.activeElement));
          step += 1
        )
          await page.keyboard.press('Tab');
        await expect(pinned).toBeFocused();
        await expect(pinned.locator('.rd-nav-tooltip')).toBeVisible();
        await page
          .getByRole('navigation', { name: 'File shortcuts' })
          .getByRole('button', { name: 'Shared with me', exact: true })
          .click();
        await expect(
          page.getByRole('heading', { name: 'Shared with me', exact: true }),
        ).toBeVisible();
        await page
          .getByRole('navigation', { name: 'File shortcuts' })
          .getByRole('button', { name: 'My files', exact: true })
          .click();
        await page.getByRole('button', { name: 'Expand navigation', exact: true }).click();
        await expect(
          page.getByRole('button', { name: 'Collapse navigation', exact: true }),
        ).toBeFocused();
        await page.getByRole('button', { name: /^Filters/ }).click();
        await page.getByRole('combobox', { name: 'Ownership', exact: true }).click();
        await page.getByRole('option', { name: 'Mine', exact: true }).click();
        const files = page.getByRole('list', { name: 'Files', exact: true });
        await expect(files.getByRole('listitem').filter({ hasText: 'Household' })).toBeVisible();
        await expect(
          files.getByRole('listitem').filter({ hasText: 'Quarterly budget' }),
        ).toHaveCount(0);
      } else {
        await page.getByRole('button', { name: 'Expand navigation', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'Browse files', exact: true })).toBeVisible();
        await page.screenshot({ path: resolve(directory, `navigation-open-${width}.png`) });
        await page
          .getByRole('dialog')
          .getByRole('button', { name: 'Shared with me', exact: true })
          .click();
        await expect(page.getByRole('dialog')).toBeHidden();
        await expect(
          page.getByRole('heading', { name: 'Shared with me', exact: true }),
        ).toBeVisible();
      }
      const appearance = page.getByRole('radiogroup', { name: 'Appearance', exact: true });
      for (const radio of await appearance.getByRole('radio').all()) {
        const box = await radio.boundingBox();
        expect(box, `Visible appearance control at ${width}px`).not.toBeNull();
        expect(Math.round(box!.width), `${width}px ${hasTouch ? 'coarse' : 'fine'} pointer`).toBe(
          hasTouch ? 44 : 24,
        );
        expect(Math.round(box!.height)).toBe(hasTouch ? 44 : 24);
      }
      await appearance.getByRole('radio', { name: 'Dark', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await appearance.getByRole('radio', { name: 'Follow system', exact: true }).click();
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await page.emulateMedia({ colorScheme: 'light' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await expect(
        appearance.getByRole('radio', { name: 'Follow system', exact: true }),
      ).toBeChecked();
      await page.screenshot({ path: resolve(directory, `appearance-system-${width}.png`) });
      await page.close();
      verifications.push(
        `${width}px: navigation/focus, list/grid parity and segmented appearance/system response`,
      );
    }
  }
  if (requested.includes('redesign-screens--planned-space')) {
    for (const width of [1280, 768, 390]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        hasTouch: width <= 768,
      });
      await page.goto(
        'http://127.0.0.1:6007/iframe.html?id=redesign-screens--planned-space&viewMode=story&globals=theme:light',
      );
      const opener = page.getByRole('button', { name: 'Open Space contents', exact: true });
      const globalNavigation = page.getByRole('complementary', {
        name: 'Global navigation',
        exact: true,
      });
      await expect(
        globalNavigation.getByRole('button', { name: 'My files', exact: true }),
      ).toBeVisible();
      await expect(globalNavigation.getByRole('button', { name: /Expand|Open Space/ })).toHaveCount(
        0,
      );
      if (width > 900) {
        await expect(opener).toBeHidden();
        await page.getByRole('button', { name: 'Collapse navigation', exact: true }).click();
        await expect(opener).toBeFocused();
        await opener.click();
        await expect(opener).toBeHidden();
        await expect(
          page.getByRole('navigation', { name: 'Space contents', exact: true }),
        ).toBeVisible();
      } else {
        await expect(opener).toBeVisible();
        const globalBox = await globalNavigation.boundingBox();
        const openerBox = await opener.boundingBox();
        expect(openerBox!.y).toBeGreaterThanOrEqual(globalBox!.y + globalBox!.height - 1);
        await opener.click();
        const contents = page.getByRole('dialog', { name: 'Space contents', exact: true });
        await expect(contents).toBeVisible();
        await contents.getByRole('button', { name: 'Budget', exact: true }).click();
        await expect(contents).toBeHidden();
        await expect(page.getByRole('heading', { name: 'Budget', exact: true })).toBeVisible();
      }
      await page.close();
      verifications.push(
        `${width}px: Space contents is local navigation with a working collapsed/phone opener`,
      );
    }
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
  if (requested.includes('redesign-walkthrough--owner')) {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        hasTouch: width === 390,
      });
      const open = async (story: string) => {
        await page.goto(
          `http://127.0.0.1:6007/iframe.html?id=redesign-walkthrough--${story}&viewMode=story&globals=theme:light`,
        );
        await expect(page.locator('.rd-walkthrough')).toBeVisible();
      };
      const event = async (label: string) => {
        // Returning from profile/history remounts Univer. Wait for its focus and
        // permissions setup before opening a menu that initialization could dismiss.
        await waitForNativeEditor(page);
        const tools = page.locator('.rd-review-tools');
        if (!(await tools.getAttribute('open'))) await tools.locator('summary').click();
        await page.getByRole('combobox', { name: 'Preview event', exact: true }).click();
        await page.getByRole('option', { name: label, exact: true }).click();
        await tools.locator('summary').click();
        await waitForNativeEditor(page);
      };
      const shot = async (name: string) => {
        await waitForNativeEditor(page);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
          `Walkthrough overflow: ${name} ${width}`,
        ).toBe(true);
        await page.screenshot({
          path: resolve(directory, `journey-${name}-${width}.png`),
          fullPage: true,
        });
      };
      await open('owner');
      const brand = page.getByRole('button', { name: 'Spinel home', exact: true });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await brand.hover();
      await expect(brand.locator('.wiggle')).toHaveCSS('animation-name', 'none');
      await brand.focus();
      await expect(brand.locator('.wiggle')).toHaveCSS('animation-name', 'none');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await expect(brand.locator('.wiggle')).toHaveCSS('animation-name', 'gem-wiggle');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      // Arrival and sign-in are one screen; help has one name and destination.
      await expect(page.getByRole('button', { name: 'Need help?', exact: true })).toHaveCount(1);
      await page.getByRole('button', { name: 'Need help?', exact: true }).click();
      await expect(
        page.getByRole('dialog', { name: 'Access to this workspace', exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Got it', exact: true }).click();
      await page.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();
      await expect(
        page.getByText('Continue in your browser or device’s passkey prompt.', { exact: true }),
      ).toBeVisible();
      await event('Passkey cancelled');
      await page.getByRole('button', { name: 'Try again with a passkey', exact: true }).click();
      await event('Passkey succeeded');
      await expect(page.getByRole('heading', { name: 'My files', exact: true })).toBeVisible();
      const appBrand = page.getByRole('button', { name: 'Spinel home', exact: true });
      await appBrand.hover();
      await expect(appBrand.locator('.rd-gem-wiggle')).toHaveCSS('animation-name', 'none');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await expect(appBrand.locator('.rd-gem-wiggle')).toHaveCSS('animation-name', 'gem-wiggle');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const search = page.getByRole('textbox', { name: 'Search files', exact: true });
      await search.fill('recipes');
      await page.locator('.rd-file-open').filter({ hasText: 'A few good recipes' }).click();
      await expect(
        page.getByRole('heading', { name: 'A few good recipes', exact: true }),
      ).toBeVisible();
      await shot('owner-doc');
      await waitForNativeEditor(page);
      await page.getByRole('button', { name: 'Document actions', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Export', exact: true }).click();
      await expect(page.locator('.rd-inspector h2')).toBeFocused();
      await expect(page.locator('.rd-inspector h2')).toBeInViewport();
      await page.getByRole('button', { name: 'Document actions', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Export', exact: true }).focus();
      await page.keyboard.press('Escape');
      await expect(
        page.getByRole('button', { name: 'Document actions', exact: true }),
      ).toBeFocused();

      await page.getByRole('button', { name: 'Close panel', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Document actions', exact: true }),
      ).toBeFocused();

      await page
        .getByRole('button', { name: width > 640 ? 'Back to files' : 'My files', exact: true })
        .click();
      await expect(search).toHaveValue('recipes');
      await expect(
        page.locator('.rd-file-open').filter({ hasText: 'A few good recipes' }),
      ).toBeFocused();
      await search.fill('');
      await page.getByRole('button', { name: 'New file', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Doc', exact: true }).click();
      await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Weekend notes');
      await page.getByRole('button', { name: 'Create Doc', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Weekend notes', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Document actions', exact: true }).click();
      await expect(page.getByRole('menuitem', { name: 'Fill presets', exact: true })).toHaveCount(
        0,
      );
      await page.getByRole('menuitem', { name: 'Versions', exact: true }).click();
      await page.getByRole('button', { name: 'Name current version…', exact: true }).click();
      await page.getByRole('textbox', { name: 'Version name', exact: true }).fill('Ready to share');
      await page.getByRole('button', { name: 'Save version name', exact: true }).click();
      await expect(
        page
          .getByText('Preview · October 20, 2026 · Just now · Ready to share · UTC', {
            exact: true,
          })
          .filter({ visible: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Restore this version…', exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Return to document', exact: true }).click();
      await page.getByRole('button', { name: /^(Your profile|.+ — Profile settings)$/ }).click();
      await page.getByRole('textbox', { name: 'Display name', exact: true }).fill('Alex Updated');
      await page.getByRole('button', { name: 'Save profile', exact: true }).click();
      await page.getByRole('button', { name: 'This device', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Appearance on this device', exact: true }),
      ).toBeVisible();
      await shot('device-settings');
      await page.getByRole('button', { name: 'Back to document', exact: true }).click();
      const savedEditorTop = await page
        .locator('.rd-editor-body')
        .evaluate((node) => node.getBoundingClientRect().top);
      await event('Save failed');
      await expect
        .poll(() =>
          page.locator('.rd-editor-body').evaluate((node) => node.getBoundingClientRect().top),
        )
        .toBe(savedEditorTop);
      await expect(
        page.getByRole('status', { name: 'Document save status', exact: true }),
      ).toContainText('Could not save');
      await page
        .getByRole('button', { name: width > 640 ? 'Back to files' : 'My files', exact: true })
        .click();
      await expect(
        page.getByRole('dialog', { name: 'Leave with unsaved changes?', exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
      await shot('save-failed');
      await page.getByRole('button', { name: 'Could not save', exact: true }).click();
      await page.getByRole('button', { name: 'Retry saving', exact: true }).click();
      await expect(page.getByRole('button', { name: '✓ Saved', exact: true })).toBeVisible();
      await expect(
        page.getByRole('status', { name: 'Document save status', exact: true }),
      ).toContainText('Saved');
      await page
        .getByRole('button', { name: width > 640 ? 'Back to files' : 'My files', exact: true })
        .click();
      await expect(
        page.locator('.rd-file-open').filter({ hasText: 'Weekend notes' }),
      ).toBeVisible();
      await page
        .getByRole('button', { name: 'More actions for Weekend notes', exact: true })
        .click();
      await page.getByRole('menuitem', { name: 'Trash', exact: true }).click();
      await page.locator('.rd-file-open').filter({ hasText: 'Permanent folder' }).click();
      await page
        .getByRole('button', { name: 'More actions for Weekend notes', exact: true })
        .click();
      await page.getByRole('menuitem', { name: 'Restore', exact: true }).click();
      await page
        .getByRole('navigation', { name: 'Breadcrumb', exact: true })
        .getByRole('button', { name: 'My files', exact: true })
        .click();
      await expect(
        page.locator('.rd-file-open').filter({ hasText: 'Weekend notes' }),
      ).toBeVisible();
      await page
        .getByRole('button', { name: 'More actions for Weekend notes', exact: true })
        .click();
      await page.getByRole('menuitem', { name: 'Rename…', exact: true }).click();
      await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Weekend journal');
      await page.getByRole('button', { name: 'Rename', exact: true }).click();
      // Named checkpoints belong to the file when navigating between documents.
      await page.locator('.rd-file-open').filter({ hasText: 'A few good recipes' }).click();
      await page
        .getByRole('button', { name: width > 640 ? 'Back to files' : 'My files', exact: true })
        .click();
      await page.locator('.rd-file-open').filter({ hasText: 'Weekend journal' }).click();
      await page.getByRole('button', { name: 'Document actions', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Versions', exact: true }).click();
      await expect(
        page.getByText('Preview · October 20, 2026 · Just now · Ready to share · UTC', {
          exact: true,
        }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Return to document', exact: true }).click();
      await page
        .getByRole('button', { name: width > 640 ? 'Back to files' : 'My files', exact: true })
        .click();
      await page.locator('.rd-file-open').filter({ hasText: 'Trips' }).click();
      await page.getByRole('button', { name: 'New file', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Sheet', exact: true }).click();
      await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Trip costs');
      await page.getByRole('button', { name: 'Create Sheet', exact: true }).click();
      await page
        .getByRole('button', { name: width > 640 ? 'Back to files' : 'My files', exact: true })
        .click();
      await expect(page.getByRole('heading', { name: 'Trips', exact: true })).toBeVisible();
      await expect(page.locator('.rd-file-open').filter({ hasText: 'Trip costs' })).toBeVisible();
      await page
        .getByRole('navigation', { name: 'Breadcrumb', exact: true })
        .getByRole('button', { name: 'My files', exact: true })
        .click();
      await page.getByRole('button', { name: 'Grid view', exact: true }).click();
      await page.locator('.rd-file-open').filter({ hasText: 'Autumn plans' }).click();
      await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
      await expect(page.getByText('Space · Autumn plans /', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'My files', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'My files', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Grid view', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await open('invitation');
      await page.getByRole('textbox', { name: 'Your name', exact: true }).fill('Sam Rivera');
      await page.getByRole('button', { name: 'Join with a passkey', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Try again with a passkey', exact: true }),
      ).toBeFocused();
      await page.getByRole('button', { name: 'Try again with a passkey', exact: true }).click();
      await event('Passkey succeeded');
      await expect(
        page.getByRole('heading', { name: 'Quarterly budget', exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Document actions', exact: true }).click();
      await expect(page.getByRole('menuitem', { name: 'Share', exact: true })).toHaveCount(0);
      await expect(page.getByRole('menuitem', { name: 'Insert formula', exact: true })).toHaveCount(
        0,
      );
      await expect(
        page.getByRole('menuitem', { name: 'About your access', exact: true }),
      ).toHaveCount(0);
      await page.getByRole('menuitem', { name: 'Versions', exact: true }).focus();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu', { name: 'Document actions', exact: true })).toBeHidden();
      await page.getByRole('button', { name: /^(Your profile|.+ — Profile settings)$/ }).click();
      await expect(page.getByRole('textbox', { name: 'Display name', exact: true })).toHaveValue(
        'Sam Rivera',
      );
      await page.getByRole('button', { name: 'Back to document', exact: true }).click();
      const collaboratorEditorTop = await page
        .locator('.rd-editor-body')
        .evaluate((node) => node.getBoundingClientRect().top);
      await event('Save failed');
      await expect
        .poll(() =>
          page.locator('.rd-editor-body').evaluate((node) => node.getBoundingClientRect().top),
        )
        .toBe(collaboratorEditorTop);
      await page.getByRole('button', { name: 'Document actions', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Versions', exact: true }).click();
      await page.getByRole('button', { name: 'Return to document', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.getByRole('button', { name: /^(Your profile|.+ — Profile settings)$/ }).click();
      await page.getByRole('button', { name: 'Leave without saving', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Back to document', exact: true }),
      ).toBeVisible();
      await open('recovery');
      await expect(
        page.getByText('Create a new passkey for Alex Baylee.', { exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Recover with a passkey', exact: true }).click();
      await event('Passkey succeeded');
      await page.getByRole('button', { name: /^(Your profile|.+ — Profile settings)$/ }).click();
      await expect(page.getByRole('textbox', { name: 'Display name', exact: true })).toHaveValue(
        'Alex Baylee',
      );
      await open('operator');
      await page.getByRole('button', { name: 'Create Operator passkey', exact: true }).click();
      await event('Passkey succeeded');
      await expect(
        page.getByRole('heading', { name: 'Administration', exact: true }),
      ).toBeVisible();
      await shot('operator-first-run');
      await page.getByRole('button', { name: 'Invite your everyday account', exact: true }).click();
      await page.getByRole('button', { name: 'Create invite', exact: true }).click();
      await expect(page.getByRole('combobox', { name: 'Expires in', exact: true })).toContainText(
        '7 days',
      );
      await shot('operator-invite-form');
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Create invite', exact: true })
        .click();
      await expect(
        page.getByRole('textbox', { name: 'Invitation address', exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Revoke', exact: true }).click();
      await expect(
        page.getByRole('textbox', { name: 'Invitation address', exact: true }),
      ).toHaveCount(0);
      await page.getByRole('button', { name: /^(Your profile|.+ — Profile settings)$/ }).click();
      await expect(
        page.getByRole('button', { name: 'Connected assistants', exact: true }),
      ).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'My files', exact: true })).toHaveCount(0);
      await open('link-guest');
      await expect(
        page.getByRole('button', { name: /^(Your profile|.+ — Profile settings)$/ }),
      ).toHaveCount(0);
      await event('Editor access');
      const connectedEditorTop = await page
        .locator('.rd-editor-body')
        .evaluate((node) => node.getBoundingClientRect().top);
      await event('Connection lost');
      await expect
        .poll(() =>
          page.locator('.rd-editor-body').evaluate((node) => node.getBoundingClientRect().top),
        )
        .toBe(connectedEditorTop);
      await expect(
        page.getByRole('button', { name: 'Offline · keep open', exact: true }),
      ).toBeVisible();
      await expect(page.locator('.rd-live-alert')).toHaveText(
        'Connection lost. Keep this page open to protect unsent changes.',
      );
      await shot('guest-disconnected');
      await event('Owner turns off link');
      await expect(
        page.getByRole('heading', { name: 'This link no longer works.', exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Autumn plans', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Export as PDF', exact: true })).toHaveCount(0);
      await shot('guest-revoked');
      verifications.push(
        `Connected Owner/Operator/Guest journeys, preserved retrieval state, permissions and save guard: ${width}px`,
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
    { capturedAt: '2026-10-20T16:00:00Z', captures, verifications, failures: captureFailures },
    null,
    2,
  ),
);
const pairs = [
  ['dashboard-dashboard--populated', 'dashboard'],
  ['dashboard-dashboard--empty-workspace', 'empty-folder'],
  ['dashboard-searchpanel--results', 'search'],
  ['dashboard-trash--with-items', 'trash'],
  ['settings-themesettings--default', 'profile'],
  ['settings-assistantconnections--loaded', 'connections'],
  ['settings-connectassistant--consent', 'consent'],
  ['editor-versionnames--open', 'history'],
  ['sharing-sharing--with-people', 'sharing'],
  ['sharing-sharelink--link-on-view-only', 'sharing-existing-link'],
  ['admin-adminusers--loaded', 'admin'],
  ['admin-admininvites--loaded', 'admin-invites'],
  ['admin-backupstatus--healthy', 'admin-health'],
  ['guest-guestapp--link-revoked', 'revoked-link'],
];
const paired = pairs
  .map(([oldId, suffix]) => {
    const newId = `redesign-screens--${suffix}`;
    if (!requested.includes(oldId) || !requested.includes(newId)) return '';
    return `<section><h2>Before / proposed · ${escape(index.entries[newId].name)}</h2>${variants.map(([, , variant]) => `<h3>${variant}</h3><div class="shots">${[oldId, newId].map((id, i) => `<figure><a href="${id}-${variant}.png"><img loading="lazy" src="${id}-${variant}.png" alt="${i ? 'Proposed' : 'Before'} ${escape(index.entries[id].name)}"></a><figcaption>${i ? 'Proposed' : 'Before'} · ${escape(index.entries[id].title)}</figcaption></figure>`).join('')}</div>`).join('')}</section>`;
  })
  .join('');
await writeFile(
  resolve(directory, 'index.html'),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Spinel design review</title><style>body{font:16px system-ui;margin:32px;background:#fafafa;color:#222}nav{display:flex;gap:16px;flex-wrap:wrap}section{margin:40px 0} .shots{display:flex;gap:16px;overflow:auto;align-items:start}figure{margin:0;flex:0 0 480px}img{width:100%;border:1px solid #ddd}figcaption{padding:12px}a{color:#8a1d3f}</style><h1>Spinel · SPN-047 design review</h1><p>Proposed screens are Storybook mockups, not production routes. Current screens are labelled by their existing story title. Space and delegated file Admin are planned.</p><h2>Paired comparisons</h2>${paired}<h2>All states and sizes</h2><nav>${requested.map((id) => `<a href="#${escape(id)}">${escape(index.entries[id].name)}</a>`).join('')}</nav>${requested
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
  `Captured ${captures.length} screenshots in ${directory}; ${verifications.length} interaction passes.`,
);

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
      await expect(editor.locator('canvas[aria-label]')).toBeVisible();
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
  await page.screenshot({ path: resolve(output, `menu-open-${variant}.png`) });
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
  await page.screenshot({ path: resolve(output, `appearance-choice-${variant}.png`) });
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
  await page.screenshot({ path: resolve(output, `dialog-select-open-${variant}.png`) });
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
