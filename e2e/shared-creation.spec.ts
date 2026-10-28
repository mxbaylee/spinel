import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { IWorkbookData } from '@univerjs/core';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';

test('collaborator creates and edits in a shared folder; owner refreshes the same file', async ({
  page,
  context,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth);
  const owner = auth.createUser('Alex Kim');
  const collaborator = auth.createUser('Sam Lee');
  const folder = workspace.create(owner.id, { name: 'Trip 2027', kind: 'folder', parentId: null });
  workspace.share(owner.id, folder.id, collaborator.id, 'editor');
  const cookie = (id: string) => ({
    name: COOKIE_NAME,
    value: auth.createSession(id).token,
    url: baseURL!.replace('http:', 'https:'),
    secure: true,
    httpOnly: true,
    sameSite: 'Strict' as const,
  });
  await context.addCookies([cookie(owner.id)]);
  const second = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  await second.addCookies([cookie(collaborator.id)]);
  const other = await second.newPage();
  const errors: string[] = [];
  let stage = 'open-owner-and-collaborator-folder';
  for (const tab of [page, other]) tab.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`/?item=${folder.id}`);
    await expect(page.getByText('This folder is empty.')).toBeVisible();
    await other.goto(`/?item=${folder.id}`);
    await expect(other.getByRole('heading', { name: folder.name, exact: true })).toBeVisible();
    stage = 'create-and-edit-shared-sheet';
    await other.getByRole('button', { name: 'New', exact: true }).click();
    await other.getByRole('menuitem', { name: 'Sheet', exact: true }).click();
    const dialog = other.getByRole('dialog', { name: 'New sheet', exact: true });
    await expect(dialog).toContainText('This item will belong to Alex Kim.');
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Travel budget');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    const sheet = other.getByRole('region', { name: 'Sheet document', exact: true });
    await expect(sheet.getByRole('status', { name: 'Save status' })).toHaveText(
      'All changes saved.',
      {
        timeout: 20_000,
      },
    );
    const itemId = new URL(other.url()).searchParams.get('item')!;
    const nameBox = sheet.getByRole('textbox').nth(2);
    await nameBox.fill('A1');
    await nameBox.press('Enter');
    await other.keyboard.type('2027');
    await other.keyboard.press('Enter');
    const serverCell = async () => {
      const response = await context.request.get(`/api/items/${itemId}/sheet`);
      expect(response.status()).toBe(200);
      const { snapshot } = (await response.json()) as { snapshot: IWorkbookData };
      return snapshot.sheets[snapshot.sheetOrder[0]].cellData?.[0]?.[0]?.v;
    };
    await expect.poll(serverCell).toBe(2027);
    await expect(sheet.getByRole('status', { name: 'Save status' })).toHaveText(
      'All changes saved.',
    );
    expect(workspace.fileOwner(itemId)).toBe(owner.id);
    expect(workspace.get(collaborator.id, itemId)).toMatchObject({
      parentId: folder.id,
      access: 'editor',
      ownerName: owner.name,
      createdByName: collaborator.name,
    });
    await other.getByRole('button', { name: 'Back to files', exact: true }).click();
    await expect(other.getByRole('heading', { name: folder.name, exact: true })).toBeVisible();
    const row = other.getByRole('button', { name: 'Travel budget Sheet', exact: true });
    await expect(row).toContainText('Shared · Can edit');
    await expect(row).toContainText('Owner: Alex Kim');
    await expect(row).toContainText('Created by Sam Lee');
    stage = 'verify-editor-row-actions';
    await other
      .getByRole('button', { name: 'More actions for Travel budget', exact: true })
      .click();
    const actions = other.getByRole('menu');
    // Prove the menu is ready before checking absent owner-only actions or
    // dismissing it; absence alone also passes before the portal has mounted.
    await expect(actions.getByRole('menuitem', { name: 'Open', exact: true })).toBeVisible();
    for (const name of ['Rename…', 'Move…', 'Move to Trash', 'Share…'])
      await expect(actions.getByRole('menuitem', { name, exact: true })).toHaveCount(0);
    await actions.press('Escape');
    await expect(actions).toHaveCount(0);

    stage = 'capture-light-dark-phone';
    await mkdir('test-results/theme-screenshots', { recursive: true });
    for (const [theme, width] of [
      ['light', 1440],
      ['dark', 1440],
      ['light', 390],
    ] as const) {
      await other.emulateMedia({ colorScheme: theme });
      await other.setViewportSize({ width, height: 844 });
      await expect(other.locator('html')).toHaveAttribute('data-theme', theme);
      await expect
        .poll(() => other.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await other.screenshot({
        path: `test-results/theme-screenshots/spn-069-shared-folder-${theme}-${width}-${info.project.name}.png`,
        animations: 'disabled',
      });
      await other.getByRole('button', { name: 'New', exact: true }).click();
      await other.getByRole('menuitem', { name: 'Doc', exact: true }).click();
      await expect(other.getByRole('dialog', { name: 'New doc' })).toContainText(
        'This item will belong to Alex Kim.',
      );
      await other.screenshot({
        path: `test-results/theme-screenshots/spn-069-shared-new-${theme}-${width}-${info.project.name}.png`,
        animations: 'disabled',
      });
      await other.getByRole('button', { name: 'Cancel', exact: true }).click();
    }

    stage = 'owner-refresh-and-open';
    await page.bringToFront();
    await page.getByRole('button', { name: 'More actions for Trip 2027', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Refresh folder', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Travel budget Sheet', exact: true }),
    ).toContainText('Created by Sam Lee');
    await page.getByRole('button', { name: 'Travel budget Sheet', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`item=${itemId}$`));
    await expect(
      page
        .getByRole('region', { name: 'Sheet document' })
        .getByRole('status', { name: 'Save status' }),
    ).toHaveText('All changes saved.', { timeout: 20_000 });
    expect(await serverCell()).toBe(2027);

    stage = 'viewer-denial';
    workspace.share(owner.id, folder.id, collaborator.id, 'viewer');
    await other.reload();
    await expect(other.getByRole('heading', { name: folder.name, exact: true })).toBeVisible();
    await expect(other.getByRole('button', { name: 'New', exact: true })).toHaveCount(0);
    await expect(other.getByLabel('Univer file or archive')).toHaveCount(0);
    const denied = await second.request.post('/api/items', {
      headers: { Origin: baseURL! },
      data: { name: 'Cannot create', kind: 'doc', parentId: folder.id },
    });
    expect(denied.status()).toBe(403);
    expect(workspace.children(owner.id, folder.id)).toHaveLength(1);
    expect(errors).toEqual([]);
    stage = 'completed';
  } finally {
    try {
      await writeFile(
        info.outputPath('sync-diagnostics.json'),
        JSON.stringify(
          { stage, errors, ownerUrl: page.url(), collaboratorUrl: other.url() },
          null,
          2,
        ),
      );
    } finally {
      try {
        await second.close();
      } finally {
        db.close();
      }
    }
  }
});
