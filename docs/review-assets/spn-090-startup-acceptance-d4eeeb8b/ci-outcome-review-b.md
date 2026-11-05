# ✅ SPN-090 final ordinary-CI prerequisite review B

The completed evidence satisfies the ordinary-CI prerequisite of the **single changed-build Safari plan** for `d4eeeb8b4871695a0efc9b2c09259cc801784894`. No new blocking finding arose. Dispatch remains conditional on the plan's fresh remote head/base and idle-account guards, and its authored clean-install/type/build/retained-build upload prerequisites before allocation. This is not physical-phone acceptance, authorization for repeated attempts, or merge approval.

## 🔐 Current source and gates

CI `42072843465` completed successfully. `ci-jobs.json` contains exactly 33 jobs, all terminal/success, including every selected owner and all seven required gates:

- Pull request `127405086148`; Backlog `127405675822`.
- Typecheck `127405675882`; Lint `127405675969`.
- Unit tests `127412909830`; Lib tests `127412546189`.
- Playwright smoke aggregate `127427919333`.

The retained run identifies current d4eeeb8b. Checkout logs and mobile evidence identify tested merge `1ac497cddf189165a95d2de5e5875e114fe452e3`. Independent local Git tree comparison confirms source and tested trees both `ee14758d57461c4a79176d6417ed9ce2f00c6058`, on base `2f442317dd2e1c188ae4a810ac094fd1162a4a2a`. No historical source pass is substituted. `ci-outcome-proof-b.json` binds the terminal metadata, inspected logs, source identity receipt and supporting reviews by hash. This review reconciles terminal owners; it does not claim independently rerunning every aggregate or reanalyzing every other owner's raw artifact.

## 🔎 Bootstrap owners actually selected

I inspected current `.github/workflows/ci.yml`, `e2e/sync-client.spec.ts` and `e2e/pwa.spec.ts` against the retained job logs.

`Playwright smoke (sync-production)` job `127405677017` built and tested with `VITE_SYNC_EVIDENCE: 1`. Its log explicitly ran the native-Docs concurrent-text/undo/reconnect/image-UI test at source line 351, and all 98 tests passed. The actual test requires a non-null sanitized bootstrap snapshot, sealed state, no failure, no dropped events, valid clock, and import-end/styles-end/application-start-returned phases. These assertions execute after real app navigation and saved readiness; they are not merely unit tests of the sanitizer. The returned start function is still not independently equivalent to DOM readiness; the test's subsequent real application assertions provide their own evidence.

`Playwright smoke (mobile-https)` job `127405676648` built and tested with `VITE_SYNC_EVIDENCE: 0`. Its log explicitly selected the configured-HTTPS install/touch/offline-page test at `pwa.spec.ts:8`; 10 tests passed and three project-inapplicable cases skipped. The PWA test requires the CI test environment to be explicitly zero and then requires `Object.hasOwn(window, '__spinelBootstrapEvidence')` to be false. Build and test flags are set by the same workflow expression. Thus ordinary-build absence was actually asserted, rather than inferred from a project label or silently bypassed. The three inapplicable cases do not stand in for this required successful test.

## 📱 Independent mobile raw audit

Current mobile responsiveness job `127405676239` passed its first attempt. Artifact `13438489135`, 2,698,898 bytes, SHA-256 `6e27784e4d23a9027af044f9b6de9e0e73e48fc773221251830efa31c3aece75`, matches GitHub artifact metadata. The bounded verifier checked unique safe member paths, ZIP CRCs and all 18 members' bytes/hashes, retaining every member under `mobile/`. It checked all eight metric records, both profile hashes, all nine current harness-file hashes, and all 11 individual test results: four historical baseline and seven candidate tests, each one result, retry zero, passed within its unchanged timeout. The paired comparator records passed/timing-valid, candidate integrity, and no failures or unavailable requirements.

The three primary unprofiled candidate samples have capacity p95/max **29.3/47.7**, **31.5/54.9**, and **34.9/86.9 ms**, within 50/100 ms. Actual terminal idle episodes were **1.6**, **3.4**, and **3.4 ms**, each owned by the six-state policy-idle episode with returned history and collaboration calls. Input-to-frame p95 values were **107**, **107.5**, and **99.9 ms**, within 200 ms; longest tasks **189**, **233**, and **183 ms**, within 500 ms. First verified browser-local drain times were **517**, **556.2**, and **425.1 ms**, within 1,000 ms. Later read upper bounds exceeding 1,000 ms are descriptive and are not substituted for the registered local-drain metric.

Each primary sample retained all 2,086 inputs, 65 full 32-state capacity groups, high-water 32/32, final pending zero and an uninvalidated drain witness. Sender/peer/saved complete text hashes and lengths match the 16-paragraph fixture before history operations and after redo, with the expected sender selection. Plain-1 actually exercises all **66 undo/redo groups**, reaches empty text and 0 undo/66 redo entries, then restores the full saved/peer text and 66 undo/0 redo entries. The other candidate samples exercise one group. Historical baseline observations retain their declared native history-capacity refusal outcome; they do not prove full 66-group undo/redo.

Continuation after the quiet pause passed: request return **188.34 ms**, next-key frame **126.2 ms**, next-key native read **127.6 ms**, and final-original-key to continuation frame/native read **622.7/624.1 ms**, within the unchanged respective bounds. The composition record preserves text/history through composing Enter and records zero pending after final composition. The revocation record retains one held write refused after revocation and no forwarded late write; exact persisted-state/capability assertions belong to the successful current source test. Composition is browser/CDP-generated evidence, explicitly not physical IME coverage. Successful test completion includes the source's awaited fixture-close path; this artifact does not provide an independent system-wide process census.

Proof/helper/log/watchdog: `responsiveness-mobile-proof-b.json`, `audit-mobile-ci-b.ts`, `ci-audit-b.log`, `ci-audit-watchdog-b.json`. The single bounded audit passed first execution in **1,630 ms**, peak **235,888 KiB**, normal memory pressure. No browser, build, converter or provider execution occurred.

## ⚖️ Limits and Safari disposition

The profiled sample is diagnostic, not the primary timing gate. Profile clock brackets are **1,804.3 ms baseline** and **3,141.2 ms candidate**; comparator receipts retain negative/reordered samples and no certain candidate containing-task attribution. Whole-task improvements are not time attributed entirely to a native reducer, and sample variation does not isolate profiler overhead. I did not reparse CPU profiles. These Linux emulated-mobile results do not prove physical Safari startup, native IME, installed-context persistence or the historical blank-sign-in cause; they do not waive SPN-146's distinct unresolved observations.

I read the current independent native/visual reports and source-bound proof: native run `42072843841` passed Chrome/Firefox/Safari on this source/tested identity; Storybook `42072843530` passed all eight applicable jobs with two optional Pages skips. Current light/dark/phone-layout ProtectionPending captures are independently approved **agent review only**, with durable visual archive `d4eb6a943536337ec1b5d170a0316e25e74ac812`. Those reviews' limits, including desktop-native versus physical-phone scope and truncated optional Safari diagnostics, remain intact.

The main-CI pending condition in `safari-plan.md` is now resolved by current evidence. The plan may proceed to its one exact-d4ee Safari-only dispatch after fresh guards; no further user approval is inferred necessary beyond the recorded standing authority. The job must still retain and validate the actual current inspected build before allocation, use its unchanged 15-second navigation/readiness and 240/780-second phase/operation limits, preserve first cause and separately report cleanup. Provider refusal or any failed required phase consumes the attempt and stops it. The owner's provider-limit spending policy remains in force without reinstating a removed estimator or budget gate. Chrome/Firefox phone requirements remain separate; a Safari startup alone would not complete the authored journey or SPN-090.
