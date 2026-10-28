import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import type { BrowserContext, TestInfo } from '@playwright/test';
import type { NativeSnapshot } from '@spinel/sync-client';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import type { OfflineCreationRequest } from '../src/shared/offlineCreation.ts';
import {
  copy,
  edit,
  matchesServer,
  pending,
  savedLocally,
  saveStatus,
  stored,
  synced,
  usableCanvas,
} from './offline-fixture.ts';
import type { Kind, Stored } from './offline-fixture.ts';
import { syncNetwork } from './sync-network.ts';
import { recordNativeSnapshots } from './sync-snapshot.ts';

type Creation = Stored & {
  creation?: {
    request: OfflineCreationRequest;
    access?: 'owner' | 'admin' | 'editor';
    ownerName?: string;
    createdByName?: string;
  };
};

/** Uses the existing production server; every restart opens the same real profile. */
export async function verifySharedCreationRestart(baseURL: string, info: TestInfo) {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-shared-creation-restart-'));
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  const owner = auth.createUser(`Restart owner ${info.testId}`);
  const actor = auth.createUser(`Restart creator ${info.testId}`);
  const folder = workspace.create(owner.id, {
    kind: 'folder',
    name: 'Restart project',
    parentId: null,
  });
  workspace.share(owner.id, folder.id, actor.id, 'editor');
  const seeds = (['sheet', 'doc'] as const).map((kind) =>
    workspace.create(owner.id, { kind, name: `Prepare ${kind}`, parentId: folder.id }),
  );
  const created: { id: string; kind: Kind; text: string; before: Creation }[] = [];
  const accepted = new Map<string, { revision: number; snapshot: NativeSnapshot }>();
  const stages: string[] = [];
  const errors: string[] = [];
  let context: BrowserContext | undefined;
  const start = async (offline = false) => {
    // Closing this context terminates its browser process. No storageState or
    // IndexedDB fixture reconstructs data, and offline precedes any navigation.
    context = await chromium.launchPersistentContext(join(directory, 'profile'), {
      headless: true,
      baseURL,
      viewport: { width: 1440, height: 1100 },
      permissions: ['clipboard-read', 'clipboard-write'],
      offline,
    });
    await recordNativeSnapshots(context);
    const network = await syncNetwork(context);
    await network.setOffline(offline);
    const page = context.pages()[0] ?? (await context.newPage());
    expect(await page.evaluate(() => navigator.onLine)).toBe(!offline);
    page.on('pageerror', (error) => errors.push(error.message));
    return { page, network };
  };
  const serverItem = (id: string) => db.prepare('SELECT * FROM workspace_items WHERE id=?').get(id);
  const readServer = async (id: string, unitId: string) => {
    const response = await context!.request.get(
      `/sync-api/items/${id}/snapshot?unitId=${encodeURIComponent(unitId)}`,
    );
    expect(response.status(), await response.text()).toBe(200);
    return (await response.json()) as { revision: number; snapshot: NativeSnapshot };
  };
  try {
    let { page, network } = await start();
    const session = auth.createSession(actor.id);
    await context!.addCookies([
      {
        name: COOKIE_NAME,
        value: session.token,
        url: baseURL.replace('http:', 'https:'),
        secure: true,
        httpOnly: true,
        sameSite: 'Strict',
        expires: Math.floor(session.session.expires_at / 1000),
      },
    ]);
    for (const seed of seeds) {
      await page.goto(`/?item=${seed.id}`);
      await expect(saveStatus(page)).toHaveText('All changes saved.', { timeout: 30_000 });
      await expect
        .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
        .toBe(true);
      await page.getByRole('button', { name: 'Document actions', exact: true }).click();
      await page
        .getByRole('menuitem', { name: 'Available offline on this device', exact: true })
        .click();
      const dialog = page.getByRole('dialog', { name: 'Offline availability', exact: true });
      await expect(dialog.getByRole('status')).toHaveText(
        `${seed.name} is available offline on this device.`,
        { timeout: 120_000 },
      );
      await dialog.getByRole('button', { name: 'Done', exact: true }).click();
      await synced(page);
    }
    await page.goto('/');
    await page.getByRole('button', { name: 'Shared with me', exact: true }).click();
    await page.getByRole('button', { name: `${folder.name} Folder`, exact: true }).click();
    await expect(page.getByRole('heading', { name: folder.name, exact: true })).toBeVisible();
    await network.setOffline(true);
    for (const kind of ['sheet', 'doc'] as const) {
      await page.getByRole('button', { name: 'New', exact: true }).click();
      const menu = page.getByRole('menu');
      await expect(menu.getByRole('menuitem')).toHaveText(['Sheet', 'Doc']);
      await menu
        .getByRole('menuitem', { name: kind === 'sheet' ? 'Sheet' : 'Doc', exact: true })
        .click();
      const dialog = page.getByRole('dialog', { name: `New ${kind}`, exact: true });
      await dialog.getByRole('textbox', { name: 'Name' }).fill(`Cold restart ${kind}`);
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(page).toHaveURL(/\?item=[a-f\d-]{36}$/);
      await usableCanvas(page);
      const id = new URL(page.url()).searchParams.get('item')!;
      const text = kind === 'sheet' ? '69851' : 'Persisted through a browser process restart 69851';
      await edit(page, kind, text);
      await savedLocally(page);
      const before = (await stored(page, actor.id, id)) as Creation;
      expect(before.creation).toMatchObject({
        request: { itemId: id, parentId: folder.id, kind },
        access: 'editor',
        ownerName: owner.name,
        createdByName: actor.name,
      });
      expect(before.bundle).toMatchObject({ accountId: actor.id, access: 'editor' });
      expect(before.outbox).toMatchObject({ account: actor.id, item: id });
      expect(pending(before.outbox?.checkpoint)).toBe(true);
      expect(serverItem(id)).toBeUndefined();
      created.push({ id, kind, text, before });
      await page.getByRole('button', { name: 'Back to files', exact: true }).click();
    }
    stages.push('both-native-drafts-persisted-offline');
    await context!.close();
    context = undefined;
    ({ page, network } = await start(true));
    for (const item of created) {
      await page.goto(`/?item=${item.id}`);
      expect(await page.evaluate(() => navigator.onLine)).toBe(false);
      await usableCanvas(page);
      await savedLocally(page);
      expect(await copy(page, item.kind)).toContain(item.text);
      const reopened = (await stored(page, actor.id, item.id)) as Creation;
      expect(reopened.creation).toEqual(item.before.creation);
      expect(reopened.outbox?.checkpoint).toEqual(item.before.outbox!.checkpoint);
      expect(reopened.bundle).toMatchObject({
        accountId: actor.id,
        access: 'editor',
        unitId: item.before.creation!.request.unitId,
      });
      expect(serverItem(item.id)).toBeUndefined();
    }
    stages.push('offline-process-restart-retained-exact-drafts');
    await network.setOffline(false);
    // The last opened Doc publishes first; opening the Sheet resumes its writer.
    for (const item of [...created].reverse()) {
      if (new URL(page.url()).searchParams.get('item') !== item.id)
        await page.goto(`/?item=${item.id}`);
      await synced(page);
      const unitId = item.before.creation!.request.unitId;
      expect(serverItem(item.id)).toMatchObject({
        id: item.id,
        owner_id: owner.id,
        parent_id: folder.id,
        kind: item.kind,
      });
      expect(
        db.prepare('SELECT * FROM workspace_item_creators WHERE item_id=?').get(item.id),
      ).toMatchObject({ created_by: actor.id, created_by_name: actor.name });
      expect(
        db.prepare('SELECT * FROM workspace_offline_creations WHERE item_id=?').get(item.id),
      ).toMatchObject({ user_id: actor.id, owner_id: owner.id, unit_id: unitId });
      expect(workspace.get(owner.id, item.id)).toMatchObject({
        access: 'owner',
        createdByName: actor.name,
      });
      const result = await readServer(item.id, unitId);
      await matchesServer(page, result);
      if (item.kind === 'sheet') {
        if (!('sheets' in result.snapshot)) throw new Error('Expected the published Sheet.');
        expect(result.snapshot.sheets[result.snapshot.sheetOrder[0]].cellData?.[0]?.[3]?.v).toBe(
          Number(item.text),
        );
      } else {
        if ('sheets' in result.snapshot) throw new Error('Expected the published Doc.');
        expect(result.snapshot.body?.dataStream.split(item.text)).toHaveLength(2);
      }
      const committed = (await stored(page, actor.id, item.id)) as Creation;
      expect(committed.creation).toBeUndefined();
      expect(pending(committed.outbox?.checkpoint)).toBe(false);
      accepted.set(item.id, result);
    }
    expect(
      db
        .prepare('SELECT item_id FROM workspace_offline_creations WHERE user_id=? ORDER BY item_id')
        .all(actor.id),
    ).toEqual(
      created.map(({ id }) => ({ item_id: id })).sort((a, b) => a.item_id.localeCompare(b.item_id)),
    );
    stages.push('both-drafts-published-once-to-folder-owner');
    await context!.close();
    context = undefined;
    ({ page, network } = await start(true));
    for (const item of created) {
      await page.goto(`/?item=${item.id}`);
      expect(await page.evaluate(() => navigator.onLine)).toBe(false);
      await usableCanvas(page);
      expect(await copy(page, item.kind)).toContain(item.text);
      const committed = (await stored(page, actor.id, item.id)) as Creation;
      expect(committed.creation).toBeUndefined();
      expect(committed.bundle.access).toBe('editor');
      expect(pending(committed.outbox?.checkpoint)).toBe(false);
    }
    await network.setOffline(false);
    for (const item of [...created].reverse()) {
      if (new URL(page.url()).searchParams.get('item') !== item.id)
        await page.goto(`/?item=${item.id}`);
      await synced(page);
      expect(await readServer(item.id, item.before.creation!.request.unitId)).toEqual(
        accepted.get(item.id),
      );
    }
    expect(
      db
        .prepare('SELECT count(*) AS count FROM workspace_offline_creations WHERE user_id=?')
        .get(actor.id)?.count,
    ).toBe(2);
    expect(
      workspace
        .children(owner.id, folder.id)
        .map(({ id }) => id)
        .sort(),
    ).toEqual([...seeds.map(({ id }) => id), ...created.map(({ id }) => id)].sort());
    stages.push('accepted-files-survive-second-offline-process-restart-without-republication');
    expect(errors).toEqual([]);
  } finally {
    try {
      await writeFile(
        info.outputPath('sync-diagnostics.json'),
        JSON.stringify(
          {
            stages,
            errors,
            created: created.map(({ id, kind, before }) => ({
              id,
              kind,
              request: before.creation?.request,
            })),
          },
          null,
          2,
        ),
      );
    } finally {
      try {
        await context?.close();
      } finally {
        db.close();
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
}
