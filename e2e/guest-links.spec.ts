import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';

for (const kind of ['sheet', 'doc'] as const) {
  test(`${kind} guest links isolate visitors, preserve tab identities and revoke open editors`, async ({
    page,
    context,
    browser,
    baseURL,
  }, info) => {
    test.setTimeout(150_000);
    const db = openDatabase(`test-results/${info.project.name}/app.sqlite`),
      auth = new AuthStore(db),
      workspace = new WorkspaceStore(auth);
    const owner = auth.createUser('Private owner ' + info.testId),
      item = workspace.create(owner.id, { kind, name: `Guest ${kind}`, parentId: null });
    const guest = await browser.newContext(),
      first = await guest.newPage(),
      second = await guest.newPage();
    const captureGuest = async (role: string) => {
      await mkdir('test-results/theme-screenshots', { recursive: true });
      for (const [theme, width, variant] of [
        ['light', 1280, 'light'],
        ['dark', 1280, 'dark'],
        ['light', 390, 'phone'],
      ] as const) {
        await first.setViewportSize({ width, height: 900 });
        await first.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await expect(first.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(
          first.getByRole('status', { name: 'Connection status', exact: true }),
        ).toHaveText('Online');
        // The SDK's initial viewer-protection notice can cover the phone header.
        // Wait for its real dismissal; screenshot CSS must not hide live UI.
        await expect(
          first.getByText('This content is protected. This action is not allowed.', {
            exact: true,
          }),
        ).not.toBeVisible();
        await first.screenshot({
          path: `test-results/theme-screenshots/spn-042-guest-${kind}-${role}-${variant}-${info.project.name}.png`,
          fullPage: true,
          animations: 'disabled',
        });
      }
      await first.setViewportSize({ width: 1440, height: 1000 });
      await first.emulateMedia({ colorScheme: 'light' });
    };
    const diagnostics: string[] = [];
    for (const view of [page, first, second]) {
      view.on('pageerror', (error) => diagnostics.push(error.message.slice(0, 300)));
      view.on('response', (response) => {
        if (response.status() >= 400)
          diagnostics.push(`${response.status()} ${new URL(response.url()).pathname}`);
      });
      view.on('websocket', (socket) =>
        socket.on('framesent', ({ payload }) => {
          const text = String(payload);
          if (
            text.includes('update_cursor') &&
            diagnostics.filter((line) => line.startsWith('cursor ')).length < 2
          )
            diagnostics.push('cursor ' + text.slice(0, 1000));
        }),
      );
      view.setDefaultTimeout(15_000);
      await view.setViewportSize({ width: 1440, height: 1000 });
    }
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
    const region = (view: Page) =>
      view.getByRole('region', {
        name: kind === 'sheet' ? 'Sheet document' : 'Doc document',
        exact: true,
      });
    const saved = async (view: Page) => {
      await expect(region(view).getByRole('status', { name: 'Save status' })).toHaveText(
        'All changes saved.',
        { timeout: 30_000 },
      );
      await expect(
        view.getByRole('button', { name: 'Save details: Saved', exact: true }),
      ).toBeVisible();
    };
    const edit = async (view: Page, value: string, cell = 'A1') => {
      if (kind === 'sheet') {
        const address = region(view).getByRole('textbox').nth(2);
        await address.fill(cell);
        await address.press('Enter');
        await view.keyboard.type(value);
        await view.keyboard.press('Enter');
      } else {
        await region(view)
          .locator('.univer-container')
          .click({ position: { x: 130, y: 200 } });
        await view.keyboard.press('ControlOrMeta+End');
        await view.keyboard.type(value);
      }
    };
    try {
      await page.goto('/');
      await page
        .getByRole('button', { name: `More actions for Guest ${kind}`, exact: true })
        .click();
      await page.getByRole('menuitem', { name: 'Share…', exact: true }).click();
      const controls = page.getByRole('region', { name: 'Guest link', exact: true });
      if (kind === 'doc') {
        await expect(controls).toContainText('Social previews show only the file title and type');
        for (const [mode, width] of [
          ['light', 1440],
          ['dark', 1440],
          ['phone', 390],
        ] as const) {
          await page.setViewportSize({ width, height: 1000 });
          await page.emulateMedia({ colorScheme: mode === 'dark' ? 'dark' : 'light' });
          await expect(page.locator('html')).toHaveAttribute(
            'data-theme',
            mode === 'dark' ? 'dark' : 'light',
          );
          await page.getByRole('dialog', { name: 'Share Guest doc', exact: true }).screenshot({
            path: `test-results/theme-screenshots/share-preview-${mode}-${info.project.name}.png`,
          });
        }
        await page.setViewportSize({ width: 1440, height: 1000 });
      }
      await controls.getByRole('button', { name: 'Create link', exact: true }).click();
      const viewLink = await controls
        .getByLabel('Guest link address', { exact: true })
        .inputValue();
      await first.goto(viewLink);
      await expect(region(first).getByRole('status', { name: 'Save status' })).toHaveText(
        'View only — reload after your access changes.',
        { timeout: 30_000 },
      );
      await expect(
        first.getByRole('button', { name: 'Save details: View only', exact: true }),
      ).toBeVisible();
      const viewOnlyAccess = first
        .getByRole('region', { name: 'Document workspace', exact: true })
        .locator('header .editor-access');
      await expect(viewOnlyAccess).toHaveText('View only');
      await expect(viewOnlyAccess).toBeVisible();
      await expect(first).toHaveTitle(`${item.name} — Spinel`);
      await captureGuest('viewer');
      await expect(first.getByText('Your workspace', { exact: true })).toHaveCount(0);
      await expect(first.getByRole('navigation', { name: 'Workspace' })).toHaveCount(0);
      expect(await first.locator('body').innerText()).not.toContain(owner.name);
      expect((await guest.request.get(baseURL + '/api/items')).status()).toBe(401);
      await controls
        .getByRole('combobox', { name: 'Link access', exact: true })
        .selectOption('editor');
      await controls.getByRole('button', { name: 'Guest link actions', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Replace link…', exact: true }).click();
      const replacement = page.getByRole('dialog', { name: 'Replace the link?', exact: true });
      await expect(replacement).toContainText('The old link stops working at once');
      await replacement.getByRole('button', { name: 'Replace link', exact: true }).click();
      await expect(controls.getByLabel('Guest link address', { exact: true })).not.toHaveValue(
        viewLink,
      );
      const editLink = await controls
        .getByLabel('Guest link address', { exact: true })
        .inputValue();
      expect(editLink).not.toBe(viewLink);
      await expect(first.getByRole('alert')).toHaveText('This link no longer works.');
      await expect(first).toHaveTitle('Spinel');
      // Both tabs exchange at once; Web Locks + valid-cookie reuse must produce one identity.
      await Promise.all([first.goto(editLink), second.goto(editLink)]);
      await saved(first);
      await saved(second);
      await expect(first).toHaveTitle(`${item.name} — Spinel`);
      await expect(second).toHaveTitle(`${item.name} — Spinel`);
      await captureGuest('editor');
      expect(
        db
          .prepare('SELECT count(*) AS n FROM workspace_guest_sessions WHERE item_id=?')
          .get(item.id)?.n,
      ).toBe(1);
      await edit(first, 'Guest one 314');
      await saved(first);
      await edit(second, 'Guest two 159', 'B1');
      await saved(second);
      await first.getByRole('button', { name: 'People in this document', exact: true }).click();
      await expect(
        first
          .getByRole('dialog', { name: 'People in this document', exact: true })
          .getByRole('button', { name: 'Go to Guest', exact: true }),
      ).toBeVisible();
      await first
        .getByRole('dialog', { name: 'People in this document', exact: true })
        .getByRole('button', { name: 'Close dialog', exact: true })
        .click();
      const live = async () =>
        (await (await context.request.get(`/api/items/${item.id}/${kind}`)).json()).snapshot;
      await expect.poll(async () => JSON.stringify(await live())).toContain('Guest one 314');
      await expect.poll(async () => JSON.stringify(await live())).toContain('Guest two 159');
      await first.reload();
      await saved(first);
      await expect(first).toHaveTitle(`${item.name} — Spinel`);
      // A failed metadata poll must preserve the existing editor, including an unfinished edit.
      await first.route(`**/api/guest/${item.id}`, (route) => route.abort('failed'));
      if (kind === 'sheet') {
        const address = region(first).getByRole('textbox').nth(2);
        await address.fill('C1');
        await address.press('Enter');
        await first.keyboard.type('Kept during retry');
      } else {
        await edit(first, 'Kept during retry');
      }
      const connection = first.getByRole('status', { name: 'Connection status', exact: true });
      await expect(connection).toHaveText(/^(Offline|Reconnecting)$/);
      const network = first.getByRole('button', { name: /^(Offline|Reconnecting) — / });
      await expect(network).toHaveCount(1);
      await network.hover();
      const explanation = first.getByRole('dialog', { name: 'Connection details', exact: true });
      await expect(explanation).toContainText(/offline|connect/i);
      expect(await explanation.innerText()).not.toContain(owner.name);
      expect(await first.locator('body').innerText()).not.toContain(owner.name);
      await expect(first.getByRole('navigation', { name: 'Workspace' })).toHaveCount(0);
      await first.screenshot({
        path: `test-results/theme-screenshots/spn-042-guest-${kind}-interrupted-light-${info.project.name}.png`,
        fullPage: true,
        animations: 'disabled',
      });
      // Do not send Escape to an unfinished cell while checking its network popover.
      await first.mouse.move(0, 0);
      await expect(region(first)).toBeVisible();
      if (kind === 'sheet')
        await expect(region(first).getByRole('status', { name: 'Save status' })).toContainText(
          'Editing cell',
        );
      if (kind === 'sheet') {
        // Reopening a valid link after a clean-URL reload must still protect an unfinished cell.
        const warning = first.waitForEvent('dialog');
        await first.evaluate((url) => {
          location.hash = new URL(url).hash;
        }, editLink);
        const dialog = await warning;
        expect(dialog.type()).toBe('beforeunload');
        await dialog.dismiss();
        await expect(region(first).getByRole('status', { name: 'Save status' })).toContainText(
          'Editing cell',
        );
      }
      await first.unroute(`**/api/guest/${item.id}`);
      if (kind === 'sheet') await first.keyboard.press('Enter');
      await saved(first);
      // HTTP-only interruption must recover even if the room socket stayed up.
      await expect(connection).toHaveText('Online', { timeout: 15_000 });
      await expect.poll(async () => JSON.stringify(await live())).toContain('Kept during retry');
      await controls.getByRole('button', { name: 'Guest link actions', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Turn off link', exact: true }).click();
      await expect(first.getByRole('alert')).toHaveText('This link no longer works.');
      await expect(second.getByRole('alert')).toHaveText('This link no longer works.');
      await expect(first).toHaveTitle('Spinel');
      await expect(second).toHaveTitle('Spinel');
      await expect(region(first)).toHaveCount(0);
      await second.goto(editLink);
      await expect(second.getByRole('alert')).toHaveText('This link no longer works.');
      await page.goto(`/?item=${item.id}`);
      await saved(page);
      expect(JSON.stringify(await live())).toContain('Guest one 314');
    } catch (cause) {
      console.log('Guest fixture diagnostics', diagnostics.slice(-20));
      await page.screenshot({ path: info.outputPath('test-failed-owner-before-cleanup.png') });
      throw cause;
    } finally {
      await guest.close();
      await page.goto('/sign-in').catch(() => {});
      db.prepare('DELETE FROM workspace_items WHERE owner_id=?').run(owner.id);
      db.prepare('DELETE FROM auth_users WHERE id=?').run(owner.id);
      db.close();
    }
  });
}
