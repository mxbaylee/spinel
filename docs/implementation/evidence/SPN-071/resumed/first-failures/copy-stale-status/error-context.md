# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: copy.spec.ts >> a phone Doc viewer retains a copy after dismissing its busy native drawer and losing source access
- Location: e2e/copy.spec.ts:334:1

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator:  getByRole('status', { name: 'Save status', exact: true })
Expected: "View only — reload after your access changes."
Received: "View only."
Timeout:  30000ms

Call log:
  - Expect "toHaveText" getByRole('status', { name: 'Save status', exact: true }) with timeout 30000ms
  - waiting for getByRole('status', { name: 'Save status', exact: true })
    - locator resolved to <span role="status" aria-live="polite" aria-atomic="true" aria-label="Save status" class="save-announcement">Loading document…</span>
    - unexpected value "Loading document…"
    57 × locator resolved to <span role="status" aria-live="polite" aria-atomic="true" aria-label="Save status" class="save-announcement">View only.</span>
       - unexpected value "View only."

```

```yaml
- status "Save status": View only.
```

# Test source

```ts
  319 |       info.outputPath('sync-diagnostics.json'),
  320 |       JSON.stringify({
  321 |         stage,
  322 |         errors,
  323 |         copyPosts,
  324 |         failureUI,
  325 |         outgoing: network.outgoing,
  326 |         incoming: network.incoming,
  327 |       }),
  328 |     );
  329 |     await page.goto('/sign-in').catch(() => {});
  330 |     db.close();
  331 |   }
  332 | });
  333 | 
  334 | test('a phone Doc viewer retains a copy after dismissing its busy native drawer and losing source access', async ({
  335 |   browser,
  336 |   baseURL,
  337 | }, info) => {
  338 |   test.setTimeout(90_000);
  339 |   const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  340 |   const auth = new AuthStore(db);
  341 |   const workspace = new WorkspaceStore(auth);
  342 |   const owner = auth.createUser(`Recipe owner ${info.testId}`);
  343 |   const viewer = auth.createUser(`Recipe viewer ${info.testId}`);
  344 |   const other = auth.createUser(`Recipe other reader ${info.testId}`);
  345 |   const folder = workspace.create(owner.id, {
  346 |     name: 'Private recipes',
  347 |     kind: 'folder',
  348 |     parentId: null,
  349 |   });
  350 |   const source = workspace.create(owner.id, {
  351 |     name: 'Shared recipe',
  352 |     kind: 'doc',
  353 |     parentId: folder.id,
  354 |   });
  355 |   const text = 'A recipe shared with a viewer. Keep this editable text in an independent copy.';
  356 |   const snapshot = getDocsEmptySnapshot(
  357 |     source.id,
  358 |     LocaleType.EN_US,
  359 |     source.name,
  360 |     DocumentFlavor.MODERN,
  361 |   );
  362 |   snapshot.body = {
  363 |     ...snapshot.body,
  364 |     dataStream: `${text}\r\n`,
  365 |     paragraphs: [{ startIndex: text.length, paragraphId: createParagraphId(new Set()) }],
  366 |     sectionBreaks: [{ startIndex: text.length + 1, sectionId: createSectionId(new Set()) }],
  367 |   };
  368 |   expect(validateDocumentStructure(snapshot)).toEqual([]);
  369 |   new DocumentStore(workspace).save(owner.id, source.id, {
  370 |     snapshot,
  371 |     revision: 0,
  372 |     writeId: randomUUID(),
  373 |   });
  374 |   workspace.share(owner.id, source.id, viewer.id, 'viewer');
  375 |   workspace.share(owner.id, source.id, other.id, 'editor');
  376 |   const link = workspace.links.begin(source.id, 'viewer');
  377 |   workspace.links.finish(source.id, link.epoch, true);
  378 |   const phone = await browser.newContext({
  379 |     baseURL,
  380 |     viewport: { width: 390, height: 844 },
  381 |     deviceScaleFactor: 1,
  382 |     isMobile: true,
  383 |     hasTouch: true,
  384 |     colorScheme: 'light',
  385 |     reducedMotion: 'reduce',
  386 |   });
  387 |   await phone.addCookies([
  388 |     {
  389 |       name: COOKIE_NAME,
  390 |       value: auth.createSession(viewer.id).token,
  391 |       url: baseURL!.replace('http:', 'https:'),
  392 |       secure: true,
  393 |       httpOnly: true,
  394 |       sameSite: 'Strict',
  395 |     },
  396 |   ]);
  397 |   const page = await phone.newPage();
  398 |   page.setDefaultTimeout(10_000);
  399 |   const errors: string[] = [];
  400 |   page.on('pageerror', (error) => errors.push(error.message));
  401 |   let copyPosts = 0;
  402 |   let publishedResponse: APIResponse | undefined;
  403 |   let releaseCopy = () => {};
  404 |   const heldResponse = new Promise<void>((resolve) => {
  405 |     releaseCopy = resolve;
  406 |   });
  407 |   await page.route(`**/api/items/${source.id}/copy`, async (route) => {
  408 |     copyPosts++;
  409 |     // The real server publishes once. Delay only delivery of that successful
  410 |     // response so the native drawer can unmount while the request is pending.
  411 |     const response = await route.fetch();
  412 |     publishedResponse = response;
  413 |     await heldResponse;
  414 |     await route.fulfill({ response });
  415 |   });
  416 |   try {
  417 |     await page.goto(`/?item=${source.id}`);
  418 |     expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
> 419 |     await expect(page.getByRole('status', { name: 'Save status', exact: true })).toHaveText(
      |                                                                                  ^ Error: expect(locator).toHaveText(expected) failed
  420 |       'View only — reload after your access changes.',
  421 |       { timeout: 30_000 },
  422 |     );
  423 |     await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  424 |     const dialog = await openNativeCopy(page, true, info);
  425 |     await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
  426 |       'Shared recipe (copy)',
  427 |     );
  428 |     await expect(dialog.getByRole('combobox', { name: 'Folder', exact: true })).toHaveValue('');
  429 |     await expect(dialog).not.toContainText(folder.name);
  430 |     const submit = dialog.getByRole('button', { name: 'Make a copy', exact: true });
  431 |     await expect(submit).toBeEnabled();
  432 |     await capture(page, info, 'native-doc-viewer-dialog-phone');
  433 |     await submit.tap();
  434 |     await expect.poll(() => publishedResponse?.status()).toBe(201);
  435 |     const { item: copy } = (await publishedResponse!.json()) as { item: WorkspaceItem };
  436 |     await expect(
  437 |       dialog.getByRole('button', { name: 'Making a copy…', exact: true }),
  438 |     ).toBeDisabled();
  439 |     expect(workspace.fileOwner(copy.id)).toBe(viewer.id);
  440 |     await dismissNativeCopyDrawer(page);
  441 |     await expect(page).toHaveURL(new RegExp(`item=${source.id}$`));
  442 |     const nativeMore = page.locator('.univer-container [data-u-comp="mobile-more-trigger"]');
  443 |     await expect(nativeMore).toHaveAttribute('aria-expanded', 'false');
  444 |     await nativeMore.tap();
  445 |     await expect(nativeMore).toHaveAttribute('aria-expanded', 'true');
  446 |     const copyMenu = page
  447 |       .locator('[data-u-comp="mobile-more-menu"]')
  448 |       .getByRole('button', { name: 'Make a copy', exact: true });
  449 |     await expect(copyMenu).toBeDisabled();
  450 |     expect(copyPosts).toBe(1);
  451 |     const delivered = page.waitForResponse(
  452 |       (response) =>
  453 |         response.request().method() === 'POST' &&
  454 |         new URL(response.url()).pathname === `/api/items/${source.id}/copy`,
  455 |     );
  456 |     releaseCopy();
  457 |     const created = await delivered;
  458 |     expect(created.status(), await publishedResponse!.text()).toBe(201);
  459 |     await expect(page.getByText(`Created ${copy.name}.`, { exact: true })).toBeVisible();
  460 |     await expect(copyMenu).toBeEnabled();
  461 |     // Dismissal cannot silently navigate or turn another tap into a second copy.
  462 |     await expect(page).toHaveURL(new RegExp(`item=${source.id}$`));
  463 |     await copyMenu.tap();
  464 |     const result = page.getByRole('dialog').filter({
  465 |       has: page.getByRole('form', { name: 'Make a copy', exact: true }),
  466 |     });
  467 |     await expect(result.getByRole('status')).toHaveText(`Created ${copy.name}.`);
  468 |     await expect(result.getByRole('textbox', { name: 'Name', exact: true })).toHaveCount(0);
  469 |     expect(copyPosts).toBe(1);
  470 |     expect(workspace.list(viewer.id).filter((item) => item.name === copy.name)).toHaveLength(1);
  471 |     await capture(page, info, 'native-doc-copy-result-phone');
  472 |     expect(copy).toMatchObject({ name: 'Shared recipe (copy)', parentId: null, access: 'owner' });
  473 |     expect(copy.id).not.toBe(source.id);
  474 |     expect(workspace.fileOwner(copy.id)).toBe(viewer.id);
  475 |     for (const account of [owner, other])
  476 |       expect(() => workspace.get(account.id, copy.id)).toThrow('This item is not available.');
  477 |     expect(workspace.links.metadata(copy.id).enabled).toBe(false);
  478 |     await result.getByRole('button', { name: 'Open copy', exact: true }).tap();
  479 |     await expect(page).toHaveURL(new RegExp(`item=${copy.id}$`));
  480 |     await saved(page);
  481 | 
  482 |     workspace.share(owner.id, source.id, viewer.id, null);
  483 |     expect((await phone.request.get(`/api/items/${source.id}/doc`)).status()).toBe(404);
  484 |     await page.reload();
  485 |     await saved(page);
  486 |     const copied = await phone.request.get(`/api/items/${copy.id}/doc`);
  487 |     expect(copied.status(), await copied.text()).toBe(200);
  488 |     const body = (await copied.json()) as { snapshot: IDocumentData };
  489 |     expect(body.snapshot.body?.dataStream).toBe(`${text}\r\n`);
  490 |     expect(body.snapshot.id).not.toBe(snapshot.id);
  491 | 
  492 |     // Commit a second operation, then lose only its response. A transport error
  493 |     // cannot prove publication failed or authorize an accidental second POST.
  494 |     let uncertainPosts = 0;
  495 |     let uncertainCopy: WorkspaceItem | undefined;
  496 |     await page.route(`**/api/items/${copy.id}/copy`, async (route) => {
  497 |       uncertainPosts++;
  498 |       const response = await route.fetch();
  499 |       expect(response.status()).toBe(201);
  500 |       uncertainCopy = (await response.json()).item;
  501 |       await route.abort('failed');
  502 |     });
  503 |     const unknown = await openNativeCopy(page, true);
  504 |     await unknown.getByRole('button', { name: 'Make a copy', exact: true }).tap();
  505 |     await expect(unknown.getByRole('alert')).toContainText(
  506 |       'Check My files before making another copy.',
  507 |     );
  508 |     await expect(unknown.getByRole('button', { name: 'Make a copy', exact: true })).toHaveCount(0);
  509 |     await capture(page, info, 'native-doc-copy-unknown-phone');
  510 |     await dismissNativeCopyDrawer(page);
  511 |     await nativeMore.tap();
  512 |     await copyMenu.tap();
  513 |     await expect(unknown.getByRole('alert')).toContainText(
  514 |       'Check My files before making another copy.',
  515 |     );
  516 |     await expect(unknown.getByRole('button', { name: 'Make a copy', exact: true })).toHaveCount(0);
  517 |     expect(uncertainPosts).toBe(1);
  518 |     expect(uncertainCopy?.id).toBeTruthy();
  519 |     expect(
```