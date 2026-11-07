import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { DOCS_NORMAL_EDITOR_UNIT_ID_KEY } from '@univerjs/core';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { interruptibleNetwork } from './live-network.ts';
import { readRestoreSnapshot } from './restore-snapshot.ts';

// A successful configured retry cannot explain the original preview failure.
test.use({ trace: 'retain-on-failure' });

const sheetInputSelector = `[id="__editor_${DOCS_NORMAL_EDITOR_UNIT_ID_KEY}"][contenteditable="true"][data-u-comp="editor"]`;

/** Passive, bounded observations of the one native click/key attempt. */
const observeSheetInput = (page: Page) =>
  page.evaluateHandle((selector) => {
    const describe = (target: EventTarget | null) =>
      target instanceof Element
        ? {
            tag: target.tagName,
            id: target.id,
            role: target.getAttribute('role'),
            component: target.getAttribute('data-u-comp'),
            editable: target.getAttribute('contenteditable'),
          }
        : null;
    const state = () => {
      const input = document.querySelector(selector);
      const selection = document.getSelection();
      return {
        at: performance.now(),
        documentFocused: document.hasFocus(),
        visibility: document.visibilityState,
        active: describe(document.activeElement),
        input: describe(input),
        inputParent: describe(input?.parentElement ?? null),
        inputConnected: input?.isConnected,
        inputInViewer: !!input?.closest('.univer-container'),
        inputFocused: input !== null && input === document.activeElement,
        inputBounds: input?.getBoundingClientRect().toJSON(),
        inputVisibility: input && getComputedStyle(input).visibility,
        selectedCell: document.querySelector<HTMLInputElement>('[data-u-comp="defined-name"] input')
          ?.value,
        selection: selection && {
          ranges: selection.rangeCount,
          collapsed: selection.isCollapsed,
          anchorInInput: !!input?.contains(selection.anchorNode),
          focusInInput: !!input?.contains(selection.focusNode),
          anchorOffset: selection.anchorOffset,
          focusOffset: selection.focusOffset,
        },
      };
    };
    const events: unknown[] = [];
    const marks: { stage: string; state: ReturnType<typeof state> }[] = [];
    let droppedEvents = 0;
    const record = (event: Event) => {
      if (events.length === 32) {
        droppedEvents++;
        return;
      }
      events.push({
        type: event.type,
        at: performance.now(),
        trusted: event.isTrusted,
        target: describe(event.target),
        active: describe(document.activeElement),
        key: event instanceof KeyboardEvent ? event.key : undefined,
        inputType: event instanceof InputEvent ? event.inputType : undefined,
        dataLength: event instanceof InputEvent ? event.data?.length : undefined,
      });
    };
    const types = [
      'pointerdown',
      'pointerup',
      'focusin',
      'focusout',
      'keydown',
      'keyup',
      'beforeinput',
      'input',
    ];
    for (const type of types) document.addEventListener(type, record, true);
    return {
      mark: (stage: string) => marks.push({ stage, state: state() }),
      finish: () => {
        for (const type of types) document.removeEventListener(type, record, true);
        return { marks, events, droppedEvents, final: state() };
      },
    };
  }, sheetInputSelector);

for (const kind of ['sheet', 'doc'] as const) {
  test(`${kind} preview is read only and restore preserves the state seen by both editors`, async ({
    page,
    context,
    browser,
    baseURL,
  }, info) => {
    test.setTimeout(120_000);
    page.setDefaultTimeout(15_000);
    const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
    const auth = new AuthStore(db),
      workspace = new WorkspaceStore(auth);
    const owner = auth.createUser('Restore owner'),
      editor = auth.createUser('Restore collaborator');
    const item = workspace.create(owner.id, { name: 'Restore example', kind, parentId: null });
    workspace.share(owner.id, item.id, editor.id, 'editor');
    const second = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const offline = await interruptibleNetwork(second);
    const other = await second.newPage();
    other.setDefaultTimeout(15_000);
    const cookie = (user: string) => ({
      name: COOKIE_NAME,
      value: auth.createSession(user).token,
      url: baseURL!.replace('http:', 'https:'),
      secure: true,
      httpOnly: true,
      sameSite: 'Strict' as const,
    });
    await context.addCookies([cookie(owner.id)]);
    await second.addCookies([cookie(editor.id)]);
    await page.setViewportSize({ width: 1440, height: 1100 });
    let preview: typeof page | undefined;
    const saved = (target: typeof page) =>
      expect(target.getByRole('status', { name: 'Save status' })).toHaveText('All changes saved.', {
        timeout: 30_000,
      });
    const read = () => readRestoreSnapshot(context.request, `/api/items/${item.id}/${kind}`);
    const edit = async (target: typeof page, text: string, cell = 'A1') => {
      const region = target.getByRole('region', {
        name: kind === 'sheet' ? 'Sheet document' : 'Doc document',
        exact: true,
      });
      if (kind === 'sheet') {
        const box = region.getByRole('textbox').nth(2);
        await box.fill(cell);
        await box.press('Enter');
      } else await region.locator('.univer-container').click({ position: { x: 130, y: 200 } });
      await target.keyboard.type(text);
      if (kind === 'sheet') await target.keyboard.press('Enter');
    };
    try {
      await page.goto(`/?item=${item.id}`);
      await saved(page);
      await edit(page, 'Original');
      await expect.poll(async () => JSON.stringify((await read()).snapshot)).toContain('Original');
      await saved(page);
      await page.getByRole('button', { name: 'Document actions', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Versions', exact: true }).click();
      await page.getByRole('button', { name: 'Name this version', exact: true }).click();
      await page.getByLabel('Version name', { exact: true }).fill('Original version');
      await page.getByRole('button', { name: 'Save version name' }).click();
      const original = page.getByRole('listitem').filter({ hasText: 'Original version' });
      await expect(original).toBeVisible();
      const popup = page.waitForEvent('popup');
      await original.getByRole('link', { name: 'Preview version' }).click();
      preview = await popup;
      await page
        .getByRole('dialog', { name: 'Versions', exact: true })
        .getByRole('button', { name: 'Close dialog', exact: true })
        .click();
      preview.setDefaultTimeout(15_000);
      await expect(
        preview.getByRole('heading', { name: 'Preview — Restore example' }),
      ).toBeVisible();
      await expect(preview.getByRole('button', { name: 'Restore this version' })).toBeEnabled({
        timeout: 30_000,
      });
      await expect(preview.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled();
      await expect(
        preview.getByText('This content is protected. This action is not allowed.', {
          exact: true,
        }),
      ).not.toBeVisible();
      await preview.screenshot({
        path: info.outputPath(`${kind}-restore-preview.png`),
        animations: 'disabled',
      });
      const untouched = await read();
      const inputObserver = kind === 'sheet' ? await observeSheetInput(preview) : undefined;
      let inputFailure: { error: unknown } | undefined;
      try {
        await inputObserver?.evaluate((observer) => observer.mark('before click'));
        await preview.locator('.univer-container').click({ position: { x: 130, y: 200 } });
        if (kind === 'sheet') {
          await inputObserver!.evaluate((observer) => observer.mark('after click'));
          // Observe the real click's keyboard target; never manufacture focus.
          await expect(preview.locator(sheetInputSelector)).toBeFocused();
          await inputObserver!.evaluate((observer) => observer.mark('before key'));
          // The Sheet warning focuses OK, so later spaces would dismiss it.
          await preview.keyboard.press('m');
          await inputObserver!.evaluate((observer) => observer.mark('after key'));
          await expect(
            preview.getByText('The range is protected, and you do not have edit permission.', {
              exact: false,
            }),
          ).toBeVisible();
          await preview.getByRole('button', { name: 'ok', exact: true }).click();
        } else await preview.keyboard.type('must not edit');
      } catch (cause) {
        inputFailure = { error: cause };
      }
      if (inputObserver) {
        try {
          const observation = await inputObserver.evaluate((observer) => observer.finish());
          await info.attach('sheet-preview-input', {
            body: JSON.stringify(observation, null, 2),
            contentType: 'application/json',
          });
        } catch (captureError) {
          // Preserve the original assertion if the failed page cannot be read.
          console.error('Preview input capture failed:', captureError);
          inputFailure ??= { error: captureError };
        } finally {
          await inputObserver.dispose().catch((captureError: unknown) => {
            console.error('Preview input disposal failed:', captureError);
            inputFailure ??= { error: captureError };
          });
        }
      }
      if (inputFailure) throw inputFailure.error;
      const afterInput = await read();
      expect(afterInput.revision).toBe(untouched.revision);
      expect(afterInput.snapshot).toEqual(untouched.snapshot);
      await other.goto(`${baseURL}/?item=${item.id}`);
      await saved(other);
      await edit(other, 'Latest collaborative change');
      await expect
        .poll(async () => JSON.stringify((await read()).snapshot))
        .toContain('Latest collaborative change');
      await saved(other);
      await saved(page);
      const latest = await read();
      if (kind === 'sheet') {
        await offline.setOffline(true);
        await edit(other, 'Old offline edit', 'B2');
      }
      await preview.getByRole('button', { name: 'Restore this version' }).click();
      await preview
        .getByRole('dialog', { name: /Restore .* for everyone\?/ })
        .getByRole('button', { name: 'Restore version', exact: true })
        .click();
      await saved(preview);
      const restored = await read();
      expect(restored.revision).toBe(latest.revision + 1);
      expect(JSON.stringify(restored.snapshot)).toContain('Original');
      expect(JSON.stringify(restored.snapshot)).not.toContain('Latest collaborative change');
      await edit(preview, 'Editing after restore', 'C3');
      await expect
        .poll(async () => JSON.stringify((await read()).snapshot))
        .toContain('Editing after restore');
      await saved(preview);
      if (kind === 'sheet') await offline.setOffline(false);
      await expect(other.getByRole('status', { name: 'Save status' })).toContainText(
        'has been restored',
        { timeout: 15_000 },
      );
      await expect(page.getByRole('status', { name: 'Save status' })).toContainText(
        'has been restored',
      );
      expect(JSON.stringify((await read()).snapshot)).not.toContain('Old offline edit');
      other.on('dialog', (dialog) => void dialog.accept());
      await other.reload();
      await saved(other);
      await other.getByRole('button', { name: 'Document actions', exact: true }).click();
      await other.getByRole('menuitem', { name: 'Versions', exact: true }).click();
      const before = other.getByRole('listitem').filter({ hasText: 'Before restore' });
      await expect(before).toBeVisible();
      // The collaborator can recover their accepted work from the retained pre-state.
      const undoPopup = other.waitForEvent('popup');
      await before.getByRole('link', { name: 'Preview version' }).click();
      const undo = await undoPopup;
      undo.setDefaultTimeout(15_000);
      await expect(undo.getByRole('button', { name: 'Restore this version' })).toBeEnabled({
        timeout: 30_000,
      });
      await undo.getByRole('button', { name: 'Restore this version' }).click();
      await undo
        .getByRole('dialog', { name: /Restore .* for everyone\?/ })
        .getByRole('button', { name: 'Restore version', exact: true })
        .click();
      await saved(undo);
      expect(JSON.stringify((await read()).snapshot)).toContain('Latest collaborative change');
      await undo.close();
    } catch (cause) {
      // Automatic screenshots run after finally, when the popup is already gone.
      if (preview && !preview.isClosed()) {
        try {
          await info.attach(`${kind}-preview-at-failure`, {
            body: await preview.screenshot({ timeout: 5_000 }),
            contentType: 'image/png',
          });
        } catch (captureError) {
          console.error('Preview capture failed:', captureError);
        }
      }
      throw cause;
    } finally {
      await preview?.close();
      await second.close();
      db.close();
    }
  });
}
