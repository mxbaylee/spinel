import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test';
import type { IWorkbookData, IDocumentData } from '@univerjs/core';
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { Profiles } from '../src/server/auth/profile.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { SheetStore } from '../src/server/workspace/sheets.ts';
import { syncSheetMenuFixture } from '../src/ui/syncSheetMenus.fixture.ts';
import { SpaceStore } from '../src/server/workspace/spaces.ts';
import { syncNetwork } from './sync-network.ts';
import { assertDocSoakContent, docSoakInsertion } from './sync-soak-intent.ts';
import type { DocSoakInsertion } from './sync-soak-intent.ts';
import { downloadPdf, inspectPdf } from './pdfEvidence.ts';
import {
  recordNativeSnapshots,
  expectNativeSnapshots,
  expectNativeCellDelivery,
  nativeCellDeliveryTiming,
  expectNativeMutationInventory,
} from './sync-snapshot.ts';

const saved = (page: Page) =>
  expect(page.getByRole('status', { name: 'Save status' })).toHaveText('All changes saved.', {
    timeout: 30_000,
  });
const nativeInput = (page: Page) => page.locator('[contenteditable="true"][data-u-comp="editor"]');

async function exportConfirmedPdf(
  page: Page,
  info: TestInfo,
  kind: 'sheet' | 'doc',
  text: string[],
) {
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export', exact: true });
  const download = await downloadPdf(
    page,
    dialog.getByRole('button', { name: 'Export as PDF', exact: true }),
  );
  // PDF preparation must read the same acknowledged native head as the new
  // client, including reconnected edits and an image inserted through the UI.
  await inspectPdf(download, info, `native-sync-${kind}`, {
    text,
    forbidden: ['Sync owner', 'Sync collaborator'],
    ...(kind === 'doc' ? { image: true, colors: [[255, 153, 0]] } : {}),
  });
  await expect(dialog).toContainText('PDF download started.');
}

async function focusDoc(page: Page) {
  await page.locator('.univer-container').click({ position: { x: 130, y: 200 } });
  await nativeInput(page).focus();
}
async function selectCell(page: Page, address: string) {
  const box = page
    .getByRole('region', { name: 'Sheet document', exact: true })
    .locator('[data-u-comp="defined-name"] input');
  await box.fill(address);
  await box.press('Enter');
}
async function editCell(page: Page, address: string, value: string) {
  await selectCell(page, address);
  await page.keyboard.type(value);
  await page.keyboard.press('Enter');
}
async function copySelection(page: Page) {
  await page.bringToFront();
  const sentinel = `not-copied-${crypto.randomUUID()}`;
  await page.evaluate((value) => navigator.clipboard.writeText(value), sentinel);
  await page.keyboard.press('Control+c');
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
      timeout: 5000,
      intervals: [10],
    })
    .not.toBe(sentinel);
  return (await page.evaluate(() => navigator.clipboard.readText())).trim();
}
async function copyCell(page: Page, address: string) {
  await selectCell(page, address);
  return copySelection(page);
}
async function copyDoc(page: Page) {
  await nativeInput(page).focus();
  await page.keyboard.press('Control+a');
  return copySelection(page);
}

async function fixture(
  browser: Browser,
  baseURL: string,
  info: TestInfo,
  kind: 'sheet' | 'doc',
  mobile = false,
  snapshot?: IWorkbookData,
) {
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  const owner = auth.createUser('Sync owner');
  const editor = auth.createUser('Sync collaborator');
  const profiles = new Profiles(auth);
  profiles.save(owner.id, { name: owner.name, color: 'primary-strong', icon: 'lucide:flower-2' });
  profiles.save(editor.id, { name: editor.name, color: 'info-strong', icon: 'lucide:leaf' });
  const item = workspace.create(owner.id, { kind, name: `Native ${kind} sync`, parentId: null });
  workspace.share(owner.id, item.id, editor.id, 'editor');
  if (snapshot)
    new SheetStore(workspace).save(owner.id, item.id, {
      snapshot: { ...snapshot, id: item.id },
      revision: 0,
      writeId: crypto.randomUUID(),
    });
  const contexts: BrowserContext[] = [];
  async function account(user: string) {
    const context = await browser.newContext({
      baseURL,
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1100 },
      isMobile: mobile,
      hasTouch: mobile,
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    contexts.push(context);
    await recordNativeSnapshots(context);
    await context.addCookies([
      {
        name: COOKIE_NAME,
        value: auth.createSession(user).token,
        url: baseURL.replace('http:', 'https:'),
        secure: true,
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
    return context;
  }
  const first = await account(owner.id);
  const second = await account(editor.id);
  const network = await syncNetwork(first);
  const otherNetwork = await syncNetwork(second);
  const page = await first.newPage(),
    other = await second.newPage();
  const errors: string[] = [];
  for (const target of [page, other]) target.on('pageerror', (error) => errors.push(error.message));
  const prepared = await first.request.post(`/api/items/${item.id}/collaboration`, {
    headers: { Origin: baseURL },
    data: {},
  });
  expect(prepared.ok(), await prepared.text()).toBe(true);
  const data = await prepared.json();
  expect(data.syncVersion).toBe(1);
  const read = async () => {
    const response = await first.request.get(
      `/sync-api/items/${item.id}/snapshot?unitId=${encodeURIComponent(data.unitId)}`,
      // Repeat only this read-only observation after ECONNRESET. HTTP failures,
      // authored writes and native/content assertions retain their failure gates.
      { maxRetries: 1 },
    );
    expect(response.ok()).toBe(true);
    return (await response.json()) as { revision: number; snapshot: IWorkbookData & IDocumentData };
  };
  return {
    db,
    auth,
    workspace,
    owner,
    editor,
    item,
    unitId: data.unitId as string,
    first,
    second,
    page,
    other,
    network,
    otherNetwork,
    errors,
    read,
    account,
    async close() {
      // Preserve actual model/wire evidence before teardown, including failures
      // that occur before the final full-snapshot assertions can run.
      const observed = await Promise.allSettled(
        [page, other].map((target) =>
          target.evaluate(() => ({
            native: (window as Window & { nativeSyncEvidence?: unknown }).nativeSyncEvidence,
            focus: document.activeElement?.outerHTML,
            status: document.querySelector('[role="status"][aria-label="Save status"]')
              ?.textContent,
          })),
        ),
      );
      await writeFile(
        info.outputPath('sync-diagnostics.json'),
        JSON.stringify(
          {
            observed,
            delivery: [page, other].map(nativeCellDeliveryTiming),
            errors,
            outgoing: network.outgoing,
            incoming: network.incoming,
            peerOutgoing: otherNetwork.outgoing,
            peerIncoming: otherNetwork.incoming,
          },
          null,
          2,
        ),
      );
      await Promise.all(contexts.map((context) => context.close()));
      // Workspace parent foreign keys are RESTRICT, so remove this fixture's
      // descendants before their Space root instead of depending on row order.
      const leaves = db.prepare(`DELETE FROM workspace_items WHERE owner_id=?
        AND id NOT IN (SELECT parent_id FROM workspace_items WHERE parent_id IS NOT NULL)`);
      while (leaves.run(owner.id).changes) {
        /* Continue through this fixture's tree. */
      }
      for (const user of [owner, editor])
        db.prepare('DELETE FROM auth_users WHERE id=?').run(user.id);
      db.close();
    },
  };
}

for (const kind of ['sheet', 'doc'] as const) {
  test(`the actual mobile ${kind} preset has a complete mutation classification`, async ({
    browser,
    baseURL,
  }, info) => {
    const f = await fixture(browser, baseURL!, info, kind, true);
    try {
      await Promise.all([f.page.goto(`/?item=${f.item.id}`), f.other.goto(`/?item=${f.item.id}`)]);
      await Promise.all([saved(f.page), saved(f.other)]);
      expect(
        await f.page.evaluate(() => matchMedia('(pointer: coarse) and (max-width: 900px)').matches),
      ).toBe(true);
      await expectNativeMutationInventory(f.page, f.unitId);
      await expectNativeMutationInventory(f.other, f.unitId);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });
}

test('native Sheets deliver within a second, rebase offline edits, and retry one durable write after a lost acknowledgment', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(150_000);
  const f = await fixture(browser, baseURL!, info, 'sheet');
  try {
    await Promise.all([f.page.goto(`/?item=${f.item.id}`), f.other.goto(`/?item=${f.item.id}`)]);
    await Promise.all([saved(f.page), saved(f.other)]);
    await Promise.all([selectCell(f.page, 'A1'), selectCell(f.other, 'B1')]);
    await expect(
      f.page.locator('[data-presence-label]').filter({ hasText: 'Sync collaborator' }),
    ).toBeVisible();
    await expect(
      f.other.locator('[data-presence-label]').filter({ hasText: 'Sync owner' }),
    ).toBeVisible();
    // A real multi-cell native selection must reach the peer's canvas as well.
    await selectCell(f.page, 'A1:A2');
    await expect
      .poll(
        () =>
          f.otherNetwork.incoming
            .filter((frame) => frame.type === 'presence')
            .at(-1)
            ?.members.find((member: { name: string }) => member.name === 'Sync owner')?.selection,
      )
      .toMatch(/!A1:A2$/);
    await expect(
      f.other.locator('[data-presence-label]').filter({ hasText: 'Sync owner' }),
    ).toBeVisible();
    await selectCell(f.page, 'A1');
    await f.page.screenshot({ path: info.outputPath('sheet-light-sync-presence.png') });
    await Promise.all([f.page.keyboard.type('41'), f.other.keyboard.type('73')]);
    await expectNativeCellDelivery([f.page, f.other], f.unitId);
    await Promise.all([selectCell(f.page, 'B1'), selectCell(f.other, 'A1')]);
    await expect.poll(() => copySelection(f.page), { intervals: [20] }).toBe('73');
    await expect.poll(() => copySelection(f.other), { intervals: [20] }).toBe('41');
    await Promise.all([saved(f.page), saved(f.other)]);
    await f.network.setOffline(true);
    await editCell(f.page, 'A2', 'offline owner');
    await editCell(f.other, 'B2', 'online collaborator');
    await saved(f.other);
    await expect(f.page.getByRole('status', { name: 'Save status' })).toContainText('not saved');
    f.network.holdResume();
    await f.network.setOffline(false);
    await expect.poll(f.network.resumeHeld).toBe(true);
    await expect(f.page.getByRole('status', { name: 'Save status' })).not.toHaveText(
      'All changes saved.',
    );
    f.network.releaseResume();
    await Promise.all([saved(f.page), saved(f.other)]);
    await expect.poll(() => copyCell(f.page, 'B2')).toBe('online collaborator');
    await expect.poll(() => copyCell(f.other, 'A2')).toBe('offline owner');

    f.network.loseAcknowledgment();
    await editCell(f.page, 'A3', 'one durable edit');
    await expect.poll(f.network.lostMutationId).toBeTruthy();
    const committed = await f.read();
    const lost = f.network.lostMutationId();
    const original = f.network.outgoing.find((frame) => frame.mutationId === lost);
    await f.network.setOffline(false);
    await saved(f.page);
    await saved(f.other);
    expect(f.network.outgoing.filter((frame) => frame.mutationId === lost)).toEqual([
      original,
      original,
    ]);
    expect((await f.read()).revision).toBe(committed.revision);
    const sheet = committed.snapshot.sheets[committed.snapshot.sheetOrder[0]];
    expect(sheet.cellData![0]![0]!.v).toBe(41);
    expect(sheet.cellData![0]![1]!.v).toBe(73);
    expect(sheet.cellData![1]![0]!.v).toBe('offline owner');
    expect(sheet.cellData![1]![1]!.v).toBe('online collaborator');
    expect(sheet.cellData![2]![0]!.v).toBe('one durable edit');
    // Each browser hashes its own pending-free visible model, not an API snapshot.
    for (const wire of [f.network, f.otherNetwork])
      await expect
        .poll(() =>
          wire.incoming.some(
            (frame) => frame.type === 'verified' && frame.revision === committed.revision,
          ),
        )
        .toBe(true);
    await expectNativeSnapshots([f.page, f.other], committed);
    await Promise.all([f.page.reload(), f.other.reload()]);
    await Promise.all([saved(f.page), saved(f.other)]);
    await expectNativeSnapshots([f.page, f.other], committed);
    expect(await copyCell(f.page, 'A3')).toBe('one durable edit');
    expect(await copyCell(f.other, 'A3')).toBe('one durable edit');
    await exportConfirmedPdf(f.page, info, 'sheet', [
      '41',
      '73',
      'offline owner',
      'online collaborator',
      'one durable edit',
    ]);
    expect(f.network.incoming.filter((frame) => frame.type === 'resync')).toEqual([]);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('native Docs preserve concurrent text and undo across reconnect, render profile presence, and capture actual image UI edits', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(180_000);
  const f = await fixture(browser, baseURL!, info, 'doc');
  try {
    await f.page.goto(`/?item=${f.item.id}`);
    await saved(f.page);
    await focusDoc(f.page);
    await f.page.keyboard.type('Shared anchor');
    await saved(f.page);
    await f.other.goto(`/?item=${f.item.id}`);
    await saved(f.other);
    await focusDoc(f.page);
    await f.page.keyboard.press('Home');
    await focusDoc(f.other);
    await f.other.keyboard.press('End');
    await expect(
      f.page.locator('[data-presence-label]').filter({ hasText: 'Sync collaborator' }),
    ).toBeVisible();
    await expect(
      f.other.locator('[data-presence-label]').filter({ hasText: 'Sync owner' }),
    ).toBeVisible();
    await f.page.screenshot({ path: info.outputPath('doc-light-sync-presence.png') });
    await f.network.setOffline(true);
    await nativeInput(f.page).focus();
    await f.page.keyboard.type('Owner ');
    await nativeInput(f.other).focus();
    await f.other.keyboard.type(' Collaborator');
    await saved(f.other);
    await expect(f.page.getByRole('status', { name: 'Save status' })).toContainText('not saved');
    await f.network.setOffline(false);
    await Promise.all([saved(f.page), saved(f.other)]);
    await expect.poll(() => copyDoc(f.page)).toBe('Owner Shared anchor Collaborator');
    await expect.poll(() => copyDoc(f.other)).toBe('Owner Shared anchor Collaborator');
    await f.page.keyboard.press('ArrowRight');
    await f.page.keyboard.type(' undo-me');
    await saved(f.page);
    await f.page.keyboard.press('Control+z');
    await saved(f.page);
    await expect.poll(() => copyDoc(f.other)).toBe('Owner Shared anchor Collaborator');
    await f.other.keyboard.press('ArrowRight');
    await f.other.keyboard.press('Shift+ArrowLeft');
    await f.other.keyboard.press('Shift+ArrowLeft');
    await f.page.getByRole('button', { name: 'People in this document', exact: true }).click();
    const jump = f.page
      .getByRole('dialog', { name: 'People in this document', exact: true })
      .getByRole('button', { name: 'Go to Sync collaborator', exact: true });
    // Cursor updates are coalesced. Follow the new two-character selection,
    // not the prior select-all range used by the clipboard assertion.
    await expect(jump).toHaveAttribute('data-selection', '30:32:1:TEXT::-1');
    await expect(jump).toBeEnabled();
    await jump.click();
    await expect(nativeInput(f.page)).toBeFocused();
    await f.page.keyboard.type('XX');
    await saved(f.page);
    await expect
      .poll(async () => (await f.read()).snapshot.body!.dataStream)
      .toBe('Owner Shared anchor CollaboratXX\r\n');

    // The actual image toolbar/selection producer exercises the Doc drawing
    // controls whose render-only collaboration event must stay out of edits.
    await f.page.keyboard.press('Control+End');
    await f.page.keyboard.press('Enter');
    const region = f.page.getByRole('region', { name: 'Doc document', exact: true });
    await region.getByRole('tab', { name: 'Insert', exact: true }).click();
    const chooser = f.page.waitForEvent('filechooser');
    await region.getByRole('button', { name: 'Image', exact: true }).click();
    await (
      await chooser
    ).setFiles({
      name: 'marker.png',
      mimeType: 'image/png',
      buffer: await sharp({ create: { width: 20, height: 10, channels: 4, background: '#ff9900' } })
        .png()
        .toBuffer(),
    });
    await saved(f.page);
    await expect.poll(async () => (await f.read()).snapshot.drawingsOrder?.length).toBe(1);
    await focusDoc(f.page);
    await f.page.keyboard.press('Control+End');
    await f.page.keyboard.type(' after image');
    await Promise.all([saved(f.page), saved(f.other)]);
    const committed = await f.read();
    expect(committed.snapshot.drawingsOrder).toHaveLength(1);
    expect(committed.snapshot.body!.dataStream).toContain('after image');
    const ids = f.network.outgoing
      .filter((frame) => frame.type === 'submit')
      .flatMap((frame) => frame.mutations.map((mutation: { id: string }) => mutation.id));
    expect(ids).toContain('doc.mutation.rich-text-editing');
    expect(ids).not.toContain('doc.operation.clear-drawing-transformer');
    for (const wire of [f.network, f.otherNetwork])
      await expect
        .poll(() =>
          wire.incoming.some(
            (frame) => frame.type === 'verified' && frame.revision === committed.revision,
          ),
        )
        .toBe(true);
    await expectNativeSnapshots([f.page, f.other], committed);
    await Promise.all([f.page.reload(), f.other.reload()]);
    await Promise.all([saved(f.page), saved(f.other)]);
    await expectNativeSnapshots([f.page, f.other], committed);
    expect(await copyDoc(f.page)).toBe(await copyDoc(f.other));
    expect((await f.read()).snapshot.drawingsOrder).toEqual(committed.snapshot.drawingsOrder);
    await exportConfirmedPdf(f.page, info, 'doc', [
      'Owner Shared anchor CollaboratXX',
      'after image',
    ]);
    expect(f.network.incoming.filter((frame) => frame.type === 'resync')).toEqual([]);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('Space page changes clear room membership and a root link downgrade fences all anonymous child editors', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  const f = await fixture(browser, baseURL!, info, 'doc');
  const guests = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1100 } });
  try {
    const spaces = new SpaceStore(f.workspace);
    const root = spaces.createRoot(f.owner.id, { name: 'Shared project', parentId: null }).space;
    const first = spaces.createChild(f.owner.id, root.id, {
      name: 'First page',
      kind: 'doc',
      parentId: root.id,
    }).item;
    const next = spaces.createChild(f.owner.id, root.id, {
      name: 'Second page',
      kind: 'sheet',
      parentId: root.id,
    }).item;
    const linkResponse = await f.first.request.put(`/api/items/${root.id}/link`, {
      headers: { Origin: baseURL! },
      data: { role: 'editor' },
    });
    expect(linkResponse.ok()).toBe(true);
    const link = await linkResponse.json();
    const wire = await syncNetwork(guests);
    const guest = await guests.newPage();
    await guest.goto(link.url);
    // Finish the fragment capability exchange before selecting a child.
    await saved(guest);
    await guest.goto(`/share/${root.id}?item=${first.id}`);
    await saved(guest);
    const initialRoom = wire.incoming.find((frame) => frame.type === 'resume')?.unitId;
    await f.page.goto(`/spaces/${root.id}?item=${first.id}`);
    await saved(f.page);
    await expect
      .poll(() => wire.incoming.filter((frame) => frame.type === 'presence').at(-1)?.members.length)
      .toBe(2);
    const members = wire.incoming.filter((frame) => frame.type === 'presence').at(-1)!.members;
    expect(
      members.every(
        (member: { name: string; avatar: string }) =>
          ['Guest', 'Collaborator'].includes(member.name) && member.avatar === '',
      ),
    ).toBe(true);
    expect(JSON.stringify(members)).not.toContain(f.owner.name);
    // Navigate inside the same mounted app so cleanup cannot rely on page reload.
    await guest
      .getByRole('region', { name: 'Space pages', exact: true })
      .getByRole('link', { name: next.name, exact: true })
      .click();
    await expect(guest).toHaveURL(new RegExp(`item=${next.id}`));
    await saved(guest);
    const currentRoom = wire.incoming.filter((frame) => frame.type === 'resume').at(-1)!.unitId;
    expect(currentRoom).not.toBe(initialRoom);
    await expect
      .poll(
        () =>
          f.network.incoming.filter((frame) => frame.type === 'presence').at(-1)?.members.length,
      )
      .toBe(1);
    const sibling = await guests.newPage();
    await sibling.goto(`/share/${root.id}?item=${first.id}`);
    await saved(sibling);
    const changed = await f.first.request.put(`/api/items/${root.id}/link`, {
      headers: { Origin: baseURL! },
      data: { role: 'viewer' },
    });
    expect(changed.ok()).toBe(true);
    for (const page of [guest, sibling]) {
      await expect(page.getByRole('region', { name: /^(Doc|Sheet) document$/ })).toHaveCount(0, {
        timeout: 10_000,
      });
      await expect(
        page.getByText(/access.*changed|link.*changed|no longer (available|works)/i).first(),
      ).toBeVisible();
    }
  } finally {
    await guests.close();
    await f.close();
  }
});

for (const kind of ['sheet', 'doc'] as const) {
  test(`native ${kind} viewers cannot enqueue edits during startup or after readiness`, async ({
    browser,
    baseURL,
  }, info) => {
    const f = await fixture(browser, baseURL!, info, kind);
    try {
      f.workspace.share(f.owner.id, f.item.id, f.editor.id, 'viewer');
      const before = await f.read();
      await f.other.goto(`/?item=${f.item.id}`);
      const surface = f.other.locator('.univer-container');
      await surface.locator('canvas').first().waitFor({ state: 'visible' });
      // Try the first visible native surface before waiting for save/readiness.
      await surface.click({ position: { x: 130, y: 200 } });
      await f.other.keyboard.type('viewer cannot write');
      await f.other.keyboard.press('Enter');
      await expect(f.other.getByRole('status', { name: 'Save status' })).toHaveText(
        'View only — reload after your access changes.',
        { timeout: 30_000 },
      );
      const refusal = f.other.getByText(
        'The range is protected, and you do not have edit permission. To edit, please contact the creator.',
        { exact: true },
      );
      // Native Sheets may explain the first blocked edit in a modal. Dismiss
      // that observed denial before testing another actual surface interaction.
      if (await refusal.isVisible()) {
        await f.other.getByRole('button', { name: 'ok', exact: true }).click();
        await expect(refusal).toBeHidden();
      }
      await surface.click({ position: { x: 130, y: 200 } });
      await f.other.keyboard.type('still read only');
      await f.other.keyboard.press('Enter');
      expect(f.otherNetwork.outgoing.filter((frame) => frame.type === 'submit')).toEqual([]);
      expect((await f.read()).revision).toBe(before.revision);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });
}

for (const mobile of [false, true]) {
  test(`native sync sheet menus preserve supported commands on ${mobile ? 'phone' : 'desktop'}`, async ({
    browser,
    baseURL,
  }, info) => {
    test.setTimeout(150_000);
    const f = await fixture(browser, baseURL!, info, 'sheet', mobile, syncSheetMenuFixture());
    const openSheetMenu = async (name: string) => {
      const namedTab = f.page.getByRole('tab', { name, exact: true });
      // The active mobile tab includes its menu button in its accessible name.
      // Both names are exact so a newly copied tab cannot match the original.
      const tab = mobile
        ? namedTab.or(f.page.getByRole('tab', { name: `${name} Open sheet menu`, exact: true }))
        : namedTab;
      await tab.click();
      if (mobile)
        await f.page.getByRole('button', { name: 'Open sheet menu', exact: true }).click();
      else await tab.click({ button: 'right' });
      await expect(f.page.getByText('Rename', { exact: true })).toBeVisible();
      for (const text of [
        'Protect Worksheet',
        'Unprotect Worksheet',
        'Change permissions',
        'Remove protection',
        'View All Protection Ranges',
      ])
        await expect(f.page.getByText(text, { exact: true })).toHaveCount(0);
    };
    try {
      await f.page.goto(`/?item=${f.item.id}`);
      await saved(f.page);
      await expect(
        f.page.locator('[data-u-command="sheet.command.add-range-protection-from-toolbar"]'),
      ).toHaveCount(0);
      await openSheetMenu('Small sheet');
      await expect(f.page.getByText('Copy', { exact: true })).toBeVisible();
      await f.page.getByText('Copy', { exact: true }).click();
      await saved(f.page);
      await expect.poll(async () => (await f.read()).snapshot.sheetOrder.length).toBe(3);
      const copied = (await f.read()).snapshot;
      const copiedId = copied.sheetOrder.find((id) => !['small', 'large'].includes(id))!;
      expect(copied.sheets[copiedId].cellData?.[0]?.[1]?.v).toBe(5);
      expect(copied.sheets[copiedId].cellData?.[0]?.[2]?.f).toBe('=B1*2');
      await openSheetMenu('Large sheet');
      await expect(f.page.getByText('Copy', { exact: true })).toHaveCount(0);
      await f.page.screenshot({
        path: info.outputPath(`spn-059-sheet-menu-${mobile ? 'phone' : 'light'}.png`),
        animations: 'disabled',
      });
      await f.page.keyboard.press('Escape');
      if (!mobile) {
        await f.page.emulateMedia({ colorScheme: 'dark' });
        await openSheetMenu('Large sheet');
        await f.page.screenshot({
          path: info.outputPath('spn-059-sheet-menu-dark.png'),
          animations: 'disabled',
        });
        await f.page.keyboard.press('Escape');
        await f.page.getByRole('tab', { name: 'Formulas', exact: true }).click();
        await expect(f.page.getByRole('button', { name: /Calculation options/i })).toHaveCount(0);
        const region = f.page.getByRole('region', { name: 'Sheet document', exact: true });
        await expect(
          region.locator('[data-u-command="sheet.command.add-range-protection-from-toolbar"]'),
        ).toHaveCount(0);
        await selectCell(f.page, 'A1');
        const nameBox = region.locator('[data-u-comp="defined-name"]');
        await nameBox.locator('input').fill('CutoverRange');
        await nameBox.locator('input').press('Enter');
        await saved(f.page);
        await nameBox.locator('a').click();
        await f.page.getByText('Manager named', { exact: true }).click();
        await expect(f.page.locator('[data-u-comp="defined-name-container"]')).toBeVisible();
        await expect(f.page.getByText('CutoverRange', { exact: true })).toBeVisible();
        await selectCell(f.page, 'D1');
        await f.page.keyboard.type('=CutoverRange+1');
        await f.page.keyboard.press('Enter');
        await saved(f.page);
        await expect
          .poll(async () => (await f.read()).snapshot.sheets.large.cellData?.[0]?.[3]?.f)
          .toBe('=CutoverRange+1');
        await editCell(f.page, 'F1', '79');
        await saved(f.page);
        await selectCell(f.page, 'F1');
        await f.page.evaluate(() => navigator.clipboard.writeText('pending cut'));
        await f.page.keyboard.press('Control+x');
        await expect
          .poll(async () => (await f.page.evaluate(() => navigator.clipboard.readText())).trim())
          .toBe('79');
        await f.page.getByRole('tab', { name: 'Small sheet', exact: true }).click();
        await selectCell(f.page, 'G1');
        await f.page.keyboard.press('Control+v');
        await saved(f.page);
        await expect
          .poll(async () => (await f.read()).snapshot.sheets.small.cellData?.[0]?.[6]?.v)
          .toBe(79);
        expect((await f.read()).snapshot.sheets.large.cellData?.[0]?.[5]?.v ?? null).toBeNull();
      }
      await f.page.reload();
      await saved(f.page);
      await openSheetMenu('Small sheet');
      await expect(f.page.getByText('Copy', { exact: true })).toBeVisible();
      expect(f.network.incoming.filter((frame) => frame.type === 'resync')).toEqual([]);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });
}

// This transport soak complements the broad native mutation matrix: random
// real keyboard edits cross live/offline/lost-ack boundaries in two browsers,
// with independent authored-content checks as well as full-model convergence.
for (const kind of ['sheet', 'doc'] as const) {
  test(
    `seeded two-editor ${kind} sync soak survives repeated reconnect and reload`,
    { tag: '@sync-soak' },
    async ({ browser, baseURL }, info) => {
      test.setTimeout(10 * 60_000);
      const seed = kind === 'sheet' ? 0x5901 : 0x5902;
      let state = seed;
      const random = (limit: number) => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        // The low bit alternates, which would make every owner edit go to End
        // and every peer edit go to Home when two positions are chosen per round.
        return Math.floor((state / 0x100000000) * limit);
      };
      const f = await fixture(browser, baseURL!, info, kind);
      const expected = new Map<string, { value: number; formula?: string }>();
      const docEdits: DocSoakInsertion[] = [];
      const authored: object[] = [];
      const rounds = 150;
      let reconnects = 0,
        lostAcks = 0;
      let completedRounds = 0;
      let fullSnapshotCheckpoints = 0;
      let authoredContentCheckpoints = 0;
      let formulaDisplayChecks = 0;
      let revision: number | undefined;
      let completed = false;
      const verifyIntent = async (snapshot: IWorkbookData & IDocumentData) => {
        if (kind === 'sheet') {
          const sheet = snapshot.sheets[snapshot.sheetOrder[0]];
          for (const [address, intent] of expected) {
            const column = address[0] === 'A' ? 0 : 1;
            const cell = sheet.cellData?.[Number(address.slice(1)) - 1]?.[column];
            if (intent.formula) expect(cell?.f, address).toBe(intent.formula);
            else {
              expect(cell?.f ?? null, address).toBeNull();
              expect(cell?.v, address).toBe(intent.value);
            }
          }
          // The server persists authored formulas, not browser calculation
          // caches. Independently verify a computed result in both live views.
          const formula = [...expected].findLast(([, intent]) => intent.formula);
          if (formula)
            for (const page of [f.page, f.other]) {
              await expect.poll(() => copyCell(page, formula[0])).toBe(String(formula[1].value));
              formulaDisplayChecks++;
            }
        } else assertDocSoakContent(snapshot.body!.dataStream, docEdits);
        authoredContentCheckpoints++;
      };
      try {
        await Promise.all([
          f.page.goto(`/?item=${f.item.id}`),
          f.other.goto(`/?item=${f.item.id}`),
        ]);
        await Promise.all([saved(f.page), saved(f.other)]);
        if (kind === 'doc') await Promise.all([focusDoc(f.page), focusDoc(f.other)]);
        for (let round = 0; round < rounds; round++) {
          if (round % 30 === 5) await f.network.setOffline(true);
          const losingAck = round % 50 === 40;
          if (losingAck) f.network.loseAcknowledgment();
          if (kind === 'sheet') {
            const rows = [random(30), random(30)];
            const values = [random(10000), random(10000)];
            const formulas = [random(4) === 0, random(4) === 0];
            await Promise.all(
              [f.page, f.other].map((page, index) => {
                const address = `${index === 0 ? 'A' : 'B'}${rows[index] + 1}`;
                const formula = formulas[index] ? `=${values[index]}+0` : undefined;
                const input = formula ?? String(values[index]);
                expected.set(address, { value: values[index], formula });
                authored.push({ round, author: index === 0 ? 'owner' : 'peer', address, input });
                return editCell(page, address, input);
              }),
            );
          } else {
            const additions = (['owner', 'peer'] as const).map((author) =>
              docSoakInsertion(round, author),
            );
            docEdits.push(...additions);
            const positions = [random(2), random(2)];
            await Promise.all(
              [f.page, f.other].map(async (page, index) => {
                authored.push({
                  round,
                  ...additions[index],
                  position: positions[index] ? 'end' : 'start',
                });
                await nativeInput(page).focus();
                await page.keyboard.press(positions[index] ? 'Control+End' : 'Control+Home');
                await page.keyboard.insertText(additions[index].text);
              }),
            );
          }
          completedRounds = round + 1;
          if (round % 30 === 8) {
            await f.network.setOffline(false);
            reconnects++;
          }
          if (losingAck) {
            await expect.poll(f.network.lostMutationId).toBeTruthy();
            await f.network.setOffline(false);
            lostAcks++;
          }
          if (round % 10 === 9) {
            await Promise.all([saved(f.page), saved(f.other)]);
            const checkpoint = await f.read();
            revision = checkpoint.revision;
            await expectNativeSnapshots([f.page, f.other], checkpoint);
            fullSnapshotCheckpoints++;
            await verifyIntent(checkpoint.snapshot);
          }
        }
        await Promise.all([saved(f.page), saved(f.other)]);
        const committed = await f.read();
        revision = committed.revision;
        await Promise.all([f.page.reload(), f.other.reload()]);
        await Promise.all([saved(f.page), saved(f.other)]);
        await expectNativeSnapshots([f.page, f.other], committed);
        fullSnapshotCheckpoints++;
        await verifyIntent(committed.snapshot);
        expect(f.network.incoming.filter((frame) => frame.type === 'resync')).toEqual([]);
        expect(f.otherNetwork.incoming.filter((frame) => frame.type === 'resync')).toEqual([]);
        expect(f.errors).toEqual([]);
        completed = true;
      } finally {
        try {
          await writeFile(
            info.outputPath(`spn-059-${kind}-soak.json`),
            JSON.stringify(
              {
                seed,
                rounds,
                completed,
                completedRounds,
                authoredEdits: completedRounds * 2,
                reconnects,
                lostAcks,
                revision,
                outgoingSubmissions: [f.network, f.otherNetwork].map(
                  (wire) => wire.outgoing.filter((frame) => frame.type === 'submit').length,
                ),
                fullSnapshotCheckpoints,
                authoredContentCheckpoints,
                formulaDisplayChecks,
                authored,
              },
              null,
              2,
            ),
          );
        } finally {
          await f.close();
        }
      }
    },
  );
}
