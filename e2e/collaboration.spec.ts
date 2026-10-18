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
    const edit = async (target: typeof page, cell: string, text: string, commit = true) => {
      const box = target
        .getByRole('region', { name: 'Sheet document', exact: true })
        .getByRole('textbox')
        .nth(2);
      await box.fill(cell);
      await box.press('Enter');
      await target.keyboard.type(text);
      if (commit) await target.keyboard.press('Enter');
    };
    // Cursor navigation and typing into the local cell editor precede the
    // committed Sheet edit. Keep the first submission cold, but time from Enter.
    await Promise.all([edit(page, 'A1', '41', false), edit(other, 'B1', '73', false)]);
    const sentAt = Date.now();
    await Promise.all([page.keyboard.press('Enter'), other.keyboard.press('Enter')]);
    const copyCell = async (target: typeof page, cell: string) => {
      const box = target
        .getByRole('region', { name: 'Sheet document', exact: true })
        .getByRole('textbox')
        .nth(2);
      await box.fill(cell);
      await box.press('Enter');
      // Desktop Chrome fixture advertises Windows, even on a macOS test host.
      await target.keyboard.press('Control+c');
      return (await target.evaluate(() => navigator.clipboard.readText())).trim();
    };
    // Copy reads each peer's currently rendered model, not the server snapshot.
    // Let a slow request finish for diagnosis; the separate elapsed assertion
    // still enforces the strict one-second requirement in both builds.
    await expect.poll(() => copyCell(page, 'B1'), { timeout: 5000, intervals: [50] }).toBe('73');
    await expect.poll(() => copyCell(other, 'A1'), { timeout: 5000, intervals: [50] }).toBe('41');
    expect(Date.now() - sentAt).toBeLessThan(1000);
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
    // Header and cell markers identify the same person, without shifting layout.
    const people = page.getByRole('group', { name: 'People in this document' });
    const jump = people.getByRole('button', { name: 'Go to Collaboration editor', exact: true });
    await expect(jump).toBeVisible();
    const before = await jump.boundingBox();
    await jump.focus();
    await expect(jump.locator('.collaborator-name')).toBeVisible();
    expect(await jump.boundingBox()).toEqual(before);
    await jump.click();
    await expect(
      page.getByRole('region', { name: 'Sheet document', exact: true }).getByRole('textbox').nth(2),
    ).toHaveValue('B2');
    // Canvas popups are rendered in the SDK's body portal, outside its container.
    const markers = page.getByRole('button', { name: 'Go to Collaboration editor', exact: true });
    await expect(markers).toHaveCount(2);
    await expect(markers.last()).toBeVisible();
    expect(await markers.first().evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(
      await markers.last().evaluate((node) => getComputedStyle(node).backgroundColor),
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
    await expect(
      page
        .getByRole('group', { name: 'People in this document' })
        .getByRole('button', { name: 'Go to Doc collaborator', exact: true }),
    ).toHaveAttribute('data-selection', '13:13:1:TEXT::-1');
    await expect(
      other
        .getByRole('group', { name: 'People in this document' })
        .getByRole('button', { name: 'Go to Doc owner', exact: true }),
    ).toHaveAttribute('data-selection', '0:0:1:TEXT::-1');
    await Promise.all([page.keyboard.type('Owner'), other.keyboard.type(' Collaborato')]);
    // Measure the final explicit insertion from before dispatch, while still
    // checking the complete simultaneous text burst in both live editors.
    const sentAt = Date.now();
    await Promise.all([page.keyboard.type(' '), other.keyboard.type('r')]);
    const copyText = async (target: typeof page) => {
      await target.bringToFront();
      await focus(target);
      await target.keyboard.press('Control+a');
      // Desktop Chrome fixture advertises Windows, even on a macOS test host.
      await target.keyboard.press('Control+c');
      return (await target.evaluate(() => navigator.clipboard.readText())).trim();
    };
    await expect
      .poll(() => copyText(page), { timeout: 5000, intervals: [50] })
      .toBe('Owner Shared anchor Collaborator');
    await expect
      .poll(() => copyText(other), { timeout: 5000, intervals: [50] })
      .toBe('Owner Shared anchor Collaborator');
    expect(Date.now() - sentAt).toBeLessThan(1000);
    await other.keyboard.press('ArrowRight');
    await saved(page);
    await saved(other);
    await expect.poll(read).toBe('Owner Shared anchor Collaborator\r\n');
    await other.keyboard.press('Shift+ArrowLeft');
    await other.keyboard.press('Shift+ArrowLeft');
    const jump = page
      .getByRole('group', { name: 'People in this document' })
      .getByRole('button', { name: 'Go to Doc collaborator', exact: true });
    await expect(jump).toBeVisible();
    await expect(jump).toHaveAttribute(
      'data-selection',
      `${'Owner Shared anchor Collaborator'.length - 2}:${'Owner Shared anchor Collaborator'.length}:1:TEXT::-1`,
    );
    await jump.click();
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
  const other = await second.newPage();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false,
    closed = 0;
  const revokedMessages: string[] = [];
  page.on('websocket', (socket) =>
    socket.on('framereceived', (frame) => revokedMessages.push(String(frame.payload))),
  );
  other.on('websocket', (socket) =>
    socket.on('close', () => {
      closed++;
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
    await page.goto(`/?item=${item.id}`);
    await other.goto(`${baseURL}/?item=${item.id}`);
    for (const target of [page, other])
      await expect(target.getByRole('status', { name: 'Save status' })).toHaveText(
        'All changes saved.',
        { timeout: 30_000 },
      );
    await second.route('**/universer-api/comb/**/new_changes', async (route) => {
      held = true;
      await pending;
      await route.continue();
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
    auth.revokeSession(sessions[0].session.token_hash);
    await expect.poll(() => closed).toBeGreaterThan(0);
    await expect(page.getByRole('status', { name: 'Save status' })).toContainText('Access changed');
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
    await other.reload();
    await expect(other.getByRole('status', { name: 'Save status' })).toHaveText(
      'All changes saved.',
      { timeout: 30_000 },
    );
  } finally {
    release();
    await second.close();
    db.prepare('DELETE FROM workspace_items WHERE id=?').run(item.id);
    db.prepare('DELETE FROM auth_users WHERE id=?').run(owner.id);
    db.close();
  }
});
