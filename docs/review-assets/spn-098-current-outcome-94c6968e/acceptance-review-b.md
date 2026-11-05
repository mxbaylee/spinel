# 🔎 SPN-098 current evidence audit B

## Identity and current disposition

Read-only acceptance audit for reviewed source **94c6968e29b57351c548dd5065cb0a61adfad896**, main base **2f442317dd2e1c188ae4a810ac094fd1162a4a2a**, reported tested merge **bc2e8c812c5c67252ddf6889b34d8b0838af1073**, equal tree **ffdc72abd7d46c361ecd75286569f63a828cff84**. Local source tree identity was independently read. Native raw reports identify that source/tested pair; tested merge equality is supplied by the parent's identity verification (the merge object is not present in this checkout, so this audit does not claim a second local tree comparison). CI **42023278283**, native **42023278122** and Storybook **42023278102** are first-attempt runs.

**BLOCKED: CI42023278283 completed with failure in mobile responsiveness and the fail-closed Playwright aggregate. The first-attempt candidate measured131.2ms against the unchanged100ms capacity-flush limit. The retained SPN-098 browser/export, server, native and visual passes remain valid within their scopes; they do not override this required failure. See the terminal addendum below.** This is not permission to merge or to treat pending work as successful. The earlier independent source score remains97/100 on94c; this report does not manufacture a new source grade from CI flags.

No application/browser/native test, rebuild, dependency change or project edit was executed. I inspected raw extracted JSON, the extraction/verifier source and receipt, actual test/assertion source, raw job metadata and unit log. I relied on the parent's retained whole-ZIP digest verification rather than repeat those streams; I did not independently replay the full archive/member checks or re-open all native screenshots. Those limits are distinct from the actual-row checks below.

## 💾 Browser submission and paired SQLite exports

Independently traversed both shard reports in each environment. Each of the four diagnostics journeys has exactly one result, expected status, `passed`, **retry0** in both **development** and **production**:

- Lost acknowledgement, deliberate retry and immutable paired downloads.
- Truncate/flag reset and explicit new submission for a stale report.
- Actual Operator correlated diagnostics download and freshly confirmed generation clear.
- Failed/cancelled download, pending-clear navigation and expired Operator-session handling.

The durable pair attachments are actual rows read from the browser-downloaded SQLite files. `feedbackArtifact` checks download failure, SQLite integrity, manifest and every returned row; the test compares them with the live database selection frozen before the later report and then removes its fixtures. These are not the synthetic Storybook payloads.

For both raw `*-feedback-pair.json` records I independently checked: one initial preparation, retry0, common snapshot/generation/window,2user rows/3system rows, every user row belongs to the selected actor, all user IDs appear in the system set, every system row lies within the inclusive receipt-time window, and the post-snapshot report ID is absent from both. The extra system row belongs to the collaborator. The specific snapshot IDs are development **036e1bb7-2fde-4a6d-8dff-167e6250babd** and production **99b35722-83fe-46f0-93ef-2e7eaceddb1d**. Generation/window/counts agree with the shared preparation and independently inspected test assertions. The lost-ack control verifies exactly one stored report for the repeated ID and a frozen attempted payload.

These browser fixtures are explicitly **feedback-only**: user/system observation counts are zero. They cannot be cited as browser proof of mixed backend/unattributed membership, expired metric retention or every capacity limit. The real server suites own those boundaries. Manifests retain unknown historical completeness, global-process drop-counter scope, retained-snapshot membership and absence of unsent/discarded browser observations. The two downloads preserve that same snapshot despite actual intervening activity.

The production pair's `build: development` is the diagnostics metadata default when no container-image digest is supplied (`src/server/diagnostics/configuration.ts`), not the browser serving mode. The diagnostics fixture passes `development: info.project.name === 'development'`; `startApp` adds `--dev` only for that project. The production project serves the built frontend. Do not label this fixture's build field a deployment-image identity or infer a source SHA from it; source/run provenance is separate.

## 🔐 Current clean-hosted server coverage

The initially empty `unit-remaining-job.log` arrived during review. I read the populated log and confirmed current hosted execution of:

- `feedback.test.ts`:16 passed.
- `feedback-routes.test.ts`:9 passed.
- `feedback-capacity.test.ts`:3 passed.
- `feedback-transfer.test.ts`:3 passed.
- `feedbackContext.test.ts`:3 passed.

The full remaining partition reports **188 files / 2,049 tests passed**. This closes the specifically missing current HTTP-route execution evidence from the local donor installation; it does not rewrite the two failed local installation attempts or the resource-aborted local typecheck into passes. Current Typecheck, Lint and Unit tests metadata are successful. The server tests previously source-reviewed protect actor/session/origin/file authority, exact mixed/unattributed window membership, generation/restart/idempotency, capacity/staging removal recovery and cancellation through destination finalization. This audit relies on those meaningful actual tests and successful execution, not only the aggregate's name.

## 🖥️ Native and visual scope

Raw native JSON shows current source/tested identity, first attempt and terminal pass for Chrome/Firefox/Safari with **37/37/39 stages**. I inspected the actual stage sequence and relevant records: original downloads and image snapshots; offline process stop/relaunch in the same retained profile; pending native edits and clipboard readback; normal reconnect revision/content; recovered conflict copies preserving original content; target storage deletion and both post-loss assertions; terminal browser/driver exit. These are actual macOS ordinary-browser-profile outcomes, not physical phone or installed-PWA acceptance.

Each browser records three profile launches with consistent profile identity, witnessed prior exits and final stop. Safari uses the ordinary hosted user rather than pretending the requested directory is a dedicated Safari profile. Storage deletion records empty worker/cache lists, target account database removed and localStorage0; **UniverLocalStorage and spinel-offline-runtime remain listed**. This is targeted loss behavior, not an assertion that every browser database vanished or the unmerged SPN-141 stricter procedure ran. Post-loss catalogue reports accountnull/available0, and outage opening shows the explicit offline message. Current native success does not waive earlier failures on other sources/tickets.

Storybook42023278102 is terminal success. Independent reviewer A's **agent review only** approval pins94c and24 actual images, current light/dark/phone production components and capture manifests. I read that approval and its image inventory; I did not independently repeat visual inspection or expand its scope. Its caveats must remain: mocked story downloads, geometry editor fixture,390×900 browser phone viewport rather than physical phone, selected24 rather than all96 feedback captures, and below-fold footer reachability not visually inspected after touch scrolling. Actual SQLite acceptance comes from the browser/server evidence above. Publish useful current images with accurate source/theme/viewport/state captions rather than treating old repository captures as this approval.

## 🚦 Remaining gates and retained obligations

At the initial audit checkpoint, CI metadata showed successful existing jobs but **Doc responsiveness (mobile) still in progress** and no completed final Playwright aggregate. This dated checkpoint is superseded by the failed terminal result below. The parent's later observation that baseline finished and candidate started is progress, not acceptance. `verifyCoverage` requires selected work to be exactly successful and rejects missing/failed/skipped selected results or invalid classification/plan. Preserve this fail-closed contract; do not finalize all-seven-gates acceptance until the terminal mobile result, selected-owner evidence and final aggregate agree on this source and immutable plan. No rerun or waiver is proposed here.

SPN-110 remains a separate unmerged TTL owner. Preserve its explicit feedback exemption and the requirement that whichever ticket lands second execute the retained **actual combined expiry/export integration**. Simulated expiry, null observation-age metadata here and green098 do not discharge that future obligation. This is a documented integration boundary, not hidden acceptance deferred from a broken098 implementation.

Before merge, retain final source/check/review identities and all failure dispositions in the canonical PR/immutable evidence; reconcile the final selected matrix, confirm no unresolved review blocker, publish current useful visuals, and run fresh head/base/PR guards. Branch cleanup must follow actual squash and ownership checks. This report does not claim publication, merge or cleanup has occurred.


## ⛔ Terminal first-attempt mobile failure — supersedes pending checkpoint

The completed current run **42023278283**, attempt1, source94c6968e, has exactly two failed jobs in the terminal records: **Doc responsiveness (mobile)127231484521** and **Playwright smoke aggregate127252164305**. Other retained scoped passes remain intact. **Do not merge or publish an all-green receipt. No rerun has been authorized or performed.** The numerical pre-push source review is not retroactively a claim that this selected contract passed.

The finished artifact **13415581418** is retained as `mobile.zip`, **3,083,848 bytes**, independently checked SHA256 **34a6c65ce950be7fafaddc12c707cd4392246a68ff4cfc018acf51e6f1ca3812**, matching both stated artifact size and the completed upload log. I read the reports and relevant metrics directly from this complete ZIP, without parsing the CPU profiles or rerunning the workload. It contains20 original members, including both reports, all eight baseline/candidate metrics, continuation/composition/revocation records, profile/clock artifacts and two first-failure PNGs/error context. The original ZIP remains unchanged; `mobile-plain3-metrics-b.json` is an exact extracted failed metrics member.

Historical baseline has4passed cases. Candidate has6passed and1failed, each with one result/retry0: **mobile sustained native typing plain-3** failed at `e2e/doc-responsiveness.spec.ts:718`, `capacityFlush.max <=100`, observed **131.20000000018626ms**. This was a measured maximum failure, not missing infrastructure, timeout, provider failure or collection failure. The preceding capacity p95 assertion passed. Baseline performance is descriptive (`budgetEnforced=false`), not compliance with candidate limits.

### Raw interval and successful measurements

Failed sample source is tested mergebc2e8c81. All nine retained harness/dependency hashes match the reviewed checkout, and their bytes are identical to base2f442317; the feedback PR does not modify that native timing policy/harness. The sample is unprofiled Chromium, emulated mobile with4×CPU throttle, not a physical-phone measurement. Its fixed native workload is16paragraphs,2071typed characters plus15Enters,2086completed states.

The maximum is capacity flush index12 (zero based), completed state **416**, browser monotonic interval **23639.399999999907 →23770.600000000093ms**. Native records share unit/epoch/generation and report:

- History sequence38:23639.4→23671.5, **32.1ms**, queues32/32→0/32, returned.
- Collaboration sequence39:23671.6→23770.6, **99.0ms**, queues0/32→0/0, returned.
- Pair sequence37: **131.2ms**, queues32/32→0/0, returned.

The same input timeline contains an overlapping **188ms long task** starting23635.3. It corroborates a main-thread interval but does not separate composition work, allocation, GC, JIT or scheduling pauses. The raw failed sample has no CPU profile/whole-runtime trace for that interval; the separately profiled passing sample cannot be substituted as its explanation. No noise, instrumentation defect, feedback cause or historical pause cause is established.

Plain-3capacity p95 is **37.5ms**, input-to-frame p95 **113.6ms**, longest observed task **205ms**; idle duration **1.6ms** belongs to an actual policy-idle native episode flushing6/6states, not a capacity-labelled substitute. The first verified browser-local empty witness is **400.6ms** after the last completed state, within the1s contract. The later read is849.1ms and remains descriptive. Final pending queues are0/0, high-water32/32, final history66undos/0redos and no final reloads. The record reports exact saved/live-peer text, sender/peer selections, Online and requested one-group undo/redo passed. Plain-1 separately owns the full66-group history traversal; its capacity max43.4ms and plain-2max44.1ms passed. The profiled case's48.3ms max is diagnostic, not a replacement for plain-3.

`timingComplete=true` and correctness evidence survive, but **`completed` is absent** for the failed case because the budget assertion stopped successful completion. The body had zero captured application errors and final-native observations; the Playwright report and raw job retain the assertion failure. Do not relabel this as a passed case merely because data integrity succeeded. Fixture/process cleanup follows existing test finally ownership and the job terminates; this audit does not invent a separate per-resource cleanup receipt absent from the failed metrics.

### Ownership and disposition

This is another observed breach of the exact mobile capacity maximum already owned by **SPN-146**. That XL ticket requires finite causal investigation or evidence-supported measurement disposition, preserves every first failure and forbids sample dropping, averaging a maximum away, raised limits or unchanged reruns. No new ticket is needed simply to restate the same contract; register/link this source/run/sample and retained evidence with that existing owner in the blocked checkpoint. The unchanged harness/native files support separation from the feedback implementation, but do not prove that broader application state had zero influence.

Keep SPN-098 draft/open/unmerged until the required selected failure is resolved through its documented owner and a newly justified complete candidate/validation plan. Any later green cannot alone explain or erase131.2ms. Preserve the current browser/server/native/visual passes accurately, SPN-110's second-landing actual expiry regression, the failed mobile artifact and fail-closed aggregate, then publish a truthful blocked archive/body. No further execution, threshold change, source repair or third-party diagnosis is admitted by this evidence audit.
