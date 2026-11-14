# 🧪 Independent full-outcome review A — SPN-090

Reviewed candidate: `18c3170590c162bebe118a17e4b47d7df40f36ad`.
Actual base: `c525aa933505d6e78b8fdd7a89940d87506d5cb3`.
Reviewer: independent nonimplementing agent `/root/spn090_integrated_a`; **agent review only**.

**Result: 95/100; changes required before validation push.** One P2 product finding and its missing regression protection remain. This score does not clear the strictly-above-95 gate. CI status costs no points. No owner decision or hosted execution is needed to repair the deductions below.

## 🔎 Finding and every step to 100

**P2 — Finish startup reporting for guest entry (3 correctness points).** `web/main.tsx:92` and `:105` start the global startup reporter for all routes. `web/application.tsx:23` renders GuestApp directly for a share route, but the only successful completion call is inside AccountApp (`web/App.tsx:352`). GuestApp never calls it, nor does successful bootstrap. Consequently, after eight seconds a successfully opened guest Doc, Sheet or Space acquires a false fixed `role=status` line, `Still starting: styles (…)`, and its timer continues indefinitely. Failed/revoked guest entry has the same orphaned reporter. This is a new visible regression for the Link guest persona and an ongoing live-region update, independent of network/offline capability.

Local fix: make completion ownership cover the guest entry and all of its settled entry states, or explicitly scope the account diagnostic to the account path while preserving real shared-code startup diagnostics. Avoid clearing account startup prematurely before its actual admission result. Remove both the line and interval on completion. Keep this in SPN-090, because this PR introduced the reporter.

**Regression gap (2 verification points).** `src/ui/startupDeadlines.test.ts:90` exercises manually calling `startupDone`, while `web/StartupStage.stories.tsx:6` creates a fixed display element directly. Neither can detect a missing completion call in the real guest/application wiring. Add the lowest meaningful integration control for actual guest entry ownership: a ready guest remains free of startup reporting after the display deadline; a previously visible slow-start report disappears when guest entry settles; terminal/unavailable guest entry does not leave the timer running. Preserve a control that account admission still reports a truly pending stage. The control must fail with the guest-completion repair removed. This is a local repair; no new broad browser matrix is needed merely to test a timer. If the implementation chooses a browser owner, run the focused existing owner with a bounded negative control.

There are no other point deductions or undisclosed steps to 100 in this review. Recommit the repair and have both reviewers assess the new exact head. Required current-head hosted acceptance remains a separate merge prerequisite, without numerical deduction.

## 📏 Rubric

- Scope and acceptance: **35/35**. Assessed the whole XL outcome, not only the documentation merge. The base ticket explicitly accepts targeted Pixel/Home Screen observations plus shared native/deterministic owners, with reduced physical confidence. The remaining SPN-154 and SPN-156 full pre-launch outcomes are preserved rather than represented as delivered; SPN-156 retains its installed repaired-build observation. SPN-152 remains post-launch. Provider retirement does not erase original failures.
- Correctness, integrity and access: **22/25**. Guest reporter defect above. The changed account fallback, cache and native-lifetime paths otherwise retain conservative authority and persistence checks.
- Regression protection and evidence: **18/20**. Guest completion wiring lacks a detecting control. Exact-content and authority assertions, fail-closed routing and retained negative controls are meaningful; current local controls below pass.
- CI and operational usability: **10/10**. Relevant source/shared paths remain selected; missing, failed, cancelled and skipped selected workers cannot pass aggregates. Provider execution is retired. Runtime resource guards and explicit aborted-check disposition remain usable. No deduction for current or historical CI results.
- Maintainability, documentation and process: **10/10**. The small helpers separate real shared boundaries without new dependencies or speculative APIs. Runtime shell asset hashes, bounded validation and account epoch fencing are justified safeguards. The large historical record is clearly superseded at its top, and source/result identities remain separate. Complete scope stays XL, with the soft size warning acknowledged. Bookkeeping preserves main's IDs and only removes SPN-090 relative to the base.

## 🧬 Independent source and outcome assessment

I read the base ticket using `git show <base>:docs/todo/SPN-090.md`, repository AGENTS, backlog process/runbook and rubric, all four personas, sustainable testing, design playbook, current canonical scope/decisions, phone findings and current repair/integration evidence. I reviewed the entire changed runtime/config/test surface against the actual base, and inspected representative retained native replay, recovery, viewer, alternate-account and exact Space-child assertions.

The packet `full.diff` is independently byte-exact with `git diff --full-index <base> <candidate>`; SHA256 is `170fb55c6532d559bdcb060e1eb2b015e57838f2b4809968fd020a699913a69c`. My hash check verifies all 54 retained candidate inputs, all 16 imported-main inputs and all 12 shared inputs in the integration audit. See `reviewer-a-source-check.json`. The initial diagnostic script accidentally queried a nonexistent `mainInputs` key; it was corrected to `importedMainInputs` and all 16 actual entries verified. No product source changed.

Specific boundaries inspected:

- Navigation's known-offline shortcut and eight-second fallback are confined to account shell routes; guest/invite/setup do not receive a private saved shell. Item request timeout is classified as a network failure. Server 403/404 responses remain authoritative.
- Warm first-list/deep-link opening consults only the prepared account, existing store, persisted catalog and verified available inventory. Account/navigation fences are checked after asynchronous reads, and store handles close in `finally`. Metadata alone does not authorize an unavailable copy.
- Dashboard keeps the admitted native editor mounted through reconnect and incidental metadata/list refresh. Existing native binding owns reconnection and current authority; explicit navigation stays dirty-aware. The new Doc test verifies complete native clipboard content and 403 refusal. The Sheet test retains canvas identity and exact unfinished draft, checks the server remains unchanged until Enter, then checks the acknowledged cell value.
- Installation manifest and 180/192/512 icons are emitted as hash-addressed assets bound into the runtime descriptor. Validation rejects wrong digest, MIME, oversized payload, invalid manifest shape and invalid PNG dimensions. Fixed public aliases do not include account/token URLs; old retained builds keep their original completeness contract. Runtime cache lookup does not create new caches on reads.
- Persistence prompts no longer block download completion. Late answers update only their original still-current result and retain the guide trigger/focus behavior. The prepared download and storage protection remain distinct promises; device copies are not represented as backups.
- Renderer grouping uses one shared actual configuration with nonrecursive dependency capture and strict execution order. Its real pinned-bundler synthetic control tests both the former eager dependency and repaired lazy evaluation order. It is not mislabeled as full native acceptance.
- Retained native owners assert one durable server revision/copy, exact payloads, lost acknowledgements, crash-before-cleanup, rejected folders, viewer no-outbox behavior, wrong-account no-submit/no-exposure, revocation and exact Space-child routing. Their shared fixture cleanup and unchanged ownership are retained; they were read, not freshly executed as browsers by me.
- Bootstrap evidence is opt-in and restricted to bounded public phase/timing values; ordinary PWA checks assert its absence. Native read evidence is opt-in, unit-scoped and removed on disposal. No private production feature is added.
- BrowserStack workflow/implementation removal matches the accepted method. Historical unexplained origin-data loss and recovery 503 remain failures, with no invented causal repair.

## 🔬 Checks actually run by reviewer A

Both commands ran from the exact candidate worktree using `/tmp/spinel-dependabot-2026-11-11/node-v26.13.0-darwin-arm64/bin/node`, the supplied `watch.ts`, shared `scripts/serial.ts`, normal-pressure startup and runtime monitoring, a 2 GiB process-tree cap and eight-minute limit. The workspace package links resolve to candidate-local libs; no install mutation.

1. Vitest, `--cache=false --fsModuleCachePath /tmp/spn090-review18-a-vitest-cache`: `warmCatalog`, `warmOpen`, `startupDeadlines`, `serviceWorker`, `offlineShell`, `offlineProtection`, `offlineRuntime`, `offlineDownload`, `bootstrapFailure`, `appIcon`, `spinelSync`. **208 tests, 11 files passed**; guard elapsed **2,469 ms**, sampled peak **607,808 KiB**, exit 0, no guard reason.
2. Node tests: `desktop-fixture-origin`, `offline-image-pixels`, `bootstrap-evidence`, `renderer-chunks`, `plan`, `coverage-result`. **28 tests passed**; guard elapsed **1,305 ms**, sampled peak **394,752 KiB**, exit 0, no guard reason. These include selected missing/skipped/failed worker and immutable evidence/source rejection.

Exact complete commands are in `spn090-review18-a-unit.json` and `spn090-review18-a-node.json`; output is in `reviewer-a-unit.log` and `reviewer-a-node.log`, all beside this review. I removed only my private module cache. Afterwards memory pressure was 1, the shared lock was absent, and the process audit showed no owned guard/serial/test descendants. I told the manager the slot was released before further read-only review. Tracked status remained clean; the pre-existing untracked `artifacts/` was preserved.

The guest finding was first shared as a concrete issue by reviewer B, without a score. I independently traced the actual production dispatch/completion code and evaluated its effect. B separately ran the actual startupStage module with a synthetic clock/DOM and checked production guest dispatch; its log shows `Still starting: styles (120 s)` and a live interval. This is B-owned supporting evidence (`reviewer-b-guest-probe.ts`, `.log`), not my browser execution. The source call graph and my passing timer tests independently establish why the missing call persists. No prior numerical review assessment was consulted.

I did not repeat the unchanged resource-aborted full compiler or heavy full-application/browser run. The retained compiler resource abort is not a type pass. Prior local native passes and negative controls retain their original source identities and are not relabeled executions on this SHA.

## 🎨 Visual assessment and applicability

I used the image tool to inspect actual retained current startup light/dark/phone images, storage-protection pending dialog light/dark/phone images, and both installed icon PNGs (192 and 512). The 1280×900 startup/storage views and 390×900 phone views retain their original captions and execution identities. Storage text wraps within the phone dialog, controls fit with visible focus, close/guide/Done are clearly discoverable, and the light/dark tokens and semantic hierarchy match the playbook. The startup line uses the intended modest fixed bottom placement. The icon is legible, retains the facet family and has balanced visible spacing at both sizes.

Ten of eleven combined source/capture inputs match their original hashes. I independently inspected the sole runner delta: `scripts/screenshots.ts:588` adds JSON extraction of `[data-native-drawing-capture]` and diagnostic geometry/transition/event fields within `nativeEditorGeometry`. It does not alter startup/storage/icon rendering, screenshot timing or capture operation. Full hosted Storybook still must run its current drawing owner; no whole-build byte identity is claimed.

**Retained screenshot applicability and depicted layout are approved for `18c3170590c162bebe118a17e4b47d7df40f36ad`, agent review only. Overall visual/interaction approval is withheld until the guest startup lifecycle defect is fixed.** The static slow-start story cannot prove that the status disappears on a real guest route. Fresh lifecycle evidence is required for that repair; unchanged storage/icon captures need not be regenerated without a relevant input change.

## 👥 All four personas and remaining acceptance

Operator benefits from bounded startup, public diagnostics, complete source/run provenance and retired paid orchestration without additional services. Owner gains usable offline cold/warm opening, truthful storage feedback and preserved unfinished work. Collaborator retains the same protections with download/read-only, account, share and revocation boundaries; local cached metadata cannot grant server authority. Link guest remains excluded from private offline storage, but currently receives the erroneous perpetual startup status, which is the required repair.

The accepted Pixel 10/latest Chrome/Home Screen observations have unknown exact OS/browser/build identities. The final known-offline sign-in shortcut is not phone-retested, and these notes do not establish every physical edit/image/reopen/replay/creation permutation. I accept that explicitly documented confidence tradeoff under the original base ticket; I do not assign this SHA to those observations or call emulation an installed-phone run.

All seven exact-current-head required hosted gates, selected actual Linux recovery/supervisor acceptance, browser/native content/access/installation owners, ordinary desktop acceptance and complete Storybook remain pending. Original run43548838838's recovery failure and failed-closed aggregates remain failed. SPN-158's prerequisite repair does not retrospectively pass them. These are merge prerequisites, not score deductions, and the review grants neither merge nor deployment approval.
