import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { SheetStore } from '../src/server/workspace/sheets.ts';
import { DocumentStore } from '../src/server/workspace/documents.ts';
import { SpaceStore } from '../src/server/workspace/spaces.ts';
import { SpaceRecoveryStore } from '../src/server/workspace/space-recovery.ts';
import { TrashStore } from '../src/server/workspace/trash.ts';
import type { TransferPreview } from '../src/shared/adminRecovery.ts';

async function capture(page: Page, info: TestInfo, name: string) {
  await mkdir('test-results/theme-screenshots', { recursive: true });
  for (const [theme, width, variant] of [
    ['light', 1280, 'light'],
    ['dark', 1280, 'dark'],
    ['light', 390, 'phone'],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const dialogs = page.getByRole('dialog').or(page.getByRole('alertdialog'));
    if (!(await dialogs.count())) {
      // Normalize fixed navigation without changing an open modal's scroll lock.
      await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    }
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: `test-results/theme-screenshots/spn-064-${name}-${variant}-${info.project.name}.png`,
      animations: 'disabled',
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
}

async function accountAction(page: Page, name: string, kind: 'reactivate' | 'transfer') {
  await page.getByRole('button', { name: `Actions for ${name}`, exact: true }).click();
  await page
    .getByRole('menuitem', {
      name: kind === 'transfer' ? 'Transfer ownership…' : 'Reactivate…',
      exact: true,
    })
    .click();
  return page.getByRole('dialog', {
    name: kind === 'transfer' ? `Transfer ownership from ${name}` : `Reactivate ${name}?`,
    exact: true,
  });
}

test('Operator hands over retained ordinary and Space contents, then recovers the departed account without its old access', async ({
  page,
  context,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth),
    spaces = new SpaceStore(workspace);
  const suffix = randomUUID().slice(0, 8);
  const operator = auth.createUser(`Recovery Operator ${suffix}`, true);
  const departed = auth.createUser(`Departed collaborator ${suffix}`);
  const recipient = auth.createUser(`Everyday recipient ${suffix}`);
  const collaborator = auth.createUser(`Retained collaborator ${suffix}`);
  const disabled = auth.createUser(`Unavailable recipient ${suffix}`);
  db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(disabled.id);
  const folder = workspace.create(departed.id, {
    kind: 'folder',
    name: `Private project ${suffix}`,
    parentId: null,
  });
  const sheet = workspace.create(departed.id, {
    kind: 'sheet',
    name: `Retained budget ${suffix}`,
    parentId: folder.id,
  });
  const doc = workspace.create(departed.id, {
    kind: 'doc',
    name: `Private journal ${suffix}`,
    parentId: folder.id,
  });
  const trashed = workspace.create(departed.id, {
    kind: 'doc',
    name: `Earlier draft ${suffix}`,
    parentId: null,
  });
  new TrashStore(workspace).trash(departed.id, trashed.id);
  workspace.share(departed.id, folder.id, collaborator.id, 'editor');
  const space = spaces.createRoot(departed.id, {
    name: `Private Space ${suffix}`,
    parentId: folder.id,
  }).item;
  const spaceDoc = spaces.createChild(departed.id, space.id, {
    kind: 'doc',
    name: `Nested private page ${suffix}`,
    parentId: space.id,
  }).item;
  const spaceFolder = spaces.createChild(departed.id, space.id, {
    kind: 'folder',
    name: `Nested private folder ${suffix}`,
    parentId: spaceDoc.id,
  }).item;
  const spaceTrash = spaces.createChild(departed.id, space.id, {
    kind: 'sheet',
    name: `Earlier private sheet ${suffix}`,
    parentId: spaceFolder.id,
  }).item;
  new SpaceRecoveryStore(workspace).trash(departed.id, space.id, spaceTrash.id);
  new SheetStore(workspace).save(departed.id, sheet.id, {
    snapshot: {
      id: sheet.id,
      name: sheet.name,
      appVersion: '1.1.0',
      locale: 'enUS',
      styles: {},
      sheetOrder: ['first'],
      sheets: {
        first: {
          id: 'first',
          name: 'Sheet1',
          rowCount: 100,
          columnCount: 26,
          cellData: { 0: { 0: { v: 'Budget preserved through handover' } } },
        },
      },
    },
    revision: 0,
    writeId: randomUUID(),
  });
  new DocumentStore(workspace).save(departed.id, doc.id, {
    snapshot: { id: doc.id, body: { dataStream: 'Private journal content stays private\r\n' } },
    revision: 0,
    writeId: randomUUID(),
  });
  const link = workspace.links.begin(sheet.id, 'viewer');
  workspace.links.finish(sheet.id, link.epoch, true);
  const oldCredential = `${info.testId}-${suffix}`;
  db.prepare('INSERT INTO auth_passkeys VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
    oldCredential,
    departed.id,
    Buffer.from([1]),
    0,
    '[]',
    'Departed browser',
    'Browser',
    auth.now(),
    null,
    0,
    'singleDevice',
  );
  const oldSession = auth.createSession(departed.id, undefined, oldCredential);
  const cookie = (token: string) => ({
    name: COOKIE_NAME,
    value: token,
    url: baseURL!.replace('http:', 'https:'),
    secure: true,
    httpOnly: true,
    sameSite: 'Strict' as const,
  });
  const member = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  const guest = await browser.newContext({ baseURL });
  const recovered = await browser.newContext({ baseURL });
  const contexts: BrowserContext[] = [member, guest, recovered];
  const memberPage = await member.newPage(),
    guestPage = await guest.newPage(),
    recoveredPage = await recovered.newPage();
  const errors: string[] = [];
  for (const view of [page, memberPage, guestPage, recoveredPage]) {
    view.setDefaultTimeout(15_000);
    view.on('pageerror', (error) => errors.push(error.message));
  }
  const saved = (target = memberPage) =>
    expect(target.getByRole('status', { name: 'Save status' })).toHaveText('All changes saved.', {
      timeout: 30_000,
    });
  const readSheet = async (client = member) => {
    const response = await client.request.get(`/api/items/${sheet.id}/sheet`);
    expect(response.status()).toBe(200);
    return response.json();
  };
  try {
    await context.addCookies([cookie(auth.createSession(operator.id).token)]);
    await member.addCookies([cookie(oldSession.token)]);
    await memberPage.goto(`/?item=${sheet.id}`);
    await saved();
    expect(JSON.stringify((await readSheet()).snapshot)).toContain(
      'Budget preserved through handover',
    );
    await memberPage.getByRole('button', { name: 'Versions', exact: true }).click();
    await memberPage.getByRole('button', { name: 'Name this version', exact: true }).click();
    await memberPage.getByLabel('Version name', { exact: true }).fill('Before departure');
    await memberPage.getByRole('button', { name: 'Save version name' }).click();
    await expect(memberPage.getByText('Before departure', { exact: true })).toBeVisible();
    const retainedHistory = db
      .prepare('SELECT * FROM history_checkpoints WHERE item_id=? ORDER BY id')
      .all(sheet.id);
    expect(retainedHistory.length).toBeGreaterThan(0);
    const retainedDoc = db.prepare('SELECT * FROM doc_snapshots WHERE item_id=?').get(doc.id);
    const retainedSpaceTrash = db
      .prepare('SELECT * FROM workspace_space_trash WHERE space_id=? ORDER BY item_id')
      .all(space.id);

    await page.goto('/admin');
    const account = page.getByRole('region', { name: `${departed.name} account`, exact: true });
    await account
      .getByRole('button', { name: `Actions for ${departed.name}`, exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Disable account…' }).click();
    await page
      .getByRole('dialog', { name: `Disable ${departed.name}?`, exact: true })
      .getByRole('button', { name: 'Confirm removal' })
      .click();
    await expect(account.getByText('Member · Disabled', { exact: true })).toBeVisible();
    expect(auth.session(oldSession.token)).toBeUndefined();
    await expect(memberPage.getByRole('status', { name: 'Save status' })).toContainText(
      'Access changed',
    );
    const beforeRows = db
      .prepare('SELECT * FROM workspace_items WHERE owner_id=? ORDER BY id')
      .all(departed.id);
    await capture(page, info, 'disabled-account');

    // Development StrictMode discards its first preview before consuming the
    // body. Inspect a completed GET, not headers from that stale effect.
    const previewRequest = page.waitForEvent(
      'requestfinished',
      (request) =>
        request.method() === 'GET' &&
        request.url().endsWith(`/admin/users/${departed.id}/transfer-preview`),
    );
    let dialog = await accountAction(page, departed.name, 'transfer');
    const previewResponse = await (await previewRequest).response();
    expect(previewResponse?.status()).toBe(200);
    const preview = (await previewResponse!.json()) as TransferPreview;
    expect(Object.keys(preview).sort()).toEqual(['confirmation', 'counts', 'recipients', 'source']);
    expect(preview.source).toEqual({ id: departed.id, name: departed.name });
    expect(
      preview.recipients.some((entry) =>
        [operator.id, departed.id, disabled.id].includes(entry.id),
      ),
    ).toBe(false);
    for (const item of [folder, sheet, doc, trashed, space, spaceDoc, spaceFolder, spaceTrash]) {
      expect(JSON.stringify(preview)).not.toContain(item.id);
      expect(await page.locator('body').innerText()).not.toContain(item.name);
    }
    await dialog.getByRole('combobox', { name: 'New owner' }).click();
    await page.getByRole('option', { name: recipient.name, exact: true }).click();
    await expect(
      dialog.getByText(`${recipient.name} will own these files.`, { exact: true }),
    ).toBeVisible();
    await capture(page, info, 'transfer-confirmation');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button', { name: `Actions for ${departed.name}` })).toBeFocused();
    expect(
      db.prepare('SELECT * FROM workspace_items WHERE owner_id=? ORDER BY id').all(departed.id),
    ).toEqual(beforeRows);

    dialog = await accountAction(page, departed.name, 'transfer');
    await dialog.getByRole('combobox', { name: 'New owner' }).click();
    await page.getByRole('option', { name: recipient.name, exact: true }).click();
    const transferred = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/admin/users/${departed.id}/transfer`) &&
        response.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: 'Transfer ownership', exact: true }).click();
    expect((await transferred).status()).toBe(204);
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByText(new RegExp(`Ownership transferred from ${departed.name}`)),
    ).toBeVisible();
    expect(
      db.prepare('SELECT count(*) AS n FROM workspace_items WHERE owner_id=?').get(departed.id)?.n,
    ).toBe(0);
    const wrapper = db
      .prepare('SELECT * FROM workspace_items WHERE owner_id=? AND name=?')
      .get(recipient.id, departed.name)!;
    expect(wrapper.kind).toBe('folder');
    for (const row of beforeRows) {
      const after = db.prepare('SELECT * FROM workspace_items WHERE id=?').get(row.id)!;
      expect(after).toEqual({
        ...row,
        owner_id: recipient.id,
        parent_id: row.parent_id === null ? wrapper.id : row.parent_id,
      });
    }
    expect(db.prepare('SELECT * FROM doc_snapshots WHERE item_id=?').get(doc.id)).toEqual(
      retainedDoc,
    );
    expect(
      db.prepare('SELECT * FROM history_checkpoints WHERE item_id=? ORDER BY id').all(sheet.id),
    ).toEqual(retainedHistory);
    expect(
      db
        .prepare('SELECT * FROM workspace_space_trash WHERE space_id=? ORDER BY item_id')
        .all(space.id),
    ).toEqual(retainedSpaceTrash);
    expect(workspace.get(collaborator.id, sheet.id, 'edit').access).toBe('editor');
    expect(spaces.get(recipient.id, space.id, spaceDoc.id).ownerId).toBe(recipient.id);
    expect(spaces.get(collaborator.id, space.id, spaceDoc.id).access).toBe('editor');
    expect(workspace.links.state(sheet.id)?.state).toBe('off');
    expect(() => workspace.links.exchange(sheet.id, link.token!)).toThrow();
    expect((await context.request.get(`/api/items/${sheet.id}/sheet`)).status()).toBe(403);
    await capture(page, info, 'transfer-complete');

    await member.clearCookies();
    await member.addCookies([cookie(auth.createSession(recipient.id).token)]);
    await memberPage.goto('/');
    await expect(memberPage.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(
      memberPage.getByRole('button', { name: `${departed.name} Folder`, exact: true }),
    ).toBeVisible();
    await capture(memberPage, info, 'recipient-dashboard');
    await memberPage.getByRole('button', { name: `${departed.name} Folder`, exact: true }).click();
    await expect(
      memberPage.getByRole('button', { name: `${folder.name} Folder`, exact: true }),
    ).toBeVisible();
    await capture(memberPage, info, 'recipient-wrapper');
    await memberPage.getByRole('button', { name: `${folder.name} Folder`, exact: true }).click();
    await expect(
      memberPage.getByRole('button', { name: `${sheet.name} Sheet`, exact: true }),
    ).toBeVisible();
    await expect(
      memberPage.getByRole('button', { name: `${doc.name} Doc`, exact: true }),
    ).toBeVisible();
    await capture(memberPage, info, 'recipient-retained-folder');
    await memberPage.getByRole('button', { name: `${sheet.name} Sheet`, exact: true }).click();
    await saved();
    expect(JSON.stringify((await readSheet()).snapshot)).toContain(
      'Budget preserved through handover',
    );
    const address = memberPage
      .getByRole('region', { name: 'Sheet document', exact: true })
      .getByRole('textbox')
      .nth(2);
    await address.fill('B1');
    await address.press('Enter');
    await memberPage.keyboard.type('Continued by the new owner');
    await memberPage.keyboard.press('Enter');
    await expect
      .poll(async () => JSON.stringify((await readSheet()).snapshot))
      .toContain('Continued by the new owner');
    await saved();
    const history = await member.request.get(`/api/items/${sheet.id}/history`);
    expect(history.status()).toBe(200);
    expect(
      (await history.json()).versions.some(
        (version: { name: string }) => version.name === 'Before departure',
      ),
    ).toBe(true);
    await capture(memberPage, info, 'recipient-native-sheet');
    await memberPage.close();

    const retained = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
    contexts.push(retained);
    await retained.addCookies([cookie(auth.createSession(collaborator.id).token)]);
    const retainedPage = await retained.newPage();
    retainedPage.setDefaultTimeout(15_000);
    retainedPage.on('pageerror', (error) => errors.push(error.message));
    await retainedPage.goto(`/?item=${sheet.id}`);
    await saved(retainedPage);
    const collaboratorRead = await readSheet(retained);
    expect(collaboratorRead.access).toBe('editor');
    for (const text of ['Budget preserved through handover', 'Continued by the new owner'])
      expect(JSON.stringify(collaboratorRead.snapshot)).toContain(text);
    const retainedAddress = retainedPage
      .getByRole('region', { name: 'Sheet document', exact: true })
      .getByRole('textbox')
      .nth(2);
    await retainedAddress.fill('C1');
    await retainedAddress.press('Enter');
    await retainedPage.keyboard.type('Continued by the retained collaborator');
    await retainedPage.keyboard.press('Enter');
    await expect
      .poll(async () => JSON.stringify((await readSheet(retained)).snapshot))
      .toContain('Continued by the retained collaborator');
    await saved(retainedPage);
    const collaboratorWritten = JSON.stringify((await readSheet(retained)).snapshot);
    for (const text of ['Budget preserved through handover', 'Continued by the new owner'])
      expect(collaboratorWritten).toContain(text);
    await capture(retainedPage, info, 'collaborator-native-sheet');
    await retainedPage.close();

    await guestPage.goto(`/share/${sheet.id}?preview=${link.previewToken}#${link.token}`);
    await expect(guestPage.getByText('This link no longer works.', { exact: true })).toBeVisible();
    for (const name of [departed.name, recipient.name, folder.name, sheet.name])
      expect(await guestPage.locator('body').innerText()).not.toContain(name);
    await capture(guestPage, info, 'old-guest-link');

    dialog = await accountAction(page, departed.name, 'reactivate');
    await capture(page, info, 'reactivate-confirmation');
    await dialog.getByRole('button', { name: 'Reactivate account', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(account.getByText('Member · Active', { exact: true })).toBeVisible();
    expect(auth.passkey(oldCredential)).toBeUndefined();
    expect(auth.session(oldSession.token)).toBeUndefined();
    await account
      .getByRole('button', { name: `Actions for ${departed.name}`, exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Create recovery invite…' }).click();
    const inviteFor = page.getByRole('combobox', { name: 'Invite for', exact: true });
    await expect(inviteFor).toBeEnabled();
    await expect(
      inviteFor.getByRole('option', { name: `Recover ${departed.name}`, exact: true }),
    ).toHaveAttribute('value', departed.id);
    await inviteFor.selectOption(departed.id);
    await expect(inviteFor).toHaveValue(departed.id);
    await page
      .getByRole('dialog', { name: 'Create invite', exact: true })
      .getByRole('button', { name: 'Create invite', exact: true })
      .click();
    const recoveryUrl = await page.getByLabel('New invite link', { exact: true }).inputValue();
    const countBeforeRecovery = auth.userCount();
    const cdp = await recovered.newCDPSession(recoveredPage);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    await recoveredPage.goto(recoveryUrl);
    await expect(
      recoveredPage.getByRole('heading', { name: 'Recover your account' }),
    ).toBeVisible();
    await recoveredPage.getByRole('button', { name: 'Recover with a passkey' }).click();
    await expect(
      recoveredPage.getByRole('heading', { name: 'Dashboard', exact: true }),
    ).toBeVisible();
    expect(auth.userCount()).toBe(countBeforeRecovery);
    const freshCookie = (await recovered.cookies()).find((entry) => entry.name === COOKIE_NAME)!;
    expect(auth.session(freshCookie.value)?.user_id).toBe(departed.id);
    expect(auth.passkeys(departed.id)).toHaveLength(1);
    expect((await recovered.request.get(`/api/items/${sheet.id}/sheet`)).status()).toBe(404);
    expect(() => spaces.get(departed.id, space.id, spaceDoc.id)).toThrow();
    expect(() => workspace.links.exchange(sheet.id, link.token!)).toThrow();
    await recoveredPage.getByRole('button', { name: 'Sign out', exact: true }).click();
    await recoveredPage.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await expect(
      recoveredPage.getByRole('heading', { name: 'Dashboard', exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await Promise.allSettled(contexts.map((entry) => entry.close()));
    db.close();
  }
});
