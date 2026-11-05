import { expect } from '@playwright/test';
import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test';
import { DocumentFlavor, getDocsEmptySnapshot, LocaleType } from '@univerjs/core';
import type { IDocumentData } from '@univerjs/core';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { Profiles } from '../src/server/auth/profile.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { DocumentStore } from '../src/server/workspace/documents.ts';
import { readDocResponsiveness } from './doc-responsiveness.ts';

export const saved = (page: Page) =>
  expect(page.getByRole('status', { name: 'Save status' })).toHaveText('All changes saved.', {
    timeout: 30_000,
  });
export const online = (page: Page) =>
  expect(page.getByRole('status', { name: 'Connection status', exact: true })).toHaveText(
    'Online',
    {
      timeout: 30_000,
    },
  );
export const nativeInput = (page: Page) =>
  page.locator('[contenteditable="true"][data-u-comp="editor"]');

export async function focusEmptyDoc(page: Page, mobile: boolean) {
  const region = page.getByRole('region', { name: 'Doc document', exact: true });
  if (mobile) {
    await expect(region).toHaveAttribute('data-mobile', 'true');
    await region.getByRole('button', { name: 'Edit', exact: true }).click();
  }
  await page.locator('.univer-container').click({ position: { x: 130, y: 200 } });
  await nativeInput(page).focus();
  await page.keyboard.press('Control+Home');
  await expect(nativeInput(page)).toBeFocused();
  await expect
    .poll(async () => (await readDocResponsiveness(page))?.selection)
    .toMatchObject({ start: 0, end: 0 });
}

export async function fixture(
  browser: Browser,
  baseURL: string,
  info: TestInfo,
  mobile: boolean,
  signal?: AbortSignal,
) {
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  let databaseClosed = false;
  const closeDatabase = () => {
    if (!databaseClosed) {
      db.close();
      databaseClosed = true;
    }
  };
  try {
    const auth = new AuthStore(db),
      workspace = new WorkspaceStore(auth);
    const owner = auth.createUser('Typing benchmark owner');
    const peer = auth.createUser('Typing benchmark collaborator');
    const profiles = new Profiles(auth);
    profiles.save(owner.id, { name: owner.name, color: 'primary-strong', icon: 'lucide:flower-2' });
    profiles.save(peer.id, { name: peer.name, color: 'info-strong', icon: 'lucide:leaf' });
    const item = workspace.create(owner.id, {
      kind: 'doc',
      name: 'Sustained typing',
      parentId: null,
    });
    workspace.share(owner.id, item.id, peer.id, 'editor');
    // Both presets receive the identical native modern document, with no seed
    // shortcuts. The original sixteen paragraphs are entered one key at a time.
    new DocumentStore(workspace).save(owner.id, item.id, {
      snapshot: getDocsEmptySnapshot(item.id, LocaleType.EN_US, item.name, DocumentFlavor.MODERN),
      revision: 0,
      writeId: crypto.randomUUID(),
    });
    const contexts: BrowserContext[] = [];
    let closed: Promise<void> | undefined;
    const contextClosures = new Map<BrowserContext, Promise<void>>();
    const closeContext = (context: BrowserContext) => {
      let pending = contextClosures.get(context);
      if (!pending) {
        pending = Promise.resolve().then(() => context.close());
        contextClosures.set(context, pending);
      }
      return pending;
    };
    const close = () =>
      (closed ??= (async () => {
        const results = await Promise.allSettled(contexts.map(closeContext));
        let failure = results.find((result) => result.status === 'rejected')?.reason;
        try {
          db.prepare('DELETE FROM workspace_items WHERE owner_id=?').run(owner.id);
          for (const user of [owner, peer])
            db.prepare('DELETE FROM auth_users WHERE id=?').run(user.id);
        } catch (error) {
          failure ??= error;
        } finally {
          try {
            closeDatabase();
          } catch (error) {
            failure ??= error;
          }
        }
        if (failure) throw failure;
      })());
    let interruptedSetup: Promise<unknown> | undefined;
    const interruptSetup = () => {
      interruptedSetup = Promise.allSettled(contexts.map(closeContext));
    };
    signal?.addEventListener('abort', interruptSetup, { once: true });
    const account = async (id?: string) => {
      signal?.throwIfAborted();
      if (closed) throw new Error('Document fixture is closed.');
      const context = await browser.newContext({
        baseURL,
        viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
        deviceScaleFactor: 1,
        isMobile: mobile,
        hasTouch: mobile,
        colorScheme: 'light',
        reducedMotion: 'reduce',
      });
      contexts.push(context);
      if (closed) {
        await closeContext(context);
        throw new Error('Document fixture closed during context acquisition.');
      }
      signal?.throwIfAborted();
      if (id)
        await context.addCookies([
          {
            name: COOKIE_NAME,
            value: auth.createSession(id).token,
            url: baseURL.replace('http:', 'https:'),
            secure: true,
            httpOnly: true,
            sameSite: 'Strict',
          },
        ]);
      return context;
    };
    try {
      signal?.throwIfAborted();
      const first = await account(owner.id),
        second = await account(peer.id);
      const page = await first.newPage(),
        other = await second.newPage();
      signal?.throwIfAborted();
      const errors: string[] = [];
      for (const target of [page, other])
        target.on('pageerror', (error) => errors.push(error.message));
      const readState = async () => {
        const response = await first.request.get(`/api/items/${item.id}/doc`);
        expect(response.ok()).toBe(true);
        return (await response.json()) as { snapshot: IDocumentData; revision: number };
      };
      return {
        first,
        second,
        account,
        owner,
        peer,
        workspace,
        item,
        page,
        other,
        errors,
        read: async () => (await readState()).snapshot,
        readState,
        close,
      };
    } catch (error) {
      // Partial acquisition still owns every context and the database. Preserve
      // the setup failure even if resource disposition also fails.
      await interruptedSetup;
      await close().catch(() => {});
      throw error;
    } finally {
      signal?.removeEventListener('abort', interruptSetup);
    }
  } catch (error) {
    try {
      closeDatabase();
    } catch {
      /* Preserve the setup failure. */
    }
    throw error;
  }
}

export async function exactText(page: Page, expected: string) {
  await expect
    .poll(async () => (await readDocResponsiveness(page, true))?.text, { timeout: 30_000 })
    .toBe(expected);
}
