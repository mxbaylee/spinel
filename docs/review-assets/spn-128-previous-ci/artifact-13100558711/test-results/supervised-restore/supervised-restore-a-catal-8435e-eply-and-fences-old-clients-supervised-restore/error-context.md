# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: supervised-restore.spec.ts >> a catalog restore survives double-clicks, cancel and a lost reply, and fences old clients
- Location: e2e/supervised-restore.spec.ts:252:1

# Error details

```
Error: apiRequestContext.get: read ECONNRESET
Call log:
  - → GET http://localhost:3198/api/items/b00b5705-345a-440e-9a98-780604b75270/sheet
    - user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.4 Safari/537.36
    - accept: */*
    - accept-encoding: gzip,deflate,br
    - cookie: __Host-spinel-session=[redacted]

```

# Test source

```ts
  185 |   const downloads = operator.getByRole('region', {
  186 |     name: 'Workspace backup download',
  187 |     exact: true,
  188 |   });
  189 |   await downloads.getByRole('button', { name: 'Prepare workspace backup', exact: true }).click();
  190 |   await operator
  191 |     .getByRole('dialog', { name: 'Prepare encrypted backup', exact: true })
  192 |     .getByRole('button', { name: 'Verify and prepare backup', exact: true })
  193 |     .click();
  194 |   await expect(downloads.getByText('Encrypted backup ready.', { exact: true })).toBeVisible({
  195 |     timeout: 60_000,
  196 |   });
  197 |   await downloads.getByRole('button', { name: 'Download encrypted backup', exact: true }).click();
  198 |   const downloaded = operator.waitForEvent('download');
  199 |   await operator
  200 |     .getByRole('dialog', { name: 'Download encrypted backup', exact: true })
  201 |     .getByRole('button', { name: 'Verify and download', exact: true })
  202 |     .click();
  203 |   const path = await (await downloaded).path();
  204 |   expect(path).not.toBeNull();
  205 |   return path!;
  206 | }
  207 | 
  208 | async function saveToCatalog(app: Fixture, archive: string) {
  209 |   const stamp = new Date().toISOString().replaceAll(':', '-');
  210 |   const target = join(app.catalogDirectory!, `${stamp}-${randomUUID()}.spinel`);
  211 |   await copyFile(archive, target);
  212 |   await chmod(target, 0o600);
  213 | }
  214 | 
  215 | async function chooseSavedBackup(page: Page) {
  216 |   const dialog = page.getByRole('dialog', { name: 'Prepare workspace restore', exact: true });
  217 |   await dialog.getByRole('combobox', { name: 'Backup source', exact: true }).click();
  218 |   await page.getByRole('option', { name: 'Previously saved backup', exact: true }).click();
  219 |   await dialog.getByRole('combobox', { name: 'Saved backup', exact: true }).click();
  220 |   const options = page.getByRole('option');
  221 |   await expect(options).toHaveCount(2);
  222 |   await expect(options.first()).toHaveText(/Choose a recovery point/);
  223 |   await options.nth(1).click();
  224 |   return dialog;
  225 | }
  226 | 
  227 | async function attachFailure(browser: Browser | undefined, info: TestInfo) {
  228 |   let index = 0;
  229 |   for (const context of browser?.contexts() ?? [])
  230 |     for (const page of context.pages()) {
  231 |       if (page.isClosed()) continue;
  232 |       await info.attach(`restore-failure-${index}`, {
  233 |         body: await page.screenshot({ animations: 'disabled' }).catch(() => Buffer.alloc(0)),
  234 |         contentType: 'image/png',
  235 |       });
  236 |       await info.attach(`restore-state-${index++}`, {
  237 |         body: await page
  238 |           .locator('body')
  239 |           .ariaSnapshot()
  240 |           .catch(() => 'Page unavailable.'),
  241 |         contentType: 'text/plain',
  242 |       });
  243 |     }
  244 | }
  245 | 
  246 | const skipUnsupported = (info: TestInfo) =>
  247 |   test.skip(
  248 |     info.project.name !== 'supervised-restore' || process.platform !== 'linux',
  249 |     'Supervised restore uses the Linux production supervisor and a filesystem catalog.',
  250 |   );
  251 | 
  252 | test('a catalog restore survives double-clicks, cancel and a lost reply, and fences old clients', async ({
  253 |   playwright,
  254 | }, info) => {
  255 |   skipUnsupported(info);
  256 |   test.setTimeout(600_000);
  257 |   const app = await startMaintenanceFixture({ catalog: true });
  258 |   let browser: Browser | undefined;
  259 |   const failures: string[] = [];
  260 |   try {
  261 |     browser = await playwright.chromium.launch(info.project.use.launchOptions);
  262 |     const operator = await enrollOperator(browser, app);
  263 |     operator.page.on('pageerror', (error) => failures.push(error.message));
  264 |     const ownerInvitation = await invite(operator.page);
  265 |     const memberInvitation = await invite(operator.page);
  266 | 
  267 |     // The Owner keeps a Doc open; a Collaborator keeps a Sheet available offline.
  268 |     const owner = await joinWorkspace(browser, app, ownerInvitation, 'Restore owner', {
  269 |       name: 'Owner plan',
  270 |       kind: 'doc',
  271 |     });
  272 |     const {
  273 |       context: memberContext,
  274 |       page: member,
  275 |       key: memberKey,
  276 |       accountId,
  277 |       item,
  278 |     } = await joinWorkspace(browser, app, memberInvitation, 'Restore collaborator', {
  279 |       name: 'Restore field notes',
  280 |       kind: 'sheet',
  281 |     });
  282 |     for (const page of [owner.page, member])
  283 |       page.on('pageerror', (error) => failures.push(error.message));
  284 |     const remote = async () => {
> 285 |       const response = await memberContext.request.get(`/api/items/${item.id}/sheet`);
      |                                                    ^ Error: apiRequestContext.get: read ECONNRESET
  286 |       return response.ok() ? JSON.stringify((await response.json()).snapshot) : '';
  287 |     };
  288 |     await member.reload();
  289 |     await expect
  290 |       .poll(() => member.evaluate(() => Boolean(navigator.serviceWorker.controller)))
  291 |       .toBe(true);
  292 |     await member
  293 |       .getByRole('button', { name: `More actions for ${item.name}`, exact: true })
  294 |       .click();
  295 |     await member
  296 |       .getByRole('menuitem', { name: 'Available offline on this device', exact: true })
  297 |       .click();
  298 |     await expect(member.getByRole('status').filter({ hasText: 'available offline' })).toHaveText(
  299 |       `${item.name} is available offline on this device.`,
  300 |       { timeout: 90_000 },
  301 |     );
  302 |     await member.getByRole('button', { name: `${item.name} Sheet`, exact: true }).click();
  303 |     const synced = 'Synced. All changes are saved on the server and this device.';
  304 |     await expect(saveStatus(member)).toHaveText(synced, { timeout: 30_000 });
  305 |     await typeCell(member, 'A1', 'Kept by the saved backup');
  306 |     await expect(saveStatus(member)).toHaveText(synced, { timeout: 30_000 });
  307 |     await expect.poll(remote).toContain('Kept by the saved backup');
  308 | 
  309 |     const docText = async () => {
  310 |       const response = await owner.context.request.get(`/api/items/${owner.item.id}/doc`);
  311 |       return response.ok() ? String((await response.json()).snapshot?.body?.dataStream ?? '') : '';
  312 |     };
  313 |     const docTab = owner.page;
  314 |     await docTab.goto(`/?item=${owner.item.id}`);
  315 |     const docEditor = docTab.getByRole('region', { name: 'Doc document', exact: true });
  316 |     await expect(docEditor.getByRole('button', { name: 'Bold', exact: true })).toBeEnabled();
  317 |     await docEditor.locator('.univer-container').click({ position: { x: 130, y: 200 } });
  318 |     await docTab.keyboard.type('Owner plan in the backup.');
  319 |     await expect.poll(docText, { timeout: 30_000 }).toContain('Owner plan in the backup.');
  320 | 
  321 |     await saveToCatalog(app, await downloadBackup(operator.page));
  322 | 
  323 |     await docEditor.locator('.univer-container').click({ position: { x: 130, y: 200 } });
  324 |     await docTab.keyboard.type(' Acknowledged Owner change.');
  325 |     await expect.poll(docText, { timeout: 30_000 }).toContain('Acknowledged Owner change.');
  326 | 
  327 |     // Work after the backup: one acknowledged edit, then one queued offline.
  328 |     await typeCell(member, 'A2', 'Acknowledged after the backup');
  329 |     await expect(saveStatus(member)).toHaveText(synced, { timeout: 30_000 });
  330 |     await expect.poll(remote).toContain('Acknowledged after the backup');
  331 |     await memberContext.setOffline(true);
  332 |     await typeCell(member, 'A3', 'Queued offline after the backup');
  333 |     await expect(saveStatus(member)).toHaveText('Saved on this device — waiting to sync.', {
  334 |       timeout: 30_000,
  335 |     });
  336 |     await expect
  337 |       .poll(() => outbox(member, accountId, item.id))
  338 |       .toContain('Queued offline after the backup');
  339 | 
  340 |     // Catalog selection with a double-click: one passkey check, one preparation.
  341 |     const page = operator.page;
  342 |     const count = requests(page);
  343 |     const restore = restoreRegion(page);
  344 |     await restore.getByRole('button', { name: 'Prepare restore', exact: true }).click();
  345 |     let dialog = await chooseSavedBackup(page);
  346 |     await dialog.getByRole('button', { name: 'Verify and prepare', exact: true }).dblclick();
  347 |     const ready = 'Backup prepared. Review its source and consequences before restoring.';
  348 |     await expect(restore.getByText(ready, { exact: true })).toBeVisible({ timeout: 120_000 });
  349 |     expect([count('verify'), count('prepare')]).toEqual([1, 1]);
  350 | 
  351 |     // Cancel leaves the live workspace alone and frees the next preparation.
  352 |     await restore.getByRole('button', { name: 'Cancel preparation', exact: true }).click();
  353 |     await expect(
  354 |       restore.getByText('Restore preparation was cancelled. The live workspace was not replaced.', {
  355 |         exact: true,
  356 |       }),
  357 |     ).toBeVisible();
  358 |     expect(count('cancel')).toBe(1);
  359 |     await expect(
  360 |       restore.getByRole('button', { name: 'Prepare restore', exact: true }),
  361 |     ).toBeEnabled();
  362 |     expect((await publicStatus(app.publicOrigin)).phase).toBe('running');
  363 | 
  364 |     await restore.getByRole('button', { name: 'Prepare restore', exact: true }).click();
  365 |     dialog = await chooseSavedBackup(page);
  366 |     await dialog.getByRole('button', { name: 'Verify and prepare', exact: true }).click();
  367 |     await expect(restore.getByText(ready, { exact: true })).toBeVisible({ timeout: 120_000 });
  368 |     expect([count('verify'), count('prepare')]).toEqual([2, 2]);
  369 | 
  370 |     // The first confirmation never reaches the server. The retry does, and the
  371 |     // server takes custody, but its reply is lost too.
  372 |     let confirms = 0;
  373 |     let acceptedStatus: number | undefined;
  374 |     await page.route('**/api/admin/restores/preparations/*/confirm', async (route) => {
  375 |       if (confirms++ === 0) return route.abort('connectionreset');
  376 |       acceptedStatus = (await route.fetch()).status();
  377 |       await route.abort('connectionreset');
  378 |     });
  379 |     const lost =
  380 |       'The confirmation response was lost. Its outcome is unconfirmed. Refresh status before taking another action.';
  381 |     const before = await publicStatus(app.publicOrigin);
  382 |     await restore.getByRole('button', { name: 'Review restore', exact: true }).click();
  383 |     dialog = page.getByRole('dialog', { name: 'Restore this workspace?', exact: true });
  384 |     await dialog.getByRole('checkbox').check();
  385 |     await dialog
```