import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { getDocsEmptySnapshot, LocaleType } from '@univerjs/core';
import { formulaBody, parseFormula } from '@spinel/doc-formulas';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { SheetStore } from '../src/server/workspace/sheets.ts';
import { DocumentStore } from '../src/server/workspace/documents.ts';
import { downloadPdf, inspectPdf } from './pdfEvidence.ts';

test('Doc readers and host-only guests see literal formulas without receiving private source values', async ({
  page,
  context,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth);
  const owner = auth.createUser(`Formula access owner ${info.testId}`);
  const reader = auth.createUser(`Formula reader ${info.testId}`);
  const host = workspace.create(owner.id, { name: 'Shared report', kind: 'doc', parentId: null });
  const source = workspace.create(owner.id, { name: 'Budget', kind: 'sheet', parentId: null });
  const secret = 'PRIVATE_SOURCE_SENTINEL_829173';
  new SheetStore(workspace).save(owner.id, source.id, {
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
          cellData: { 0: { 0: { v: secret } } },
        },
      },
    },
    revision: 0,
    writeId: crypto.randomUUID(),
  });
  const expression = '=Budget.Summary.A1';
  const reference = parseFormula(expression)[0]!;
  const bound = formulaBody('private-source', {
    version: 1,
    expression,
    references: [
      {
        start: reference.start,
        end: reference.end,
        range: reference.range,
        itemId: source.id,
        sheetId: 'summary',
      },
    ],
  });
  const literal = formulaBody('literal', { version: 1, expression: '=40+2', references: [] });
  const offset = expression.length + 1;
  const snapshot = getDocsEmptySnapshot(host.id);
  snapshot.body = {
    ...snapshot.body,
    dataStream: `${expression}\r${literal.dataStream}\r\n`,
    customRanges: [
      ...bound.customRanges!,
      ...literal.customRanges!.map((range) => ({
        ...range,
        startIndex: range.startIndex + offset,
        endIndex: range.endIndex + offset,
      })),
    ],
    sectionBreaks: [
      { startIndex: offset + literal.dataStream.length + 1, sectionId: 'formula-access-section' },
    ],
    paragraphs: [
      { startIndex: expression.length, paragraphId: 'source-paragraph' },
      { startIndex: offset + literal.dataStream.length, paragraphId: 'literal-paragraph' },
    ],
  };
  new DocumentStore(workspace).save(owner.id, host.id, {
    snapshot,
    revision: 0,
    writeId: crypto.randomUUID(),
  });
  workspace.share(owner.id, host.id, reader.id, 'viewer');
  const link = workspace.links.begin(host.id, 'viewer');
  workspace.links.finish(host.id, link.epoch, true);
  const guest = await browser.newContext();
  await context.addCookies([
    {
      name: COOKIE_NAME,
      value: auth.createSession(reader.id).token,
      url: baseURL!.replace('http:', 'https:'),
      secure: true,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  for (const target of [context, guest]) {
    await target.addInitScript(() => {
      const original = CanvasRenderingContext2D.prototype.fillText;
      const painted: string[] = [];
      Object.assign(window, { formulaAccessPaintedText: painted });
      CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
        painted.push(text);
        if (painted.length > 20000) painted.splice(0, 10000);
        return original.call(this, text, ...args);
      };
    });
  }
  const assertReadOnly = async (view: Page, message: string) => {
    const region = view.getByRole('region', { name: 'Doc document', exact: true });
    await expect(region.getByRole('status', { name: 'Save status' })).toHaveText(
      'View only — reload after your access changes.',
      { timeout: 30_000 },
    );
    if (await view.getByRole('button', { name: 'Document actions', exact: true }).count()) {
      await view.getByRole('button', { name: 'Document actions', exact: true }).click();
      await expect(view.getByRole('menuitem', { name: 'Insert formula', exact: true })).toHaveCount(
        0,
      );
      await view.getByRole('menuitem', { name: 'Formulas', exact: true }).click();
    } else {
      await expect(view.getByRole('button', { name: 'Insert formula', exact: true })).toHaveCount(
        0,
      );
      await view.getByRole('button', { name: 'Formulas', exact: true }).click();
    }
    const panel = view.getByRole('dialog', { name: 'Formulas', exact: true });
    await expect(panel.getByText(message, { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(panel.locator('output')).toHaveText('42', { timeout: 20_000 });
    await expect(panel.getByRole('button', { name: 'Insert formula', exact: true })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: expression, exact: true })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: '=40+2', exact: true })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(panel).toHaveCount(0);
    // Also check native canvas output: the panel alone cannot prove native privacy.
    await expect
      .poll(() =>
        view.evaluate(() =>
          (
            window as unknown as { formulaAccessPaintedText: string[] }
          ).formulaAccessPaintedText.includes('42'),
        ),
      )
      .toBe(true);
    expect(await view.locator('body').innerText()).not.toContain(secret);
    expect(
      await view.evaluate(() =>
        (window as unknown as { formulaAccessPaintedText: string[] }).formulaAccessPaintedText.join(
          '\n',
        ),
      ),
    ).not.toContain(secret);
    const account = Boolean(
      await view.getByRole('button', { name: 'Document actions', exact: true }).count(),
    );
    if (account) {
      await view.getByRole('button', { name: 'Document actions', exact: true }).click();
      await view.getByRole('menuitem', { name: 'Export', exact: true }).click();
    } else await view.getByRole('button', { name: 'Export as PDF', exact: true }).click();
    const pdf = view.getByRole('dialog', {
      name: account ? 'Export' : 'Export as PDF',
      exact: true,
    });
    const downloaded = await downloadPdf(
      view,
      pdf.getByRole('button', { name: 'Export as PDF', exact: true }),
    );
    await inspectPdf(downloaded, info, `${account ? 'account' : 'guest'}-private-formulas`, {
      text: ['42', 'Unavailable'],
      forbidden: [secret, source.name, source.id, expression, owner.name, reader.name],
    });
    await pdf.getByRole('button', { name: 'Close dialog', exact: true }).click();
  };
  try {
    await page.goto(`/?item=${host.id}`);
    await assertReadOnly(page, 'You need access to this formula’s sources');
    expect((await context.request.get(`/api/items/${source.id}/sheet`)).status()).toBe(404);
    const hostResponse = await context.request.get(`/api/items/${host.id}/doc`);
    expect(hostResponse.status()).toBe(200);
    expect(await hostResponse.text()).not.toContain(secret);
    // Release the account editor before creating the guest editor.
    await page.goto('/sign-in');
    const visitor = await guest.newPage();
    await visitor.goto(`${baseURL}/share/${host.id}#${link.token}`);
    await assertReadOnly(visitor, 'Source unavailable');
    const viewOnlyAccess = visitor
      .getByRole('region', { name: 'Document workspace', exact: true })
      .locator('header .editor-access');
    await expect(viewOnlyAccess).toHaveText('View only');
    await expect(viewOnlyAccess).toBeVisible();
    await expect(visitor.getByRole('navigation', { name: 'Workspace' })).toHaveCount(0);
    expect((await guest.request.get(`${baseURL}/api/items`)).status()).toBe(401);
    expect((await guest.request.get(`${baseURL}/api/guest/${source.id}`)).status()).toBe(404);
    expect(
      db.prepare('SELECT count(*) AS n FROM workspace_grants WHERE item_id=?').get(source.id)?.n,
    ).toBe(0);
    expect(workspace.links.state(source.id)).toBeUndefined();
  } finally {
    await guest.close();
    await page.goto('/sign-in').catch(() => {});
    db.prepare('DELETE FROM workspace_items WHERE owner_id=?').run(owner.id);
    db.prepare('DELETE FROM auth_users WHERE id IN (?,?)').run(owner.id, reader.id);
    db.close();
  }
});
