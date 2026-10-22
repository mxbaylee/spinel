import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page, Locator } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { WorkspaceFiles } from '../src/server/workspace/files.ts';
import type { FileKind } from '../src/shared/workspace.ts';

test('Owner delegates file administration on every outer type, administrators manage access and lose downgraded authority', async ({
  page,
  context,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(150_000);
  page.setDefaultTimeout(15_000);
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db),
    store = new WorkspaceStore(auth, { spacesEnabled: true }),
    files = new WorkspaceFiles(store);
  const owner = auth.createUser('Role owner ' + info.testId),
    admin = auth.createUser('Role delegate ' + info.testId),
    peer = auth.createUser('Role recipient ' + info.testId);
  const cookie = (id: string) => ({
    name: COOKIE_NAME,
    value: auth.createSession(id).token,
    url: baseURL!.replace('http:', 'https:'),
    secure: true,
    httpOnly: true,
    sameSite: 'Strict' as const,
  });
  await context.addCookies([cookie(owner.id)]);
  const second = await browser.newContext({ baseURL, viewport: { width: 1280, height: 1000 } });
  await second.addCookies([cookie(admin.id)]);
  const other = await second.newPage();
  other.setDefaultTimeout(15_000);
  const destination = files.create(owner.id, {
    kind: 'folder',
    name: 'Admin destination ' + info.testId,
    parentId: null,
  });
  files.share(owner.id, destination.id, admin.id, 'admin');
  const headers = { Origin: baseURL!, 'Content-Type': 'application/json' };
  async function action(tab: Page, kind: FileKind, name: string, verb: string) {
    if (kind === 'space') {
      await tab.getByRole('button', { name: `Space actions for ${name}`, exact: true }).click();
      await tab.getByRole('menuitem', { name: verb, exact: true }).click();
    } else await tab.getByRole('button', { name: `${verb} ${name}`, exact: true }).click();
  }
  async function sharing(tab: Page, kind: FileKind, name: string) {
    await action(tab, kind, name, 'Share');
    return tab.getByRole('region', { name: `Share ${name}`, exact: true });
  }
  async function grant(panel: Locator, name: string, role: string) {
    await panel
      .getByRole('combobox', { name: `Access for ${name}`, exact: true })
      .selectOption(role);
    const response = panel
      .page()
      .waitForResponse(
        (response) => response.url().endsWith('/sharing') && response.request().method() === 'PUT',
      );
    await panel.getByRole('button', { name: `Apply access for ${name}`, exact: true }).click();
    expect((await response).status()).toBe(200);
    await expect(panel.getByText(`Access updated for ${name}.`, { exact: true })).toBeVisible();
  }
  try {
    for (const kind of ['doc', 'sheet', 'folder', 'space'] as const) {
      const name = `Delegated ${kind} ${info.testId}`;
      const item = files.create(owner.id, { kind, name, parentId: null });
      await page.goto('/');
      const ownerPanel = await sharing(page, kind, name);
      await grant(ownerPanel, admin.name, 'admin');
      await other.goto('/');
      await other.getByRole('button', { name: 'Shared with me', exact: true }).click();
      const panel = await sharing(other, kind, name);
      await expect(
        panel.getByRole('combobox', { name: `Access for ${owner.name}`, exact: true }),
      ).toHaveCount(0);
      for (const role of ['admin', 'editor', 'viewer', '']) {
        await grant(panel, peer.name, role);
        if (role) expect(files.get(peer.id, item.id).access).toBe(role);
        else expect(() => files.get(peer.id, item.id)).toThrow();
      }
      if (kind !== 'folder') {
        expect(
          (
            await second.request.put(`/api/items/${item.id}/link`, {
              headers,
              data: { role: 'admin' },
            })
          ).status(),
        ).toBe(400);
        await expect(panel.getByLabel('Link access').locator('option[value="admin"]')).toHaveCount(
          0,
        );
        await panel.getByRole('button', { name: 'Create guest link', exact: true }).click();
        if (kind === 'space')
          await other.getByRole('button', { name: 'Create view link', exact: true }).click();
        await expect(
          panel.getByRole('button', { name: 'Turn link off', exact: true }),
        ).toBeVisible();
        await panel.getByRole('button', { name: 'Turn link off', exact: true }).click();
        if (kind === 'space')
          await other
            .getByRole('dialog', { name: 'Turn off this Space link?' })
            .getByRole('button', { name: 'Turn link off', exact: true })
            .click();
      }
      await panel.getByRole('button', { name: 'Close sharing', exact: true }).click();
      await action(other, kind, name, 'Rename');
      const rename =
        kind === 'space'
          ? other.getByRole('dialog', { name: 'Rename Space' })
          : other.getByRole('form', { name: 'Rename item' });
      await rename.getByRole('textbox', { name: 'Name', exact: true }).fill(name + ' renamed');
      await rename.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(rename).toBeHidden();
      expect(files.get(owner.id, item.id).name).toBe(name + ' renamed');
      if (kind === 'folder') {
        await expect(
          other
            .getByRole('complementary', { name: 'Folders' })
            .getByRole('button', { name: name + ' renamed', exact: true }),
        ).toHaveCount(0);
        await other.getByRole('button', { name: `File ${name} renamed`, exact: true }).click();
        const filing = other.getByRole('form', { name: 'File shared item' });
        await expect(
          filing.getByRole('option', { name: name + ' renamed', exact: true }),
        ).toHaveCount(0);
        await filing.getByRole('button', { name: 'Cancel', exact: true }).click();
      }
      await action(other, kind, name + ' renamed', 'Move');
      const move =
        kind === 'space'
          ? other.getByRole('dialog', { name: 'Move Space' })
          : other.getByRole('form', { name: 'Move item' });
      await move
        .getByRole('combobox', { name: 'Destination', exact: true })
        .selectOption(destination.id);
      for (const [theme, width, variant] of [
        ['light', 1280, 'light'],
        ['dark', 1280, 'dark'],
        ['light', 390, 'phone'],
      ] as const) {
        await other.setViewportSize({ width, height: 1000 });
        await other.emulateMedia({ colorScheme: theme });
        await expect(other.locator('html')).toHaveAttribute('data-theme', theme);
        await mkdir('test-results/theme-screenshots', { recursive: true });
        await other.screenshot({
          path: `test-results/theme-screenshots/spn-079-${kind}-move-${variant}-${info.project.name}.png`,
        });
      }
      await other.setViewportSize({ width: 1280, height: 1000 });
      await move.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(move).toBeHidden();
      expect(files.get(owner.id, item.id).parentId).toBe(destination.id);
      expect(store.fileOwner(item.id)).toBe(owner.id);
      // Remove inherited authority before testing direct downgrade/revoke.
      files.share(owner.id, destination.id, admin.id, null);
      await grant(ownerPanel, admin.name, 'editor');
      expect(
        (
          await second.request.patch(`/api/items/${item.id}`, { headers, data: { name: 'Denied' } })
        ).status(),
      ).toBe(403);
      await other.reload();
      await other.getByRole('button', { name: 'Shared with me', exact: true }).click();
      await expect(
        other.getByRole('button', {
          name: kind === 'space' ? `Space actions for ${name} renamed` : `Share ${name} renamed`,
          exact: true,
        }),
      ).toHaveCount(0);
      await grant(ownerPanel, admin.name, '');
      expect((await second.request.get(`/api/items/${item.id}`)).status()).toBe(404);
      expect(files.get(owner.id, item.id).access).toBe('owner');
      files.share(owner.id, item.id, admin.id, 'admin');
      expect(
        (await second.request.post(`/api/items/${item.id}/trash`, { headers, data: {} })).status(),
      ).toBe(200);
      expect(
        (
          await second.request.post(`/api/items/${item.id}/restore`, { headers, data: {} })
        ).status(),
      ).toBe(404);
      files.share(owner.id, destination.id, admin.id, 'admin');
    }
    expect((await second.request.get('/api/admin/users')).status()).toBe(403);
  } finally {
    await second.close();
    db.close();
  }
});
