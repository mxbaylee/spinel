import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import type { ICellData, IWorkbookData } from '@univerjs/core';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { SpaceStore } from '../src/server/workspace/spaces.ts';
import type { SpaceNode } from '../src/shared/spaces.ts';
import { interruptibleNetwork } from './live-network.ts';

const variants = [
  { name: 'light', width: 1440, height: 1000, theme: 'light' },
  { name: 'dark', width: 1440, height: 1000, theme: 'dark' },
  { name: 'phone', width: 390, height: 844, theme: 'light' },
] as const;

// Collaboration materialization can re-key styles on every read. Compare the
// complete cell style, rather than its incidental dictionary key, as the native
// appearance tests do. All other workbook fields remain in the equality check.
function resolvedWorkbook(snapshot: IWorkbookData) {
  const { styles, ...workbook } = structuredClone(snapshot);
  for (const sheet of Object.values(workbook.sheets))
    for (const row of Object.values(sheet.cellData ?? {}))
      for (const cell of Object.values(row ?? {}) as (ICellData | null)[])
        if (cell && typeof cell.s === 'string') {
          expect(styles[cell.s], `Style ${cell.s} must resolve`).toBeDefined();
          cell.s = styles[cell.s];
        }
  return workbook;
}

async function capture(page: Page, info: TestInfo, name: string) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await mkdir('test-results/theme-screenshots', { recursive: true });
  await page.screenshot({
    path: `test-results/theme-screenshots/spn-049-${name}-${info.project.name}.png`,
    fullPage: true,
    animations: 'disabled',
  });
}

test('Space theatre fills the window and restores its own page navigation', async ({
  page,
  context,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db),
    store = new WorkspaceStore(auth, { spacesEnabled: true });
  const spaces = new SpaceStore(store),
    owner = auth.createUser('Theatre Space owner');
  const root = spaces.createRoot(owner.id, { name: 'Theatre project', parentId: null }).space;
  const pages = (['sheet', 'doc'] as const).map(
    (kind) =>
      spaces.createChild(owner.id, root.id, {
        name: `Project ${kind}`,
        kind,
        parentId: root.id,
      }).item as SpaceNode,
  );
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
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/spaces/${root.id}?item=${pages[0]!.id}`);
    await expect(page.getByRole('status', { name: 'Save status' })).toHaveText(
      'All changes saved.',
      { timeout: 30_000 },
    );
    await page.getByRole('button', { name: `Rename ${pages[0]!.name}`, exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Document name', exact: true })
      .fill('Draft for the first page');
    await page
      .getByRole('complementary', { name: 'Space contents', exact: true })
      .locator(`a[href="/spaces/${root.id}?item=${pages[1]!.id}"]`)
      .click();
    await expect(page.getByRole('heading', { name: pages[1]!.name, exact: true })).toBeVisible();
    await expect(page.getByRole('form', { name: 'Rename document' })).toHaveCount(0);
    await page.getByRole('button', { name: `Rename ${pages[1]!.name}`, exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Document name', exact: true })).toHaveValue(
      pages[1]!.name,
    );
    await page.keyboard.press('Escape');
    // A completed root action releases its controller, so both the same and a
    // different subsequent action open rather than changing a stale initialMode.
    await page.getByRole('button', { name: 'Document actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Rename Space…', exact: true }).click();
    const renameRoot = page.getByRole('dialog', { name: 'Rename Space', exact: true });
    await renameRoot
      .getByRole('textbox', { name: 'Name', exact: true })
      .fill('Renamed theatre project');
    await renameRoot.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(renameRoot).toHaveCount(0);
    await page.getByRole('button', { name: 'Document actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Rename Space…', exact: true }).click();
    await expect(renameRoot.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
      'Renamed theatre project',
    );
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Document actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Move…', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Move Space', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    for (const item of pages) {
      await page.goto(`/spaces/${root.id}?item=${item.id}`);
      const editor = page.getByRole('region', {
        name: item.kind === 'sheet' ? 'Sheet document' : 'Doc document',
        exact: true,
      });
      await expect(page.getByRole('status', { name: 'Save status' })).toHaveText(
        'All changes saved.',
        { timeout: 30_000 },
      );
      for (const variant of variants) {
        await page.setViewportSize({ width: variant.width, height: variant.height });
        await page.emulateMedia({ colorScheme: variant.theme, reducedMotion: 'reduce' });
        await capture(page, info, `space-${item.kind}-${variant.name}-normal`);
        const canvas = await editor.locator('canvas').first().elementHandle();
        expect(canvas).not.toBeNull();
        await page.getByRole('button', { name: 'Enter theatre mode', exact: true }).click();
        await expect(
          page.getByRole('complementary', { name: 'Space contents', exact: true }),
        ).toBeHidden();
        await expect(
          page.getByRole('button', { name: 'Open Space contents', exact: true }),
        ).toBeHidden();
        await expect
          .poll(async () => {
            const box = await editor.locator('.univer-container').boundingBox();
            return !!box && box.width >= variant.width - 24 && box.height >= variant.height - 150;
          })
          .toBe(true);
        await capture(page, info, `space-${item.kind}-${variant.name}-theatre`);
        await page.getByRole('button', { name: 'Exit theatre mode', exact: true }).click();
        expect(await canvas!.evaluate((node) => node.isConnected)).toBe(true);
        await expect(page).toHaveURL(new RegExp(`item=${item.id}$`));
        if (variant.name === 'phone') {
          await page.getByRole('button', { name: 'Open Space contents', exact: true }).click();
          const drawer = page.getByRole('dialog', { name: 'Space contents', exact: true });
          await expect(drawer).toContainText('Project sheet');
          await expect(drawer).toContainText('Project doc');
          await capture(page, info, `space-${item.kind}-phone-pages-restored`);
          await page.getByRole('button', { name: 'Close Space contents', exact: true }).click();
          await expect(drawer).toHaveCount(0);
        } else {
          await expect(
            page.getByRole('complementary', { name: 'Space contents', exact: true }),
          ).toBeVisible();
        }
      }
    }
    expect(errors).toEqual([]);
  } finally {
    db.close();
  }
});

for (const kind of ['sheet', 'doc'] as const) {
  for (const variant of variants) {
    test(`${kind} theatre preserves the live editor and selection in ${variant.name}`, async ({
      page,
      context,
      browser,
      baseURL,
    }, info) => {
      test.setTimeout(120_000);
      const network = await interruptibleNetwork(context);
      const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
      const auth = new AuthStore(db),
        store = new WorkspaceStore(auth);
      const displayName = 'Alexandria Very Long Collaborator Name Beyond The Phone Width';
      const owner = auth.createUser(displayName);
      const item = store.create(owner.id, { name: `Theatre ${kind}`, kind, parentId: null });
      const peerName = 'Morgan Another Very Long Collaborator Name Beyond The Phone Header';
      const collaborator = variant.name === 'phone' ? auth.createUser(peerName) : null;
      if (collaborator) store.share(owner.id, item.id, collaborator.id, 'editor');
      let peer: BrowserContext | undefined;
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
      await page.emulateMedia({ colorScheme: variant.theme, reducedMotion: 'reduce' });
      // Seed text at a readable native size before exercising the phone viewport.
      // The phone test does not change stored page geometry to make it fit.
      await page.setViewportSize({ width: 1440, height: 1000 });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const editor = page.getByRole('region', {
        name: kind === 'sheet' ? 'Sheet document' : 'Doc document',
        exact: true,
      });
      const saved = () =>
        expect(page.getByRole('status', { name: 'Save status' })).toHaveText('All changes saved.', {
          timeout: 30_000,
        });
      const read = async () => {
        const response = await context.request.get(`/api/items/${item.id}/${kind}`);
        expect(response.ok()).toBe(true);
        const snapshot = (await response.json()).snapshot;
        return kind === 'sheet' ? resolvedWorkbook(snapshot) : snapshot;
      };
      try {
        await page.goto(`/?item=${item.id}`);
        await saved();
        await expect(
          page.getByRole('status', { name: 'Connection status', exact: true }),
        ).toHaveText('Online');
        const address = editor.getByRole('textbox').nth(2);
        if (kind === 'sheet') {
          await address.fill('B2');
          await address.press('Enter');
          await page.keyboard.type('Before theatre');
          await page.keyboard.press('Enter');
          await address.fill('B2');
          await address.press('Enter');
        } else {
          await editor.locator('.univer-container').click({ position: { x: 130, y: 200 } });
          await page.keyboard.type('Before theatre');
        }
        const nativeInput = await page.evaluateHandle(() => document.activeElement as HTMLElement);
        await saved();
        await expect.poll(async () => JSON.stringify(await read())).toContain('Before theatre');
        if (collaborator) {
          peer = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
          await peer.addCookies([
            {
              name: COOKIE_NAME,
              value: auth.createSession(collaborator.id).token,
              url: baseURL!.replace('http:', 'https:'),
              secure: true,
              httpOnly: true,
              sameSite: 'Strict',
            },
          ]);
          const other = await peer.newPage();
          other.on('pageerror', (error) => errors.push(error.message));
          await other.goto(`/?item=${item.id}`);
          await expect(other.getByRole('status', { name: 'Save status' })).toHaveText(
            'All changes saved.',
            { timeout: 30_000 },
          );
          const native = other.getByRole('region', {
            name: kind === 'sheet' ? 'Sheet document' : 'Doc document',
            exact: true,
          });
          if (kind === 'sheet') {
            await native.getByRole('textbox').nth(2).fill('C4');
            await native.getByRole('textbox').nth(2).press('Enter');
          } else {
            await native.locator('.univer-container').click({ position: { x: 130, y: 200 } });
            await other.keyboard.press('End');
          }
          await page.bringToFront();
        }
        await page.setViewportSize({ width: variant.width, height: variant.height });
        await expect(
          page.getByRole('searchbox', { name: 'Search files', exact: true }),
        ).toHaveCount(0);
        await capture(page, info, `account-${kind}-${variant.name}-normal`);
        await page.getByRole('button', { name: 'People in this document', exact: true }).click();
        const people = page.getByRole('dialog', { name: 'People in this document', exact: true });
        await expect(people).toContainText(displayName);
        if (collaborator)
          await expect(
            people.getByRole('button', { name: `Go to ${peerName}`, exact: true }),
          ).toBeVisible();
        await capture(page, info, `account-${kind}-${variant.name}-people`);
        await page.keyboard.press('Escape');
        await expect(people).toHaveCount(0);
        await page.getByRole('button', { name: 'Document actions', exact: true }).click();
        await capture(page, info, `account-${kind}-${variant.name}-actions`);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('menu', { name: 'Document actions', exact: true })).toHaveCount(
          0,
        );
        await expect(
          page.getByRole('button', { name: 'Document actions', exact: true }),
        ).toBeFocused();

        // Restore the original native input without applying a new pointer selection.
        // A toggle must preserve this native selection, not reconstruct body offsets.
        if (kind === 'sheet') {
          await address.fill('B2');
          await address.press('Enter');
        } else {
          await nativeInput.evaluate((node) => node.focus({ preventScroll: true }));
          await expect
            .poll(() => nativeInput.evaluate((node) => node === document.activeElement))
            .toBe(true);
          await page.keyboard.press('Control+a');
        }
        const active = await page.evaluateHandle(() => document.activeElement as HTMLElement);
        const canvas = await editor.locator('canvas').first().elementHandle();
        expect(canvas).not.toBeNull();
        const before = await read(),
          joined = network.connectionCount();
        expect(joined).toBeGreaterThan(0);
        await page.getByRole('button', { name: 'Enter theatre mode', exact: true }).click();
        await expect(
          page.getByRole('button', { name: 'Exit theatre mode', exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole('button', { name: 'Save details: Saved', exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole('status', { name: 'Connection status', exact: true }),
        ).toHaveText('Online');
        await expect
          .poll(async () => {
            const box = await editor.locator('.univer-container').boundingBox();
            return !!box && box.width >= variant.width - 24 && box.height >= variant.height - 150;
          })
          .toBe(true);
        expect(await canvas!.evaluate((node) => node.isConnected)).toBe(true);
        expect(
          await editor
            .locator('canvas')
            .first()
            .evaluate((node, original) => node === original, canvas!),
        ).toBe(true);
        expect(network.connectionCount()).toBe(joined);
        expect(await read()).toEqual(before);
        if (kind === 'sheet') await expect(address).toHaveValue('B2');
        await capture(page, info, `account-${kind}-${variant.name}-theatre`);
        await active.evaluate((node) => {
          if (node.isConnected) node.focus({ preventScroll: true });
        });
        // Replacement proves the existing native selection survived the header click
        // and resize. It also proves editing continues in the same live document.
        await page.keyboard.type('After theatre');
        if (kind === 'sheet') await page.keyboard.press('Enter');
        await saved();
        await expect
          .poll(async () => {
            const snapshot = await read();
            return kind === 'sheet'
              ? snapshot.sheets[snapshot.sheetOrder[0]].cellData[1][1].v
              : snapshot.body.dataStream;
          })
          .toBe(kind === 'sheet' ? 'After theatre' : 'After theatre\r\n');

        if (kind === 'sheet') {
          await address.fill('C3');
          await address.press('Enter');
          await page.keyboard.type('Cancel this cell');
          await page.keyboard.press('Escape');
          // Escape in a native cell editor cancels that edit, never theatre mode.
          await expect(
            page.getByRole('button', { name: 'Exit theatre mode', exact: true }),
          ).toBeVisible();
          await saved();
          expect(JSON.stringify(await read())).not.toContain('Cancel this cell');
        }
        await page.getByRole('button', { name: 'Exit theatre mode', exact: true }).focus();
        await page.keyboard.press('Escape');
        await expect(
          page.getByRole('button', { name: 'Enter theatre mode', exact: true }),
        ).toBeVisible();
        expect(await canvas!.evaluate((node) => node.isConnected)).toBe(true);
        expect(network.connectionCount()).toBe(joined);
        await page.getByRole('button', { name: 'Enter theatre mode', exact: true }).click();
        await page.reload();
        await saved();
        await expect(
          page.getByRole('button', { name: 'Exit theatre mode', exact: true }),
        ).toBeVisible();
        await page.getByRole('button', { name: 'Exit theatre mode', exact: true }).click();

        if (variant.name === 'phone') {
          await network.setOffline(true);
          await expect(
            page.getByRole('status', { name: 'Connection status', exact: true }),
          ).not.toHaveText('Online');
          await network.setOffline(false);
          await expect(
            page.getByRole('status', { name: 'Connection status', exact: true }),
          ).toHaveText('Online', { timeout: 30_000 });
          await page.getByRole('button', { name: 'People in this document', exact: true }).click();
          await expect(people).toContainText(displayName);
          await expect(people).toContainText(peerName);
          await capture(page, info, `account-${kind}-phone-people-reconnected`);
          await page.keyboard.press('Escape');
          await expect(people).toHaveCount(0);
          await capture(page, info, `account-${kind}-phone-reconnected`);
        }
        expect(errors).toEqual([]);
      } finally {
        await network.setOffline(false);
        await peer?.close();
        db.close();
      }
    });
  }

  test(`${kind} guest theatre keeps viewer permissions and revocation boundaries`, async ({
    browser,
    context,
    baseURL,
  }, info) => {
    test.setTimeout(90_000);
    const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
    const auth = new AuthStore(db),
      store = new WorkspaceStore(auth);
    const owner = auth.createUser('Private theatre owner');
    const item = store.create(owner.id, { name: `Guest theatre ${kind}`, kind, parentId: null });
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
    const link = await context.request.put(`/api/items/${item.id}/link`, {
      headers: { Origin: baseURL! },
      data: { role: 'viewer' },
    });
    expect(link.status()).toBe(200);
    const guest = await browser.newContext({ baseURL });
    const page = await guest.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.goto((await link.json()).url);
      const editor = page.getByRole('region', {
        name: kind === 'sheet' ? 'Sheet document' : 'Doc document',
        exact: true,
      });
      await expect(page.getByRole('status', { name: 'Connection status', exact: true })).toHaveText(
        'Online',
        { timeout: 30_000 },
      );
      await expect(editor.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled();
      for (const variant of variants) {
        await page.setViewportSize({ width: variant.width, height: variant.height });
        await page.emulateMedia({ colorScheme: variant.theme, reducedMotion: 'reduce' });
        await expect(page.locator('html')).toHaveAttribute('data-theme', variant.theme);
        await expect(
          page.getByText('This content is protected. This action is not allowed.', { exact: true }),
        ).not.toBeVisible();
        await capture(page, info, `guest-${kind}-${variant.name}-normal`);
        await page.getByRole('button', { name: 'People in this document', exact: true }).click();
        await expect(
          page.getByRole('dialog', { name: 'People in this document', exact: true }),
        ).not.toContainText(owner.name);
        await capture(page, info, `guest-${kind}-${variant.name}-people`);
        await page.keyboard.press('Escape');
        await expect(
          page.getByRole('dialog', { name: 'People in this document', exact: true }),
        ).toHaveCount(0);
        await page.getByRole('button', { name: 'Enter theatre mode', exact: true }).click();
        await capture(page, info, `guest-${kind}-${variant.name}-theatre`);
        await expect(editor.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled();
        for (const name of ['Document actions', 'My files', 'Versions', 'Download Univer file'])
          await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
        await expect(page.getByRole('link', { name: 'Your profile', exact: true })).toHaveCount(0);
        await page.getByRole('button', { name: 'Exit theatre mode', exact: true }).click();
      }
      await page.getByRole('button', { name: 'Enter theatre mode', exact: true }).click();
      const revoked = await context.request.put(`/api/items/${item.id}/link`, {
        headers: { Origin: baseURL! },
        data: { role: null },
      });
      expect(revoked.status()).toBe(200);
      await expect(page.getByText('This link no longer works.', { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(editor).toHaveCount(0);
      await expect(page.getByText(item.name, { exact: true })).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Exit theatre mode', exact: true }),
      ).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await guest.close();
      db.close();
    }
  });
}
