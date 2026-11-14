# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: startup-lifecycle.spec.ts >> guest startup reporting ends when a ready guest mounts after slow app code
- Location: e2e/startup-lifecycle.spec.ts:80:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: 'Open Space contents', exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('button', { name: 'Open Space contents', exact: true }) with timeout 5000ms
  - waiting for getByRole('button', { name: 'Open Space contents', exact: true })

```

```yaml
- banner:
  - img "Spinel"
  - status "Connection status": Online
  - button "Online — connected to Spinel"
  - radiogroup "Appearance":
    - radio "Follow system" [checked]
    - radio "Light"
    - radio "Dark"
- complementary "Space contents":
  - button "Collapse navigation"
  - navigation "Pages":
    - heading "Shared timer fixture" [level=2]
    - region "Space pages":
      - list
      - paragraph: No pages yet.
- main:
  - paragraph: Space · Shared timer fixture
  - heading "Shared timer fixture" [level=1]
  - text: View only Guest
  - heading "This Space is empty" [level=2]
  - paragraph: Pages will appear here when an editor adds them.
```

# Test source

```ts
  9   |   await page.clock.install();
  10  |   await page.addInitScript(() => {
  11  |     // Bootstrap starts the first one-second interval before importing application.
  12  |     // Track its real browser handle without replacing the production callback.
  13  |     const set = window.setInterval.bind(window);
  14  |     const clear = window.clearInterval.bind(window);
  15  |     const probe = { reporter: null as number | null, cleared: false };
  16  |     Object.assign(window, { startupTimerProbe: probe });
  17  |     window.setInterval = (callback, delay, ...args) => {
  18  |       const handle = set(callback, delay, ...args);
  19  |       if (delay === 1000 && probe.reporter === null) probe.reporter = handle;
  20  |       return handle;
  21  |     };
  22  |     window.clearInterval = (handle) => {
  23  |       if (handle === probe.reporter) probe.cleared = true;
  24  |       clear(handle);
  25  |     };
  26  |   });
  27  | });
  28  | 
  29  | async function reporterCleared(page: Page, cleared: boolean) {
  30  |   await expect
  31  |     .poll(() =>
  32  |       page.evaluate(() => {
  33  |         const probe = (
  34  |           window as unknown as {
  35  |             startupTimerProbe: { reporter: number | null; cleared: boolean };
  36  |           }
  37  |         ).startupTimerProbe;
  38  |         return { started: probe.reporter !== null, cleared: probe.cleared };
  39  |       }),
  40  |     )
  41  |     .toEqual({ started: true, cleared });
  42  | }
  43  | 
  44  | async function beyondDeadline(page: Page, elapsed = 120_000) {
  45  |   // Change wall time, then tick once. Do not exhaust unrelated HTTP deadlines
  46  |   // or replay two minutes of guest polling just to test the startup reporter.
  47  |   await page.clock.setSystemTime((await page.evaluate(() => Date.now())) + elapsed);
  48  |   await page.clock.runFor(1000);
  49  | }
  50  | 
  51  | async function readySpace(page: Page) {
  52  |   await page.route('**' + guestPath, (route) =>
  53  |     route.fulfill({
  54  |       json: { item: { id, kind: 'space', name: 'Shared timer fixture', access: 'viewer' } },
  55  |     }),
  56  |   );
  57  |   await page.route('**/api/guest-spaces/' + id, (route) =>
  58  |     route.fulfill({
  59  |       json: {
  60  |         space: {
  61  |           id,
  62  |           kind: 'space',
  63  |           name: 'Shared timer fixture',
  64  |           parentId: null,
  65  |           spaceId: null,
  66  |           position: null,
  67  |           createdAt: 0,
  68  |           updatedAt: 0,
  69  |         },
  70  |         access: 'viewer',
  71  |         items: [],
  72  |       },
  73  |     }),
  74  |   );
  75  | }
  76  | 
  77  | // This is an actual application -> GuestApp -> Space mount with deterministic
  78  | // HTTP responses. Native editing has its own owners; no SDK editor is needed
  79  | // to verify entry lifecycle, DOM removal and timer disposal.
  80  | test('guest startup reporting ends when a ready guest mounts after slow app code', async ({
  81  |   page,
  82  | }) => {
  83  |   await readySpace(page);
  84  |   let release!: () => void;
  85  |   const gate = new Promise<void>((resolve) => {
  86  |     release = resolve;
  87  |   });
  88  |   let requested!: () => void;
  89  |   const applicationRequested = new Promise<void>((resolve) => {
  90  |     requested = resolve;
  91  |   });
  92  |   await page.route(
  93  |     /\/(?:application\.tsx(?:\?.*)?|assets\/application-[^/]+\.js)$/,
  94  |     async (route) => {
  95  |       requested();
  96  |       await gate;
  97  |       await route.continue();
  98  |     },
  99  |   );
  100 |   try {
  101 |     await page.goto('/share/' + id, { waitUntil: 'commit' });
  102 |     await applicationRequested;
  103 |     await beyondDeadline(page, 9000);
  104 |     await expect(slowLine(page)).toContainText('Still starting: app code');
  105 |     await reporterCleared(page, false);
  106 |     release();
  107 |     await expect(
  108 |       page.getByRole('button', { name: 'Open Space contents', exact: true }),
> 109 |     ).toBeVisible();
      |       ^ Error: expect(locator).toBeVisible() failed
  110 |     await expect(page).toHaveTitle('Shared timer fixture — Spinel');
  111 |     await expect(slowLine(page)).toHaveCount(0);
  112 |     await reporterCleared(page, true);
  113 |     await beyondDeadline(page);
  114 |     await expect(slowLine(page)).toHaveCount(0);
  115 |   } finally {
  116 |     release();
  117 |   }
  118 | });
  119 | 
  120 | for (const state of ['unavailable', 'revoked', 'unsupported'] as const) {
  121 |   test(`guest startup reporting ends for ${state} entry`, async ({ page }) => {
  122 |     if (state === 'unsupported')
  123 |       await page.addInitScript(() => {
  124 |         Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
  125 |       });
  126 |     await page.route('**' + guestPath, (route) =>
  127 |       route.fulfill({ status: state === 'revoked' ? 404 : 503, json: {} }),
  128 |     );
  129 |     await page.goto('/share/' + id + (state === 'unsupported' ? '#timer-fixture' : ''));
  130 |     if (state === 'unsupported')
  131 |       await expect(page.getByRole('alert')).toHaveText(
  132 |         'Open this link in a current browser that supports Web Locks.',
  133 |       );
  134 |     else
  135 |       await expect(
  136 |         page.getByRole('heading', {
  137 |           name: state === 'revoked' ? 'This link no longer works.' : "You're offline",
  138 |           exact: true,
  139 |         }),
  140 |       ).toBeVisible();
  141 |     await reporterCleared(page, true);
  142 |     await beyondDeadline(page);
  143 |     await expect(slowLine(page)).toHaveCount(0);
  144 |   });
  145 | }
  146 | 
  147 | test('account startup reporting remains live while actual admission is pending', async ({
  148 |   page,
  149 | }) => {
  150 |   let requested!: () => void;
  151 |   const sessionRequested = new Promise<void>((resolve) => {
  152 |     requested = resolve;
  153 |   });
  154 |   await page.route('**/api/session', () => {
  155 |     requested();
  156 |   });
  157 |   await page.goto('/sign-in');
  158 |   await sessionRequested;
  159 |   await beyondDeadline(page, 9000);
  160 |   await expect(slowLine(page)).toContainText('Still starting: sign-in check');
  161 |   await reporterCleared(page, false);
  162 | });
  163 | 
```