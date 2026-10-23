import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test';
import { LocaleType } from '@univerjs/core';
import { DatabaseSync, openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { startApp } from './app-process.ts';

async function fixture(browser: Browser, context: BrowserContext, info: TestInfo) {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-diagnostics-e2e-'));
  const databasePath = join(directory, 'spinel.sqlite');
  const origin = `http://localhost:${info.project.name === 'development' ? 3298 : 3299}`;
  const app = await startApp({
    databasePath,
    origin,
    development: info.project.name === 'development',
  });
  const database = openDatabase(databasePath);
  const auth = new AuthStore(database);
  const operator = auth.createUser('Private Operator Name', true);
  const owner = auth.createUser('Private Document Owner');
  const operatorSession = auth.createSession(operator.id);
  const ownerSession = auth.createSession(owner.id);
  const cookie = (token: string) => ({
    name: COOKIE_NAME,
    value: token,
    url: origin.replace('http:', 'https:'),
    httpOnly: true,
    secure: true,
    sameSite: 'Strict' as const,
  });
  await context.addCookies([cookie(operatorSession.token)]);
  const member = await browser.newContext({ baseURL: origin });
  await member.addCookies([cookie(ownerSession.token)]);
  const headers = { Origin: origin };
  const create = async (name: string, kind: 'sheet' | 'doc') => {
    const response = await member.request.post(`${origin}/api/items`, {
      headers,
      data: { name, kind, parentId: null },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).item as { id: string; name: string };
  };
  return {
    directory,
    origin,
    database,
    auth,
    operator,
    owner,
    operatorSession,
    ownerSession,
    member,
    headers,
    create,
    async close() {
      await member.close();
      database.close();
      await app.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function openClear(page: Page) {
  const panel = page.getByRole('region', { name: 'Diagnostics', exact: true });
  await expect(
    panel.getByRole('button', { name: 'Download diagnostics', exact: true }),
  ).toBeEnabled();
  await panel.getByRole('button', { name: 'Diagnostics actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Truncate diagnostics…', exact: true }).click();
  return page.getByRole('dialog', { name: 'Truncate diagnostics', exact: true });
}

async function downloadDatabase(page: Page, destination: string) {
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download diagnostics', exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('spinel-diagnostics.sqlite');
  await download.saveAs(destination);
  expect(await download.failure()).toBeNull();
  expect((await readFile(destination)).subarray(0, 16).toString()).toBe('SQLite format 3\0');
  return new DatabaseSync(destination);
}

test('Operator downloads real correlated diagnostics without document data and clears only a freshly confirmed generation', async ({
  page,
  context,
  browser,
}, info) => {
  test.setTimeout(180_000);
  const f = await fixture(browser, context, info);
  const memberPage = await f.member.newPage();
  try {
    const host = await f.create('Private report title', 'doc');
    const source = await f.create('Budget', 'sheet');
    const saved = await f.member.request.put(`${f.origin}/api/items/${source.id}/sheet`, {
      headers: f.headers,
      data: {
        revision: 0,
        writeId: randomUUID(),
        snapshot: {
          id: source.id,
          name: source.name,
          appVersion: '1.1.0',
          locale: LocaleType.EN_US,
          styles: {},
          sheetOrder: ['summary'],
          sheets: {
            summary: {
              id: 'summary',
              name: 'Summary',
              rowCount: 100,
              columnCount: 10,
              cellData: { 0: { 0: { v: 314159 } } },
            },
          },
        },
      },
    });
    expect(saved.status()).toBe(200);
    // A real mounted account adapter must initialize; the test never injects a sink.
    const collection = memberPage.waitForResponse(
      (response) =>
        response.url().endsWith('/api/diagnostics/collection') && response.status() === 200,
    );
    await memberPage.goto(`${f.origin}/?item=${host.id}`);
    await memberPage.bringToFront();
    await collection;
    await expect(memberPage.getByRole('status', { name: 'Save status' })).toHaveText(
      'All changes saved.',
      { timeout: 30_000 },
    );
    // Formula insertion uses the native selection even when this test only previews.
    await memberPage.locator('.univer-container').click({ position: { x: 130, y: 200 } });
    const formulas = memberPage.locator('details.doc-formulas');
    await formulas.locator('summary').click();
    await formulas.getByRole('button', { name: 'Insert formula', exact: true }).click();
    const formula = memberPage.getByRole('dialog', { name: 'Insert formula', exact: true });
    await formula.getByRole('combobox', { name: 'Formula', exact: true }).fill('=Bud');
    await formula.getByRole('option', { name: 'Budget', exact: true }).click();
    await formula.getByRole('option', { name: 'Summary', exact: true }).click();
    await formula.getByRole('option', { name: 'A1', exact: true }).click();
    const expression = await formula
      .getByRole('combobox', { name: 'Formula', exact: true })
      .inputValue();
    const evaluation = memberPage.waitForRequest((request) =>
      request.url().endsWith(`/api/items/${host.id}/formulas/evaluate`),
    );
    const uploaded = memberPage.waitForResponse((response) => {
      if (!response.url().endsWith('/api/diagnostics/events') || response.status() !== 200)
        return false;
      const batch = response.request().postDataJSON() as {
        records: { event: { details: { operation?: string } }; context: { fileId?: string } }[];
      };
      return batch.records.some(
        (record) =>
          record.context.fileId === host.id &&
          record.event.details.operation === 'formula-evaluate',
      );
    });
    await formula.getByRole('button', { name: 'Preview', exact: true }).click();
    const runId = (await evaluation).headers()['x-spinel-diagnostic-run'];
    expect(runId).toMatch(/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i);
    await expect(formula.getByRole('region', { name: 'Formula preview' })).toContainText('314159');
    const upload = await uploaded;
    expect((await upload.json()).accepted).toBeGreaterThan(0);
    await formula.getByRole('button', { name: 'Cancel', exact: true }).click();

    // A real rejected formula also produces a static log; arbitrary failure input
    // must never become diagnostic details, an error message, or the exported DB.
    const failedRun = randomUUID();
    const failed = await f.member.request.post(
      `${f.origin}/api/items/${host.id}/formulas/evaluate`,
      {
        headers: { ...f.headers, 'X-Spinel-Diagnostic-Run': failedRun },
        data: {
          definition: {
            version: 1,
            expression: '=1+2',
            references: [],
            cachedValue: 'PRIVATE_FORMULA_PAYLOAD',
          },
        },
      },
    );
    expect(failed.status()).toBe(200);
    expect((await failed.json()).ok).toBe(false);

    for (const endpoint of ['health', 'diagnostics']) {
      expect((await f.member.request.get(`${f.origin}/api/admin/${endpoint}`)).status()).toBe(404);
    }
    expect(
      (
        await f.member.request.post(`${f.origin}/api/admin/diagnostics/download`, {
          headers: f.headers,
          data: {},
        })
      ).status(),
    ).toBe(404);
    await page.bringToFront();
    await page.goto(`${f.origin}/admin#health`);
    const panel = page.getByRole('region', { name: 'Diagnostics', exact: true });
    await expect(
      panel.getByRole('button', { name: 'Download diagnostics', exact: true }),
    ).toBeEnabled();
    const before = await (await context.request.get(`${f.origin}/api/admin/diagnostics`)).json();
    expect(
      (
        await f.member.request.post(`${f.origin}/api/admin/diagnostics/truncate`, {
          headers: f.headers,
          data: { confirm: true, generation: before.generation },
        })
      ).status(),
    ).toBe(404);
    const exported = await downloadDatabase(page, join(f.directory, 'download.sqlite'));
    try {
      expect(exported.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');
      expect(exported.prepare('PRAGMA user_version').get()?.user_version).toBe(1);
      expect(
        exported
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
          )
          .all()
          .map((row) => row.name),
      ).toEqual(['diagnostics_state', 'events']);
      const rows = exported.prepare('SELECT * FROM events').all();
      const correlated = rows.filter((row) => row.run_id === runId);
      for (const [origin, operation] of [
        ['frontend', 'formula-parse'],
        ['frontend', 'formula-evaluate'],
        ['backend', 'formula-evaluate'],
      ]) {
        expect(
          correlated.some(
            (row) =>
              row.source === origin &&
              row.name === 'operation.result' &&
              JSON.parse(String(row.details)).operation === operation,
          ),
        ).toBe(true);
      }
      expect(correlated.length).toBeGreaterThanOrEqual(9);
      for (const row of correlated) {
        expect(row.actor_id).toBe(f.owner.id);
        expect(row.file_id).toBe(host.id);
      }
      expect(
        correlated.some(
          (row) => row.metric_kind === 'histogram' && row.metric_unit === 'milliseconds',
        ),
      ).toBe(true);
      expect(
        correlated.some((row) => row.metric_kind === 'counter' && row.metric_value === 1),
      ).toBe(true);
      expect(rows.some((row) => row.metric_kind === 'gauge' && row.name === 'runtime.memory')).toBe(
        true,
      );
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            run_id: failedRun,
            kind: 'log',
            level: 'warn',
            message: 'An operation failed.',
            source: 'backend',
          }),
        ]),
      );
      const serialized = JSON.stringify(rows);
      for (const privateText of [
        host.name,
        source.name,
        'Summary',
        expression,
        'Private Document Owner',
        'PRIVATE_FORMULA_PAYLOAD',
        f.ownerSession.token,
        f.operatorSession.token,
        upload.request().postDataJSON().binding,
      ])
        expect(serialized).not.toContain(privateText);
      expect(serialized).not.toContain('"314159"');
    } finally {
      exported.close();
    }

    await mkdir('test-results/theme-screenshots', { recursive: true });
    for (const variant of [
      { name: 'light', theme: 'light', width: 1440 },
      { name: 'dark', theme: 'dark', width: 1440 },
      { name: 'phone', theme: 'light', width: 390 },
    ] as const) {
      await page.evaluate((theme) => localStorage.setItem('spinel-theme', theme), variant.theme);
      await page.setViewportSize({ width: variant.width, height: 1000 });
      await page.reload();
      await expect(
        panel.getByRole('button', { name: 'Download diagnostics', exact: true }),
      ).toBeEnabled();
      await expect(
        page
          .getByRole('region', { name: 'Server health', exact: true })
          .getByRole('heading', { name: 'Maintenance jobs' }),
      ).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await page.screenshot({
        path: `test-results/theme-screenshots/spn-032-health-${variant.name}-${info.project.name}.png`,
        fullPage: true,
      });
      const dialog = await openClear(page);
      await expect(dialog).toContainText(
        'Files, accounts, backups and collaboration state are not deleted.',
      );
      await page.screenshot({
        path: `test-results/theme-screenshots/spn-032-clear-${variant.name}-${info.project.name}.png`,
        fullPage: true,
      });
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(
        panel.getByRole('button', { name: 'Diagnostics actions', exact: true }),
      ).toBeFocused();
      expect(
        (await (await context.request.get(`${f.origin}/api/admin/diagnostics`)).json()).generation,
      ).toBe(before.generation);
    }
    // Another operator clears while this confirmation is open. A stale click
    // must fail, refresh status, and require a second explicit confirmation.
    const firstDialog = await openClear(page);
    const raced = await context.request.post(`${f.origin}/api/admin/diagnostics/truncate`, {
      headers: f.headers,
      data: { confirm: true, generation: before.generation },
    });
    expect(raced.status()).toBe(200);
    const racedGeneration = (await raced.json()).generation;
    const attempts: string[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/api/admin/diagnostics/truncate'))
        attempts.push(request.postDataJSON().generation);
    });
    await firstDialog.getByRole('button', { name: 'Truncate diagnostics', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('confirm again');
    await expect(firstDialog).toBeHidden();
    expect(attempts).toEqual([before.generation]);
    expect(
      (await (await context.request.get(`${f.origin}/api/admin/diagnostics`)).json()).generation,
    ).toBe(racedGeneration);
    const freshDialog = await openClear(page);
    await freshDialog.getByRole('button', { name: 'Truncate diagnostics', exact: true }).click();
    await expect(panel.getByText('Diagnostics cleared.', { exact: false })).toBeVisible();
    expect(attempts).toEqual([before.generation, racedGeneration]);
    const after = await (await context.request.get(`${f.origin}/api/admin/diagnostics`)).json();
    expect(after.generation).not.toBe(racedGeneration);
    const staleUpload = await f.member.request.post(`${f.origin}/api/diagnostics/events`, {
      headers: { ...f.headers, 'X-Spinel-Diagnostic-Account': f.owner.id },
      data: upload.request().postDataJSON(),
    });
    expect(staleUpload.status()).toBe(409);
    const cleared = await downloadDatabase(page, join(f.directory, 'cleared.sqlite'));
    try {
      expect(
        cleared.prepare('SELECT id FROM events WHERE run_id IN (?,?)').all(runId, failedRun),
      ).toEqual([]);
    } finally {
      cleared.close();
    }
    // Background observations may already exist after clear; document state must survive.
    expect((await f.member.request.get(`${f.origin}/api/items/${host.id}`)).status()).toBe(200);
    expect((await f.member.request.get(`${f.origin}/api/items/${source.id}/sheet`)).status()).toBe(
      200,
    );
  } finally {
    await f.close();
  }
});

test('diagnostics failures, cancelled downloads, pending clear navigation and expired Operator sessions stay honest', async ({
  page,
  context,
  browser,
}, info) => {
  test.setTimeout(120_000);
  const f = await fixture(browser, context, info);
  const endpoint = `${f.origin}/api/admin/diagnostics`;
  const panel = page.getByRole('region', { name: 'Diagnostics', exact: true });
  let releaseDownload: (() => void) | undefined;
  let releaseClear: (() => void) | undefined;
  try {
    await page.goto(`${f.origin}/admin#health`);
    await expect(
      panel.getByRole('button', { name: 'Download diagnostics', exact: true }),
    ).toBeEnabled();
    await page.route(`${endpoint}/download`, (route) =>
      route.fulfill({ status: 503, json: { error: 'PRIVATE_EXPORT_PATH' } }),
    );
    await panel.getByRole('button', { name: 'Download diagnostics', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('Diagnostics could not be downloaded.');
    await expect(page.getByText('PRIVATE_EXPORT_PATH')).toHaveCount(0);
    await expect(panel.getByText(/snapshot sent/)).toHaveCount(0);
    await page.unroute(`${endpoint}/download`);
    await panel.getByRole('button', { name: 'Refresh diagnostics status' }).click();
    await expect(
      panel.getByRole('button', { name: 'Download diagnostics', exact: true }),
    ).toBeEnabled();

    const heldDownload = new Promise<void>((resolve) => {
      releaseDownload = resolve;
    });
    let enteredDownload!: () => void;
    const downloadEntered = new Promise<void>((resolve) => {
      enteredDownload = resolve;
    });
    await page.route(`${endpoint}/download`, async (route) => {
      enteredDownload();
      await heldDownload;
      await route.abort().catch(() => {});
    });
    let downloads = 0;
    page.on('download', () => {
      downloads++;
    });
    await panel.getByRole('button', { name: 'Download diagnostics', exact: true }).click();
    await downloadEntered;
    const sections = page.getByRole('navigation', { name: 'Administration sections' });
    await expect(sections.getByRole('link', { name: 'People', exact: true })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await panel.getByRole('button', { name: 'Cancel download' }).click();
    releaseDownload!();
    await expect(panel.getByText('Download cancelled.', { exact: false })).toBeVisible();
    await expect(sections.getByRole('link', { name: 'People', exact: true })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(downloads).toBe(0);
    await page.unroute(`${endpoint}/download`);

    await page.route(`${endpoint}/truncate`, (route) =>
      route.fulfill({ status: 503, json: { error: 'PRIVATE_SQLITE_FAILURE' } }),
    );
    const failedDialog = await openClear(page);
    await failedDialog.getByRole('button', { name: 'Truncate diagnostics', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText(
      'The clear request could not be confirmed.',
    );
    await expect(panel.getByText(/Diagnostics cleared/)).toHaveCount(0);
    await expect(page.getByText('PRIVATE_SQLITE_FAILURE')).toHaveCount(0);
    await page.unroute(`${endpoint}/truncate`);
    await panel.getByRole('button', { name: 'Refresh diagnostics status' }).click();
    const heldClear = new Promise<void>((resolve) => {
      releaseClear = resolve;
    });
    await page.route(`${endpoint}/truncate`, async (route) => {
      await heldClear;
      await route.continue();
    });
    const pendingDialog = await openClear(page);
    await pendingDialog.getByRole('button', { name: 'Truncate diagnostics', exact: true }).click();
    await expect(pendingDialog.getByRole('button', { name: 'Clearing…' })).toBeDisabled();
    await expect(pendingDialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(pendingDialog).toBeVisible();
    await page.evaluate(() => {
      location.hash = 'people';
    });
    await expect(page).toHaveURL(/#health$/);
    await expect(pendingDialog).toBeVisible();
    releaseClear!();
    await expect(panel.getByText('Diagnostics cleared.', { exact: false })).toBeVisible();
    await page.unroute(`${endpoint}/truncate`);

    // Expire the real ingress session without navigating away first. A denied
    // download must not create a file or turn old status into a success notice.
    f.auth.revokeSession(f.operatorSession.session.token_hash);
    await panel.getByRole('button', { name: 'Download diagnostics', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('Operator access is unavailable.');
    await expect(panel.getByRole('link', { name: 'Sign in again' })).toBeVisible();
    await expect(
      panel.getByRole('button', { name: 'Download diagnostics', exact: true }),
    ).toBeDisabled();
    expect(downloads).toBe(0);
    expect((await context.request.get(`${f.origin}/api/admin/health`)).status()).toBe(401);
  } finally {
    releaseDownload?.();
    releaseClear?.();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await f.close();
  }
});
