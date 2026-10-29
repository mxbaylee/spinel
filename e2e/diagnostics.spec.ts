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
import { edit as editNative } from './offline-fixture.ts';

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
      try {
        await member.close();
      } finally {
        try {
          database.close();
        } finally {
          try {
            await app.close();
          } finally {
            await rm(directory, { recursive: true, force: true });
          }
        }
      }
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
  // Report a rejected export at its HTTP boundary rather than waiting for an absent download.
  void downloaded.catch(() => {});
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/admin/diagnostics/download') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Download diagnostics', exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('application/vnd.sqlite3');
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('spinel-diagnostics.sqlite');
  await download.saveAs(destination);
  expect(await download.failure()).toBeNull();
  expect((await readFile(destination)).subarray(0, 16).toString()).toBe('SQLite format 3\0');
  return new DatabaseSync(destination);
}

test('production open, search, local persistence and server acknowledgement remain distinct in the diagnostics export', async ({
  page,
  context,
  browser,
}, info) => {
  test.skip(
    info.project.name !== 'production',
    'Prepared offline copies require the production runtime manifest.',
  );
  test.setTimeout(180_000);
  const f = await fixture(browser, context, info);
  const member = await f.member.newPage();
  try {
    const item = await f.create('Private diagnostic diary', 'doc');
    const collection = member.waitForResponse(
      (response) =>
        response.url().endsWith('/api/diagnostics/collection') && response.status() === 200,
    );
    await member.goto(f.origin);
    await member.bringToFront();
    await collection;
    const query = member.getByRole('searchbox', { name: 'Search files', exact: true });
    await query.fill('Private diagnostic diary');
    await expect(
      member.getByRole('region', { name: 'Search results', exact: true }).getByRole('status'),
    ).toHaveText('1 result');
    await member.getByRole('button', { name: 'Clear search and filters', exact: true }).click();
    await member
      .getByRole('button', { name: `More actions for ${item.name}`, exact: true })
      .click();
    await member
      .getByRole('menuitem', { name: 'Available offline on this device', exact: true })
      .click();
    await expect(member.getByRole('status').filter({ hasText: 'available offline' })).toHaveText(
      `${item.name} is available offline on this device.`,
      { timeout: 120_000 },
    );
    await member.getByRole('button', { name: `${item.name} Doc`, exact: true }).click();
    const saved = member.getByRole('status', { name: 'Save status', exact: true });
    await expect(saved).toHaveText('Synced. All changes are saved on the server and this device.', {
      timeout: 30_000,
    });
    const uploaded = member.waitForResponse((response) => {
      if (!response.url().endsWith('/api/diagnostics/events') || response.status() !== 200)
        return false;
      const batch = response.request().postDataJSON() as {
        records: { event: { name: string; details: { operation?: string; outcome?: string } } }[];
      };
      return batch.records.some(
        ({ event }) =>
          event.name === 'operation.result' &&
          event.details.operation === 'document-save-server-ack' &&
          event.details.outcome === 'success',
      );
    });
    await editNative(member, 'doc', 'Private native content 123');
    await expect(saved).toHaveText('Synced. All changes are saved on the server and this device.', {
      timeout: 30_000,
    });
    expect((await (await uploaded).json()).dropped).toBe(0);
    const persisted = new DatabaseSync(join(f.directory, 'diagnostics.sqlite'));
    try {
      await expect
        .poll(
          () =>
            persisted
              .prepare(
                "SELECT count(*) AS n FROM events WHERE source='frontend' AND name='operation.result' AND json_extract(details,'$.operation')='document-save-local' AND json_extract(details,'$.outcome')='success'",
              )
              .get()?.n,
        )
        .toBeGreaterThan(0);
    } finally {
      persisted.close();
    }
    const content = await f.member.request.get(`${f.origin}/api/items/${item.id}/doc`);
    expect(content.status()).toBe(200);
    expect(JSON.stringify(await content.json())).toContain('Private native content 123');
    await page.bringToFront();
    await page.goto(`${f.origin}/admin#health`);
    const exported = await downloadDatabase(page, join(f.directory, 'operations.sqlite'));
    try {
      const rows = exported.prepare('SELECT * FROM events').all();
      for (const [source, operation] of [
        ['frontend', 'document-open'],
        ['frontend', 'document-save-local'],
        ['frontend', 'document-save-server-ack'],
        ['frontend', 'search'],
        ['backend', 'search'],
      ])
        expect(
          rows.some(
            (row) =>
              row.source === source &&
              row.name === 'operation.result' &&
              JSON.parse(String(row.details)).operation === operation &&
              JSON.parse(String(row.details)).outcome === 'success',
          ),
          `${source} ${operation}`,
        ).toBe(true);
      for (const name of [
        'native.flush',
        'native.checkpoint',
        'offline.persistence',
        'sync.client.connection',
      ])
        expect(
          rows.some(
            (row) =>
              row.name === name &&
              row.source === 'frontend' &&
              row.actor_id === f.owner.id &&
              row.file_id === item.id,
          ),
          name,
        ).toBe(true);
      const encoded = JSON.stringify(rows);
      for (const privateText of [item.name, 'Private native content 123', f.ownerSession.token])
        expect(encoded).not.toContain(privateText);
      expect(exported.prepare('PRAGMA user_version').get()?.user_version).toBe(1);
    } finally {
      exported.close();
    }
  } finally {
    await f.close();
  }
});

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
    await memberPage.getByRole('button', { name: 'Document actions', exact: true }).click();
    await memberPage.getByRole('menuitem', { name: 'Insert formula', exact: true }).click();
    const formula = memberPage.getByRole('dialog', { name: 'Insert formula', exact: true });
    await formula.getByRole('combobox', { name: 'Formula', exact: true }).fill('=Bud');
    const suggestions = formula.getByRole('listbox', { name: 'Formula suggestions', exact: true });
    await suggestions.getByRole('option', { name: 'Budget', exact: true }).click();
    await suggestions.getByRole('option', { name: 'Summary', exact: true }).click();
    await suggestions.getByRole('option', { name: 'A1', exact: true }).click();
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
          .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
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
      // Execute the schema-v1 examples from docs/diagnostics.md against the
      // actual browser download, including SQLite JSON aggregation semantics.
      const logs = exported
        .prepare(
          `
        SELECT received_at, source, level, message, actor_id, file_id, route, run_id, details
        FROM events WHERE kind='log' ORDER BY received_at;
      `,
        )
        .all();
      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: 'backend',
            level: 'warn',
            message: 'An operation failed.',
            actor_id: f.owner.id,
            file_id: host.id,
            run_id: failedRun,
          }),
        ]),
      );
      const runRows = exported
        .prepare(
          `
        SELECT run_id, source, component, name, details, metric_kind, metric_unit, metric_value
        FROM events WHERE run_id IS NOT NULL ORDER BY run_id, received_at;
      `,
        )
        .all()
        .filter((row) => row.run_id === runId);
      expect(runRows).toHaveLength(correlated.length);
      const counters = exported
        .prepare(
          `
        SELECT source, json_extract(details, '$.operation') AS operation,
               sum(metric_value) AS increments
        FROM events WHERE metric_kind='counter' GROUP BY source, operation;
      `,
        )
        .all();
      const histograms = exported
        .prepare(
          `
        SELECT source, json_extract(details, '$.operation') AS operation,
               count(*) AS observations, avg(metric_value) AS mean_ms, max(metric_value) AS max_ms
        FROM events WHERE name='operation.duration' AND metric_unit='milliseconds'
        GROUP BY source, operation;
      `,
        )
        .all();
      for (const [source, operation] of [
        ['frontend', 'formula-parse'],
        ['frontend', 'formula-evaluate'],
        ['backend', 'formula-evaluate'],
      ]) {
        expect(
          runRows.some(
            (row) =>
              row.source === source &&
              row.name === 'operation.result' &&
              JSON.parse(String(row.details)).operation === operation,
          ),
        ).toBe(true);
        const samples = rows.filter(
          (row) => row.source === source && JSON.parse(String(row.details)).operation === operation,
        );
        const increments = samples.filter((row) => row.metric_kind === 'counter');
        expect(increments.length).toBeGreaterThanOrEqual(1);
        expect(
          increments.every((row) => row.metric_value === 1 && row.metric_unit === 'count'),
        ).toBe(true);
        expect(
          counters.find((row) => row.source === source && row.operation === operation)?.increments,
        ).toBe(increments.length);
        const durations = samples.filter((row) => row.name === 'operation.duration');
        expect(durations.length).toBeGreaterThanOrEqual(1);
        const values = durations.map((row) => Number(row.metric_value));
        expect(
          durations.every(
            (row) => row.metric_kind === 'histogram' && row.metric_unit === 'milliseconds',
          ),
        ).toBe(true);
        expect(values.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
        const summary = histograms.find(
          (row) => row.source === source && row.operation === operation,
        );
        expect(summary?.observations).toBe(values.length);
        expect(summary?.max_ms).toBe(Math.max(...values));
        expect(Number(summary?.mean_ms)).toBeCloseTo(
          values.reduce((sum, value) => sum + value, 0) / values.length,
          8,
        );
      }
      const gauges = exported
        .prepare(
          `
        SELECT received_at, name, details, metric_value, metric_unit
        FROM events WHERE metric_kind='gauge' ORDER BY received_at;
      `,
        )
        .all();
      const memory = gauges.filter((row) => row.name === 'runtime.memory');
      expect(memory).toHaveLength(
        rows.filter((row) => row.metric_kind === 'gauge' && row.name === 'runtime.memory').length,
      );
      expect(memory.some((row) => JSON.parse(String(row.details)).scope === 'process')).toBe(true);
      for (const point of memory) {
        expect(['process', 'host', 'container']).toContain(JSON.parse(String(point.details)).scope);
        expect(point.metric_unit).toBe('bytes');
        expect(Number.isFinite(Number(point.metric_value))).toBe(true);
        expect(Number(point.metric_value)).toBeGreaterThanOrEqual(0);
        expect(Number(point.received_at)).toBeGreaterThan(0);
      }
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

    // Let clear's refresh finish, then isolate the independent session poll so the
    // real download denial is observable before the global sign-out takes over.
    await expect(
      panel.getByRole('button', { name: 'Download diagnostics', exact: true }),
    ).toBeEnabled();
    let healthIntercepted = false;
    await page.route(`${f.origin}/api/health`, (route) => {
      healthIntercepted = true;
      return route.fulfill({ json: { status: 'ok' } });
    });
    await expect.poll(() => healthIntercepted).toBe(true);
    f.auth.revokeSession(f.operatorSession.session.token_hash);
    const deniedDownload = page.waitForResponse(
      (response) =>
        response.url() === `${endpoint}/download` && response.request().method() === 'POST',
    );
    await panel.getByRole('button', { name: 'Download diagnostics', exact: true }).click();
    expect((await deniedDownload).status()).toBe(401);
    await expect(panel.getByRole('alert')).toContainText('Operator access is unavailable.');
    await expect(panel.getByRole('link', { name: 'Sign in again' })).toBeVisible();
    await expect(
      panel.getByRole('button', { name: 'Download diagnostics', exact: true }),
    ).toBeDisabled();
    expect(downloads).toBe(0);
    expect((await context.request.get(`${f.origin}/api/admin/health`)).status()).toBe(401);
    await page.unroute(`${f.origin}/api/health`);
    await expect(
      page.getByRole('button', { name: 'Sign in with a passkey', exact: true }),
    ).toBeVisible();
    expect(downloads).toBe(0);
  } finally {
    releaseDownload?.();
    releaseClear?.();
    try {
      if (!page.isClosed()) await page.unrouteAll({ behavior: 'wait' });
    } finally {
      await f.close();
    }
  }
});
