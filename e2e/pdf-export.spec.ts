import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { getDocsEmptySnapshot, LocaleType } from '@univerjs/core';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { DocumentStore } from '../src/server/workspace/documents.ts';
import { SheetStore } from '../src/server/workspace/sheets.ts';
import { downloadPdf, inspectPdf } from './pdfEvidence.ts';

for (const kind of ['sheet', 'doc'] as const) {
  test(`${kind} PDF downloads for every current reader with worksheet selection and guest privacy`, async ({
    browser,
    baseURL,
  }, info) => {
    test.setTimeout(210_000);
    const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
    const auth = new AuthStore(db),
      workspace = new WorkspaceStore(auth);
    const owner = auth.createUser(`PRIVATE-PDF-OWNER-${info.testId}`);
    const editor = auth.createUser(`PRIVATE-PDF-EDITOR-${info.testId}`);
    const viewer = auth.createUser(`PRIVATE-PDF-VIEWER-${info.testId}`);
    const item = workspace.create(owner.id, { name: `Portable ${kind}`, kind, parentId: null });
    if (kind === 'sheet') {
      new SheetStore(workspace).save(owner.id, item.id, {
        snapshot: {
          id: item.id,
          name: item.name,
          appVersion: '1.1.0',
          locale: LocaleType.EN_US,
          styles: {},
          sheetOrder: ['summary', 'detail', 'hidden'],
          sheets: {
            summary: {
              id: 'summary',
              name: 'Summary',
              rowCount: 120,
              columnCount: 4,
              defaultColumnWidth: 240,
              defaultRowHeight: 24,
              cellData: Object.fromEntries(
                Array.from({ length: 90 }, (_, row) => [
                  row,
                  { 0: { v: `PUBLIC-SHEET-${String(row + 1).padStart(3, '0')}` } },
                ]),
              ),
            },
            detail: {
              id: 'detail',
              name: 'Detail',
              rowCount: 10,
              columnCount: 4,
              cellData: { 0: { 0: { v: 'PUBLIC-DETAIL-731' } } },
            },
            hidden: {
              id: 'hidden',
              name: 'Hidden worksheet',
              hidden: 1,
              rowCount: 10,
              columnCount: 4,
              cellData: { 0: { 0: { v: 'HIDDEN-CONTENT-950' } } },
            },
          },
        },
        revision: 0,
        writeId: crypto.randomUUID(),
      });
    } else {
      const snapshot = getDocsEmptySnapshot(item.id);
      const lines = Array.from(
        { length: 90 },
        (_, row) => `PUBLIC-DOC-${String(row + 1).padStart(3, '0')} Complete paragraph.`,
      );
      const dataStream = lines.join('\r') + '\r\n';
      snapshot.body = {
        ...snapshot.body,
        dataStream,
        paragraphs: [...dataStream.matchAll(/\r/g)].map((match, index) => ({
          startIndex: match.index,
          paragraphId: `p${index}`,
        })),
        sectionBreaks: [{ startIndex: dataStream.length - 1, sectionId: 'complete-document' }],
      };
      new DocumentStore(workspace).save(owner.id, item.id, {
        snapshot,
        revision: 0,
        writeId: crypto.randomUUID(),
      });
    }
    workspace.share(owner.id, item.id, editor.id, 'editor');
    workspace.share(owner.id, item.id, viewer.id, 'viewer');
    try {
      for (const role of ['owner', 'editor', 'viewer', 'guest-viewer', 'guest-editor'] as const) {
        const context = await browser.newContext({
          baseURL,
          viewport: { width: 1280, height: 960 },
        });
        const page = await context.newPage();
        const failures: string[] = [];
        page.on('pageerror', (error) => failures.push(error.message));
        page.setDefaultTimeout(20_000);
        await context.addInitScript(() => {
          window.print = () => {
            throw new Error('Browser print must not be called.');
          };
        });
        try {
          if (role.startsWith('guest-')) {
            const link = workspace.links.begin(
              item.id,
              role === 'guest-viewer' ? 'viewer' : 'editor',
            );
            workspace.links.finish(item.id, link.epoch, true);
            await page.goto(`/share/${item.id}#${link.token}`);
          } else {
            const user = role === 'owner' ? owner : role === 'editor' ? editor : viewer;
            await context.addCookies([
              {
                name: COOKIE_NAME,
                value: auth.createSession(user.id).token,
                url: baseURL!.replace('http:', 'https:'),
                secure: true,
                httpOnly: true,
                sameSite: 'Strict',
              },
            ]);
            await page.goto(`/?item=${item.id}`);
          }
          await expect(page.getByRole('status', { name: 'Save status' })).toHaveText(
            role.endsWith('viewer')
              ? 'View only — reload after your access changes.'
              : 'All changes saved.',
            { timeout: 30_000 },
          );
          const protectedMessage = 'This content is protected. This action is not allowed.';
          const protectedNotice = page.getByText(protectedMessage, { exact: true });
          const startupProtectionNotice = await protectedNotice.isVisible();
          // Native Doc initialization attempts an on-open field refresh even
          // for readers. Record that existing startup notice separately; any
          // new warning from Export, theme/viewport changes or download fails.
          await expect(protectedNotice).toBeHidden({ timeout: 6000 });
          await page.evaluate((message) => {
            const notices: string[] = [];
            const state = { phase: 'open-export', notices };
            (window as unknown as { pdfPermissionEvidence: typeof state }).pdfPermissionEvidence =
              state;
            new MutationObserver((records) => {
              for (const record of records) {
                const changed =
                  record.type === 'characterData' ? [record.target] : record.addedNodes;
                if ([...changed].some((node) => node.textContent?.includes(message))) {
                  notices.push(state.phase);
                  break;
                }
              }
            }).observe(document.body, { childList: true, characterData: true, subtree: true });
          }, protectedMessage);
          const guest = role.startsWith('guest-');
          const pdfPath = `/api/${guest ? 'guest' : 'items'}/${item.id}/pdf`;
          let optionRequests = 0;
          page.on('request', (request) => {
            if (new URL(request.url()).pathname === pdfPath && request.method() === 'GET')
              optionRequests++;
          });
          const optionsResponse = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname === pdfPath && response.request().method() === 'GET',
          );
          if (guest) {
            await expect(
              page.getByRole('button', { name: 'Document actions', exact: true }),
            ).toHaveCount(0);
            await page.getByRole('button', { name: 'Export as PDF', exact: true }).click();
          } else {
            await page.getByRole('button', { name: 'Document actions', exact: true }).click();
            await page.getByRole('menuitem', { name: 'Export', exact: true }).click();
          }
          const dialog = page.getByRole('dialog', {
            name: guest ? 'Export as PDF' : 'Export',
            exact: true,
          });
          const options = await optionsResponse;
          expect(
            options.status(),
            options.ok() ? 'PDF options loaded.' : `PDF options refused: ${await options.text()}`,
          ).toBe(200);
          const button = dialog.getByRole('button', { name: 'Export as PDF', exact: true });
          await expect(button).toBeEnabled();
          expect(optionRequests, 'Opening Export starts one current options request.').toBe(1);
          if (guest)
            await expect(dialog.getByRole('button', { name: 'Download Univer file' })).toHaveCount(
              0,
            );
          if (kind === 'sheet') {
            await expect(dialog.getByRole('checkbox', { name: 'Hidden worksheet' })).toHaveCount(0);
            await expect(
              dialog.getByRole('checkbox', { name: 'Summary', exact: true }),
            ).toBeChecked();
            await expect(
              dialog.getByRole('checkbox', { name: 'Detail', exact: true }),
            ).toBeChecked();
            if (role === 'owner')
              await dialog.getByRole('checkbox', { name: 'Detail', exact: true }).uncheck();
          }
          if (role === 'owner' || role === 'guest-viewer') {
            await mkdir('test-results/theme-screenshots', { recursive: true });
            for (const [theme, width] of [
              ['light', 1280],
              ['dark', 1280],
              ['light', 390],
            ] as const) {
              await page.evaluate((phase) => {
                (
                  window as unknown as { pdfPermissionEvidence: { phase: string } }
                ).pdfPermissionEvidence.phase = phase;
              }, `theme-${theme}-${width}`);
              await page.emulateMedia({ colorScheme: theme });
              await page.setViewportSize({ width, height: 960 });
              await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
              await expect
                .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
                .toBe(true);
              await expect(protectedNotice).toBeHidden();
              await page.screenshot({
                path: `test-results/theme-screenshots/spn-075-${kind}-${role}-${theme}-${width}-${info.project.name}.png`,
                fullPage: true,
                animations: 'disabled',
              });
            }
          }
          await page.evaluate(() => {
            (
              window as unknown as { pdfPermissionEvidence: { phase: string } }
            ).pdfPermissionEvidence.phase = 'download';
          });
          const download = await downloadPdf(page, button, pdfPath);
          const evidence = await inspectPdf(download, info, `${kind}-${role}`, {
            text:
              kind === 'doc'
                ? ['PUBLIC-DOC-001', 'PUBLIC-DOC-090']
                : [
                    'PUBLIC-SHEET-001',
                    'PUBLIC-SHEET-090',
                    ...(role === 'owner' ? [] : ['PUBLIC-DETAIL-731']),
                  ],
            forbidden: [
              owner.name,
              editor.name,
              viewer.name,
              'HIDDEN-CONTENT-950',
              ...(kind === 'sheet' && role === 'owner' ? ['PUBLIC-DETAIL-731'] : []),
            ],
          });
          expect(evidence.pages).toBeGreaterThan(1);
          await expect(dialog).toContainText('PDF download started.');
          const permissionEvidence = await page.evaluate(
            () =>
              (window as unknown as { pdfPermissionEvidence: { phase: string; notices: string[] } })
                .pdfPermissionEvidence,
          );
          const permissionReport = JSON.stringify({
            startupProtectionNotice,
            ...permissionEvidence,
          });
          await writeFile(
            info.outputPath(`${kind}-${role}-permission-notices.json`),
            permissionReport,
          );
          await info.attach(`${kind}-${role}-permission-notices`, {
            body: permissionReport,
            contentType: 'application/json',
          });
          expect(permissionEvidence.notices).toEqual([]);
          await expect(protectedNotice).toBeHidden();
          expect(failures).toEqual([]);
          if (role === 'guest-editor') {
            // Hold the next POST until its previously valid link is revoked.
            let release!: () => void, arrived!: () => void;
            const held = new Promise<void>((resolve) => {
              release = resolve;
            });
            const requested = new Promise<void>((resolve) => {
              arrived = resolve;
            });
            let extraDownloads = 0;
            page.on('download', () => {
              extraDownloads++;
            });
            await page.route(`**/api/guest/${item.id}/pdf`, async (route) => {
              if (route.request().method() === 'POST') {
                arrived();
                await held;
              }
              await route.continue().catch(() => {});
            });
            await button.click();
            await requested;
            const gone = workspace.links.begin(item.id, null);
            workspace.links.finish(item.id, gone.epoch, false);
            release();
            await expect(
              page.getByRole('heading', { name: 'This link no longer works.', exact: true }),
            ).toBeVisible();
            await expect(
              page.getByRole('button', { name: 'Export as PDF', exact: true }),
            ).toHaveCount(0);
            expect(extraDownloads).toBe(0);
          }
        } finally {
          await context.close();
        }
      }
    } finally {
      db.prepare('DELETE FROM workspace_items WHERE owner_id=?').run(owner.id);
      for (const user of [owner, editor, viewer])
        db.prepare('DELETE FROM auth_users WHERE id=?').run(user.id);
      db.close();
    }
  });
}
