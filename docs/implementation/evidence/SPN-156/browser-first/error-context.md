# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: offline-editing.spec.ts >> downloaded native editors >> the file list replays queued Doc and Sheet edits without reopening either editor
- Location: e2e/offline-editing.spec.ts:53:3

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Test source

```ts
  3   | import type { Page, Request } from '@playwright/test';
  4   | import type { IDocumentData } from '@univerjs/core';
  5   | import { DOCS_NORMAL_EDITOR_UNIT_ID_KEY, DocumentFlavor, LocaleType } from '@univerjs/core';
  6   | import { docFormulas } from '@spinel/doc-formulas';
  7   | import { SyncServer } from '@spinel/sync-server';
  8   | import sharp from 'sharp';
  9   | import { COOKIE_NAME } from '../src/server/auth/store.ts';
  10  | import { SheetStore } from '../src/server/workspace/sheets.ts';
  11  | import { SQLiteSyncStorage } from '../src/server/sync/store.ts';
  12  | import type { NativeWrite } from './sync-network.ts';
  13  | import {
  14  |   attention,
  15  |   copy,
  16  |   edit,
  17  |   fixture,
  18  |   matchesServer,
  19  |   nativeInput,
  20  |   pending,
  21  |   savedLocally,
  22  |   saveStatus,
  23  |   selectCell,
  24  |   stored,
  25  |   synced,
  26  |   usableCanvas,
  27  | } from './offline-fixture.ts';
  28  | import { beginWriting, textPoint } from './doc-touch.ts';
  29  | import { recordNativeSnapshots } from './sync-snapshot.ts';
  30  | 
  31  | async function phoneText(page: Page, unitId: string) {
  32  |   return page.evaluate((id) => {
  33  |     let text: string | undefined;
  34  |     const receive = (event: Event) => {
  35  |       const evidence = (event as CustomEvent<{ unitId: string; text: string }>).detail;
  36  |       if (evidence.unitId === id) text = evidence.text;
  37  |     };
  38  |     window.addEventListener('spinel-doc-selection-evidence', receive);
  39  |     try {
  40  |       // The existing evidence observer reads the live native model, including
  41  |       // its still-offline queue. It exposes no writable selection or document.
  42  |       window.dispatchEvent(new Event('spinel-doc-selection-read'));
  43  |     } finally {
  44  |       window.removeEventListener('spinel-doc-selection-evidence', receive);
  45  |     }
  46  |     return text;
  47  |   }, unitId);
  48  | }
  49  | 
  50  | test.describe('downloaded native editors', () => {
  51  |   test.setTimeout(180_000);
  52  | 
  53  |   test('the file list replays queued Doc and Sheet edits without reopening either editor', async ({
  54  |     browser,
  55  |     baseURL,
  56  |   }, info) => {
  57  |     const f = await fixture(browser, baseURL!, info, 'doc');
  58  |     const sheet = f.workspace.create(f.owner.id, {
  59  |       name: 'Queued offline Sheet',
  60  |       kind: 'sheet',
  61  |       parentId: null,
  62  |     });
  63  |     const prepare = await f.control.request.post(`/api/items/${sheet.id}/collaboration`, {
  64  |       headers: { Origin: baseURL! },
  65  |       data: {},
  66  |     });
  67  |     expect(prepare.status(), await prepare.text()).toBe(200);
  68  |     const sheetUnit = (await prepare.json()).unitId as string;
  69  |     const readSheet = async () => {
  70  |       const response = await f.control.request.get(
  71  |         `/sync-api/items/${sheet.id}/snapshot?unitId=${sheetUnit}`,
  72  |       );
  73  |       expect(response.status(), await response.text()).toBe(200);
  74  |       return await response.json();
  75  |     };
  76  |     try {
  77  |       await f.download();
  78  |       const docBefore = await f.read();
  79  |       const sheetBefore = await readSheet();
  80  |       await f.page.getByRole('button', { name: 'Back to files', exact: true }).click();
  81  |       await f.page
  82  |         .getByRole('button', { name: `More actions for ${sheet.name}`, exact: true })
  83  |         .click();
  84  |       await f.page
  85  |         .getByRole('menuitem', { name: 'Available offline on this device', exact: true })
  86  |         .click();
  87  |       await expect(
  88  |         f.page.getByRole('status').filter({ hasText: `${sheet.name} is available offline` }),
  89  |       ).toHaveText(`${sheet.name} is available offline on this device.`, { timeout: 120_000 });
  90  |       await f.page.getByRole('button', { name: `${sheet.name} Sheet`, exact: true }).click();
  91  |       await synced(f.page);
  92  |       await f.network.setOffline(true);
  93  |       await edit(f.page, 'sheet', '15642');
  94  |       await savedLocally(f.page);
  95  |       await f.page.getByRole('button', { name: 'Back to files', exact: true }).click();
  96  |       await f.page.reload();
  97  |       await f.page.getByRole('button', { name: `${f.item.name} Doc`, exact: true }).click();
  98  |       await expect(f.page.getByRole('region', { name: 'Offline copy', exact: true })).toBeVisible();
  99  |       const text = `File-list replay ${info.testId}`;
  100 |       await edit(f.page, 'doc', text);
  101 |       await savedLocally(f.page);
  102 |       await f.page.getByRole('button', { name: 'Back to files', exact: true }).click();
> 103 |       expect(pending((await stored(f.page, f.actor.id, f.item.id))?.outbox?.checkpoint)).toBe(true);
      |                                                                                          ^ Error: expect(received).toBe(expected) // Object.is equality
  104 |       expect(pending((await stored(f.page, f.actor.id, sheet.id))?.outbox?.checkpoint)).toBe(true);
  105 |       await expect(f.page.locator('.univer-container')).toHaveCount(0);
  106 |       const sentBefore = f.network.outgoing.length;
  107 |       await f.network.setOffline(false);
  108 |       for (const itemId of [f.item.id, sheet.id]) {
  109 |         await expect
  110 |           .poll(
  111 |             async () => {
  112 |               const copy = await stored(f.page, f.actor.id, itemId);
  113 |               return Boolean(copy?.outbox && !pending(copy.outbox.checkpoint));
  114 |             },
  115 |             { timeout: 30_000 },
  116 |           )
  117 |           .toBe(true);
  118 |       }
  119 |       await expect(f.page.locator('.univer-container')).toHaveCount(0);
  120 |       await expect(f.page.getByRole('button', { name: 'Back to files', exact: true })).toHaveCount(
  121 |         0,
  122 |       );
  123 |       const docSaved = await f.read();
  124 |       const sheetSaved = await readSheet();
  125 |       expect(docSaved.revision).toBe(docBefore.revision + 1);
  126 |       expect(docSaved.snapshot.body!.dataStream.split(text)).toHaveLength(2);
  127 |       expect(sheetSaved.revision).toBe(sheetBefore.revision + 1);
  128 |       expect(sheetSaved.snapshot.sheets[sheetSaved.snapshot.sheetOrder[0]].cellData[0][3].v).toBe(
  129 |         15642,
  130 |       );
  131 |       const submits = f.network.outgoing
  132 |         .slice(sentBefore)
  133 |         .filter((frame) => frame.type === 'submit');
  134 |       expect(new Set(submits.map((frame) => frame.mutationId)).size).toBe(2);
  135 |       await recordNativeSnapshots(f.control);
  136 |       const peer = await f.control.newPage();
  137 |       await peer.goto(f.href);
  138 |       await matchesServer(peer, docSaved);
  139 |       expect(await copy(peer, 'doc')).toContain(text);
  140 |       await peer.goto(`/?item=${sheet.id}`);
  141 |       await matchesServer(peer, sheetSaved);
  142 |       expect(await copy(peer, 'sheet')).toBe('15642');
  143 |       await expect(f.page.locator('.univer-container')).toHaveCount(0);
  144 |       expect(f.errors).toEqual([]);
  145 |     } finally {
  146 |       await f.close();
  147 |     }
  148 |   });
  149 | 
  150 |   test('file-list replay retains revoked edits without sending them or creating a recovery copy', async ({
  151 |     browser,
  152 |     baseURL,
  153 |   }, info) => {
  154 |     const f = await fixture(browser, baseURL!, info, 'doc', { actor: 'editor' });
  155 |     try {
  156 |       await f.download();
  157 |       const before = await f.read();
  158 |       await f.network.setOffline(true);
  159 |       await edit(f.page, 'doc', 'Retained after file-list revocation');
  160 |       await savedLocally(f.page);
  161 |       const original = (await stored(f.page, f.actor.id, f.item.id))!.outbox!;
  162 |       await f.page.getByRole('button', { name: 'Back to files', exact: true }).click();
  163 |       f.workspace.share(f.owner.id, f.item.id, f.editor.id, null);
  164 |       await f.network.setOffline(false);
  165 |       await expect
  166 |         .poll(
  167 |           async () => (await stored(f.page, f.actor.id, f.item.id))?.outbox?.checkpoint.failure,
  168 |           { timeout: 30_000 },
  169 |         )
  170 |         .toBe('stale');
  171 |       const retained = (await stored(f.page, f.actor.id, f.item.id))!;
  172 |       expect(retained.outbox!.checkpoint.buffer).toEqual(original.checkpoint.buffer);
  173 |       expect(retained.outbox!.checkpoint.revision).toBe(original.checkpoint.revision);
  174 |       expect(retained.recovery).toBeUndefined();
  175 |       expect(f.network.outgoing.filter((frame) => frame.type === 'submit')).toEqual([]);
  176 |       expect(await f.read()).toEqual(before);
  177 |       await expect(f.page.locator('.univer-container')).toHaveCount(0);
  178 |       expect(f.errors).toEqual([]);
  179 |     } finally {
  180 |       await f.close();
  181 |     }
  182 |   });
  183 | 
  184 |   for (const kind of ['doc', 'sheet'] as const)
  185 |     test(`a prepared ${kind} viewer upgrades in place and can save new offline work`, async ({
  186 |       browser,
  187 |       baseURL,
  188 |     }, info) => {
  189 |       const f = await fixture(browser, baseURL!, info, kind, { actor: 'viewer' });
  190 |       try {
  191 |         await f.download();
  192 |         await expect(saveStatus(f.page)).toHaveText('View only on this device.');
  193 |         const before = await f.read();
  194 |         const prepared = (await stored(f.page, f.actor.id, f.item.id))!;
  195 |         expect(prepared.bundle).toMatchObject({
  196 |           access: 'viewer',
  197 |           readOnly: true,
  198 |           unitId: f.unitId,
  199 |         });
  200 |         const canvas =
  201 |           kind === 'doc'
  202 |             ? f.page.getByLabel('Document canvas', { exact: true })
  203 |             : f.page.locator('canvas[id^="univer-sheet-main-canvas_"]');
```