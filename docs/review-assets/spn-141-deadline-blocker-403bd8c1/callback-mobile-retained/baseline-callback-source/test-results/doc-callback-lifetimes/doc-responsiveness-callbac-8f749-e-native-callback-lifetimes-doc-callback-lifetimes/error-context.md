# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: doc-responsiveness-callbacks.spec.ts >> mobile native callback lifetimes
- Location: e2e/doc-responsiveness-callbacks.spec.ts:103:3

# Error details

```
Test timeout of 420000ms exceeded.
```

```
Error: Callback observation timedOut.
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - generic [ref=e5]:
      - link [ref=e6] [cursor=pointer]:
        - /url: /
        - img "Spinel" [ref=e8]
      - generic [ref=e33]:
        - status "Connection status" [ref=e34]: Online
        - button "Online — connected to Spinel" [ref=e35] [cursor=pointer]
    - button "Browse files" [ref=e38] [cursor=pointer]
    - generic [ref=e40]:
      - radiogroup "Appearance" [ref=e42]:
        - radio "Follow system" [checked] [ref=e43] [cursor=pointer]
        - radio [checked] [aria-hidden] [ref=e46]
        - radio "Light" [ref=e47] [cursor=pointer]
        - radio [aria-hidden] [ref=e50]
        - radio "Dark" [ref=e51] [cursor=pointer]
        - radio [aria-hidden] [ref=e54]
      - link "Your profile" [ref=e55] [cursor=pointer]:
        - /url: /profile
  - main [ref=e63]:
    - region "Your files" [ref=e64]:
      - generic [ref=e65]:
        - heading "My files" [level=1] [ref=e66]
        - generic [ref=e67]:
          - button "More actions for My files" [ref=e68] [cursor=pointer]: ···
          - button "New" [ref=e69] [cursor=pointer]
      - region "Search your workspace" [ref=e70]:
        - generic [ref=e71]:
          - generic [ref=e72]:
            - generic [ref=e73]:
              - text: Search files
              - searchbox "Search files" [ref=e74]
            - button "Search options" [ref=e75] [cursor=pointer]
            - radiogroup "File view" [ref=e76]:
              - radio "List" [checked] [ref=e77] [cursor=pointer]
              - radio [checked] [aria-hidden] [ref=e79]
              - radio "Grid" [ref=e80] [cursor=pointer]
              - radio [aria-hidden] [ref=e86]
          - group [ref=e87]:
            - generic "Search help" [ref=e88] [cursor=pointer]
        - paragraph [ref=e89]:
          - text: "Searching:"
          - strong [ref=e90]: All accessible files
      - list "Folder contents" [ref=e92]:
        - listitem [ref=e93]:
          - button "Sustained typing Doc" [ref=e94] [cursor=pointer]:
            - generic [aria-hidden] [ref=e96]: 🍀
            - generic [ref=e97]:
              - strong [ref=e98]: Sustained typing
              - generic [ref=e99]:
                - generic [ref=e100]: Doc
                - generic [ref=e111]: Owner
          - time [ref=e113]: 11/5/2026
          - button "More actions for Sustained typing" [ref=e115] [cursor=pointer]: ···
        - listitem [ref=e116]:
          - button "Trash Recently deleted files" [ref=e117] [cursor=pointer]:
            - generic [ref=e122]:
              - strong [ref=e123]: Trash
              - generic [ref=e124]: Recently deleted files
```

# Test source

```ts
  11  | import { attributeDocCallbackSources } from './doc-responsiveness-callback-sources.ts';
  12  | import {
  13  |   DOC_CALLBACK_TRACE_SETTINGS,
  14  |   DOC_CALLBACK_TRACE_STORAGE,
  15  |   readDocCallbackTrace,
  16  |   retainDocCallbackTrace,
  17  | } from './doc-responsiveness-callback-trace.ts';
  18  | import { fixture, focusEmptyDoc, exactText, saved, online } from './doc-responsiveness-fixture.ts';
  19  | import {
  20  |   callbackProgress,
  21  |   persistCallbackManifest,
  22  |   settleCallbackObservation,
  23  | } from './doc-responsiveness-callback-progress.ts';
  24  | import type { CallbackObservation } from './doc-responsiveness-callback-progress.ts';
  25  | import { observeInput, readDocResponsiveness } from './doc-responsiveness.ts';
  26  | 
  27  | // Separate traced observations preserve all existing unprofiled SPN-108 gates.
  28  | const paragraphs = Array.from(
  29  |   { length: 16 },
  30  |   (_, index) =>
  31  |     `Line ${index + 1}: Read the whole paragraph, including the far right edge. ` +
  32  |     'Keep the original page size and all of this text when navigating.',
  33  | );
  34  | const expectedText = paragraphs.join('\r') + '\r\n';
  35  | const expectedKeydowns = 2086;
  36  | const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
  37  | const baseline = process.env.SPN113_BASELINE === '1';
  38  | const categories = DOC_CALLBACK_TRACE_SETTINGS.traceConfig.includedCategories;
  39  | const harnessPaths = [
  40  |   'e2e/doc-responsiveness-callbacks.spec.ts',
  41  |   'e2e/doc-responsiveness-callback-sources.ts',
  42  |   'e2e/doc-responsiveness-callback-trace.ts',
  43  |   'e2e/doc-responsiveness-callback-progress.ts',
  44  |   'e2e/doc-responsiveness-fixture.ts',
  45  |   'e2e/doc-responsiveness.ts',
  46  |   'scripts/ci/doc-callback-lifetimes.ts',
  47  |   'web/docResponsivenessEvidence.ts',
  48  |   'src/ui/docIdleEpisode.ts',
  49  |   'src/ui/nativeDocFlush.ts',
  50  |   'playwright.config.ts',
  51  |   'package-lock.json',
  52  | ];
  53  | 
  54  | interface SelectionEvidence {
  55  |   unitId: string;
  56  |   start?: number;
  57  |   end?: number;
  58  |   anchor: { visible: boolean; width: number; height: number } | null;
  59  |   scale: { x: number; y: number };
  60  |   commands: Array<{ id: string; unitId?: string; zoomRatio?: number }>;
  61  | }
  62  | 
  63  | async function selection(page: Page) {
  64  |   return page.evaluate(() => {
  65  |     let result: SelectionEvidence | null = null;
  66  |     const receive = (event: Event) => {
  67  |       result = (event as CustomEvent<SelectionEvidence>).detail;
  68  |     };
  69  |     window.addEventListener('spinel-doc-selection-evidence', receive);
  70  |     try {
  71  |       window.dispatchEvent(new Event('spinel-doc-selection-read'));
  72  |     } finally {
  73  |       window.removeEventListener('spinel-doc-selection-evidence', receive);
  74  |     }
  75  |     return result;
  76  |   }) as Promise<SelectionEvidence | null>;
  77  | }
  78  | 
  79  | const observations = new Map<TestInfo, CallbackObservation>();
  80  | // Playwright runs this even when its deadline interrupts the test body. No page
  81  | // request or async trace collection can prevent this terminal checkpoint.
  82  | // Playwright requires a destructured fixture argument; this hook needs no browser request.
  83  | // oxlint-disable-next-line no-empty-pattern
  84  | test.afterEach(async ({}, info) => {
  85  |   const observation = observations.get(info);
  86  |   if (!observation) return;
  87  |   try {
  88  |     if (info.status !== 'passed') {
  89  |       // This reduces the separate teardown allowance, never extends acceptance.
  90  |       info.setTimeout(30_000);
  91  |     }
  92  |     await settleCallbackObservation(observation, info.status ?? 'unknown');
  93  |   } finally {
  94  |     observation.detach();
  95  |     observations.delete(info);
  96  |   }
  97  |   if (info.status === 'passed' && observation.progress.persistenceFailure)
  98  |     throw new Error('Callback progress evidence could not be persisted.');
  99  | });
  100 | 
  101 | test.describe.configure({ retries: 0, mode: 'default' });
  102 | for (const preset of ['desktop', 'mobile'] as const)
  103 |   test(`${preset} native callback lifetimes`, async ({ browser, baseURL }, info) => {
  104 |     test.setTimeout(420_000);
  105 |     const progress = callbackProgress(info.outputPath('spn134-progress.json'));
  106 |     const controller = new AbortController();
  107 |     const observation: NonNullable<ReturnType<typeof observations.get>> = {
  108 |       progress,
  109 |       detach: () => {},
  110 |       abort: () =>
> 111 |         controller.abort(new Error(`Callback observation ${info.status ?? 'interrupted'}.`)),
      |                          ^ Error: Callback observation timedOut.
  112 |       interrupt: async () => {},
  113 |     };
  114 |     observations.set(info, observation);
  115 |     const running = (async () => {
  116 |       const mobile = preset === 'mobile';
  117 |       const f = await fixture(browser, baseURL!, info, mobile, controller.signal);
  118 |       let detachPromise: Promise<void> | undefined;
  119 |       let fixtureClosePromise: Promise<void> | undefined;
  120 |       let cdp: Awaited<ReturnType<typeof f.first.newCDPSession>> | undefined;
  121 |       const detachSession = () => {
  122 |         if (!cdp) return Promise.resolve();
  123 |         if (!detachPromise) {
  124 |           progress.phase('cdp-detach');
  125 |           detachPromise = cdp.detach();
  126 |         }
  127 |         return detachPromise;
  128 |       };
  129 |       const closeFixture = () => {
  130 |         if (!fixtureClosePromise) {
  131 |           progress.cleanup();
  132 |           fixtureClosePromise = f.close().then(() => {
  133 |             progress.phase('fixture-cleanup-complete');
  134 |           });
  135 |         }
  136 |         return fixtureClosePromise;
  137 |       };
  138 |       observation.interrupt = () => Promise.allSettled([detachSession(), closeFixture()]);
  139 |       try {
  140 |         // One measured renderer. The existing responsiveness suite separately keeps
  141 |         // all two-editor convergence, Undo/Redo, renewed-input and permission gates.
  142 |         await f.second.close();
  143 |         const page = f.page;
  144 |         const onCrash = () => progress.lifecycle('page-crash');
  145 |         const onPageClose = () => progress.lifecycle('page-close');
  146 |         const onContextClose = () => progress.lifecycle('context-close');
  147 |         const onDisconnected = () => progress.lifecycle('browser-disconnected');
  148 |         page.on('crash', onCrash);
  149 |         page.on('close', onPageClose);
  150 |         f.first.on('close', onContextClose);
  151 |         browser.on('disconnected', onDisconnected);
  152 |         observation.detach = () => {
  153 |           page.off('crash', onCrash);
  154 |           page.off('close', onPageClose);
  155 |           f.first.off('close', onContextClose);
  156 |           browser.off('disconnected', onDisconnected);
  157 |         };
  158 |         const activeCdp = await page.context().newCDPSession(page);
  159 |         cdp = activeCdp;
  160 |         controller.signal.throwIfAborted();
  161 |         let tracing = false;
  162 |         let frameId = '';
  163 |         let failure: unknown;
  164 |         let finishInput: Awaited<ReturnType<typeof observeInput>> | undefined;
  165 |         const output = info.outputPath('spn113-evidence.json');
  166 |         const evidence: Record<string, unknown> = {
  167 |           schema: 1,
  168 |           cleanup: { sessionDetached: false, fixtureClosed: false },
  169 |           role: baseline ? 'baselineObservation' : 'candidate',
  170 |           preset,
  171 |           attempt: info.retry,
  172 |           runner: {
  173 |             run: process.env.GITHUB_RUN_ID ?? null,
  174 |             attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  175 |             name: process.env.RUNNER_NAME ?? 'local',
  176 |           },
  177 |           source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  178 |           dirtyPaths: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  179 |           browser: browser.version(),
  180 |           runtime: process.version,
  181 |           playwright: JSON.parse(
  182 |             await readFile('node_modules/@playwright/test/package.json', 'utf8'),
  183 |           ).version,
  184 |           harnessSha256: Object.fromEntries(
  185 |             await Promise.all(harnessPaths.map(async (path) => [path, hash(await readFile(path))])),
  186 |           ),
  187 |           fixture: {
  188 |             paragraphs: 16,
  189 |             typedCharacters: 2071,
  190 |             enterKeys: 15,
  191 |             nativeKeydowns: expectedKeydowns,
  192 |             nativeTextLength: expectedText.length,
  193 |             sha256: hash(expectedText),
  194 |             input: 'keyboard.type, zero requested delay; Enter between all sixteen paragraphs',
  195 |           },
  196 |           instrumentation: {
  197 |             categories,
  198 |             ...DOC_CALLBACK_TRACE_SETTINGS,
  199 |             storage: DOC_CALLBACK_TRACE_STORAGE,
  200 |             sourceMaps: 'hidden; exact built bundle source content',
  201 |             cpuThrottle: mobile ? 4 : 1,
  202 |             mountedEditors: 1,
  203 |             viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
  204 |             touch: mobile,
  205 |             deviceScaleFactor: 1,
  206 |             playwrightTrace: false,
  207 |             latencyBudgetsEnforced: false,
  208 |             postDisposalMs: 1200,
  209 |             buildFlags: {
  210 |               VITE_DOC_RESPONSIVENESS_EVIDENCE: '1',
  211 |               VITE_DOC_SELECTION_EVIDENCE: '1',
```