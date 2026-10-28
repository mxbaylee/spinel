import { syncNetwork } from './sync-network.ts';
import { downloadPdf, inspectPdf } from './pdfEvidence.ts';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Browser, Locator, Page, TestInfo } from '@playwright/test';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import type { FormulaDefinition } from '@spinel/doc-formulas';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { SpaceStore } from '../src/server/workspace/spaces.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import type { SpaceNode, SpaceRoot, SpaceTreeData } from '../src/shared/spaces.ts';
import { startApp } from './app-process.ts';

// Native SDKs stay in the disposable server. Account setup and verification use
// HTTP. The revocation case additionally opens one sibling to prove root scope.
async function fixture(browser: Browser, info: TestInfo) {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-space-guests-'));
  const databasePath = join(directory, 'app.sqlite');
  const origin = `http://localhost:${info.project.name === 'development' ? 3198 : 3199}`;
  const app = await startApp({
    databasePath,
    origin,
    development: info.project.name === 'development',
  });
  const db = openDatabase(databasePath);
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  const spaces = new SpaceStore(workspace);
  const owner = auth.createUser('Private account identity');
  const folder = workspace.create(owner.id, {
    name: 'Private outer location',
    kind: 'folder',
    parentId: null,
  });
  const root = spaces.createRoot(owner.id, {
    name: 'Guest project',
    parentId: folder.id,
  }).space as SpaceRoot;
  const child = (name: string, kind: SpaceNode['kind'], parentId = root.id) =>
    spaces.createChild(owner.id, root.id, { name, kind, parentId }).item as SpaceNode;
  const overview = child('Shared overview', 'doc');
  const source = child('Budget', 'sheet', overview.id);
  const section = child('Research', 'folder');
  const nested = child('Nested field notes', 'doc', section.id);
  const external = workspace.create(owner.id, {
    name: 'Private external estimates',
    kind: 'sheet',
    parentId: null,
  });
  const otherRoot = spaces.createRoot(owner.id, {
    name: 'Private unrelated Space',
    parentId: null,
  }).space as SpaceRoot;
  const outside = spaces.createChild(owner.id, otherRoot.id, {
    name: 'Private unrelated page',
    kind: 'doc',
    parentId: otherRoot.id,
  }).item as SpaceNode;
  const otherSource = spaces.createChild(owner.id, otherRoot.id, {
    name: 'Private unrelated estimates',
    kind: 'sheet',
    parentId: otherRoot.id,
  }).item as SpaceNode;
  const seedSheet = (item: { id: string; name: string }, amount: number) => {
    const snapshot = {
      id: item.id,
      name: item.name,
      appVersion: '1.1.0',
      locale: 'enUS',
      styles: {},
      sheetOrder: ['summary'],
      sheets: {
        summary: {
          id: 'summary',
          name: 'Summary',
          rowCount: 100,
          columnCount: 10,
          cellData: { 0: { 0: { v: amount } } },
        },
      },
    };
    db.prepare(
      `INSERT INTO sheet_snapshots(item_id,snapshot,revision,write_id) VALUES(?,?,1,?)
       ON CONFLICT(item_id) DO UPDATE SET snapshot=excluded.snapshot,write_id=excluded.write_id`,
    ).run(item.id, JSON.stringify(snapshot), crypto.randomUUID());
  };
  seedSheet(source, 314159265);
  seedSheet(external, 999111222);
  seedSheet(otherSource, 888111222);
  const account = await browser.newContext({ baseURL: origin });
  await account.addCookies([
    {
      name: COOKIE_NAME,
      value: auth.createSession(owner.id).token,
      url: origin.replace('http:', 'https:'),
      secure: true,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  const guest = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1440, height: 1050 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const network = await syncNetwork(guest);
  const page = await guest.newPage();
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const link = async (role: 'viewer' | 'editor' | null) => {
    const response = await account.request.put(`/api/items/${root.id}/link`, {
      headers: { Origin: origin },
      data: { role },
    });
    expect(response.status()).toBe(200);
    const result = (await response.json()) as { enabled: boolean; url: string | null };
    expect(result.enabled).toBe(role !== null);
    if (role) expect(typeof result.url).toBe('string');
    return result.url;
  };
  const create = async (name: string, kind: SpaceNode['kind'], parentId = root.id) => {
    const response = await account.request.post(`/api/spaces/${root.id}/items`, {
      headers: { Origin: origin },
      data: { name, kind, parentId },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).item as SpaceNode;
  };
  const tree = async () => {
    const response = await account.request.get(`/api/spaces/${root.id}`);
    expect(response.status()).toBe(200);
    return (await response.json()) as SpaceTreeData;
  };
  const snapshot = async <T extends IDocumentData | IWorkbookData>(id: string) => {
    const response = await account.request.get(`/api/spaces/${root.id}/items/${id}/export`);
    expect(response.status()).toBe(200);
    return (await response.json()) as T;
  };
  const close = async () => {
    const results = await Promise.allSettled([app.close(), guest.close(), account.close()]);
    try {
      db.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    const rejected = results.filter((result) => result.status === 'rejected');
    if (rejected.length)
      throw new AggregateError(
        rejected.map((result) => result.reason),
        'Could not close the guest Space fixture.',
      );
  };
  return {
    network,
    db,
    workspace,
    spaces,
    owner,
    folder,
    root,
    overview,
    source,
    section,
    nested,
    external,
    otherRoot,
    outside,
    otherSource,
    seedSheet,
    origin,
    account,
    guest,
    page,
    errors,
    link,
    create,
    tree,
    snapshot,
    close,
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
const guestPath = (root: string, child: string) => `/share/${root}?item=${child}`;
const endpoint = (root: string, child: string) => `/api/guest-spaces/${root}/items/${child}`;
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function deepLink(link: string, child: string) {
  const url = new URL(link);
  url.searchParams.set('item', child);
  return url.href;
}
const pageLink = (page: Page, root: string, child: string) =>
  page.locator(`a.space-page-link[href="${guestPath(root, child)}"]`).filter({ visible: true });
const saved = async (page: Page, access: 'viewer' | 'editor' = 'editor') => {
  await expect(page.getByRole('status', { name: 'Save status', exact: true })).toHaveText(
    access === 'viewer' ? 'View only — reload after your access changes.' : 'All changes saved.',
    { timeout: 30_000 },
  );
  await expect(
    page.getByRole('button', {
      name: `Save details: ${access === 'viewer' ? 'View only' : 'Saved'}`,
      exact: true,
    }),
  ).toBeVisible();
};
const focusDoc = (page: Page) =>
  page
    .getByRole('region', { name: 'Doc document', exact: true })
    .locator('.univer-container')
    .click({ position: { x: 130, y: 200 } });
async function pages(page: Page) {
  const navigation = page.getByRole('navigation', { name: 'Pages', exact: true });
  if (!(await navigation.isVisible()))
    await page.getByRole('button', { name: 'Open Space contents', exact: true }).click();
  await expect(navigation).toBeVisible();
  return navigation;
}
async function choose(page: Page, dialog: Locator, label: string, name: string) {
  await dialog.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: new RegExp('^' + escaped(name) + '(?:$| ·)') }).click();
}
async function add(f: Fixture, kind: 'Doc' | 'Sheet' | 'Folder', name: string, parent: string) {
  await (await pages(f.page)).getByRole('button', { name: 'Add page', exact: true }).click();
  await f.page.getByRole('menuitem', { name: kind, exact: true }).click();
  const dialog = f.page.getByRole('dialog', {
    name: `New ${kind === 'Folder' ? 'folder' : kind}`,
    exact: true,
  });
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await choose(f.page, dialog, 'Parent page or folder', parent);
  const pending = f.page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/guest-spaces/${f.root.id}/items`) &&
      response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(201);
  const item = (await response.json()).item as SpaceNode;
  await expect(dialog).not.toBeVisible();
  if (kind !== 'Folder') {
    await expect(f.page).toHaveURL(f.origin + guestPath(f.root.id, item.id));
    await saved(f.page);
  }
  return item;
}
async function action(f: Fixture, name: string, mode: 'Rename' | 'Move or reorder' | 'Trash') {
  await (
    await pages(f.page)
  )
    .getByRole('button', { name: `More actions for ${name}`, exact: true })
    .click();
  await f.page.getByRole('menuitem', { name: mode, exact: true }).click();
  const dialog = f.page.getByRole('dialog', { name: `${mode} ${name}`, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function change(
  f: Fixture,
  item: SpaceNode,
  mode: 'Rename' | 'Move or reorder',
  values: { name?: string; parent?: string; position?: number },
) {
  const dialog = await action(f, item.name, mode);
  if (values.name) await dialog.getByLabel('Name', { exact: true }).fill(values.name);
  if (values.parent) await choose(f.page, dialog, 'Parent page or folder', values.parent);
  if (values.position)
    await dialog
      .getByRole('spinbutton', { name: 'Position', exact: true })
      .fill(String(values.position));
  const pending = f.page.waitForResponse(
    (response) =>
      response.url().endsWith(endpoint(f.root.id, item.id)) &&
      response.request().method() === 'PATCH',
  );
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  await expect(dialog).not.toBeVisible();
  return (await response.json()).item as SpaceNode;
}
async function png(page: Page) {
  return Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 2;
      canvas.getContext('2d')!.fillRect(0, 0, 2, 2);
      return canvas.toDataURL('image/png').split(',')[1];
    }),
    'base64',
  );
}
async function guestOnly(f: Fixture) {
  for (const name of [
    'My files',
    'Spinel home',
    'Versions',
    'Download Univer file',
    'Document actions',
    'New Space',
  ])
    await expect(f.page.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(f.page.getByRole('button', { name: 'Your profile', exact: true })).toHaveCount(0);
  await expect(f.page.getByRole('button', { name: /^Space actions for / })).toHaveCount(0);
  await expect(f.page.getByRole('link', { name: 'Space Trash', exact: true })).toHaveCount(0);
  await expect(f.page.getByRole('navigation', { name: 'Workspace', exact: true })).toHaveCount(0);
  await expect(f.page.getByRole('dialog', { name: 'Export', exact: true })).toHaveCount(0);
  const body = await f.page.locator('body').innerText();
  for (const privateName of [
    f.owner.name,
    f.folder.name,
    f.external.name,
    f.otherRoot.name,
    f.outside.name,
    f.otherSource.name,
  ])
    expect(body).not.toContain(privateName);
}
async function capture(f: Fixture, info: TestInfo, role: string) {
  await mkdir('test-results/theme-screenshots', { recursive: true });
  for (const [theme, width, variant] of [
    ['light', 1440, 'light'],
    ['dark', 1440, 'dark'],
    ['light', 390, 'phone'],
  ] as const) {
    await f.page.setViewportSize({ width, height: 1050 });
    // Guests retain system appearance without account settings in the editor.
    await f.page.emulateMedia({ colorScheme: theme });
    await expect(f.page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(
      f.page.getByText('This content is protected. This action is not allowed.', { exact: true }),
    ).not.toBeVisible();
    expect(await f.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width + 1,
    );
    await guestOnly(f);
    await f.page.screenshot({
      path: `test-results/theme-screenshots/spn-092-space-guest-${role}-${variant}-${info.project.name}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
  await pages(f.page);
  await f.page.screenshot({
    path: `test-results/theme-screenshots/spn-092-space-guest-${role}-phone-pages-${info.project.name}.png`,
    fullPage: true,
    animations: 'disabled',
  });
  await f.page.getByRole('button', { name: 'Close Space contents', exact: true }).click();
  // Wait for the animated drawer to leave before revealing the desktop rail.
  await expect(f.page.getByRole('dialog', { name: 'Space contents', exact: true })).toBeHidden();
  await f.page.setViewportSize({ width: 1440, height: 1050 });
}

test('a View Space link covers nested and future pages without outer access or private social-card data', async ({
  browser,
}, info) => {
  test.setTimeout(180_000);
  const f = await fixture(browser, info);
  try {
    const viewLink = (await f.link('viewer'))!;
    const publicUrl = new URL(viewLink);
    publicUrl.hash = '';
    const htmlResponse = await f.guest.request.get(publicUrl.href);
    expect(htmlResponse.status()).toBe(200);
    const html = await htmlResponse.text();
    const metadata = await f.page.evaluate((source) => {
      const document = new DOMParser().parseFromString(source, 'text/html');
      const get = (name: string) =>
        document.querySelector(`meta[property="${name}"]`)?.getAttribute('content');
      return {
        title: get('og:title'),
        description: get('og:description'),
        alt: get('og:image:alt'),
        image: get('og:image'),
      };
    }, html);
    expect(metadata.title).toBe(`${f.root.name} — Spinel`);
    expect(metadata.description).toBe('A Space shared with you on Spinel.');
    expect(metadata.alt).toBe(`Space: ${f.root.name}. Shared on Spinel.`);
    for (const privateText of [
      f.owner.name,
      f.folder.name,
      f.overview.name,
      f.nested.name,
      f.source.name,
      f.external.name,
      '314159265',
    ])
      expect(html).not.toContain(privateText);
    const cardUrl = new URL(metadata.image!, f.origin);
    expect(cardUrl.pathname).toBe(`/share/${f.root.id}/preview.png`);
    const cardResponse = await f.guest.request.get(cardUrl.href);
    expect(cardResponse.status()).toBe(200);
    expect(cardResponse.headers()['content-type']).toContain('image/png');
    expect(cardResponse.headers()['cache-control']).toBe('no-store');
    const card = await cardResponse.body();
    const artwork = await f.page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(860, 140, 320, 320).data;
      let purple = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        const [red, green, blue] = pixels.subarray(offset, offset + 3);
        if (blue > red && red > green + 10 && blue > green + 25) purple++;
      }
      return { width: canvas.width, height: canvas.height, purple };
    }, card.toString('base64'));
    expect(artwork).toMatchObject({ width: 1280, height: 640 });
    expect(artwork.purple).toBeGreaterThan(1000);
    // Changing private identity/location, child titles and source values cannot
    // change the public card. No native renderer is imported into this worker.
    f.db
      .prepare('UPDATE auth_users SET name=? WHERE id=?')
      .run('Changed private identity', f.owner.id);
    f.workspace.update(f.owner.id, f.folder.id, { name: 'Changed private outer location' });
    f.spaces.updateChild(f.owner.id, f.root.id, f.nested.id, {
      name: 'Changed private child title',
    });
    f.seedSheet(f.source, 271828182);
    const unchanged = await f.guest.request.get(cardUrl.href);
    expect(unchanged.status()).toBe(200);
    expect((await unchanged.body()).equals(card)).toBe(true);
    await mkdir('test-results/theme-screenshots', { recursive: true });
    await writeFile(
      `test-results/theme-screenshots/spn-092-space-social-card-${info.project.name}.png`,
      card,
    );
    await info.attach('Space title-and-type social card', { body: card, contentType: 'image/png' });
    expect((await f.guest.request.get(`/share/${f.root.id}/preview.png`)).status()).toBe(404);

    const bytes = await png(f.page);
    const uploaded = await f.account.request.post(
      `/api/spaces/${f.root.id}/items/${f.nested.id}/images`,
      {
        headers: { Origin: f.origin, 'Content-Type': 'image/png' },
        data: bytes,
      },
    );
    expect(uploaded.status()).toBe(201);
    const image = (await uploaded.json()) as { id: string; url: string };
    await f.page.goto(deepLink(viewLink, f.nested.id));
    await saved(f.page, 'viewer');
    await expect(
      f.page.getByRole('heading', { name: 'Changed private child title', exact: true }),
    ).toBeVisible();
    expect(new URL(f.page.url()).hash).toBe('');
    await guestOnly(f);
    expect(await f.page.locator('body').innerText()).not.toContain('Changed private identity');
    expect(await f.page.locator('body').innerText()).not.toContain(
      'Changed private outer location',
    );
    await expect(f.page.getByRole('button', { name: 'Add page', exact: true })).toHaveCount(0);
    const treeResponse = await f.guest.request.get(`/api/guest-spaces/${f.root.id}`);
    expect(treeResponse.status()).toBe(200);
    const visible = (await treeResponse.json()) as SpaceTreeData;
    expect(visible.space.parentId).toBeNull();
    expect(visible.access).toBe('viewer');
    for (const value of [
      f.owner.id,
      f.folder.id,
      'Changed private identity',
      'Changed private outer location',
    ])
      expect(JSON.stringify(visible)).not.toContain(value);
    const host = endpoint(f.root.id, f.nested.id);
    await f.page.getByRole('button', { name: 'Export as PDF', exact: true }).click();
    const pdfPanel = f.page.getByRole('dialog', { name: 'Export as PDF', exact: true });
    const pdfDownload = await downloadPdf(
      f.page,
      pdfPanel.getByRole('button', { name: 'Export as PDF', exact: true }),
      `${host}/pdf`,
    );
    await inspectPdf(pdfDownload, info, 'space-guest-doc', {
      forbidden: ['Changed private identity', 'Changed private outer location', f.external.name],
    });
    await pdfPanel.getByRole('button', { name: 'Close dialog', exact: true }).click();
    for (const path of [
      '/api/items',
      `/api/spaces/${f.root.id}`,
      `/api/items/${f.root.id}/sharing`,
    ])
      expect((await f.guest.request.get(path)).status()).toBe(401);
    for (const path of [
      `${host}/history`,
      `${host}/export`,
      `${host}/offline-bundle`,
      `/api/guest-spaces/${f.root.id}/trash`,
      `/api/guest/${f.nested.id}`,
      endpoint(f.otherRoot.id, f.nested.id),
      endpoint(f.root.id, f.outside.id),
    ])
      expect((await f.guest.request.get(path)).status()).toBe(404);
    for (const method of ['PATCH', 'DELETE']) {
      const refused = await f.guest.request.fetch(host, {
        method,
        headers: { Origin: f.origin },
        data: method === 'PATCH' ? { name: 'Must not rename' } : {},
      });
      expect(refused.status()).toBe(403);
    }
    expect(
      (
        await f.guest.request.post(`/api/guest-spaces/${f.root.id}/items`, {
          headers: { Origin: f.origin },
          data: { kind: 'doc', name: 'Must not create', parentId: f.root.id },
        })
      ).status(),
    ).toBe(403);
    expect(image.url).toBe(`/api/items/${f.nested.id}/images/${image.id}`);
    expect((await f.guest.request.get(image.url)).status()).toBe(200);
    // Another root's canonical URL has no matching credential; a scoped wrong-child
    // request is authenticated as this link but still cannot reveal that child.
    expect(
      (await f.guest.request.get(`/api/items/${f.outside.id}/images/${image.id}`)).status(),
    ).toBe(401);
    expect(
      (
        await f.guest.request.get(`${endpoint(f.root.id, f.outside.id)}/images/${image.id}`)
      ).status(),
    ).toBe(404);
    expect(
      (
        await f.guest.request.post(`${host}/images`, {
          headers: { Origin: f.origin, 'Content-Type': 'image/png' },
          data: bytes,
        })
      ).status(),
    ).toBe(403);
    const sources = await f.guest.request.get(`${host}/formulas/sources`);
    expect(await sources.json()).toEqual({
      sources: [{ itemId: f.source.id, name: f.source.name }],
    });
    const resolved = await f.guest.request.post(`${host}/formulas/resolve`, {
      headers: { Origin: f.origin },
      data: { expression: '=Budget.Summary.A1' },
    });
    expect(resolved.status()).toBe(200);
    const { definition } = (await resolved.json()) as { definition: FormulaDefinition };
    expect(definition.references[0]).toMatchObject({ itemId: f.source.id, sheetId: 'summary' });
    const result = await f.guest.request.post(`${host}/formulas/evaluate`, {
      headers: { Origin: f.origin },
      data: { definition },
    });
    expect(await result.json()).toMatchObject({ ok: true, kind: 'scalar', value: 271828182 });
    for (const source of [f.external, f.otherSource]) {
      expect((await f.guest.request.get(`${host}/formulas/sources/${source.id}`)).status()).toBe(
        404,
      );
      const inaccessible = await f.guest.request.post(`${host}/formulas/evaluate`, {
        headers: { Origin: f.origin },
        data: {
          definition: {
            ...definition,
            references: [{ ...definition.references[0], itemId: source.id }],
          },
        },
      });
      expect(await inaccessible.json()).toEqual({ ok: false, reason: 'private-source' });
    }
    await capture(f, info, 'viewer');
    const future = await f.create('Future page inside a Sheet', 'doc', f.source.id);
    await (
      await pages(f.page)
    )
      .getByRole('button', { name: `Expand ${f.overview.name}`, exact: true })
      .click();
    await f.page.getByRole('button', { name: `Expand ${f.source.name}`, exact: true }).click();
    await expect(pageLink(f.page, f.root.id, future.id)).toBeVisible();
    await pageLink(f.page, f.root.id, future.id).click();
    await saved(f.page, 'viewer');
    await expect(f.page).toHaveURL(f.origin + guestPath(f.root.id, future.id));
    await pageLink(f.page, f.root.id, f.source.id).click();
    await saved(f.page, 'viewer');
    await expect(f.page.getByRole('region', { name: 'Sheet document', exact: true })).toBeVisible();
    for (const href of await f.page
      .locator('a.space-page-link')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href'))))
      expect(href).toMatch(new RegExp(`^/share/${f.root.id}\\?item=`));
    // Even a concurrently signed-in owner cannot promote this guest namespace.
    await f.guest.addCookies(await f.account.cookies());
    const mixed = await f.guest.request.get(host);
    expect((await mixed.json()).item.access).toBe('viewer');
    expect(
      (
        await f.guest.request.patch(host, {
          headers: { Origin: f.origin },
          data: { name: 'No owner fallback' },
        })
      ).status(),
    ).toBe(403);
    expect((await f.guest.request.get(`${host}/export`)).status()).toBe(404);
    expect((await f.guest.request.get(`${host}/formulas/sources/${f.external.id}`)).status()).toBe(
      404,
    );
    await guestOnly(f);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('a stale missing sibling action preserves a valid guest root and pending native input', async ({
  browser,
}, info) => {
  test.setTimeout(90_000);
  const f = await fixture(browser, info);
  let release = () => {};
  try {
    const link = (await f.link('editor'))!;
    await f.page.goto(deepLink(link, f.overview.id));
    await saved(f.page);
    const activeAddress = f.page.url();
    const activeUrl = new URL(activeAddress);
    expect(activeUrl.origin + activeUrl.pathname).toBe(f.origin + `/share/${f.root.id}`);
    expect(activeUrl.searchParams.get('item')).toBe(f.overview.id);
    expect(activeUrl.hash).toBe('');
    await (
      await pages(f.page)
    )
      .getByRole('button', { name: `Expand ${f.section.name}`, exact: true })
      .click();
    const native = await f.page
      .getByRole('region', { name: 'Doc document', exact: true })
      .locator('.univer-container')
      .elementHandle();
    expect(native).not.toBeNull();
    let received = 0;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.network.interceptWrites(async (write) => {
      received++;
      await held;
      write.forward();
    });
    const draft = 'Pending input survives a missing sibling.';
    await focusDoc(f.page);
    await f.page.keyboard.type(draft);
    await expect.poll(() => received).toBeGreaterThan(0);
    await expect(f.page.getByRole('status', { name: 'Save status', exact: true })).toContainText(
      'not saved',
    );
    const rename = await action(f, f.nested.name, 'Rename');
    await rename.getByLabel('Name', { exact: true }).fill('A stale rename');
    const removed = await f.account.request.delete(
      `/api/spaces/${f.root.id}/items/${f.nested.id}`,
      { headers: { Origin: f.origin }, data: {} },
    );
    expect(removed.status()).toBe(200);
    let sawFailure = false;
    const refreshed = f.page.waitForResponse((response) => {
      const requestPath = new URL(response.url()).pathname;
      if (
        requestPath === endpoint(f.root.id, f.nested.id) &&
        response.request().method() === 'PATCH' &&
        response.status() === 404
      )
        sawFailure = true;
      return sawFailure && requestPath === `/api/guest-spaces/${f.root.id}`;
    });
    const failed = f.page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === endpoint(f.root.id, f.nested.id) &&
        response.request().method() === 'PATCH',
    );
    await rename.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await failed).status()).toBe(404);
    expect((await refreshed).status()).toBe(200);
    await expect(rename.getByRole('alert')).toBeVisible();
    await rename.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(f.page).toHaveURL(activeAddress);
    expect(await native?.evaluate((element) => element.isConnected)).toBe(true);
    await expect(f.page.getByRole('status', { name: 'Save status', exact: true })).toContainText(
      'not saved',
    );
    await expect(
      f.page.getByRole('heading', { name: 'This link no longer works.', exact: true }),
    ).toHaveCount(0);
    await guestOnly(f);
    release();
    await saved(f.page);
    expect((await f.snapshot<IDocumentData>(f.overview.id)).body?.dataStream).toContain(draft);
    expect(f.errors).toEqual([]);
    await native?.dispose();
  } finally {
    release();
    try {
      await f.network.drainWrites();
    } finally {
      await f.close();
    }
  }
});

for (const [kind, expiring] of [
  ['doc', false],
  ['sheet', false],
  ['doc', true],
  ['sheet', true],
] as const) {
  test(`${expiring ? 'expired' : 'revoked'} dirty guest ${kind} loses native content, portals and keyboard access across Space children`, async ({
    browser,
  }, info) => {
    test.setTimeout(150_000);
    const f = await fixture(browser, info);
    let release = () => {};
    try {
      const child = kind === 'doc' ? f.overview : f.source;
      const sibling = kind === 'doc' ? f.source : f.nested;
      const link = (await f.link('editor'))!;
      await f.page.goto(deepLink(link, child.id));
      await saved(f.page);
      const other = await f.guest.newPage();
      await other.goto(guestPath(f.root.id, sibling.id));
      await saved(other);
      await f.page.bringToFront();
      let expiringImage: string | undefined;
      if (expiring) {
        const doc = kind === 'doc' ? child : sibling;
        const uploaded = await f.guest.request.post(`${endpoint(f.root.id, doc.id)}/images`, {
          headers: { Origin: f.origin, 'Content-Type': 'image/png' },
          data: await png(f.page),
        });
        expect(uploaded.status()).toBe(201);
        expiringImage = (await uploaded.json()).url;
        expect((await f.guest.request.get(expiringImage!)).status()).toBe(200);
        expect(await (await f.guest.request.get(link.split('#')[0])).text()).toContain(f.root.name);
      }
      const before = await f.snapshot(child.id);
      const siblingBefore = await f.snapshot(sibling.id);
      let received = 0;
      const forwarded: boolean[] = [];
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      f.network.interceptWrites(async (write) => {
        received++;
        await held;
        forwarded.push(write.forward());
      });
      const privateDraft = `Unsent ${kind} private contribution`;
      if (kind === 'doc') {
        await focusDoc(f.page);
        await f.page.keyboard.type(privateDraft);
      } else {
        const address = f.page
          .getByRole('region', { name: 'Sheet document', exact: true })
          .locator('[data-u-comp="defined-name"]')
          .getByRole('textbox');
        await address.fill('B2');
        await address.press('Enter');
        await f.page.keyboard.type(privateDraft);
        await f.page.keyboard.press('Enter');
      }
      await expect.poll(() => received).toBeGreaterThan(0);
      await expect(f.page.getByRole('status', { name: 'Save status', exact: true })).toContainText(
        'not saved',
      );
      if (kind === 'doc') {
        await f.page.getByRole('button', { name: /^People/ }).click();
        await expect(
          f.page.getByRole('dialog', { name: 'People in this document', exact: true }),
        ).toBeVisible();
      } else {
        // This second cell remains actively edited, not yet in the workbook.
        // Capture must include the cell editor's Doc model/composition input.
        const address = f.page
          .getByRole('region', { name: 'Sheet document', exact: true })
          .locator('[data-u-comp="defined-name"]')
          .getByRole('textbox');
        await address.fill('C3');
        await address.press('Enter');
        await f.page.keyboard.type('Active cell draft before revocation');
        await expect(
          f.page.getByRole('status', { name: 'Save status', exact: true }),
        ).toContainText('Editing cell');
      }
      const oldInput = await f.page.evaluateHandle(() => document.activeElement);
      // Make the root bootstrap/tree probes unreachable in this tab. Its exact
      // child access watcher must enforce denial independently of those polls.
      await f.page.route(`**/api/guest/${f.root.id}`, (route) => route.abort('failed'));
      await f.page.route(`**/api/guest-spaces/${f.root.id}`, (route) => route.abort('failed'));
      if (expiring) {
        // Shorten only the test clock's deadline; exercise the production timer
        // without waiting a full day or invoking the turn-off route.
        f.db
          .prepare('UPDATE workspace_links SET expires_at=? WHERE item_id=?')
          .run(Date.now() + 1000, f.root.id);
      } else await f.link(null);
      for (const target of [f.page, other]) {
        await expect(
          target.getByRole('heading', { name: 'This link no longer works.', exact: true }),
        ).toBeVisible({ timeout: 15_000 });
        await expect(target.locator('.univer-container, canvas, a.space-page-link')).toHaveCount(0);
        await expect(target.getByRole('dialog')).toHaveCount(0);
        await expect(target.getByRole('menu')).toHaveCount(0);
        await expect(
          target.getByRole('button', {
            name: /People|theatre|Formulas|Retry saving|Export|Copy|Recover/i,
          }),
        ).toHaveCount(0);
        await expect(target.getByRole('textbox')).toHaveCount(0);
        await expect(target).toHaveTitle('Spinel');
        const text = await target.locator('body').innerText();
        for (const value of [
          f.root.name,
          child.name,
          sibling.name,
          f.owner.name,
          privateDraft,
          'Active cell draft before revocation',
        ])
          expect(text).not.toContain(value);
      }
      await expect(
        f.page.getByText('Some changes were not saved. This document is no longer accessible.', {
          exact: true,
        }),
      ).toBeVisible();
      expect(await oldInput.evaluate((element) => element?.isConnected)).toBe(false);
      await oldInput.dispose();
      await f.page.locator('h1').click();
      await f.page.keyboard.type('Cannot reenter the old editor');
      await f.page.keyboard.press('Control+a');
      await f.page.keyboard.press('Control+c');
      const copied = await f.page.evaluate(() => navigator.clipboard.readText());
      expect(copied).not.toContain(privateDraft);
      expect(copied).not.toContain('Active cell draft before revocation');
      await expect(f.page.locator('canvas, [contenteditable="true"]')).toHaveCount(0);
      const count = received;
      release();
      await expect.poll(() => forwarded.length).toBeGreaterThanOrEqual(count);
      // Revocation closed every captured native channel before held writes were released.
      expect(forwarded).toEqual(Array(count).fill(false));
      expect(await f.snapshot(child.id)).toEqual(before);
      expect(await f.snapshot(sibling.id)).toEqual(siblingBefore);
      for (const target of [child, sibling])
        expect((await f.guest.request.get(endpoint(f.root.id, target.id))).status()).toBe(404);
      if (expiring) {
        expect((await f.guest.request.get(expiringImage!)).status()).toBe(401);
        expect(await (await f.guest.request.get(link.split('#')[0])).text()).not.toContain(
          f.root.name,
        );
        expect(
          (
            await f.guest.request.post(`/api/guest/${f.root.id}/session`, {
              headers: { Origin: f.origin },
              data: { token: new URL(link).hash.slice(1) },
            })
          ).status(),
        ).toBe(404);
      }
      await mkdir('test-results/theme-screenshots', { recursive: true });
      for (const mode of [
        { name: 'light', colorScheme: 'light', width: 1280 },
        { name: 'dark', colorScheme: 'dark', width: 1280 },
        { name: 'phone', colorScheme: 'light', width: 390 },
      ] as const) {
        await f.page.emulateMedia({ colorScheme: mode.colorScheme });
        await f.page.setViewportSize({ width: mode.width, height: 844 });
        await f.page.screenshot({
          path: `test-results/theme-screenshots/${expiring ? 'spn-066-expired' : 'spn-084'}-dirty-${kind}-${mode.name}-${info.project.name}.png`,
          fullPage: true,
        });
      }
      expect(f.errors).toEqual([]);
    } finally {
      release();
      try {
        await f.network.drainWrites();
      } finally {
        await f.close();
      }
    }
  });
}

test('an Edit Space guest manages native pages and loses every child on rotation, downgrade and revocation', async ({
  browser,
}, info) => {
  test.setTimeout(210_000);
  const f = await fixture(browser, info);
  try {
    const editLink = (await f.link('editor'))!;
    await f.page.goto(deepLink(editLink, f.overview.id));
    await saved(f.page);
    await guestOnly(f);
    await focusDoc(f.page);
    await f.page.keyboard.type('Guest Space writing 271828.');
    await saved(f.page);
    expect((await f.snapshot<IDocumentData>(f.overview.id)).body?.dataStream).toContain(
      'Guest Space writing 271828.',
    );
    await f.page.keyboard.press('Control+End');
    await f.page.keyboard.press('Enter');
    await saved(f.page);
    await f.page.getByRole('button', { name: 'Insert formula', exact: true }).click();
    const formulas = f.page.getByRole('dialog', { name: 'Formulas', exact: true });
    const formula = f.page.getByRole('dialog', { name: 'Insert formula', exact: true });
    await formula.getByLabel('Formula', { exact: true }).fill('=Budget.Summary.A1');
    await formula.getByRole('button', { name: 'Insert formula', exact: true }).click();
    await expect(formula).not.toBeVisible();
    await saved(f.page);
    await f.page.getByRole('button', { name: 'Formulas', exact: true }).click();
    await expect(formulas.locator('output.formula-value')).toHaveText('314159265', {
      timeout: 20_000,
    });
    const bound = JSON.stringify(await f.snapshot<IDocumentData>(f.overview.id));
    expect(bound).toContain('=Budget.Summary.A1');
    expect(bound).toContain(f.source.id);
    await formulas.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(formulas).toHaveCount(0);
    await capture(f, info, 'editor');

    const folder = await add(f, 'Folder', 'Guest research', f.root.name);
    const doc = await add(f, 'Doc', 'Guest notes', folder.name);
    await focusDoc(f.page);
    await f.page.keyboard.type('Keep this new guest page after the earlier one is deleted.');
    await saved(f.page);
    const sheet = await add(f, 'Sheet', 'Guest totals', f.root.name);
    const address = f.page
      .getByRole('region', { name: 'Sheet document', exact: true })
      .locator('[data-u-comp="defined-name"]')
      .getByRole('textbox');
    const cell = async (target: string) => {
      await expect(address).toBeEnabled();
      await address.fill(target);
      await address.press('Enter');
    };
    for (const [target, text] of [
      ['A1', '23'],
      ['A2', '19'],
      ['A3', '=SUM(A1:A2)'],
    ]) {
      await cell(target);
      await f.page.keyboard.type(text);
      await f.page.keyboard.press('Enter');
    }
    await saved(f.page);
    await cell('A3');
    await f.page.evaluate(() => navigator.clipboard.writeText('not copied'));
    await f.page.keyboard.press('Control+c');
    await expect
      .poll(async () => (await f.page.evaluate(() => navigator.clipboard.readText())).trim())
      .toBe('42');
    const workbook = await f.snapshot<IWorkbookData>(sheet.id);
    const cells = workbook.sheets[workbook.sheetOrder[0]].cellData;
    expect(cells?.[0]?.[0]?.v).toBe(23);
    expect(cells?.[1]?.[0]?.v).toBe(19);
    expect(cells?.[2]?.[0]?.f).toBe('=SUM(A1:A2)');
    const renamed = await change(f, doc, 'Rename', { name: 'Renamed guest notes' });
    await change(f, sheet, 'Move or reorder', {
      parent: `${folder.name} / ${renamed.name}`,
      position: 1,
    });
    await change(f, folder, 'Move or reorder', { parent: f.root.name, position: 2 });
    const changed = await f.tree();
    expect(changed.items.find((item) => item.id === sheet.id)?.parentId).toBe(doc.id);
    expect(changed.items.find((item) => item.id === folder.id)?.position).toBe(1);
    await pageLink(f.page, f.root.id, f.overview.id).click();
    await saved(f.page);
    const trash = await action(f, f.overview.name, 'Trash');
    await expect(trash).toContainText('1 descendant');
    await trash.getByRole('button', { name: 'Move to Trash', exact: true }).click();
    await expect(trash).not.toBeVisible();
    // The current first page is gone. Default navigation must use the remaining
    // tree immediately, instead of reopening the stale first page before polling.
    await expect(f.page).toHaveURL(f.origin + guestPath(f.root.id, doc.id));
    await expect(f.page.getByRole('heading', { name: renamed.name, exact: true })).toBeVisible();
    await saved(f.page);
    await expect(pageLink(f.page, f.root.id, f.overview.id)).toHaveCount(0);
    await expect(pageLink(f.page, f.root.id, f.source.id)).toHaveCount(0);
    await guestOnly(f);
    const remaining = await f.tree();
    expect(remaining.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([doc.id, sheet.id, folder.id]),
    );
    expect(
      remaining.items.some((item) => item.id === f.overview.id || item.id === f.source.id),
    ).toBe(false);
    expect((await f.snapshot<IDocumentData>(doc.id)).body?.dataStream).toContain(
      'Keep this new guest page',
    );
    expect((await f.guest.request.get(`/api/guest-spaces/${f.root.id}/trash`)).status()).toBe(404);
    const recovery = await f.account.request.get(`/api/spaces/${f.root.id}/trash`);
    expect((await recovery.json()).items).toContainEqual(
      expect.objectContaining({ id: f.overview.id, descendantCount: 1 }),
    );

    const bytes = await png(f.page);
    const upload = await f.guest.request.post(`${endpoint(f.root.id, doc.id)}/images`, {
      headers: { Origin: f.origin, 'Content-Type': 'image/png' },
      data: bytes,
    });
    expect(upload.status()).toBe(201);
    const image = (await upload.json()) as { url: string };
    expect((await f.guest.request.get(image.url)).status()).toBe(200);
    const replacement = (await f.link('editor'))!;
    expect(replacement).not.toBe(editLink);
    await expect(f.page.getByRole('alert')).toHaveText('This link no longer works.', {
      timeout: 15_000,
    });
    await expect(f.page.getByRole('region', { name: 'Doc document', exact: true })).toHaveCount(0);
    expect((await f.guest.request.get(endpoint(f.root.id, doc.id))).status()).toBe(404);
    // Rotation removes the root credential; canonical account routes now require sign-in.
    expect((await f.guest.request.get(image.url)).status()).toBe(401);
    expect(
      (
        await f.guest.request.get(
          `${endpoint(f.root.id, doc.id)}/images/${image.url.split('/').at(-1)}`,
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await f.guest.request.post(`/api/guest/${f.root.id}/session`, {
          headers: { Origin: f.origin },
          data: { token: new URL(editLink).hash.slice(1) },
        })
      ).status(),
    ).toBe(404);
    await f.page.goto(deepLink(replacement, sheet.id));
    await saved(f.page);
    await expect(f.page.getByRole('heading', { name: sheet.name, exact: true })).toBeVisible();
    expect(new URL(f.page.url()).pathname).toBe(`/share/${f.root.id}`);
    expect((await f.guest.request.get(image.url)).status()).toBe(200);

    // A downgrade rotates the link and its sessions. An independent owner
    // cookie must never keep the old guest editor or its account controls alive.
    await f.guest.addCookies(await f.account.cookies());
    const viewLink = (await f.link('viewer'))!;
    await expect(f.page.getByRole('alert')).toHaveText('This link no longer works.', {
      timeout: 15_000,
    });
    await expect(f.page.getByRole('region', { name: 'Sheet document', exact: true })).toHaveCount(
      0,
    );
    await f.page.goto(deepLink(viewLink, doc.id));
    await saved(f.page, 'viewer');
    await expect(f.page.getByRole('button', { name: 'Add page', exact: true })).toHaveCount(0);
    await guestOnly(f);
    const host = endpoint(f.root.id, doc.id);
    expect(
      (
        await f.guest.request.patch(host, {
          headers: { Origin: f.origin },
          data: { name: 'Still read only' },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await f.guest.request.post(`${host}/images`, {
          headers: { Origin: f.origin, 'Content-Type': 'image/png' },
          data: bytes,
        })
      ).status(),
    ).toBe(403);
    for (const path of [
      `${host}/history`,
      `${host}/export`,
      `${host}/offline-bundle`,
      endpoint(f.root.id, f.outside.id),
    ])
      expect((await f.guest.request.get(path)).status()).toBe(404);
    await f.link(null);
    await expect(f.page.getByRole('alert')).toHaveText('This link no longer works.', {
      timeout: 15_000,
    });
    await expect(f.page.getByRole('region', { name: 'Doc document', exact: true })).toHaveCount(0);
    await expect(f.page.locator('a.space-page-link')).toHaveCount(0);
    expect(await f.page.locator('body').innerText()).not.toContain(f.root.name);
    expect((await f.guest.request.get(host)).status()).toBe(404);
    // Canonical images may use an independently authorized account. The exact
    // guest route still fails after revocation, even in this mixed-cookie browser.
    expect(
      (await f.guest.request.get(`${host}/images/${image.url.split('/').at(-1)}`)).status(),
    ).toBe(404);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});
