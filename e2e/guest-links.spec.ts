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
    const saved = (view: Page) =>
      expect(region(view).getByRole('status', { name: 'Save status' })).toHaveText(
        'All changes saved.',
        { timeout: 30_000 },
      );
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
      await page.getByRole('button', { name: `Share Guest ${kind}`, exact: true }).click();
      const controls = page.getByRole('region', { name: 'Guest link', exact: true });
      await controls.getByRole('button', { name: 'Create guest link', exact: true }).click();
      const viewLink = await controls
        .getByLabel('Guest link address', { exact: true })
        .inputValue();
      await first.goto(viewLink);
      await expect(region(first).getByRole('status', { name: 'Save status' })).toHaveText(
        'View only — reload after your access changes.',
        { timeout: 30_000 },
      );
      await expect(first.getByText('View-only link.', { exact: true })).toBeVisible();
      await expect(first.getByText('Your workspace', { exact: true })).toHaveCount(0);
      await expect(first.getByRole('navigation', { name: 'Workspace' })).toHaveCount(0);
      expect(await first.locator('body').innerText()).not.toContain(owner.name);
      expect((await guest.request.get(baseURL + '/api/items')).status()).toBe(401);
      await controls
        .getByRole('combobox', { name: 'Link access', exact: true })
        .selectOption('editor');
      await controls.getByRole('button', { name: 'Create replacement link', exact: true }).click();
      await expect(controls.getByLabel('Guest link address', { exact: true })).not.toHaveValue(
        viewLink,
      );
      const editLink = await controls
        .getByLabel('Guest link address', { exact: true })
        .inputValue();
      expect(editLink).not.toBe(viewLink);
      await expect(first.getByRole('alert')).toHaveText('This link no longer works.');
      // Both tabs exchange at once; Web Locks + valid-cookie reuse must produce one identity.
      await Promise.all([first.goto(editLink), second.goto(editLink)]);
      await saved(first);
      await saved(second);
      expect(
        db
          .prepare('SELECT count(*) AS n FROM workspace_guest_sessions WHERE item_id=?')
          .get(item.id)?.n,
      ).toBe(1);
      await edit(first, 'Guest one 314');
      await saved(first);
      await edit(second, 'Guest two 159', 'B1');
      await saved(second);
      await expect(
        first
          .getByRole('group', { name: 'People in this document' })
          .getByRole('button', { name: 'Go to Guest', exact: true }),
      ).toBeVisible();
      const live = async () =>
        (await (await context.request.get(`/api/items/${item.id}/${kind}`)).json()).snapshot;
      await expect.poll(async () => JSON.stringify(await live())).toContain('Guest one 314');
      await expect.poll(async () => JSON.stringify(await live())).toContain('Guest two 159');
      await first.reload();
      await saved(first);
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
      await expect(
        first.getByText('Connection interrupted. Keep this tab open; retrying…', { exact: true }),
      ).toBeVisible();
      await expect(region(first)).toBeVisible();
      if (kind === 'sheet')
        await expect(region(first).getByRole('status', { name: 'Save status' })).toContainText(
          'Editing cell',
        );
      await first.unroute(`**/api/guest/${item.id}`);
      if (kind === 'sheet') await first.keyboard.press('Enter');
      await saved(first);
      await expect.poll(async () => JSON.stringify(await live())).toContain('Kept during retry');
      await controls.getByRole('button', { name: 'Turn link off', exact: true }).click();
      await expect(first.getByRole('alert')).toHaveText('This link no longer works.');
      await expect(second.getByRole('alert')).toHaveText('This link no longer works.');
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
