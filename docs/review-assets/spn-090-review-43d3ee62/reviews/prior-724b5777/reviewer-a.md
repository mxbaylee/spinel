# 🧪 SPN-090 full-outcome revalidation A

Exact reviewed candidate: `724b577791273e0962ff08a38dea77a5aa632d84`.
Actual base: `c525aa933505d6e78b8fdd7a89940d87506d5cb3`.
Prior independently reviewed candidate: `18c3170590c162bebe118a17e4b47d7df40f36ad`.
Independent nonimplementing reviewer: `/root/spn090_integrated_a`. **Agent review only.**

**Result: 100/100; no unresolved findings. Exact-SHA visual/interaction approval granted.** This is source review approval for the complete SPN-090 outcome, not a claim that pending hosted acceptance passed or permission to merge before required gates finish. CI results receive no numerical deductions.

## ✅ Prior findings resolved

The earlier P2 was the global startup reporter continuing indefinitely on every guest route because only AccountApp called `startupDone`. `web/GuestApp.tsx:41` now calls it from an unconditional mount effect, before the capability branch. This is a sound ownership boundary: public code/style startup ends once the guest UI mounts, and its existing loading/unavailable/unsupported/revoked state owns subsequent progress. AccountApp still finishes its reporter after admission. The effect is idempotent under StrictMode, starts no network work, and neither grants authority nor changes persistence/native editor behavior.

The missing detecting regression is resolved by `e2e/startup-lifecycle.spec.ts`. It exercises actual bootstrap → application dispatch → React GuestApp/Space and AccountApp, using deterministic HTTP responses without a native editor. The held application import demonstrates the original production timer actually produces the visible status before mounting. Ready guest mount removes that line and clears its observed browser timer handle; advancing beyond 120 seconds leaves it absent. Unavailable, revoked and unsupported guest entry also clear the reporter. A held actual `/api/auth/session` proves account admission continues to report while pending. The wrappers forward the actual browser callback and handle rather than replacing the implementation with a test model.

I read the complete new production/test delta, canonical decision, receipts, first-failure logs, negative control log/context and actual negative PNG. Restoring pre-repair GuestApp made the ready-guest case fail on the visible startup status remaining after the real empty Space mounted. The negative image shows exactly that contradiction, `Still starting: styles (15 s)` below a usable empty Space. Its test snapshot is retained and hash-matches the recorded pre-type-correction identity; the final DOM Window typing fix changes ambient typing, not this detecting assertion. No negative retry, softened assertion or timeout expansion is claimed.

The two initial fixture failures (phone-only target on a desktop Space and wrong session endpoint), genuine Node/DOM timer overload compiler failure, correction and final successful execution remain explicit. Those dispositions are appropriate and do not conceal an app failure.

**Every step to 100:** completed. There are no remaining point deductions, local repairs, owner-decision requests or hosted-only numerical deductions. Any subsequent source or bookkeeping change still needs exact-head revalidation.

## 📏 Full rubric and outcome assessment

- **35/35 scope and acceptance.** Retains my full original assessment of the base ticket and complete XL outcome: startup/offline shell, public installation assets, prepared-account catalog/deep links, native content and unfinished input, authority/persistence, storage guidance, icon, provider retirement and accumulated physical investigation. The new repair is directly in scope and six production lines, with one narrow browser owner. The current reported 18,169 counted-line soft warning is acknowledged; the small repair does not disguise the full outcome. SPN-154 image paste and SPN-156 editor-independent replay remain complete pre-launch obligations, with SPN-156's own repaired-build installed observation intact. SPN-152 remains post-launch.
- **25/25 correctness/data/access.** The guest lifecycle finding is fixed. Unchanged inspected safeguards remain: prepared account and asynchronous epoch/navigation fences; catalog plus verified copy; denied server responses authoritative; no private guest shell/token cache; retained native editor on reconnect; conservative read-only/action behavior; digest-bound complete runtime assets; scoped late storage replies. The repair adds no authority or storage mutation.
- **20/20 regression protection/evidence.** The missing guest integration control is now meaningful, independently passed, and its unpatched negative detects the original visible failure. Existing exact native text/cell, local/server separation, canvas identity, 403 refusal, pending-write/replay/recovery/account and worker negative controls remain intact. No full physical matrix or packaged run is inferred from the development test.
- **10/10 CI/operations.** Existing source/shared dependency routing and failed-closed aggregates remain unchanged and previously verified. The new spec is owned by existing development and production projects; production adds the distinct packaged import boundary, and no phone/sync duplicate is added. Controlled wall time plus a single tick avoids unnecessary polling work. Shared watchdog/serial ownership remains enforced. CI results are a separate gate.
- **10/10 maintainability/docs/process.** Simple guest mount ownership avoids a global early completion that would hide account admission, and needs no new abstraction/dependency. The browser test is focused on lifecycle rather than costly native editing. Canonical decisions explicitly weigh all personas, preserve failure/source identities and separate historical captures from new execution. Original generated backlog/IDs remain unchanged by this repair.

## 🔬 Independent execution and identity checks

I independently ran all five new development browser cases on exact `724b577791273e0962ff08a38dea77a5aa632d84`, one worker, zero retries. **5 passed**; guard elapsed **6,896 ms**, combined sampled process-tree peak **1,226,304 KiB**, exit 0, no abort reason.

Command environment and execution:

- Working directory: `/Users/mxbaylee/projects/spinel-spn-090-current`.
- Pinned Node: `/tmp/spinel-dependabot-2026-11-11/node-v26.13.0-darwin-arm64/bin/node`, with that directory first on PATH.
- `SPINEL_E2E_PROJECT=development`.
- Supplied `watch.ts spn090-review724-a-browser node node_modules/@playwright/test/cli.js test e2e/startup-lifecycle.spec.ts --project=development --workers=1 --retries=0 --output=/tmp/spn090-review-724b5777/browser-results`.
- Shared `scripts/serial.ts`; normal-pressure preflight and runtime monitoring, unchanged 2 GiB/eight-minute limits. Private output directory preserves prior traces.

Exact receipt: `spn090-review724-a-browser.json`; complete log: `reviewer-a-browser.log`, beside this report. After completion pressure was 1, shared lock absent, and the process audit found no owned server/guard/serial/Playwright/Vite descendants. I released the local slot to the manager immediately. Tracked status stayed clean, pre-existing untracked `artifacts/` was preserved; no source edit, push, PR mutation or package installation occurred.

`reviewer-a-source-check.json` verifies all eight final input hashes from the new receipt, the preserved negative test snapshot and unchanged rendering/story/theme inputs. It records the complete 19-path delta from my previous reviewed head: GuestApp, new lifecycle test, canonical decision and retained evidence only. Full actual-base candidate diff SHA256 is `d12895fdedb5a773d79a0b1c376dc27b39a84dae04b97357d64139b034c63ee1`.

The prior full independent review and receipts remain at `/tmp/spn090-review-18c31705/reviewer-a.md` and its adjacent logs/source check. That review independently verified the full initial diff, 54 retained candidate inputs, 16 imported main inputs and 12 shared inputs; ran **208 Vitest tests in 11 files** and **28 Node controls**; inspected the entire runtime/test/config delta and representative existing native replay, recovery, viewer/account and Space-child contracts. Those executions retain their original SHA. Their unchanged contracts are reused here, not relabeled as fresh current-head runs. The narrow new runtime dependency calls the already-reviewed idempotent startup completion function.

I inspected the implementer's final full-typecheck pass (9,201 ms, 1,685,440 KiB) and final five-browser pass (7,211 ms, 1,415,152 KiB), plus prior first failures. I did not rerun full compilation or unchanged heavy native/browser acceptance. The earlier resource-aborted compiler remains an abort; the new-source compiler pass does not rewrite its history.

## 🎨 Exact-head visual approval

I re-opened all eight retained actual images with the image tool: startup light/dark/phone, storage-protection-pending dialog light/dark/phone, and 192/512 installed icon. I additionally inspected the new unpatched negative PNG. The existing visual findings remain favorable: clear theme-aware text and semantic hierarchy, unclipped phone dialog, fitting controls and visible focus, modest fixed startup line, and recognizable balanced faceted heart. The negative capture is labeled failure evidence, not a proposed design.

Startup line renderer/story, storage component/story/protection, icon/geometry/palette and Storybook inputs still hash-match their applicable retained sources. `scripts/screenshots.ts` remains the sole historical capture-input mismatch: my previous inspection established that it only adds bounded SPN-159 fixture drawing diagnostics inside `nativeEditorGeometry`, changing no startup/storage/icon rendering or capture timing. It has not changed in this repair. No whole-build identity or fresh screenshot execution is inferred; original source/theme/viewport captions stand.

The new behavior removes an erroneous existing line; it introduces no new component, layout, color or copy. Its actual mounted lifecycle evidence now closes the gap the static story could not prove. **I approve the visual and interaction result, including retained image applicability, on `724b577791273e0962ff08a38dea77a5aa632d84`, agent review only.** Full hosted Storybook, including its current native drawing owner, remains required separately.

## 👥 Persona decision and limits

Operator retains bounded startup and complete diagnostics/provenance without paid orchestration or extra services, and now avoids a leaked guest timer. Owner and Collaborator retain truthful asynchronous account admission, saved edits, native unfinished input and authority boundaries. Link guest retains only the linked content and its existing loading/access/revocation UI, with the false perpetual startup announcement removed. No persona's acceptance is traded away by this repair.

Targeted Pixel 10/latest Chrome/Home Screen evidence still has unknown precise OS/browser/build identity. The final known-offline sign-in shortcut remains untested on that phone, and not every physical image/edit/reopen/replay/creation permutation is established. The base ticket expressly accepts these documented limits alongside shared deterministic/native owners; no current SHA or installed-phone claim is attached to this development browser run.

All seven exact-current-head hosted gates and selected Linux recovery/supervisor, native content/access/replay/installation, ordinary desktop and complete Storybook acceptance remain pending. Packaged-production startup lifecycle execution is also pending. Original recovery 503 and failed-closed aggregate records remain failures; integrating SPN-158 does not retroactively pass them. A perfect source-review score does not waive these merge requirements or authorize deployment.
