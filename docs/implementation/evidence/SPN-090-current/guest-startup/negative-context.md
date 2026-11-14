# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: startup-lifecycle.spec.ts >> guest startup reporting ends when a ready guest mounts after slow app code
- Location: e2e/startup-lifecycle.spec.ts:80:1

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  getByRole('status').filter({ hasText: /^Still starting:/ })
Expected: 0
Received: 1
Timeout:  5000ms

Call log:
  - Expect "toHaveCount" getByRole('status').filter({ hasText: /^Still starting:/ }) with timeout 5000ms
  - waiting for getByRole('status').filter({ hasText: /^Still starting:/ })
    14 × locator resolved to 1 element
       - unexpected value "1"

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e4]:
    - banner [ref=e5]:
      - generic "Spinel" [ref=e6] [cursor=pointer]:
        - img "Spinel" [ref=e7]
      - generic [ref=e32]:
        - status "Connection status" [ref=e33]: Online
        - button "Online — connected to Spinel" [ref=e34] [cursor=pointer]
      - radiogroup "Appearance" [ref=e39]:
        - radio "Follow system" [checked] [ref=e40] [cursor=pointer]
        - radio [checked] [aria-hidden] [ref=e43]
        - radio "Light" [ref=e44] [cursor=pointer]
        - radio [aria-hidden] [ref=e47]
        - radio "Dark" [ref=e48] [cursor=pointer]
        - radio [aria-hidden] [ref=e51]
    - complementary "Space contents" [ref=e52]:
      - button "Collapse navigation" [ref=e54] [cursor=pointer]
      - navigation "Pages" [ref=e57]:
        - heading "Shared timer fixture" [level=2] [ref=e58]:
          - generic [aria-hidden] [ref=e59]: 🪷
          - text: Shared timer fixture
        - region "Space pages" [ref=e60]:
          - list
          - paragraph [ref=e61]: No pages yet.
    - main [ref=e62]:
      - generic [ref=e63]:
        - generic [ref=e75]:
          - paragraph [ref=e76]: Space · Shared timer fixture
          - heading "Shared timer fixture" [level=1] [ref=e77]
        - generic [ref=e78]: View only
        - generic [ref=e79]: Guest
      - generic [ref=e80]:
        - heading "This Space is empty" [level=2] [ref=e92]
        - paragraph [ref=e93]: Pages will appear here when an editor adds them.
  - status [ref=e94]: "Still starting: styles (15 s)"
```

# Test source

```ts
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
  108 |       page.getByRole('heading', { name: 'This Space is empty', exact: true }),
  109 |     ).toBeVisible();
  110 |     await expect(
  111 |       page.getByRole('heading', { name: 'Shared timer fixture', exact: true, level: 1 }),
  112 |     ).toBeVisible();
> 113 |     await expect(slowLine(page)).toHaveCount(0);
      |                                  ^ Error: expect(locator).toHaveCount(expected) failed
  114 |     await reporterCleared(page, true);
  115 |     await beyondDeadline(page);
  116 |     await expect(slowLine(page)).toHaveCount(0);
  117 |   } finally {
  118 |     release();
  119 |   }
  120 | });
  121 | 
  122 | for (const state of ['unavailable', 'revoked', 'unsupported'] as const) {
  123 |   test(`guest startup reporting ends for ${state} entry`, async ({ page }) => {
  124 |     if (state === 'unsupported')
  125 |       await page.addInitScript(() => {
  126 |         Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
  127 |       });
  128 |     await page.route('**' + guestPath, (route) =>
  129 |       route.fulfill({ status: state === 'revoked' ? 404 : 503, json: {} }),
  130 |     );
  131 |     await page.goto('/share/' + id + (state === 'unsupported' ? '#timer-fixture' : ''));
  132 |     if (state === 'unsupported')
  133 |       await expect(page.getByRole('alert')).toHaveText(
  134 |         'Open this link in a current browser that supports Web Locks.',
  135 |       );
  136 |     else
  137 |       await expect(
  138 |         page.getByRole('heading', {
  139 |           name: state === 'revoked' ? 'This link no longer works.' : "You're offline",
  140 |           exact: true,
  141 |         }),
  142 |       ).toBeVisible();
  143 |     await reporterCleared(page, true);
  144 |     await beyondDeadline(page);
  145 |     await expect(slowLine(page)).toHaveCount(0);
  146 |   });
  147 | }
  148 | 
  149 | test('account startup reporting remains live while actual admission is pending', async ({
  150 |   page,
  151 | }) => {
  152 |   let requested!: () => void;
  153 |   const sessionRequested = new Promise<void>((resolve) => {
  154 |     requested = resolve;
  155 |   });
  156 |   await page.route('**/api/auth/session', () => {
  157 |     requested();
  158 |   });
  159 |   await page.goto('/sign-in');
  160 |   await sessionRequested;
  161 |   await beyondDeadline(page, 9000);
  162 |   await expect(slowLine(page)).toContainText('Still starting: sign-in check');
  163 |   await reporterCleared(page, false);
  164 | });
  165 | 
```