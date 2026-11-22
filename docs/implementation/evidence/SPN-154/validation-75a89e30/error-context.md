# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: documents.spec.ts >> native Doc image clipboard >> a completed image upload cannot publish after live edit authority is removed
- Location: e2e/documents.spec.ts:1223:3

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator:  getByRole('status', { name: 'Save status' })
Expected: "View only."
Received: "Loading document…"
Timeout:  5000ms

Call log:
  - Expect "toHaveText" getByRole('status', { name: 'Save status' }) with timeout 5000ms
  - waiting for getByRole('status', { name: 'Save status' })
    2 × locator resolved to <span role="status" aria-live="polite" aria-atomic="true" aria-label="Save status" class="save-announcement">Loading document…</span>
      - unexpected value "Loading document…"

```

```yaml
- status "Save status": Loading document…
```

# Test source

```ts
  1213 |           await f.capture(mode);
  1214 |         }
  1215 |         const saved = await f.read();
  1216 |         await reopen(f, saved);
  1217 |         expect((await f.read()).drawings).toEqual(saved.drawings);
  1218 |         await f.capture('text-first-source-reopened');
  1219 |       });
  1220 |     },
  1221 |   );
  1222 | 
  1223 |   clipboardTest(
  1224 |     'a completed image upload cannot publish after live edit authority is removed',
  1225 |     async ({ browser, baseURL }, info) => {
  1226 |       clipboardTest.setTimeout(60_000);
  1227 |       await withClipboardDoc(
  1228 |         browser,
  1229 |         baseURL!,
  1230 |         info,
  1231 |         async (f) => {
  1232 |           const before = await f.read();
  1233 |           const beforeRevision = await f.revision();
  1234 |           const nativeBefore = (await readEditingSelection(f.page))?.body;
  1235 |           let release!: () => void;
  1236 |           const held = new Promise<void>((resolve) => {
  1237 |             release = resolve;
  1238 |           });
  1239 |           let uploaded: number | undefined;
  1240 |           let storedSource: string | undefined;
  1241 |           let delivered = false;
  1242 |           let deliveryFailed = false;
  1243 |           let clientOutcome: 'finished' | 'failed' | undefined;
  1244 |           const imageRequest = (request: Request) =>
  1245 |             request.method() === 'POST' &&
  1246 |             new URL(request.url()).pathname === `/api/items/${f.id}/images`;
  1247 |           f.page.on('requestfinished', (request) => {
  1248 |             if (imageRequest(request)) clientOutcome = 'finished';
  1249 |           });
  1250 |           f.page.on('requestfailed', (request) => {
  1251 |             if (imageRequest(request)) clientOutcome = 'failed';
  1252 |           });
  1253 |           let finished = false;
  1254 |           await f.page.route(`**/api/items/${f.id}/images`, async (route) => {
  1255 |             const response = await route.fetch();
  1256 |             uploaded = response.status();
  1257 |             storedSource = (await response.json()).url;
  1258 |             await held;
  1259 |             try {
  1260 |               await route.fulfill({ response });
  1261 |               delivered = true;
  1262 |             } catch {
  1263 |               deliveryFailed = true;
  1264 |             } finally {
  1265 |               finished = true;
  1266 |               await response.dispose();
  1267 |             }
  1268 |           });
  1269 |           await withFixtureCleanup(
  1270 |             async () => {
  1271 |               await f.paste('png');
  1272 |               await expect.poll(() => uploaded).toBe(201);
  1273 |               expect(storedSource).toMatch(new RegExp(`^/api/items/${f.id}/images/[a-f0-9]{64}$`));
  1274 |               const stored = await f.image(storedSource!);
  1275 |               expect(storedSource!.endsWith(sha256(stored))).toBe(true);
  1276 |               expect(await sharp(stored).removeAlpha().raw().toBuffer()).toEqual(
  1277 |                 await sharp(f.png).removeAlpha().raw().toBuffer(),
  1278 |               );
  1279 |               await f.downgrade!();
  1280 |               await expect(
  1281 |                 f.page.getByRole('button', { name: 'Bold', exact: true }),
  1282 |               ).toBeDisabled();
  1283 |               await f.capture('live-edit-fence-before-upload-release');
  1284 |               release();
  1285 |               await expect.poll(() => finished).toBe(true);
  1286 |               await expect.poll(() => clientOutcome).toBeDefined();
  1287 |               if (clientOutcome === 'finished') {
  1288 |                 expect(delivered).toBe(true);
  1289 |                 expect(f.posts.map((post) => post.status)).toEqual([201]);
  1290 |               }
  1291 |               await info.attach('late-upload-authority-outcome', {
  1292 |                 body: JSON.stringify({
  1293 |                   serverStatus: uploaded,
  1294 |                   delivered,
  1295 |                   deliveryFailed,
  1296 |                   clientOutcome,
  1297 |                   storedSource,
  1298 |                   storedSha256: sha256(stored),
  1299 |                 }),
  1300 |                 contentType: 'application/json',
  1301 |               });
  1302 |               expect(await f.image(storedSource!)).toEqual(stored);
  1303 |               await expect(f.page.getByRole('status', { name: 'Save status' })).toHaveText(
  1304 |                 /Access changed|View only/,
  1305 |               );
  1306 |               expect(await f.read()).toEqual(before);
  1307 |               expect(await f.revision()).toBe(beforeRevision);
  1308 |               expect((await readEditingSelection(f.page))?.body).toEqual(nativeBefore);
  1309 |               expectNoImages(await f.read());
  1310 |               await f.assertMounted();
  1311 |               await f.capture('late-success-refused');
  1312 |               await f.reload();
> 1313 |               await expect(f.page.getByRole('status', { name: 'Save status' })).toHaveText(
       |                                                                                 ^ Error: expect(locator).toHaveText(expected) failed
  1314 |                 'View only.',
  1315 |               );
  1316 |               expect(await f.read()).toEqual(before);
  1317 |               expect(await f.revision()).toBe(beforeRevision);
  1318 |               expectNoImages(await f.read());
  1319 |               await f.capture('revoked-edit-reopened');
  1320 |             },
  1321 |             async () => {
  1322 |               release();
  1323 |               await f.page.unrouteAll({ behavior: 'wait' });
  1324 |             },
  1325 |           );
  1326 |         },
  1327 |         { collaborator: true },
  1328 |       );
  1329 |     },
  1330 |   );
  1331 | 
  1332 |   clipboardTest(
  1333 |     'phone-width native image failure retains the edit and complete feedback in both themes',
  1334 |     async ({ browser, baseURL }, info) => {
  1335 |       clipboardTest.setTimeout(60_000);
  1336 |       await withClipboardDoc(
  1337 |         browser,
  1338 |         baseURL!,
  1339 |         info,
  1340 |         async (f) => {
  1341 |           const before = await f.read();
  1342 |           await f.page.route(`**/api/items/${f.id}/images`, (route) =>
  1343 |             route.fulfill({ status: 503, body: 'private failure' }),
  1344 |           );
  1345 |           await f.paste('png');
  1346 |           await expect.poll(() => f.posts.map((post) => post.status)).toEqual([503]);
  1347 |           const editor = f.page.getByRole('region', { name: 'Doc document', exact: true });
  1348 |           const alert = editor.getByRole('alert');
  1349 |           await expect(alert).toHaveText('Image upload failed. Check your connection and retry.');
  1350 |           expect((await content(f, before.body!.dataStream)).body).toEqual(before.body);
  1351 |           expectNoImages(await f.read());
  1352 |           await f.assertMounted();
  1353 |           for (const theme of ['light', 'dark'] as const) {
  1354 |             await f.page.emulateMedia({ colorScheme: theme });
  1355 |             await nativeTheme(f.page, editor.getByLabel('Document canvas', { exact: true }), theme);
  1356 |             expect(
  1357 |               await alert.evaluate(
  1358 |                 (node) =>
  1359 |                   node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight,
  1360 |               ),
  1361 |             ).toBe(true);
  1362 |             await info.attach(`spn154-phone-upload-failure-${theme}`, {
  1363 |               body: await f.page.screenshot({ animations: 'disabled' }),
  1364 |               contentType: 'image/png',
  1365 |             });
  1366 |           }
  1367 |           await f.capture('phone-emulation-failure');
  1368 |         },
  1369 |         { mobile: true },
  1370 |       );
  1371 |     },
  1372 |   );
  1373 | 
  1374 |   clipboardTest(
  1375 |     'native image denial and malformed HTML explain failure without changing content',
  1376 |     async ({ browser, baseURL }, info) => {
  1377 |       clipboardTest.setTimeout(60_000);
  1378 |       await withClipboardDoc(browser, baseURL!, info, async (f) => {
  1379 |         const before = await f.read();
  1380 |         const editor = f.page.getByRole('region', { name: 'Doc document', exact: true });
  1381 |         for (const [status, message] of [
  1382 |           [401, 'Your sign-in ended. Sign in again to add an image.'],
  1383 |           [403, 'Image not added. Check your edit access.'],
  1384 |         ] as const) {
  1385 |           // These are controlled HTTP denial responses. Live authority loss has
  1386 |           // a separate real server grant-change case above.
  1387 |           await f.page.route(`**/api/items/${f.id}/images`, (route) =>
  1388 |             route.fulfill({ status, body: 'private proxy detail' }),
  1389 |           );
  1390 |           await f.paste('png');
  1391 |           await expect(editor.getByRole('alert')).toHaveText(message);
  1392 |           expect((await content(f, before.body!.dataStream, 0)).body).toEqual(before.body);
  1393 |           expectNoImages(await f.read());
  1394 |           await f.assertMounted();
  1395 |           await f.capture(`http-${status}-refused`);
  1396 |           await f.page.unrouteAll({ behavior: 'wait' });
  1397 |         }
  1398 |         expect(f.posts.map((post) => post.status)).toEqual([401, 403]);
  1399 |         await f.paste('html', undefined, 'data:image/png;base64,!');
  1400 |         await expect(editor.getByRole('alert')).toHaveText(
  1401 |           'Could not paste. Copy the content and try again.',
  1402 |         );
  1403 |         expect((await content(f, before.body!.dataStream, 0)).body).toEqual(before.body);
  1404 |         expectNoImages(await f.read());
  1405 |         expect(f.posts.map((post) => post.status)).toEqual([401, 403]);
  1406 |         await f.assertMounted();
  1407 |         await f.capture('malformed-image-refused-before-upload');
  1408 |       });
  1409 |     },
  1410 |   );
  1411 | 
  1412 |   clipboardTest(
  1413 |     'denied native clipboard read keeps the edit and offers the system paste action',
```