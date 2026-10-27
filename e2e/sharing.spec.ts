import { syncNetwork } from './sync-network.ts';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { IWorkbookData, ICellData } from '@univerjs/core';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';

test('owner shares future folder contents, collaborator edits, and open editors honor downgrade and revocation', async ({
  page,
  context,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(10000);
  await page.setViewportSize({ width: 1440, height: 1100 });
  const db = openDatabase(
    testInfo.project.name === 'development'
      ? 'test-results/development/app.sqlite'
      : 'test-results/production/app.sqlite',
  );
  const auth = new AuthStore(db),
    owner = auth.createUser('Sharing owner ' + testInfo.testId),
    collaborator = auth.createUser('Sharing person ' + testInfo.testId);
  const cookie = (id: string) => ({
    name: COOKIE_NAME,
    value: auth.createSession(id).token,
    url: baseURL!.replace('http:', 'https:'),
    secure: true,
    httpOnly: true,
    sameSite: 'Strict' as const,
  });
  await context.addCookies([cookie(owner.id)]);
  const second = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1100 } });
  const network = await syncNetwork(second);
  await second.addCookies([cookie(collaborator.id)]);
  const other = await second.newPage();
  other.setDefaultTimeout(10000);
  const errors: string[] = [];
  const permissionWrites: string[] = [];
  second.on('request', (request) => {
    if (request.url().includes('/authz/') && ['PUT', 'DELETE', 'PATCH'].includes(request.method()))
      permissionWrites.push(request.url());
  });
  await second.grantPermissions(['clipboard-read', 'clipboard-write']);
  let releasePending = () => {};
  let heldChanges = 0;
  for (const tab of [page, other]) tab.on('pageerror', (e) => errors.push(e.message));
  async function create(name: string, type: string) {
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByRole('menuitem', { name: type, exact: true }).click();
    const form = page.getByRole('form', { name: 'New item' });
    await form.getByRole('combobox', { name: 'Type', exact: true }).selectOption({ label: type });
    await form.getByLabel('Name', { exact: true }).fill(name);
    await form.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(form).toBeHidden();
  }
  async function typeCell(tab: Page, value: string) {
    const nameBox = tab
      .getByRole('region', { name: 'Sheet document', exact: true })
      .getByRole('textbox')
      .nth(2);
    await nameBox.fill('A1');
    await nameBox.press('Enter');
    await tab.keyboard.type(value);
    await tab.keyboard.press('Enter');
  }
  const shareRegion = page.getByRole('dialog', { name: 'Share Shared plans', exact: true });
  async function grant(role: string) {
    await shareRegion
      .getByRole('button', { name: `Edit access for ${collaborator.name}`, exact: true })
      .click();
    await shareRegion
      .getByRole('combobox', { name: `Access for ${collaborator.name}`, exact: true })
      .selectOption(role);
    await shareRegion.getByRole('button', { name: /^(Share|Save changes)$/ }).click();
    await expect(
      shareRegion
        .getByRole('status')
        .filter({ hasText: `Access updated for ${collaborator.name}.` }),
    ).toHaveText(`Access updated for ${collaborator.name}.`);
  }
  try {
    await page.goto('/');
    await create('Shared plans', 'Folder');
    await page.getByRole('button', { name: 'More actions for Shared plans', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Share…', exact: true }).click();
    await grant('editor');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await shareRegion.getByRole('button', { name: 'Copy account link', exact: true }).click();
    await expect(shareRegion.getByText('Account link copied.', { exact: true })).toBeVisible();
    const address = await page.evaluate(() => navigator.clipboard.readText());
    await other.goto(address);
    await expect(other.getByRole('heading', { name: 'Shared plans', exact: true })).toBeVisible();
    await expect(other.getByRole('button', { name: 'New', exact: true })).toBeHidden();
    await other.getByRole('button', { name: 'More actions for Shared plans', exact: true }).click();
    const folderMenu = other.getByRole('menu', {
      name: 'More actions for Shared plans',
      exact: true,
    });
    await expect(folderMenu).toBeVisible();
    await expect(other.getByRole('menuitem', { name: 'Share…', exact: true })).toHaveCount(0);
    await other.keyboard.press('Escape');
    await expect(folderMenu).toBeHidden();
    await shareRegion.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByRole('button', { name: 'Shared plans Folder', exact: true }).click();
    // Create both documents after the grant to prove inheritance applies to future children.
    await create('Nested', 'Folder');
    await page.getByRole('button', { name: 'Nested Folder', exact: true }).click();
    await create('Shared budget', 'Sheet');
    await expect(
      page
        .getByRole('region', { name: 'Sheet document', exact: true })
        .getByRole('status', { name: 'Save status' }),
    ).toHaveText('All changes saved.', { timeout: 20000 });
    const sheetId = new URL(page.url()).searchParams.get('item')!;
    await page.getByRole('button', { name: 'Back to files', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Nested', exact: true })).toBeVisible();
    await create('Shared journal', 'Doc');
    await expect(
      page
        .getByRole('region', { name: 'Doc document', exact: true })
        .getByRole('status', { name: 'Save status' }),
    ).toHaveText('All changes saved.', { timeout: 20000 });
    const docId = new URL(page.url()).searchParams.get('item')!;
    await page.getByRole('button', { name: 'Back to files', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Nested', exact: true })).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('button', { name: 'Shared plans', exact: true })
      .click();
    await page.getByRole('button', { name: 'More actions for Shared plans', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Share…', exact: true }).click();
    // Return to the collaborator before reopening its previously closed menu.
    await other.bringToFront();
    await other.getByRole('button', { name: 'More actions for Shared plans', exact: true }).click();
    await expect(folderMenu).toBeVisible();
    await other.getByRole('menuitem', { name: 'Refresh folder', exact: true }).click();
    await other.getByRole('button', { name: 'Nested Folder', exact: true }).click();
    await expect(
      other.getByRole('button', { name: 'Shared budget Sheet', exact: true }),
    ).toBeVisible();
    await other.getByRole('button', { name: 'Shared journal Doc', exact: true }).click();
    const docStatus = other
      .getByRole('region', { name: 'Doc document', exact: true })
      .getByRole('status', { name: 'Save status' });
    await expect(docStatus).toHaveText('All changes saved.', { timeout: 20000 });
    await expect(
      other.getByRole('button', { name: 'Save details: Saved', exact: true }),
    ).toBeVisible();
    await expect(other.getByRole('heading', { name: 'Shared journal', exact: true })).toBeVisible();
    await other.locator('.univer-container').click({ position: { x: 130, y: 200 } });
    await other.keyboard.type('Written by collaborator');
    const readDoc = async () => await (await context.request.get(`/api/items/${docId}/doc`)).json();
    await expect
      .poll(async () => (await readDoc()).snapshot.body.dataStream)
      .toContain('Written by collaborator');
    await expect(docStatus).toHaveText('All changes saved.');
    await other.getByRole('button', { name: 'Back to files', exact: true }).click();
    await expect(other.getByRole('heading', { name: 'Nested', exact: true })).toBeVisible();
    await expect(other.getByRole('navigation', { name: 'Breadcrumb' })).toHaveText(
      'My files / Shared plans',
    );
    await other
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('button', { name: 'Shared plans', exact: true })
      .click();
    await other.getByRole('button', { name: 'Nested Folder', exact: true }).click();
    await other.getByRole('button', { name: 'Shared budget Sheet', exact: true }).click();
    const sheetStatus = other
      .getByRole('region', { name: 'Sheet document', exact: true })
      .getByRole('status', { name: 'Save status' });
    await expect(sheetStatus).toHaveText('All changes saved.', { timeout: 20000 });
    await expect(
      other.getByRole('button', { name: 'Save details: Saved', exact: true }),
    ).toBeVisible();
    await typeCell(other, '42');
    const readSheet = async () => {
      const saved = await (await context.request.get(`/api/items/${sheetId}/sheet`)).json();
      const snapshot = saved.snapshot as IWorkbookData;
      // Compare effective formatting; public materialization can re-key style IDs.
      for (const sheet of Object.values(snapshot.sheets))
        for (const row of Object.values(sheet.cellData ?? {}))
          for (const value of Object.values(row ?? {}) as (ICellData | null)[])
            if (value && typeof value.s === 'string') value.s = snapshot.styles[value.s];
      snapshot.styles = {};
      return saved;
    };
    await expect
      .poll(async () => {
        const { snapshot } = await readSheet();
        return snapshot.sheets[snapshot.sheetOrder[0]].cellData?.[0]?.[0]?.v;
      })
      .toBe(42);
    await expect(sheetStatus).toHaveText('All changes saved.');
    const savedSheet = await readSheet();
    const openDoc = await second.newPage();
    openDoc.on('pageerror', (e) => errors.push(e.message));
    await openDoc.goto(`${baseURL}/?item=${docId}`);
    const openDocStatus = openDoc
      .getByRole('region', { name: 'Doc document', exact: true })
      .getByRole('status', { name: 'Save status' });
    await expect(openDocStatus).toHaveText('All changes saved.', { timeout: 20000 });
    const beforeDowngradeDoc = await readDoc();
    const pending = new Promise<void>((resolve) => {
      releasePending = resolve;
    });
    network.interceptWrites(async (write) => {
      heldChanges++;
      await pending;
      write.forward();
    });
    await openDoc.locator('.univer-container').click({ position: { x: 130, y: 200 } });
    await openDoc.keyboard.type('Rejected edit');
    await typeCell(other, '99');
    await expect.poll(() => heldChanges).toBeGreaterThanOrEqual(2);
    await grant('viewer');
    releasePending();
    await expect(openDocStatus).toContainText('Access changed', { timeout: 10000 });
    await expect(openDocStatus).toContainText('Copy unsaved changes');
    expect(await readDoc()).toEqual(beforeDowngradeDoc);
    await expect(openDoc.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled();
    await openDoc.bringToFront();
    await openDoc.locator('.univer-container').click({ position: { x: 130, y: 200 } });
    await openDoc.keyboard.press('Control+a');
    await openDoc.keyboard.press('Control+c');
    await expect
      .poll(() => openDoc.evaluate(() => navigator.clipboard.readText()))
      .toContain('Rejected edit');
    await openDoc.close();
    await expect(sheetStatus).toContainText('Access changed', { timeout: 10000 });
    await expect(sheetStatus).toContainText('Copy unsaved changes');
    expect(await readSheet()).toEqual(savedSheet);
    await other.bringToFront();
    const rescueCell = other
      .getByRole('region', { name: 'Sheet document', exact: true })
      .getByRole('textbox')
      .nth(2);
    await rescueCell.fill('A1');
    await rescueCell.press('Enter');
    await other.keyboard.press('Control+c');
    await expect.poll(() => other.evaluate(() => navigator.clipboard.readText())).toContain('99');
    other.once('dialog', (dialog) => dialog.dismiss());
    await other.getByRole('button', { name: 'Back to files', exact: true }).click();
    await expect(other).toHaveURL(new RegExp(sheetId));
    // A fresh viewer uses the SDK's read-only mode and cannot mutate either format.
    other.once('dialog', (dialog) => dialog.accept());
    await other.reload();
    await expect(sheetStatus).toContainText('View only', { timeout: 20000 });
    await expect(other.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled();
    await typeCell(other, '81');
    expect(await readSheet()).toEqual(savedSheet);
    await other.goto(`${baseURL}/?item=${docId}`);
    await expect(docStatus).toContainText('View only', { timeout: 20000 });
    await expect(other.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled();
    const savedDoc = await readDoc();
    await other.keyboard.type('Forbidden');
    expect(await readDoc()).toEqual(savedDoc);
    await grant('');
    await other.reload();
    await expect(
      other.getByRole('heading', { name: "This item isn't available", exact: true }),
    ).toBeVisible();
    await expect(other.getByRole('button', { name: 'Go to My files', exact: true })).toBeVisible();
    expect((await second.request.get(`/api/items/${docId}/doc`)).status()).toBe(404);
    expect((await (await second.request.get('/api/items')).json()).items).toEqual([]);
    // A direct child grant must not expose the now-private shared ancestor names.
    const direct = await context.request.put(`/api/items/${docId}/sharing`, {
      headers: { Origin: baseURL! },
      data: { userId: collaborator.id, role: 'viewer' },
    });
    expect(direct.ok()).toBe(true);
    await other.reload();
    await expect(docStatus).toContainText('View only', { timeout: 20000 });
    await expect(other.getByRole('heading', { name: 'Shared journal', exact: true })).toBeVisible();
    // The compact editor must not expose inaccessible ancestor names either.
    await expect(
      other.getByRole('region', { name: 'Document workspace', exact: true }),
    ).not.toContainText('Shared plans');
    await expect(
      other.getByRole('region', { name: 'Document workspace', exact: true }),
    ).not.toContainText('Nested');
    expect(permissionWrites).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    releasePending();
    network.interceptWrites(undefined);
    try {
      await network.drainWrites();
    } finally {
      await second.close();
      while (db.prepare('SELECT id FROM workspace_items WHERE owner_id=?').get(owner.id)) {
        db.prepare(
          'DELETE FROM workspace_items WHERE owner_id=? AND id NOT IN (SELECT parent_id FROM workspace_items WHERE parent_id IS NOT NULL)',
        ).run(owner.id);
      }
      for (const id of [owner.id, collaborator.id])
        db.prepare('DELETE FROM auth_users WHERE id=?').run(id);
      db.close();
    }
  }
});
