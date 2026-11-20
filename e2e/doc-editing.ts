import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { expect, test as baseTest } from '@playwright/test';
import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test';
import {
  createParagraphId,
  createSectionId,
  DocumentFlavor,
  getDocsEmptySnapshot,
  LocaleType,
  validateDocumentStructure,
} from '@univerjs/core';
import type { IDocumentData } from '@univerjs/core';
import { canonical, normalizedDocBody } from '@spinel/sync-transform';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { DocumentStore } from '../src/server/workspace/documents.ts';
import { withFixtureCleanup } from './owned-process.ts';
import { recordNativeSnapshots } from './sync-snapshot.ts';
import { beginWriting, selectFirstWord, textPoint } from './doc-touch.ts';

// A trace override is worker-scoped in Playwright. Extend the test type, as the
// existing recorded native suites do, without changing unrelated ordinary cases.
const test = baseTest.extend({ trace: 'retain-on-failure' });

export interface EditingSelection {
  unitId: string;
  start?: number;
  end?: number;
  text: string;
  inputFocused: boolean;
  body?: IDocumentData['body'];
  queryBounds?: { left: number; top: number; right: number; bottom: number };
}

export async function readEditingSelection(page: Page, offset?: number) {
  return page.evaluate((offset) => {
    let observed: EditingSelection | undefined;
    const receive = (event: Event) => {
      observed = (event as CustomEvent<EditingSelection>).detail;
    };
    window.addEventListener('spinel-doc-selection-evidence', receive);
    try {
      window.dispatchEvent(
        new CustomEvent('spinel-doc-selection-read', { detail: { offset, includeBody: true } }),
      );
      return observed;
    } finally {
      window.removeEventListener('spinel-doc-selection-evidence', receive);
    }
  }, offset);
}

export interface EditingFixture {
  page: Page;
  context: BrowserContext;
  id: string;
  initial: IDocumentData;
  read(): Promise<IDocumentData>;
  focus(): Promise<void>;
  reload(): Promise<void>;
  mobile: boolean;
}

async function recordEditingEvents(context: BrowserContext) {
  await context.addInitScript(() => {
    const events: unknown[] = [];
    (window as Window & { editingEvents?: unknown[] }).editingEvents = events;
    for (const type of [
      'keydown',
      'beforeinput',
      'input',
      'compositionstart',
      'compositionupdate',
      'compositionend',
    ]) {
      document.addEventListener(
        type,
        (event) => {
          if (
            !(event.target instanceof HTMLElement) ||
            !event.target.matches('[data-u-comp="editor"]')
          )
            return;
          events.push({
            type,
            inputType: event instanceof InputEvent ? event.inputType : undefined,
            key:
              event instanceof KeyboardEvent && ['Backspace', 'Delete', 'Enter'].includes(event.key)
                ? event.key
                : undefined,
            composing:
              event instanceof InputEvent || event instanceof KeyboardEvent
                ? event.isComposing
                : undefined,
            cancelable: event.cancelable,
            defaultPreventedAtCapture: event.defaultPrevented,
            trusted: event.isTrusted,
          });
          if (events.length > 128) events.shift();
        },
        true,
      );
    }
  });
}

export async function withEditingDoc(
  browser: Browser,
  baseURL: string,
  info: TestInfo,
  mobile: boolean,
  work: (fixture: EditingFixture) => Promise<void>,
  options: {
    viewer?: boolean;
    traditional?: boolean;
    singleParagraph?: boolean;
    beforeOpen?: (page: Page) => Promise<void>;
  } = {},
) {
  const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  let context: BrowserContext | undefined;
  let guest: BrowserContext | undefined;
  let page: Page | undefined;
  let read: (() => Promise<IDocumentData>) | undefined;
  const errors: string[] = [];
  let eventNavigation: number | undefined;
  let capturedNavigations = 0;
  let events: { navigation: number; event: unknown }[] = [];
  const captureEvents = async () => {
    const observed = await page
      ?.evaluate(() => ({
        navigation: performance.timeOrigin,
        events: (window as Window & { editingEvents?: unknown[] }).editingEvents ?? [],
      }))
      .catch(() => undefined);
    if (!observed) return;
    if (eventNavigation !== observed.navigation) {
      eventNavigation = observed.navigation;
      capturedNavigations += 1;
    }
    // Replace the current page's snapshot if reload failed without navigating;
    // retain earlier navigation records within one content-free, bounded ring.
    events = [
      ...events.filter((event) => event.navigation !== capturedNavigations),
      ...observed.events.map((event) => ({ navigation: capturedNavigations, event })),
    ].slice(-128);
  };
  await withFixtureCleanup(
    async () => {
      const auth = new AuthStore(db);
      const workspace = new WorkspaceStore(auth);
      const owner = auth.createUser(`Editing ${info.testId}`);
      const item = workspace.create(owner.id, {
        name: 'Editing journal',
        kind: 'doc',
        parentId: null,
      });
      const initial = getDocsEmptySnapshot(
        item.id,
        LocaleType.EN_US,
        item.name,
        options.traditional ? DocumentFlavor.TRADITIONAL : DocumentFlavor.MODERN,
      );
      const stream = options.singleParagraph
        ? 'Phone journal\r\n'
        : 'Phone journal\rSecond line\r\n';
      const ids = new Set<string>();
      initial.body = {
        ...initial.body,
        dataStream: stream,
        textRuns: [{ st: 6, ed: 13, ts: { bl: 1 } }],
        paragraphs: Array.from(stream.matchAll(/\r/g), (match) => ({
          startIndex: match.index!,
          paragraphId: createParagraphId(ids),
        })),
        sectionBreaks: [{ startIndex: stream.length - 1, sectionId: createSectionId(new Set()) }],
      };
      expect(validateDocumentStructure(initial)).toEqual([]);
      new DocumentStore(workspace).save(owner.id, item.id, {
        snapshot: initial,
        revision: 0,
        writeId: crypto.randomUUID(),
      });
      context = await browser.newContext({
        baseURL,
        viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1100 },
        isMobile: mobile,
        hasTouch: mobile,
        deviceScaleFactor: 1,
        colorScheme: 'light',
        reducedMotion: 'reduce',
        ignoreHTTPSErrors: true,
      });
      await recordNativeSnapshots(context);
      await context.addCookies([
        {
          name: COOKIE_NAME,
          value: auth.createSession(owner.id).token,
          url: baseURL.replace('http:', 'https:'),
          secure: true,
          httpOnly: true,
          sameSite: 'Strict',
        },
      ]);
      read = async () => {
        const response = await context!.request.get(`/api/items/${item.id}/doc`);
        expect(response.ok()).toBe(true);
        return (await response.json()).snapshot as IDocumentData;
      };
      let url = `/?item=${item.id}`;
      if (options.viewer) {
        const response = await context.request.put(`/api/items/${item.id}/link`, {
          headers: { Origin: baseURL },
          data: { role: 'viewer' },
        });
        expect(response.ok()).toBe(true);
        url = (await response.json()).url;
        guest = await browser.newContext({
          baseURL,
          viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1100 },
          isMobile: mobile,
          hasTouch: mobile,
          ignoreHTTPSErrors: true,
        });
      }
      await recordEditingEvents(guest ?? context);
      page = await (guest ?? context).newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await options.beforeOpen?.(page);
      await page.goto(url);
      await expect(page.getByRole('status', { name: 'Save status' })).toHaveText(
        options.viewer || (mobile && options.traditional) ? /View only/ : 'All changes saved.',
        { timeout: 30_000 },
      );
      await expect(page.getByRole('region', { name: 'Doc document', exact: true })).toHaveAttribute(
        'data-mobile',
        String(mobile),
      );
      await expect.poll(async () => (await readEditingSelection(page!))?.text).toBe(stream);
      await work({
        page,
        context: guest ?? context,
        id: item.id,
        initial,
        read,
        mobile,
        async reload() {
          await captureEvents();
          await page!.reload();
        },
        async focus() {
          if (mobile) await beginWriting(page!);
          else {
            const point = await textPoint(page!);
            await page!.mouse.click(point.x, point.y);
            await expect(
              page!.locator('[contenteditable="true"][data-u-comp="editor"]'),
            ).toBeFocused();
          }
        },
      });
      expect(errors).toEqual([]);
    },
    async () => {
      await withFixtureCleanup(
        async () => {
          const native = page ? await readEditingSelection(page).catch(() => undefined) : undefined;
          await captureEvents();
          const persisted = await read?.().catch((error) => ({ failure: String(error) }));
          const evidencePath = info.outputPath('doc-editing-evidence.json');
          await writeFile(
            evidencePath,
            JSON.stringify(
              {
                source,
                browser: browser.version(),
                mobile,
                evidence: mobile
                  ? 'Chromium phone emulation; no OS software keyboard'
                  : 'Desktop Chromium browser automation',
                viewport: page?.viewportSize(),
                environment: page
                  ? await page
                      .evaluate(() => ({
                        userAgent: navigator.userAgent,
                        online: navigator.onLine,
                      }))
                      .catch(() => undefined)
                  : undefined,
                native,
                persisted,
                capturedNavigations,
                events,
                errors,
              },
              null,
              2,
            ),
          );
          await info.attach('doc-editing-evidence', {
            contentType: 'application/json',
            path: evidencePath,
          });
        },
        async () => {
          await withFixtureCleanup(
            async () => {
              await guest?.close();
            },
            async () => {
              await withFixtureCleanup(
                async () => {
                  await context?.close();
                },
                async () => {
                  db.close();
                },
              );
            },
          );
        },
      );
    },
  );
}

const editorInput = (page: Page) => page.locator('[contenteditable="true"][data-u-comp="editor"]');
const redo = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y';
const documentStart = process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home';

/** Use real desktop navigation or mobile touch; never write a native range. */
export async function placeCaret(f: EditingFixture, offset: number) {
  if (f.mobile) {
    await expect
      .poll(async () => Boolean((await readEditingSelection(f.page, offset))?.queryBounds))
      .toBe(true);
    const bounds = (await readEditingSelection(f.page, offset))!.queryBounds!;
    const x = (bounds.left + bounds.right) / 2;
    const y = (bounds.top + bounds.bottom) / 2;
    await f.page.touchscreen.tap(x, y);
    await f.page.touchscreen.tap(x, y);
  } else {
    // Nearby programmatic clicks participate in the SDK's real double/triple
    // click accumulator. Navigate with native keys instead of timing sleeps.
    await expect(editorInput(f.page)).toBeFocused();
    const prefix = (await readEditingSelection(f.page))!.text.slice(0, offset);
    await f.page.keyboard.press(documentStart);
    await expect
      .poll(async () => {
        const range = await readEditingSelection(f.page);
        return [range?.start, range?.end];
      })
      .toEqual([0, 0]);
    const steps = Array.from(new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(prefix));
    for (let index = 0; index < steps.length; index++) await f.page.keyboard.press('ArrowRight');
  }
  await expect(editorInput(f.page)).toBeFocused();
  await expect
    .poll(async () => {
      const range = await readEditingSelection(f.page);
      return [range?.start, range?.end];
    })
    .toEqual([offset, offset]);
}

export async function content(
  f: EditingFixture,
  text: string,
  caret?: number,
  expectedBold: string | null = 'journal',
) {
  await expect.poll(async () => (await readEditingSelection(f.page))?.text).toBe(text);
  if (caret !== undefined) {
    await expect
      .poll(async () => {
        const range = await readEditingSelection(f.page);
        return [range?.start, range?.end];
      })
      .toEqual([caret, caret]);
  }
  await expect.poll(async () => (await f.read()).body!.dataStream).toBe(text);
  await expect(f.page.getByRole('status', { name: 'Save status' })).toHaveText(
    'All changes saved.',
  );
  const saved = await f.read();
  const native = (await readEditingSelection(f.page))!;
  expect(native.body).toBeDefined();
  // Same documented native-default normalization as sync-snapshot.ts; text,
  // paragraph IDs, runs and all authored body metadata must match exactly.
  expect(canonical(normalizedDocBody(native.body))).toBe(canonical(normalizedDocBody(saved.body)));
  expect(validateDocumentStructure(saved)).toEqual([]);
  expect(saved.documentStyle).toEqual(f.initial.documentStyle);
  expect(saved.settings).toEqual(f.initial.settings);
  if (expectedBold !== null) {
    expect(
      saved
        .body!.textRuns!.filter((run) => run.ts?.bl === 1)
        .map((run) => text.slice(run.st, run.ed))
        .join(''),
    ).toBe(expectedBold);
  }
  return saved;
}

export async function reopen(f: EditingFixture, expected: IDocumentData) {
  await f.reload();
  await expect
    .poll(async () => (await readEditingSelection(f.page))?.text, { timeout: 30_000 })
    .toBe(expected.body!.dataStream);
  await expect(f.page.getByRole('status', { name: 'Save status' })).toHaveText(
    'All changes saved.',
  );
  const native = (await readEditingSelection(f.page))!;
  const saved = await f.read();
  expect(canonical(normalizedDocBody(native.body))).toBe(
    canonical(normalizedDocBody(expected.body)),
  );
  expect(saved.body).toEqual(expected.body);
  expect(saved.documentStyle).toEqual(expected.documentStyle);
  expect(saved.settings).toEqual(expected.settings);
}

async function selectWord(f: EditingFixture, all = false) {
  if (f.mobile) {
    await selectFirstWord(f.page);
    const drawer = f.page.locator('[data-u-comp="mobile-menu-drawer"]');
    await expect(drawer).toBeVisible();
    if (all) await drawer.getByRole('button', { name: /^select all$/i }).tap();
    if (await drawer.isVisible())
      await f.page
        .getByRole('button', { name: 'Cancel', exact: true })
        .first()
        .tap({ position: { x: 8, y: 8 } });
    // Focus only the real native input after native touch selection. No range
    // or content is written by the fixture; verify focus preserved that range.
    await editorInput(f.page).focus();
  } else {
    await placeCaret(f, 0);
    if (all) await f.page.keyboard.press('ControlOrMeta+A');
    else for (let index = 0; index < 5; index++) await f.page.keyboard.press('Shift+ArrowRight');
  }
  const end = all ? f.initial.body!.dataStream.length - 2 : 5;
  await expect
    .poll(async () => {
      const range = await readEditingSelection(f.page);
      return [range?.start, range?.end];
    })
    .toEqual([0, end]);
  await expect(editorInput(f.page)).toBeFocused();
}

async function softDelete(page: Page, inputType: 'deleteContentBackward' | 'deleteContentForward') {
  return editorInput(page).evaluate((node, inputType) => {
    // Synthetic DOM events exercise a keydown-less input route. They are not
    // Android/iOS software-keyboard observations and never mutate the model.
    const before = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType,
      data: null,
    });
    const proceed = node.dispatchEvent(before);
    if (proceed)
      node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType, data: null }));
    return { prevented: !proceed, trusted: before.isTrusted };
  }, inputType);
}

export function registerDocEditingTests(mobile: boolean) {
  // These detecting cases retain the first attempt in both owners; an inherited
  // ordinary-project retry must not repeat a known input-path failure.
  test.describe.configure({ retries: 0 });
  test('Doc editing inserts at start, middle and end and preserves Unicode and surrounding formatting', async ({
    browser,
    baseURL,
  }, info) => {
    test.setTimeout(90_000);
    await withEditingDoc(browser, baseURL!, info, mobile, async (f) => {
      await f.focus();
      let text = f.initial.body!.dataStream;
      await f.page.keyboard.type('Start ');
      text = 'Start ' + text;
      await content(f, text, 6);
      const middle = text.indexOf('Second') + 3;
      await placeCaret(f, middle);
      await f.page.keyboard.type('XY');
      text = text.slice(0, middle) + 'XY' + text.slice(middle);
      await content(f, text, middle + 2);
      await f.page.keyboard.press('Backspace');
      text = text.slice(0, middle + 1) + text.slice(middle + 2);
      await content(f, text, middle + 1);
      // Forward Delete is a supported hardware-key action in this emulation;
      // the own-phone checklist does not require a nonexistent software key.
      await placeCaret(f, middle);
      await f.page.keyboard.press('Delete');
      text = text.slice(0, middle) + text.slice(middle + 1);
      await content(f, text, middle);
      const end = text.length - 2;
      await placeCaret(f, end);
      await f.page.keyboard.insertText(' e\u0301😀');
      await content(f, text.slice(0, end) + ' e\u0301😀\r\n', end + 5);
      await f.page.keyboard.press('Backspace');
      await content(f, text.slice(0, end) + ' e\u0301\r\n', end + 3);
      await f.page.keyboard.press('Backspace');
      text = text.slice(0, end) + ' \r\n';
      await content(f, text, end + 1);
      await reopen(f, await content(f, text, end + 1));
    });
  });

  test('Doc editing deletes and replaces a native selection with exact undo and redo', async ({
    browser,
    baseURL,
  }, info) => {
    test.setTimeout(90_000);
    await withEditingDoc(browser, baseURL!, info, mobile, async (f) => {
      await f.focus();
      await selectWord(f);
      const original = f.initial.body!.dataStream;
      await f.page.keyboard.press('Backspace');
      await content(f, original.slice(5), 0);
      await f.page.keyboard.press('ControlOrMeta+z');
      await content(f, original);
      await expect
        .poll(async () => {
          const range = await readEditingSelection(f.page);
          return [range?.start, range?.end];
        })
        .toEqual([0, 5]);
      await f.page.keyboard.press(redo);
      await content(f, original.slice(5), 0);
      await f.page.keyboard.press('ControlOrMeta+z');
      await content(f, original);
      await f.page.keyboard.insertText('Garden');
      await content(f, 'Garden' + original.slice(5), 6);
      await f.page.keyboard.press('ControlOrMeta+z');
      await content(f, original);
      await f.page.keyboard.press(redo);
      const result = await content(f, 'Garden' + original.slice(5), 6);
      await reopen(f, result);
    });
  });

  test('Doc editing inserts and joins paragraphs without deleting beyond document boundaries', async ({
    browser,
    baseURL,
  }, info) => {
    test.setTimeout(90_000);
    await withEditingDoc(browser, baseURL!, info, mobile, async (f) => {
      await f.focus();
      const original = f.initial.body!.dataStream;
      await f.page.keyboard.press('Backspace');
      await content(f, original, 0);
      await placeCaret(f, original.length - 2);
      await f.page.keyboard.press('Delete');
      await content(f, original, original.length - 2);
      const boundary = original.indexOf('\r');
      await placeCaret(f, boundary + 1);
      await f.page.keyboard.press('Backspace');
      const joined = original.replace('\r', '');
      await content(f, joined, boundary);
      await f.page.keyboard.press('ControlOrMeta+z');
      await content(f, original, boundary + 1);
      await f.page.keyboard.press(redo);
      await content(f, joined, boundary);
      await f.page.keyboard.press('Enter');
      // Native BreakLineCommand gives the inserted paragraph token the style
      // at this bold boundary. Keep the exact expected run, including that token.
      const separated = await content(f, original, boundary + 1, 'journal\r');
      await reopen(f, separated);
    });
  });

  test('Doc editing can delete all text and type again in an empty document', async ({
    browser,
    baseURL,
  }, info) => {
    test.setTimeout(90_000);
    await withEditingDoc(
      browser,
      baseURL!,
      info,
      mobile,
      async (f) => {
        await f.focus();
        await selectWord(f, true);
        await f.page.keyboard.press('Backspace');
        await content(f, '\r\n', 0, null);
        await f.page.keyboard.press('Backspace');
        await f.page.keyboard.press('Delete');
        await content(f, '\r\n', 0, null);
        await f.page.keyboard.type('New');
        const result = await content(f, 'New\r\n', 3, null);
        await reopen(f, result);
      },
      { singleParagraph: true },
    );
  });

  if (mobile) {
    for (const inputType of ['deleteContentBackward', 'deleteContentForward'] as const) {
      test(`Doc editing synthetic ${inputType} without a Backspace or Delete keydown`, async ({
        browser,
        baseURL,
      }, info) => {
        test.setTimeout(60_000);
        await withEditingDoc(browser, baseURL!, info, true, async (f) => {
          await f.focus();
          await f.page.keyboard.type('abc');
          await content(f, 'abc' + f.initial.body!.dataStream, 3);
          if (inputType === 'deleteContentForward') await placeCaret(f, 1);
          const delivered = await softDelete(f.page, inputType);
          expect(delivered.trusted).toBe(false);
          // The hosted failure also delivered beforeinput without input. A
          // handled deletion must therefore complete without the fallback event.
          expect(delivered.prevented).toBe(true);
          const expected =
            (inputType === 'deleteContentBackward' ? 'ab' : 'ac') + f.initial.body!.dataStream;
          const result = await content(f, expected, inputType === 'deleteContentBackward' ? 2 : 1);
          await reopen(f, result);
        });
      });
    }
  }

  for (const boundary of mobile ? (['viewer', 'traditional'] as const) : (['viewer'] as const)) {
    test(`Doc editing respects ${boundary} mutation denial`, async ({ browser, baseURL }, info) => {
      test.setTimeout(60_000);
      await withEditingDoc(
        browser,
        baseURL!,
        info,
        mobile,
        async (f) => {
          const original = await f.read();
          const nativeBefore = (await readEditingSelection(f.page))!.body;
          expect(canonical(normalizedDocBody(nativeBefore))).toBe(
            canonical(normalizedDocBody(original.body)),
          );
          const point = await textPoint(f.page);
          if (mobile) {
            await f.page.touchscreen.tap(point.x, point.y);
            await f.page.touchscreen.tap(point.x, point.y);
          } else await f.page.mouse.click(point.x, point.y);
          await f.page.keyboard.type('FORBIDDEN');
          await f.page.keyboard.press('Backspace');
          await f.page.keyboard.press('Delete');
          await f.page.keyboard.press('Enter');
          // Playwright's generic dispatchEvent drops InputEvent-only fields.
          // Use the same genuine deletion payload as the editable cases; a
          // denied operation need not have a particular cancellation outcome.
          const delivered = await softDelete(f.page, 'deleteContentBackward');
          expect(delivered.trusted).toBe(false);
          expect((await readEditingSelection(f.page))?.body).toEqual(nativeBefore);
          expect((await f.read()).body).toEqual(original.body);
          if (mobile) await expect(editorInput(f.page)).not.toBeFocused();
          await f.reload();
          await expect
            .poll(async () => (await readEditingSelection(f.page))?.text, { timeout: 30_000 })
            .toBe(original.body!.dataStream);
          expect((await readEditingSelection(f.page))?.body).toEqual(nativeBefore);
          expect((await f.read()).body).toEqual(original.body);
        },
        { viewer: boundary === 'viewer', traditional: boundary === 'traditional' },
      );
    });
  }
}
