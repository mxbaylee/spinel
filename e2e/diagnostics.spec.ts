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
import type { FeedbackPair, FeedbackSubmission } from '../src/shared/feedback.ts';

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

async function openFeedbackComposer(page: Page) {
  const documentOpen = await page
    .getByRole('region', { name: 'Document workspace', exact: true })
    .isVisible();
  const trigger = page.getByRole('button', {
    name: documentOpen ? 'Document actions' : 'Account actions',
    exact: true,
  });
  await expect(trigger).toBeVisible();
  await trigger.click();
  await page.getByRole('menuitem', { name: 'Send feedback…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Send feedback', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function feedbackComposer(page: Page, message: string) {
  const dialog = await openFeedbackComposer(page);
  const another = dialog.getByRole('button', { name: 'Send another report', exact: true });
  if (await another.isVisible()) await another.click();
  await dialog.getByRole('textbox', { name: 'Message', exact: true }).fill(message);
  await expect(dialog.getByRole('button', { name: 'Send feedback', exact: true })).toBeEnabled();
  return dialog;
}

async function submittedFeedback(page: Page, retry = false) {
  const response = page.waitForResponse(
    (value) =>
      value.url().endsWith('/api/diagnostics/feedback') && value.request().method() === 'POST',
  );
  const dialog = page.getByRole('dialog', { name: 'Send feedback', exact: true });
  await dialog
    .getByRole('button', { name: retry ? 'Retry feedback' : 'Send feedback', exact: true })
    .click();
  const received = await response;
  expect(received.status()).toBe(200);
  await expect(dialog.getByRole('status')).toHaveText(
    'Feedback saved. Thank you for reporting it.',
  );
  return received.json() as Promise<{ id: string; generation: string; receivedAt: number }>;
}

async function feedbackArtifact(page: Page, destination: string, action: () => Promise<void>) {
  const downloaded = page.waitForEvent('download');
  void downloaded.catch(() => {});
  await action();
  // A failed preparation/transfer must report its UI state instead of waiting
  // for a browser download event that cannot occur.
  await expect(
    page.getByRole('dialog', { name: 'Feedback diagnostics', exact: true }),
  ).toContainText('metrics sent to your browser. Check your downloads.', { timeout: 35_000 });
  const file = await downloaded;
  await file.saveAs(destination);
  expect(await file.failure()).toBeNull();
  const database = new DatabaseSync(destination);
  try {
    expect(database.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');
    const manifest = JSON.parse(
      String(database.prepare('SELECT details FROM export_manifest').get()!.details),
    ) as {
      snapshotId: string;
      generation: string;
      selectedActorId: string;
      scope: string;
      window: { start: number; end: number };
      rowCount: number;
      counts: FeedbackPair['counts'];
      completeRetainedSelection: boolean;
      historicalCompleteness: string;
    };
    return { manifest, rows: database.prepare('SELECT * FROM events ORDER BY id').all() };
  } finally {
    database.close();
  }
}

test('feedback survives a lost acknowledgment and paired user/system downloads preserve one complete snapshot', async ({
  page,
  context,
  browser,
}, info) => {
  test.setTimeout(180_000);
  const f = await fixture(browser, context, info);
  const memberPage = await f.member.newPage();
  const collaborator = f.auth.createUser('Feedback collaborator');
  const collaboratorSession = f.auth.createSession(collaborator.id);
  const other = await browser.newContext({ baseURL: f.origin });
  await other.addCookies([
    {
      name: COOKIE_NAME,
      value: collaboratorSession.token,
      url: f.origin.replace('http:', 'https:'),
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
  ]);
  const otherPage = await other.newPage();
  const attempts: FeedbackSubmission[] = [];
  try {
    const file = await f.create('PRIVATE feedback document title', 'doc');
    await memberPage.goto(`${f.origin}/?item=${file.id}`);
    await expect(memberPage.getByRole('status', { name: 'Save status' })).toHaveText(
      'All changes saved.',
      { timeout: 30_000 },
    );
    let loseAcknowledgment = true;
    await memberPage.route('**/api/diagnostics/feedback', async (route) => {
      attempts.push(route.request().postDataJSON() as FeedbackSubmission);
      if (loseAcknowledgment) {
        loseAcknowledgment = false;
        // The real server persists this request. Only its acknowledgment is lost.
        const saved = await route.fetch();
        expect(saved.status()).toBe(200);
        await route.abort('failed');
      } else await route.continue();
    });
    const message = 'The toolbar was slow after opening my document.';
    const composer = await feedbackComposer(memberPage, message);
    await composer.getByRole('button', { name: 'Send feedback', exact: true }).click();
    await expect(composer.getByRole('alert')).toContainText('Sending could not be confirmed.');
    await expect(composer.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
      message,
    );
    await composer.getByRole('button', { name: 'Cancel', exact: true }).click();
    await openFeedbackComposer(memberPage);
    const first = await submittedFeedback(memberPage, true);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    expect(attempts[0].context).toMatchObject({ route: '/files/:id', fileId: file.id });
    expect(JSON.stringify(attempts[0])).not.toContain(file.name);
    await composer.getByRole('button', { name: 'Done', exact: true }).click();

    await otherPage.goto(f.origin);
    const otherComposer = await feedbackComposer(
      otherPage,
      'A collaborator can report an issue too.',
    );
    const middle = await submittedFeedback(otherPage);
    await otherComposer.getByRole('button', { name: 'Done', exact: true }).click();
    const lastComposer = await feedbackComposer(
      memberPage,
      'The problem stopped after reconnecting.',
    );
    const last = await submittedFeedback(memberPage);
    await lastComposer.getByRole('button', { name: 'Done', exact: true }).click();

    const live = new DatabaseSync(join(f.directory, 'diagnostics.sqlite'));
    try {
      expect(
        live
          .prepare("SELECT count(*) AS count FROM events WHERE name='feedback' AND id=?")
          .get(first.id)?.count,
      ).toBe(1);
      const stored = live.prepare('SELECT * FROM events WHERE id=?').get(first.id)!;
      expect(stored.actor_id).toBe(f.owner.id);
      expect(stored.file_id).toBe(file.id);
      expect(stored.message).toBe(message);
      expect(stored.route).toBe('/files/:id');

      await page.clock.install();
      await page.goto(`${f.origin}/admin`);
      const account = page.getByRole('region', { name: `${f.owner.name} account`, exact: true });
      await expect(account.getByText('Feedback available', { exact: true })).toBeVisible();
      await expect(page.getByText(message, { exact: true })).toHaveCount(0);
      await expect(page.getByText(file.name, { exact: true })).toHaveCount(0);
      let preparations = 0;
      page.on('request', (request) => {
        if (
          request.url().endsWith('/api/admin/diagnostics/feedback/prepare') &&
          request.method() === 'POST'
        )
          preparations++;
      });
      const pairResponse = page.waitForResponse(
        (value) =>
          value.url().endsWith('/api/admin/diagnostics/feedback/prepare') &&
          value.request().method() === 'POST',
      );
      const user = await feedbackArtifact(
        page,
        join(f.directory, 'feedback-user.sqlite'),
        async () => {
          await account
            .getByRole('button', { name: `Feedback downloads for ${f.owner.name}`, exact: true })
            .click();
          await page.getByRole('menuitem', { name: 'Download user metrics', exact: true }).click();
          expect((await pairResponse).status()).toBe(200);
        },
      );
      // Development StrictMode must not send an aborted mount's preparation:
      // it can still hold the server lease when the surviving mount starts.
      expect(preparations).toBe(1);
      const pair = (await (await pairResponse).json()) as FeedbackPair;
      const downloads = page.getByRole('dialog', { name: 'Feedback diagnostics', exact: true });
      await expect(downloads.getByLabel('Shared time span', { exact: true })).toBeVisible();
      expect(user.manifest).toMatchObject({
        snapshotId: pair.id,
        generation: pair.generation,
        selectedActorId: f.owner.id,
        scope: 'user',
        window: pair.window,
        completeRetainedSelection: true,
        historicalCompleteness: 'unknown',
        rowCount: pair.counts.user,
      });
      const expectedUser = live
        .prepare(
          'SELECT * FROM events WHERE actor_id=? AND received_at BETWEEN ? AND ? ORDER BY id',
        )
        .all(f.owner.id, pair.window.start, pair.window.end);
      const expectedSystem = live
        .prepare('SELECT * FROM events WHERE received_at BETWEEN ? AND ? ORDER BY id')
        .all(pair.window.start, pair.window.end);
      expect(user.rows).toEqual(expectedUser);
      expect(user.rows.some((row) => row.id === first.id)).toBe(true);
      expect(user.rows.some((row) => row.id === last.id)).toBe(true);
      expect(user.rows.every((row) => row.actor_id === f.owner.id)).toBe(true);

      // New real activity between the buttons must never alter the prepared pair.
      const boundary = await (
        await f.member.request.get(`${f.origin}/api/diagnostics/feedback-context`, {
          headers: { 'X-Spinel-Diagnostic-Account': f.owner.id },
        })
      ).json();
      const laterId = randomUUID();
      const later = await f.member.request.post(`${f.origin}/api/diagnostics/feedback`, {
        headers: { ...f.headers, 'X-Spinel-Diagnostic-Account': f.owner.id },
        data: {
          id: laterId,
          generation: boundary.generation,
          binding: boundary.binding,
          message: 'This report arrives after the frozen snapshot.',
          context: { route: '/files' },
        },
      });
      expect(later.status()).toBe(200);
      const system = await feedbackArtifact(page, join(f.directory, 'feedback-system.sqlite'), () =>
        downloads.getByRole('button', { name: 'Download system metrics', exact: true }).click(),
      );
      expect(system.manifest).toMatchObject({
        snapshotId: user.manifest.snapshotId,
        generation: user.manifest.generation,
        window: user.manifest.window,
        scope: 'system',
        rowCount: pair.counts.system,
      });
      expect(system.rows).toEqual(expectedSystem);
      expect(
        system.rows.some((row) => row.id === middle.id && row.actor_id === collaborator.id),
      ).toBe(true);
      expect(system.rows.some((row) => row.id === laterId)).toBe(false);
      expect(system.manifest.counts).toEqual(user.manifest.counts);
      const denied = await other.request.post(
        `${f.origin}/api/admin/diagnostics/feedback/${pair.id}/download`,
        { headers: f.headers, data: { scope: 'system' } },
      );
      expect(denied.status()).toBe(404);
      // Exercise the actual expiry UI without keeping a fixture alive for five minutes.
      // Store/HTTP tests separately advance the server clock and prove server expiry.
      await page.clock.fastForward(Math.max(0, pair.expiresAt - Date.now()) + 1000);
      await expect(
        downloads.getByText('This pair is no longer available.', { exact: false }),
      ).toBeVisible();
      await expect(
        downloads.getByRole('button', { name: 'Download system metrics', exact: true }),
      ).toBeDisabled();
      await expect(
        downloads.getByRole('button', { name: 'Prepare both downloads', exact: true }),
      ).toBeEnabled();
    } finally {
      live.close();
    }
  } finally {
    try {
      await other.close();
    } finally {
      await f.close();
    }
  }
});

test('truncation clears feedback flags and an unconfirmed old report needs deliberate new submission', async ({
  page,
  context,
  browser,
}, info) => {
  test.setTimeout(120_000);
  const f = await fixture(browser, context, info);
  const memberPage = await f.member.newPage();
  try {
    await memberPage.goto(f.origin);
    let drop = true;
    await memberPage.route('**/api/diagnostics/feedback', async (route) => {
      if (drop) {
        drop = false;
        expect((await route.fetch()).status()).toBe(200);
        await route.abort('failed');
      } else await route.continue();
    });
    const composer = await feedbackComposer(
      memberPage,
      'Retain this draft across a failed acknowledgment.',
    );
    await composer.getByRole('button', { name: 'Send feedback', exact: true }).click();
    await expect(composer.getByRole('alert')).toContainText('Sending could not be confirmed.');
    await page.goto(`${f.origin}/admin`);
    const owner = page.getByRole('region', { name: `${f.owner.name} account`, exact: true });
    await expect(owner.getByText('Feedback available', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Backups & health', exact: true }).click();
    const cancelled = await openClear(page);
    await expect(cancelled).toContainText('submitted feedback');
    await cancelled.getByRole('button', { name: 'Cancel', exact: true }).click();
    const before = await (
      await context.request.get(`${f.origin}/api/admin/diagnostics/feedback`)
    ).json();
    expect(before.actors).toContain(f.owner.id);
    const confirmation = await openClear(page);
    const cleared = page.waitForResponse(
      (value) =>
        value.url().endsWith('/api/admin/diagnostics/truncate') &&
        value.request().method() === 'POST',
    );
    await confirmation.getByRole('button', { name: 'Truncate diagnostics', exact: true }).click();
    expect((await cleared).status()).toBe(200);
    await page.getByRole('link', { name: 'People', exact: true }).click();
    await expect(page.getByText('Checking feedback…', { exact: true })).toHaveCount(0);
    await expect(owner.getByText('Feedback available', { exact: true })).toHaveCount(0);
    const oldRetry = memberPage.waitForResponse(
      (value) =>
        value.url().endsWith('/api/diagnostics/feedback') && value.request().method() === 'POST',
    );
    await composer.getByRole('button', { name: 'Retry feedback', exact: true }).click();
    expect((await oldRetry).status()).toBe(409);
    await expect(composer.getByRole('alert')).toContainText('will not be sent again automatically');
    expect(
      (await (await context.request.get(`${f.origin}/api/admin/diagnostics/feedback`)).json())
        .actors,
    ).not.toContain(f.owner.id);
    await composer.getByRole('button', { name: 'Start a new report', exact: true }).click();
    await expect(composer.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
      'Retain this draft across a failed acknowledgment.',
    );
    const newReport = await submittedFeedback(memberPage);
    expect(newReport.generation).not.toBe(before.generation);
    await page.getByRole('button', { name: 'Refresh users', exact: true }).click();
    await expect(owner.getByText('Feedback available', { exact: true })).toBeVisible();
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
