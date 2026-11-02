# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: access-upgrade.spec.ts >> doc viewer gains editing at the same native position, then downgrade still locks it
- Location: e2e/access-upgrade.spec.ts:19:3

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator:  locator('.editor-access')
Expected: "Can edit"
Received: "View only"
Timeout:  5000ms

Call log:
  - Expect "toHaveText" locator('.editor-access') with timeout 5000ms
  - waiting for locator('.editor-access')
    14 × locator resolved to <span class="editor-access">View only</span>
       - unexpected value "View only"

```

```yaml
- text: View only
```

# Test source

```ts
  45  |     page.on('pageerror', (error) => errors.push(error.message));
  46  |     let navigations = 0;
  47  |     let navigationCount: number | undefined;
  48  |     let upgradedInMs: number | undefined;
  49  |     page.on('framenavigated', (frame) => {
  50  |       if (frame === page.mainFrame()) navigations++;
  51  |     });
  52  |     const headers = { Origin: baseURL! };
  53  |     const create = async (
  54  |       kind: 'doc' | 'sheet' | 'folder',
  55  |       name: string,
  56  |       parentId: string | null,
  57  |     ) => {
  58  |       const response = await control.request.post('/api/items', {
  59  |         headers,
  60  |         data: { kind, name, parentId },
  61  |       });
  62  |       expect(response.status(), await response.text()).toBe(201);
  63  |       return (await response.json()).item as WorkspaceItem;
  64  |     };
  65  |     try {
  66  |       const folder = await create('folder', 'Upgrade plans', null);
  67  |       const item = await create(kind, `Shared ${kind}`, folder.id);
  68  |       const grant = async (role: 'viewer' | 'editor' | 'admin' | null) => {
  69  |         const response = await control.request.put(`/api/items/${folder.id}/sharing`, {
  70  |           headers,
  71  |           data: { userId: viewer.id, role },
  72  |         });
  73  |         expect(response.status(), await response.text()).toBe(200);
  74  |       };
  75  |       const contentPath = `/api/items/${item.id}/${kind}`;
  76  |       const read = async () => {
  77  |         const response = await control.request.get(contentPath);
  78  |         expect(response.status(), await response.text()).toBe(200);
  79  |         return (await response.json()) as {
  80  |           revision: number;
  81  |           snapshot: IDocumentData & IWorkbookData;
  82  |         };
  83  |       };
  84  |       if (kind === 'doc') {
  85  |         const text = 'Alpha Beta Gamma';
  86  |         const snapshot = getDocsEmptySnapshot(
  87  |           item.id,
  88  |           LocaleType.EN_US,
  89  |           item.name,
  90  |           DocumentFlavor.MODERN,
  91  |         );
  92  |         snapshot.body = {
  93  |           ...snapshot.body,
  94  |           dataStream: text + '\r\n',
  95  |           paragraphs: [{ startIndex: text.length, paragraphId: createParagraphId(new Set()) }],
  96  |           sectionBreaks: [{ startIndex: text.length + 1, sectionId: createSectionId(new Set()) }],
  97  |         };
  98  |         expect(validateDocumentStructure(snapshot)).toEqual([]);
  99  |         const seeded = await control.request.put(contentPath, {
  100 |           headers,
  101 |           data: { snapshot, revision: 0, writeId: randomUUID() },
  102 |         });
  103 |         expect(seeded.status(), await seeded.text()).toBe(200);
  104 |       }
  105 |       await grant('viewer');
  106 |       await page.goto(`/?item=${item.id}`);
  107 |       const region = page.getByRole('region', {
  108 |         name: kind === 'doc' ? 'Doc document' : 'Sheet document',
  109 |         exact: true,
  110 |       });
  111 |       const status = region.getByRole('status', { name: 'Save status', exact: true });
  112 |       await expect(status).toHaveText('View only.', { timeout: 30_000 });
  113 |       await expect(region.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled();
  114 |       const canvas =
  115 |         kind === 'doc'
  116 |           ? region.getByLabel('Document canvas', { exact: true })
  117 |           : region.locator('canvas[id^="univer-sheet-main-canvas_"]');
  118 |       await expect(canvas).toBeVisible();
  119 |       const mounted = (await canvas.elementHandle())!;
  120 |       const input = page.locator('[contenteditable="true"][data-u-comp="editor"]');
  121 |       const nameBox = region.locator('[data-u-comp="defined-name"] input');
  122 |       if (kind === 'doc') {
  123 |         await page.locator('.univer-container').click({ position: { x: 130, y: 200 } });
  124 |         await input.focus();
  125 |         await page.keyboard.press('Control+Home');
  126 |         for (let step = 0; step < 6; step++) await page.keyboard.press('ArrowRight');
  127 |         for (let step = 0; step < 4; step++) await page.keyboard.press('Shift+ArrowRight');
  128 |         await page.evaluate(() => navigator.clipboard.writeText('not-the-selection'));
  129 |         await page.keyboard.press('Control+c');
  130 |         await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('Beta');
  131 |       } else {
  132 |         await nameBox.fill('D8');
  133 |         await nameBox.press('Enter');
  134 |         await expect(nameBox).toHaveValue('D8');
  135 |       }
  136 |       const focused = await page.evaluateHandle(() => document.activeElement);
  137 |       const before = await read();
  138 |       navigationCount = navigations;
  139 |       const start = Date.now();
  140 |       await grant(kind === 'doc' ? 'editor' : 'admin');
  141 |       // The access scan is already running. Cold startup is excluded from the
  142 |       // ticket's requirement that an open viewer picks up a role in a few seconds.
  143 |       await expect(status).toHaveText('All changes saved.', { timeout: 5_000 });
  144 |       upgradedInMs = Date.now() - start;
> 145 |       await expect(page.locator('.editor-access')).toHaveText(
      |                                                    ^ Error: expect(locator).toHaveText(expected) failed
  146 |         kind === 'doc' ? 'Can edit' : 'File admin',
  147 |       );
  148 |       if (kind === 'sheet')
  149 |         await expect(page.getByRole('button', { name: `Rename ${item.name}`, exact: true })).toBeVisible();
  150 |       expect(await canvas.evaluate((node, original) => node === original, mounted)).toBe(true);
  151 |       expect(navigations).toBe(navigationCount);
  152 |       expect(await page.evaluate((previous) => document.activeElement === previous, focused)).toBe(
  153 |         true,
  154 |       );
  155 |       await expect(region.getByRole('button', { name: 'Bold', exact: true })).toBeEnabled();
  156 |       if (kind === 'sheet') await expect(nameBox).toHaveValue('D8');
  157 |       // Do not reselect, refocus or click after the grant. The existing selection
  158 |       // must decide where the first newly authorized native input is applied.
  159 |       await page.keyboard.insertText(kind === 'doc' ? 'Delta' : '7301');
  160 |       if (kind === 'sheet') await page.keyboard.press('Enter');
  161 |       await expect
  162 |         .poll(async () => {
  163 |           const { snapshot } = await read();
  164 |           return kind === 'doc'
  165 |             ? snapshot.body!.dataStream
  166 |             : snapshot.sheets[snapshot.sheetOrder[0]].cellData?.[7]?.[3]?.v;
  167 |         })
  168 |         .toBe(kind === 'doc' ? 'Alpha Delta Gamma\r\n' : 7301);
  169 |       await expect(status).toHaveText('All changes saved.');
  170 |       const committed = await read();
  171 |       expect(committed.revision).toBeGreaterThan(before.revision);
  172 |       if (kind === 'sheet')
  173 |         expect(
  174 |           committed.snapshot.sheets[committed.snapshot.sheetOrder[0]].cellData?.[0]?.[0],
  175 |         ).toBeUndefined();
  176 | 
  177 |       await grant(kind === 'doc' ? 'viewer' : null);
  178 |       await expect(status).toContainText('Access changed', { timeout: 10_000 });
  179 |       await expect(region.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled();
  180 |       await page.keyboard.insertText('Rejected after access loss');
  181 |       await page.keyboard.press('Enter');
  182 |       const refused = await context.request.put(contentPath, {
  183 |         headers,
  184 |         data: { snapshot: committed.snapshot, revision: committed.revision, writeId: randomUUID() },
  185 |       });
  186 |       expect(refused.status()).toBe(kind === 'doc' ? 403 : 404);
  187 |       expect((await context.request.get(contentPath)).status()).toBe(kind === 'doc' ? 200 : 404);
  188 |       expect(await read()).toEqual(committed);
  189 |       expect(await canvas.evaluate((node, original) => node === original, mounted)).toBe(true);
  190 |       expect(navigations).toBe(navigationCount);
  191 |       expect(errors).toEqual([]);
  192 |     } finally {
  193 |       try {
  194 |         const observed = await page
  195 |           .evaluate(() => ({
  196 |             status: document.querySelector('[aria-label="Save status"]')?.textContent,
  197 |             focus: document.activeElement?.outerHTML,
  198 |             selection: window.getSelection()?.toString(),
  199 |           }))
  200 |           .catch((error) => ({ error: String(error) }));
  201 |         await writeFile(
  202 |           info.outputPath('sync-diagnostics.json'),
  203 |           JSON.stringify(
  204 |             {
  205 |               kind,
  206 |               upgradedInMs,
  207 |               navigationCount,
  208 |               navigations,
  209 |               errors,
  210 |               observed,
  211 |               outgoing: network.outgoing,
  212 |               incoming: network.incoming,
  213 |             },
  214 |             null,
  215 |             2,
  216 |           ),
  217 |         );
  218 |       } finally {
  219 |         await control.close();
  220 |         database.close();
  221 |       }
  222 |     }
  223 |   });
  224 | 
```