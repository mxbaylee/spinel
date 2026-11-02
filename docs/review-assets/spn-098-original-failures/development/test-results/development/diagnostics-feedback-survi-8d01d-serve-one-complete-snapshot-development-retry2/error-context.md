# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: diagnostics.spec.ts >> feedback survives a lost acknowledgment and paired user/system downloads preserve one complete snapshot
- Location: e2e/diagnostics.spec.ts:185:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('dialog', { name: 'Feedback diagnostics', exact: true })
Expected substring: "metrics sent to your browser. Check your downloads."
Received string:    "Feedback diagnostics×Private Document OwnerUser metrics include all retained records attributed to this account. System metrics include everyone’s records in the same time span. Submitted feedback is included when present.Another diagnostics export is active. Finish or cancel it, then prepare these downloads again.Download user metricsDownload system metricsPrepare both downloadsClose"
Timeout: 35000ms

Call log:
  - Expect "toContainText" getByRole('dialog', { name: 'Feedback diagnostics', exact: true }) with timeout 35000ms
  - waiting for getByRole('dialog', { name: 'Feedback diagnostics', exact: true })
    74 × locator resolved to <div id="_r_1o_" data-open="" role="dialog" tabindex="-1" class="sp-modal sp-ui" data-base-ui-focusable="" aria-labelledby="base-ui-_r_1q_">…</div>
       - unexpected value "Feedback diagnostics×Private Document OwnerUser metrics include all retained records attributed to this account. System metrics include everyone’s records in the same time span. Submitted feedback is included when present.Another diagnostics export is active. Finish or cancel it, then prepare these downloads again.Download user metricsDownload system metricsPrepare both downloadsClose"

```

```yaml
- dialog "Feedback diagnostics":
  - heading "Feedback diagnostics" [level=2]
  - button "Close dialog": ×
  - paragraph:
    - strong: Private Document Owner
  - paragraph: User metrics include all retained records attributed to this account. System metrics include everyone’s records in the same time span. Submitted feedback is included when present.
  - alert: Another diagnostics export is active. Finish or cancel it, then prepare these downloads again.
  - button "Download user metrics" [disabled]
  - button "Download system metrics" [disabled]
  - button "Prepare both downloads"
  - button "Close"
```

```
Error: page.waitForResponse: Test ended.
```

# Test source

```ts
  175 |       counts: FeedbackPair['counts'];
  176 |       completeRetainedSelection: boolean;
  177 |       historicalCompleteness: string;
  178 |     };
  179 |     return { manifest, rows: database.prepare('SELECT * FROM events ORDER BY id').all() };
  180 |   } finally {
  181 |     database.close();
  182 |   }
  183 | }
  184 | 
  185 | test('feedback survives a lost acknowledgment and paired user/system downloads preserve one complete snapshot', async ({
  186 |   page,
  187 |   context,
  188 |   browser,
  189 | }, info) => {
  190 |   test.setTimeout(180_000);
  191 |   const f = await fixture(browser, context, info);
  192 |   const memberPage = await f.member.newPage();
  193 |   const collaborator = f.auth.createUser('Feedback collaborator');
  194 |   const collaboratorSession = f.auth.createSession(collaborator.id);
  195 |   const other = await browser.newContext({ baseURL: f.origin });
  196 |   await other.addCookies([
  197 |     {
  198 |       name: COOKIE_NAME,
  199 |       value: collaboratorSession.token,
  200 |       url: f.origin.replace('http:', 'https:'),
  201 |       httpOnly: true,
  202 |       secure: true,
  203 |       sameSite: 'Strict',
  204 |     },
  205 |   ]);
  206 |   const otherPage = await other.newPage();
  207 |   const attempts: FeedbackSubmission[] = [];
  208 |   try {
  209 |     const file = await f.create('PRIVATE feedback document title', 'doc');
  210 |     await memberPage.goto(`${f.origin}/?item=${file.id}`);
  211 |     await expect(memberPage.getByRole('status', { name: 'Save status' })).toHaveText(
  212 |       'All changes saved.',
  213 |       { timeout: 30_000 },
  214 |     );
  215 |     let loseAcknowledgment = true;
  216 |     await memberPage.route('**/api/diagnostics/feedback', async (route) => {
  217 |       attempts.push(route.request().postDataJSON() as FeedbackSubmission);
  218 |       if (loseAcknowledgment) {
  219 |         loseAcknowledgment = false;
  220 |         // The real server persists this request. Only its acknowledgment is lost.
  221 |         const saved = await route.fetch();
  222 |         expect(saved.status()).toBe(200);
  223 |         await route.abort('failed');
  224 |       } else await route.continue();
  225 |     });
  226 |     const message = 'The toolbar was slow after opening my document.';
  227 |     const composer = await feedbackComposer(memberPage, message);
  228 |     await composer.getByRole('button', { name: 'Send feedback', exact: true }).click();
  229 |     await expect(composer.getByRole('alert')).toContainText('Sending could not be confirmed.');
  230 |     await expect(composer.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
  231 |       message,
  232 |     );
  233 |     await composer.getByRole('button', { name: 'Cancel', exact: true }).click();
  234 |     await openFeedbackComposer(memberPage);
  235 |     const first = await submittedFeedback(memberPage, true);
  236 |     expect(attempts).toHaveLength(2);
  237 |     expect(attempts[1]).toEqual(attempts[0]);
  238 |     expect(attempts[0].context).toMatchObject({ route: '/files/:id', fileId: file.id });
  239 |     expect(JSON.stringify(attempts[0])).not.toContain(file.name);
  240 |     await composer.getByRole('button', { name: 'Done', exact: true }).click();
  241 | 
  242 |     await otherPage.goto(f.origin);
  243 |     const otherComposer = await feedbackComposer(
  244 |       otherPage,
  245 |       'A collaborator can report an issue too.',
  246 |     );
  247 |     const middle = await submittedFeedback(otherPage);
  248 |     await otherComposer.getByRole('button', { name: 'Done', exact: true }).click();
  249 |     const lastComposer = await feedbackComposer(
  250 |       memberPage,
  251 |       'The problem stopped after reconnecting.',
  252 |     );
  253 |     const last = await submittedFeedback(memberPage);
  254 |     await lastComposer.getByRole('button', { name: 'Done', exact: true }).click();
  255 | 
  256 |     const live = new DatabaseSync(join(f.directory, 'diagnostics.sqlite'));
  257 |     try {
  258 |       expect(
  259 |         live
  260 |           .prepare("SELECT count(*) AS count FROM events WHERE name='feedback' AND id=?")
  261 |           .get(first.id)?.count,
  262 |       ).toBe(1);
  263 |       const stored = live.prepare('SELECT * FROM events WHERE id=?').get(first.id)!;
  264 |       expect(stored.actor_id).toBe(f.owner.id);
  265 |       expect(stored.file_id).toBe(file.id);
  266 |       expect(stored.message).toBe(message);
  267 |       expect(stored.route).toBe('/files/:id');
  268 | 
  269 |       await page.clock.install();
  270 |       await page.goto(`${f.origin}/admin`);
  271 |       const account = page.getByRole('region', { name: `${f.owner.name} account`, exact: true });
  272 |       await expect(account.getByText('Feedback available', { exact: true })).toBeVisible();
  273 |       await expect(page.getByText(message, { exact: true })).toHaveCount(0);
  274 |       await expect(page.getByText(file.name, { exact: true })).toHaveCount(0);
> 275 |       const pairResponse = page.waitForResponse(
      |                                 ^ Error: page.waitForResponse: Test ended.
  276 |         (value) =>
  277 |           value.url().endsWith('/api/admin/diagnostics/feedback/prepare') && value.status() === 200,
  278 |       );
  279 |       const user = await feedbackArtifact(
  280 |         page,
  281 |         join(f.directory, 'feedback-user.sqlite'),
  282 |         async () => {
  283 |           await account
  284 |             .getByRole('button', { name: `Feedback downloads for ${f.owner.name}`, exact: true })
  285 |             .click();
  286 |           await page.getByRole('menuitem', { name: 'Download user metrics', exact: true }).click();
  287 |         },
  288 |       );
  289 |       const pair = (await (await pairResponse).json()) as FeedbackPair;
  290 |       const downloads = page.getByRole('dialog', { name: 'Feedback diagnostics', exact: true });
  291 |       await expect(downloads.getByLabel('Shared time span', { exact: true })).toBeVisible();
  292 |       expect(user.manifest).toMatchObject({
  293 |         snapshotId: pair.id,
  294 |         generation: pair.generation,
  295 |         selectedActorId: f.owner.id,
  296 |         scope: 'user',
  297 |         window: pair.window,
  298 |         completeRetainedSelection: true,
  299 |         historicalCompleteness: 'unknown',
  300 |         rowCount: pair.counts.user,
  301 |       });
  302 |       const expectedUser = live
  303 |         .prepare(
  304 |           'SELECT * FROM events WHERE actor_id=? AND received_at BETWEEN ? AND ? ORDER BY id',
  305 |         )
  306 |         .all(f.owner.id, pair.window.start, pair.window.end);
  307 |       const expectedSystem = live
  308 |         .prepare('SELECT * FROM events WHERE received_at BETWEEN ? AND ? ORDER BY id')
  309 |         .all(pair.window.start, pair.window.end);
  310 |       expect(user.rows).toEqual(expectedUser);
  311 |       expect(user.rows.some((row) => row.id === first.id)).toBe(true);
  312 |       expect(user.rows.some((row) => row.id === last.id)).toBe(true);
  313 |       expect(user.rows.every((row) => row.actor_id === f.owner.id)).toBe(true);
  314 | 
  315 |       // New real activity between the buttons must never alter the prepared pair.
  316 |       const boundary = await (
  317 |         await f.member.request.get(`${f.origin}/api/diagnostics/feedback-context`, {
  318 |           headers: { 'X-Spinel-Diagnostic-Account': f.owner.id },
  319 |         })
  320 |       ).json();
  321 |       const laterId = randomUUID();
  322 |       const later = await f.member.request.post(`${f.origin}/api/diagnostics/feedback`, {
  323 |         headers: { ...f.headers, 'X-Spinel-Diagnostic-Account': f.owner.id },
  324 |         data: {
  325 |           id: laterId,
  326 |           generation: boundary.generation,
  327 |           binding: boundary.binding,
  328 |           message: 'This report arrives after the frozen snapshot.',
  329 |           context: { route: '/files' },
  330 |         },
  331 |       });
  332 |       expect(later.status()).toBe(200);
  333 |       const system = await feedbackArtifact(page, join(f.directory, 'feedback-system.sqlite'), () =>
  334 |         downloads.getByRole('button', { name: 'Download system metrics', exact: true }).click(),
  335 |       );
  336 |       expect(system.manifest).toMatchObject({
  337 |         snapshotId: user.manifest.snapshotId,
  338 |         generation: user.manifest.generation,
  339 |         window: user.manifest.window,
  340 |         scope: 'system',
  341 |         rowCount: pair.counts.system,
  342 |       });
  343 |       expect(system.rows).toEqual(expectedSystem);
  344 |       expect(
  345 |         system.rows.some((row) => row.id === middle.id && row.actor_id === collaborator.id),
  346 |       ).toBe(true);
  347 |       expect(system.rows.some((row) => row.id === laterId)).toBe(false);
  348 |       expect(system.manifest.counts).toEqual(user.manifest.counts);
  349 |       const denied = await other.request.post(
  350 |         `${f.origin}/api/admin/diagnostics/feedback/${pair.id}/download`,
  351 |         { headers: f.headers, data: { scope: 'system' } },
  352 |       );
  353 |       expect(denied.status()).toBe(404);
  354 |       // Exercise the actual expiry UI without keeping a fixture alive for five minutes.
  355 |       // Store/HTTP tests separately advance the server clock and prove server expiry.
  356 |       await page.clock.fastForward(Math.max(0, pair.expiresAt - Date.now()) + 1000);
  357 |       await expect(
  358 |         downloads.getByText('This pair is no longer available.', { exact: false }),
  359 |       ).toBeVisible();
  360 |       await expect(
  361 |         downloads.getByRole('button', { name: 'Download system metrics', exact: true }),
  362 |       ).toBeDisabled();
  363 |       await expect(
  364 |         downloads.getByRole('button', { name: 'Prepare both downloads', exact: true }),
  365 |       ).toBeEnabled();
  366 |     } finally {
  367 |       live.close();
  368 |     }
  369 |   } finally {
  370 |     try {
  371 |       await other.close();
  372 |     } finally {
  373 |       await f.close();
  374 |     }
  375 |   }
```