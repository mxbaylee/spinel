import { syncNetwork } from './sync-network.ts';
import { expect, test } from '@playwright/test';
import { interruptibleNetwork } from './live-network.ts';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';

test('two authenticated editors receive each other’s sheet edits without reloading', async ({
  page,
  context,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(180_000);
  const network = await interruptibleNetwork(context);
  const db = openDatabase(
    info.project.name === 'development'
      ? 'test-results/development/app.sqlite'
      : 'test-results/production/app.sqlite',
  );
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth);
  const owner = auth.createUser('Collaboration owner'),
    editor = auth.createUser('Collaboration editor');
  const item = workspace.create(owner.id, { name: 'Live budget', kind: 'sheet', parentId: null });
  workspace.share(owner.id, item.id, editor.id, 'editor');
  const second = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const other = await second.newPage();
  const errors: string[] = [];
  for (const target of [page, other]) {
    target.on('pageerror', (error) => errors.push(error.message));
  }
  const cookie = (user: string) => ({
    name: COOKIE_NAME,
    value: auth.createSession(user).token,
    url: baseURL!.replace('http:', 'https:'),
    secure: true,
    httpOnly: true,
    sameSite: 'Strict' as const,
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await second.grantPermissions(['clipboard-read', 'clipboard-write']);
  await context.addCookies([cookie(owner.id)]);
  await second.addCookies([cookie(editor.id)]);
  await page.setViewportSize({ width: 1440, height: 1100 });
  try {
    await page.goto(`/?item=${item.id}`);
    await other.goto(`${baseURL}/?item=${item.id}`);
    for (const target of [page, other])
      await expect(target.getByRole('status', { name: 'Save status' })).toHaveText(
        'All changes saved.',
        { timeout: 30_000 },
      );
    const selectCell = async (target: typeof page, cell: string) => {
      const box = target
        .getByRole('region', { name: 'Sheet document', exact: true })
        .getByRole('textbox')
        .nth(2);
      await box.fill(cell);
      await box.press('Enter');
    };
    const edit = async (target: typeof page, cell: string, text: string, commit = true) => {
      await selectCell(target, cell);
      await target.keyboard.type(text);
      if (commit) await target.keyboard.press('Enter');
    };
    const copySelected = async (target: typeof page) => {
      // A fresh sentinel prevents an asynchronous copy from returning old text.
      await target.bringToFront();
      const sentinel = `not-copied-${crypto.randomUUID()}`;
      await target.evaluate((value) => navigator.clipboard.writeText(value), sentinel);
      // Desktop Chrome fixture advertises Windows, even on a macOS test host.
      await target.keyboard.press('Control+c');
      // Copy writes asynchronously; do not overwrite its in-flight result by
      // starting another outer poll. This wait remains inside the latency timer.
      await expect
        .poll(() => target.evaluate(() => navigator.clipboard.readText()), {
          timeout: 5000,
          intervals: [10],
        })
        .not.toBe(sentinel);
      return (await target.evaluate(() => navigator.clipboard.readText())).trim();
    };
    const copyCell = async (target: typeof page, cell: string) => {
      await selectCell(target, cell);
      return copySelected(target);
    };
    // Cursor navigation and typing into the local cell editor precede the
    // committed Sheet edit. Keep the first submission cold, but time from Enter.
    await Promise.all([edit(page, 'A1', '41', false), edit(other, 'B1', '73', false)]);
    const sentAt = Date.now();
    await Promise.all([page.keyboard.press('Enter'), other.keyboard.press('Enter')]);
    // Independent peer selection can run together. Clipboard copies must stay
    // sequential because the two contexts can share the system clipboard.
    // Both UI observations and all post-commit navigation remain inside the
    // strict one-second budget; no warm-up, server read or retry resets the clock.
    await Promise.all([selectCell(page, 'B1'), selectCell(other, 'A1')]);
    await expect.poll(() => copySelected(page), { timeout: 5000, intervals: [50] }).toBe('73');
    const firstObserved = Date.now() - sentAt;
    await expect.poll(() => copySelected(other), { timeout: 5000, intervals: [50] }).toBe('41');
    expect(Date.now() - sentAt, `First peer observed after ${firstObserved} ms`).toBeLessThan(1000);
    // Give the collaborator a clear remote destination for the presence controls.
    const otherName = other
      .getByRole('region', { name: 'Sheet document', exact: true })
      .getByRole('textbox')
      .nth(2);
    await otherName.fill('B2');
    await otherName.press('Enter');
    await expect
      .poll(
        async () =>
          (await (await context.request.get(`/api/items/${item.id}/sheet`)).json()).revision,
        { timeout: 20000 },
      )
      .toBe(3);
    for (const target of [page, other])
      await expect(target.getByRole('status', { name: 'Save status' })).toHaveText(
        'All changes saved.',
      );
    const snapshot = (await (await context.request.get(`/api/items/${item.id}/sheet`)).json())
      .snapshot;
    const cells = snapshot.sheets[snapshot.sheetOrder[0]].cellData;
    expect(cells[0][0].v).toBe(41);
    expect(cells[0][1].v).toBe(73);
    // Read our native selection before the modal makes the document inaccessible.
    const address = page
      .getByRole('region', { name: 'Sheet document', exact: true })
      .getByRole('textbox')
      .nth(2);
    const ownSelection = await address.inputValue();
    // The bounded people dialog and cell markers identify the same person.
    await page.getByRole('button', { name: 'People in this document', exact: true }).click();
    const people = page.getByRole('dialog', { name: 'People in this document', exact: true });
    const jump = people.getByRole('button', { name: 'Go to Collaboration editor', exact: true });
    await expect(jump).toBeVisible();
    const before = await jump.boundingBox();
    await jump.focus();
    await expect(people.getByText('Collaboration editor', { exact: true })).toBeVisible();
    expect(await jump.boundingBox()).toEqual(before);
    const personColor = await jump.evaluate((node) => getComputedStyle(node).backgroundColor);
    await jump.click();
    await expect(people).toHaveCount(0);
    // Following reveals the collaborator without overwriting our selection.
    await expect(address).toHaveValue(ownSelection);
    const marker = page
      .locator('[data-presence-label]')
      .filter({ hasText: 'Collaboration editor' });
    await expect(marker).toBeVisible();
    expect(personColor).toBe(
      await marker.evaluate((node) => getComputedStyle(node).backgroundColor),
    );

    await network.setOffline(true);
    const disconnectedAt = Date.now();
    await edit(page, 'A2', 'offline owner');
    await expect(page.getByRole('status', { name: 'Save status' })).toContainText('not saved');
    await edit(other, 'B2', 'online collaborator');
    await expect(other.getByRole('status', { name: 'Save status' })).toHaveText(
      'All changes saved.',
    );
    await page.waitForTimeout(Math.max(0, 60_000 - (Date.now() - disconnectedAt)));
    await network.setOffline(false);
    for (const target of [page, other])
      await expect(target.getByRole('status', { name: 'Save status' })).toHaveText(
        'All changes saved.',
        { timeout: 30_000 },
      );
    const recovered = (await (await context.request.get(`/api/items/${item.id}/sheet`)).json())
      .snapshot;
    const recoveredCells = recovered.sheets[recovered.sheetOrder[0]].cellData;
    expect(recoveredCells[1][0].v).toBe('offline owner');
    expect(recoveredCells[1][1].v).toBe('online collaborator');
    expect(recoveredCells[0][0].v).toBe(41);
    expect(recoveredCells[0][1].v).toBe(73);
    // Prove both still-open views incorporated replay before any reload can mask it.
    for (const target of [page, other])
      for (const [cell, value] of [
        ['A1', '41'],
        ['B1', '73'],
        ['A2', 'offline owner'],
        ['B2', 'online collaborator'],
      ])
        await expect.poll(() => copyCell(target, cell)).toBe(value);
    await other.reload();
    await expect(other.getByRole('status', { name: 'Save status' })).toHaveText(
      'All changes saved.',
      { timeout: 30_000 },
    );
    expect(errors).toEqual([]);
  } finally {
    await network.setOffline(false);
    await second.close();
    db.prepare('DELETE FROM workspace_items WHERE id=?').run(item.id);
    for (const user of [owner, editor])
      db.prepare('DELETE FROM auth_users WHERE id=?').run(user.id);
    db.close();
  }
});

test('two document editors merge text and navigate to a collaborator selection', async ({
  page,
  context,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(90_000);
  const db = openDatabase(
    info.project.name === 'development'
      ? 'test-results/development/app.sqlite'
      : 'test-results/production/app.sqlite',
  );
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth);
  const owner = auth.createUser('Doc owner'),
    editor = auth.createUser('Doc collaborator');
  const item = workspace.create(owner.id, { name: 'Shared notes', kind: 'doc', parentId: null });
  workspace.share(owner.id, item.id, editor.id, 'editor');
  const second = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const other = await second.newPage();
  const cookie = (id: string) => ({
    name: COOKIE_NAME,
    value: auth.createSession(id).token,
    url: baseURL!.replace('http:', 'https:'),
    secure: true,
    httpOnly: true,
    sameSite: 'Strict' as const,
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await second.grantPermissions(['clipboard-read', 'clipboard-write']);
  await context.addCookies([cookie(owner.id)]);
  await second.addCookies([cookie(editor.id)]);
  await page.setViewportSize({ width: 1440, height: 1100 });
  const read = async () =>
    (await (await context.request.get(`/api/items/${item.id}/doc`)).json()).snapshot.body
      .dataStream as string;
  const saved = (target: typeof page) =>
    expect(target.getByRole('status', { name: 'Save status' })).toHaveText('All changes saved.', {
      timeout: 30_000,
    });
  const focus = (target: typeof page) =>
    target.locator('.univer-container').click({ position: { x: 130, y: 200 } });
  const errors: string[] = [];
  for (const target of [page, other]) target.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`/?item=${item.id}`);
    await saved(page);
    await focus(page);
    await page.keyboard.type('Shared anchor');
    await saved(page);
    // This separate API reconstructs a native snapshot on its first read. Its
    // cold materializer is not the peer-to-peer UI latency measured below.
    await expect.poll(read, { timeout: 30_000 }).toBe('Shared anchor\r\n');
    await other.goto(`${baseURL}/?item=${item.id}`);
    await saved(other);
    await focus(page);
    await page.keyboard.press('Home');
    await focus(other);
    await other.keyboard.press('End');
    await page.getByRole('button', { name: 'People in this document', exact: true }).click();
    await expect(
      page
        .getByRole('dialog', { name: 'People in this document', exact: true })
        .getByRole('button', { name: 'Go to Doc collaborator', exact: true }),
    ).toHaveAttribute('data-selection', '13:13:1:TEXT::-1');
    await page
      .getByRole('dialog', { name: 'People in this document', exact: true })
      .getByRole('button', { name: 'Close dialog', exact: true })
      .click();
    await other.getByRole('button', { name: 'People in this document', exact: true }).click();
    await expect(
      other
        .getByRole('dialog', { name: 'People in this document', exact: true })
        .getByRole('button', { name: 'Go to Doc owner', exact: true }),
    ).toHaveAttribute('data-selection', '0:0:1:TEXT::-1');
    await other
      .getByRole('dialog', { name: 'People in this document', exact: true })
      .getByRole('button', { name: 'Close dialog', exact: true })
      .click();
    // Refocus native inputs without moving the established start/end selections.
    for (const target of [page, other]) {
      await expect(
        target.getByRole('dialog', { name: 'People in this document', exact: true }),
      ).toHaveCount(0);
      const input = target.locator('[contenteditable="true"][data-u-comp="editor"]');
      await input.focus();
      await expect(input).toBeFocused();
    }
    await Promise.all([page.keyboard.type('Owner'), other.keyboard.type(' Collaborato')]);
    // Measure the final explicit insertion from before dispatch, while still
    // checking the complete simultaneous text burst in both live editors.
    const sentAt = Date.now();
    await Promise.all([page.keyboard.type(' '), other.keyboard.type('r')]);
    const copyText = async (target: typeof page) => {
      await target.bringToFront();
      const input = target.locator('[contenteditable="true"][data-u-comp="editor"]');
      await input.focus();
      await expect(input).toBeFocused();
      await target.keyboard.press('Control+a');
      // Each editor must complete its own copy, not read the other peer's text.
      const sentinel = `not-copied-${crypto.randomUUID()}`;
      await target.evaluate((value) => navigator.clipboard.writeText(value), sentinel);
      // Desktop Chrome fixture advertises Windows, even on a macOS test host.
      await target.keyboard.press('Control+c');
      await expect
        .poll(() => target.evaluate(() => navigator.clipboard.readText()), {
          timeout: 5000,
          intervals: [10],
        })
        .not.toBe(sentinel);
      return (await target.evaluate(() => navigator.clipboard.readText())).trim();
    };
    // Shared clipboard copies stay sequential. Focus and both fresh UI
    // observations remain inside the original strict one-second budget.
    await expect
      .poll(() => copyText(page), { timeout: 5000, intervals: [50] })
      .toBe('Owner Shared anchor Collaborator');
    const firstObserved = Date.now() - sentAt;
    await expect
      .poll(() => copyText(other), { timeout: 5000, intervals: [50] })
      .toBe('Owner Shared anchor Collaborator');
    const total = Date.now() - sentAt;
    expect(
      total,
      `First peer observed after ${firstObserved} ms; both peers after ${total} ms`,
    ).toBeLessThan(1000);
    await other.keyboard.press('ArrowRight');
    await saved(page);
    await saved(other);
    await expect.poll(read).toBe('Owner Shared anchor Collaborator\r\n');
    await other.keyboard.press('Shift+ArrowLeft');
    await other.keyboard.press('Shift+ArrowLeft');
    await page.getByRole('button', { name: 'People in this document', exact: true }).click();
    const jump = page
      .getByRole('dialog', { name: 'People in this document', exact: true })
      .getByRole('button', { name: 'Go to Doc collaborator', exact: true });
    await expect(jump).toBeVisible();
    await expect(jump).toHaveAttribute(
      'data-selection',
      `${'Owner Shared anchor Collaborator'.length - 2}:${'Owner Shared anchor Collaborator'.length}:1:TEXT::-1`,
    );
    await jump.click();
    await expect(
      page.getByRole('dialog', { name: 'People in this document', exact: true }),
    ).toHaveCount(0);
    await expect(page.locator('[contenteditable="true"][data-u-comp="editor"]')).toBeFocused();
    // Replacing the selected remote range proves the cursor jump used this live document.
    await page.keyboard.type('XX');
    await saved(page);
    await expect.poll(read).toBe('Owner Shared anchor CollaboratXX\r\n');
    await other.reload();
    await saved(other);
    expect(errors).toEqual([]);
  } finally {
    await second.close();
    db.prepare('DELETE FROM workspace_items WHERE id=?').run(item.id);
    for (const user of [owner, editor])
      db.prepare('DELETE FROM auth_users WHERE id=?').run(user.id);
    db.close();
  }
});

test('revoking one login preserves another login’s queued edit and stops later broadcasts', async ({
  page,
  context,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(60_000);
  const db = openDatabase(
    info.project.name === 'development'
      ? 'test-results/development/app.sqlite'
      : 'test-results/production/app.sqlite',
  );
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth),
    owner = auth.createUser('Two logins');
  const item = workspace.create(owner.id, {
    name: 'Private after revoke',
    kind: 'sheet',
    parentId: null,
  });
  const sessions = [auth.createSession(owner.id), auth.createSession(owner.id)];
  const second = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const network = await syncNetwork(second);
  const other = await second.newPage();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let releaseCatalogDenial!: () => void;
  const pendingCatalogDenial = new Promise<void>((resolve) => {
    releaseCatalogDenial = resolve;
  });
  let catalogDenialHeld = false;
  let held = false,
    revokedClosed = 0,
    otherClosed = 0;
  const revokedMessages: string[] = [];
  page.on('websocket', (socket) => {
    socket.on('framereceived', (frame) => revokedMessages.push(String(frame.payload)));
    socket.on('close', () => {
      revokedClosed++;
    });
  });
  other.on('websocket', (socket) =>
    socket.on('close', () => {
      otherClosed++;
    }),
  );
  for (const [index, c] of [context, second].entries())
    await c.addCookies([
      {
        name: COOKIE_NAME,
        value: sessions[index].token,
        url: baseURL!.replace('http:', 'https:'),
        secure: true,
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
  try {
    // The shared-list poll redirects on 401 independently of the editor warning.
    // Keep its real denial pending while proving revocation in the open editor.
    await page.route('**/api/items/shared', async (route) => {
      const response = await route.fetch();
      if (response.status() === 401) {
        catalogDenialHeld = true;
        await pendingCatalogDenial;
      }
      await route.fulfill({ response });
    });
    await page.goto(`/?item=${item.id}`);
    await other.goto(`${baseURL}/?item=${item.id}`);
    for (const target of [page, other]) {
      await expect(target.getByRole('status', { name: 'Save status' })).toHaveText(
        'All changes saved.',
        { timeout: 30_000 },
      );
      // Saved content does not prove that this login has joined the room.
      await expect(
        target.getByRole('status', { name: 'Connection status', exact: true }),
      ).toHaveText('Online');
    }
    network.interceptWrites(async (write) => {
      held = true;
      await pending;
      write.forward();
    });
    const box = other
      .getByRole('region', { name: 'Sheet document', exact: true })
      .getByRole('textbox')
      .nth(2);
    await box.fill('A1');
    await box.press('Enter');
    await other.keyboard.type('private-after-revoke');
    await other.keyboard.press('Enter');
    await expect.poll(() => held).toBe(true);
    const revokedClosedBefore = revokedClosed;
    const otherClosedBefore = otherClosed;
    auth.revokeSession(sessions[0].session.token_hash);
    await expect.poll(() => revokedClosed).toBeGreaterThan(revokedClosedBefore);
    expect(otherClosed).toBe(otherClosedBefore);
    await expect(page.getByRole('status', { name: 'Save status' })).toContainText('Access changed');
    await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled();
    expect((await context.request.get(`${baseURL}/api/items/${item.id}/sheet`)).status()).toBe(401);
    // Exercise the existing focus refresh instead of racing its five-second timer.
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => catalogDenialHeld).toBe(true);
    const boundary = revokedMessages.length;
    release();
    await expect(other.getByRole('status', { name: 'Save status' })).toHaveText(
      'All changes saved.',
      { timeout: 30_000 },
    );
    const saved = (await (await second.request.get(`${baseURL}/api/items/${item.id}/sheet`)).json())
      .snapshot;
    expect(saved.sheets[saved.sheetOrder[0]].cellData[0][0].v).toBe('private-after-revoke');
    expect(
      revokedMessages.slice(boundary).some((message) => message.includes('private-after-revoke')),
    ).toBe(false);
    await expect(other.getByRole('button', { name: 'Bold', exact: true })).toBeEnabled();
    releaseCatalogDenial();
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByRole('heading', { name: 'Your workspace.', exact: true })).toBeVisible();
    await other.reload();
    await expect(other.getByRole('status', { name: 'Save status' })).toHaveText(
      'All changes saved.',
      { timeout: 30_000 },
    );
  } finally {
    release();
    releaseCatalogDenial();
    network.interceptWrites(undefined);
    try {
      await network.drainWrites();
    } finally {
      await page.unrouteAll({ behavior: 'wait' });
      await second.close();
      db.prepare('DELETE FROM workspace_items WHERE id=?').run(item.id);
      db.prepare('DELETE FROM auth_users WHERE id=?').run(owner.id);
      db.close();
    }
  }
});
