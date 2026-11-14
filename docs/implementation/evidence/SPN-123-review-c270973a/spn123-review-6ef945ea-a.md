# 🔎 SPN-123 independent full-ticket re-review A

**Candidate:** `6ef945eae3168da7f3706088dc7c2b78fad39cd5`.
**Actual main base:** `ec42f0741415e4e712395fb47c30b911bc4e64ea`.
**Prior source I reviewed:** `cae5a58689b049e4f62c3a815482e21bb5212f49`.
**Worktree:** `/Users/mxbaylee/projects/spinel-spn-123-production`.
**Packet:** `/tmp/spn123-review-packet-6ef945ea`.

I remain a nonimplementing reviewer. This resumes my same full SPN-123 review: I rechecked my concrete ACK finding, inspected the complete actual-base change inventory and current production contracts, reviewed all six changed TypeScript files that differ from my previously reviewed ticket source, and inspected the inherited feedback authority/export implementation at the integration boundary. I used the assessment-free packet for historical documents and reports and did not consult the other reviewer's assessment or unmasked PR/report grades. I made no repository, dependency, cache, PR or remote mutation. This is **agent review only**.

## ✅ Assessment

**100/100. No unresolved source findings or actionable deductions.** My earlier P2 is fixed and regression-protected on this exact candidate. The completed local review permits proceeding through the remaining publication and hosted acceptance gates; it does not establish merge readiness or waive those gates.

- **Scope, 35/35:** The entire original L outcome remains delivered in production seams: document-open, separate local durable save and validated server ACK, search/restore, connection/resync/refresh/queue, offline publication/recovery, native flush/checkpoint/persistence, history, maintenance and runtime. No SPN-123 acceptance is transferred to feedback, TTL or SPN-160.
- **Correctness, 25/25:** The known refused-receipt false success is removed without altering native replay or recovery authority. Current integration preserves exact browser admission, identity/current-access/generation fences, primary/secondary staging ownership and separate deliberate-feedback durability.
- **Meaningful regression coverage, 20/20:** Native negative and genuine-late/duplicate receipt cases exercise actual server history and exact visible/confirmed state. The supplied withheld-guard control detects the original defect. My independent current-head run passes 188 contracts, including feedback/store/route/transfer integration and observation isolation.
- **Delivered workflow/usability, 10/10:** The maintained inventory explains exact timing, sampled counters, loss, local-versus-server durability and frontend-versus-backend claims. Existing generic and paired exports retain their distinct scopes and current authority. No additional UI is needed for this ticket's instrumentation.
- **Maintainability/overcomplexity, 10/10:** The repair adds only three nonmutating consistency predicates to the existing terminal branch. Integration composes existing collector/store/export ownership rather than adding another queue or service. Fixed schema/sampling families, WeakMap group timing, bounded histogram and secondary writer remain justified by the actual seams. No unnecessary abstractions, dependencies or speculative flexibility found.

**Steps to 100:** none remain in the reviewed source and local regression scope. All external/current-head acceptance listed below remains mandatory, with no score deduction for CI results.

## 🧾 Prior P2 disposition and protocol review

At `lib/sync-client/src/client.ts:684-694`, the already-refused branch now requires the ACK revision to advance both the immutable sent request's base and the confirmed revision, and to equal `replayBase + 1` when guarded replay applies. Shape validation and mutation-ID matching remain before that branch. The predicates select diagnostic success versus cancelled/unknown; they do not perform native replay, alter the original refusal reason, or manufacture a failed server save from unknown durability.

The existing terminal behavior still clears the sent request/inflight set and finishes refusal handoff. A valid late durable receipt remains successful exactly once; duplicated delivery cannot emit another result because the request is already cleared. An inconsistent late response cannot emit a successful count or `sync.client.acknowledged`. These are the right minimum chronology checks for the retained immutable request. A refused client no longer has the ordinary replay inbox available, so this narrow repair appropriately avoids inventing a second native-validation/replay path solely for diagnostics.

The added tests in `lib/sync-client/tests/diagnostics.test.ts:312-483` cover three negative boundaries (older, equal-base, and guarded-replay inconsistency) plus four real late receipt combinations (ordinary/guarded and first/duplicate). They retain actual server receipts/history, exact native visible/confirmed snapshots, no native replay, original refusal, once-only diagnostics and no success for uncommitted identity. My independent run included all these tests. The supplied negative-control identity record binds original source `abea200d91a4623ea3cda0146388a26823a545c9e9aa373c484a70725d1eb36a`, repaired/restored source `bd803a83094b51fbe00630f2f7f437cdea872fccda4f6992dc622ff505966fee` and test source `05c571cb6d9e1a02b081b193115487102196b5d99c4e9fadc3f2cf22fb9f42b0`; all three negative cases fail with the original guard withheld. I did not repeat a source-mutating control.

## 🔗 Actual-main and feedback integration

`DiagnosticsStore` initializes both its secondary-writer flag and landed `FeedbackExports` owner. Constructor cleanup at `src/server/diagnostics/store.ts:175` belongs only to the primary application and covers both generic and paired-feedback staging names. A secondary writer neither removes an active primary export at startup nor acquires a pair during shutdown. The strengthened `src/server/diagnostics/supervisor.test.ts` retains both staging files through secondary startup/close, alongside generation fencing, loss accounting and unchanged application data. That test passed in my run.

The automatically merged `src/server/diagnostics/routes.ts` keeps the exact SPN-123 event vocabulary and current file/Space access checks. Deliberate feedback remains a separate synchronous durable operation with session-derived identity, its own binding/rate/idempotency contract and fixed context fields. It cannot be admitted via the lossy browser-event batch. Paired export preparation and transfers continue to require Operator session ownership and current generation; every streamed chunk rechecks authority, and cancellation/truncate invalidates the lease. The secondary writer uses normal bounded observations, not the deliberate feedback API.

Both E2E parent blocks remain intact: SPN-123 production open/search/local-save/server-ACK/native/privacy/admission assertions, and SPN-098 feedback lost-ACK/paired-export/truncation assertions. I independently read/hash-checked eight final source entries from the integration manifest, compared all five exact-main contract files byte-for-byte with actual base, and confirmed both complete E2E insertion blocks are verbatim retained from their identified parents. The block hashes are:

- Production observations: `0d8e42436a358c880c5fb98d20fe2a755f9aca650d0102b97299fa810610b8ac` from repair parent `a37289b48825535a9036dfe17b4f671f7464bd65`.
- Feedback helper/case block: `5279fb08387057ac19677b29f1382ba7d812d37c3d0ba7b21b02952a16bc4bb9` from actual main `ec42f0741415e4e712395fb47c30b911bc4e64ea`.

The exact-main comparisons covered SPN-110's live ticket/canonical handoff, SPN-157's implementation/full contract audit and November 14 grooming. TTL remains unimplemented M work. Only SPN-123 is provisionally completed relative to actual main; completion order `[SPN-098, SPN-123]`, next161, November14 and the CLI-generated 25-ticket index remain consistent.

## 🧭 Complete L outcome and persona judgment

The full actual-base diff is 18,964 counted lines: 11,200 evidence, 1,674 other documentation and 6,090 runtime/test/configuration. I accept the retained cohesive L judgment and soft-limit disposition. The production seams, original failures, bounded repair proofs and their regressions belong to the claimed complete outcome; no size threshold/exclusion or acceptance obligation was relaxed. The integration added no tracing protocol, durable diagnostic queue, service, SDK algorithm or new design.

Original production contracts remain as assessed in my prior source review and preserved in the unchanged files: once-only operation terminals; local transaction durability separated from server receipt; group-derived pending mutation counts and unknown restored/rebased ages; fixed browser schemas and frontend source; current account/session/file/Space/generation fences; guest exclusion; fixed-family sampling and visible losses; bounded fresh verification after rate pressure; original exception preservation for native/persistence failures; no observation-based recovery authority.

Main's incremental PendingBuffer and 16-state/200-history policy remain. The unchanged 70-character lost-ACK regression covers all five actual Undo/Redo groups with selection, peer, server/storage and reopened body checks. The supported opaque-pointer Safari loader preserves main's identity/action/readiness/consent guards. Main's whole-browser storage-quiescence and history account-transition fixtures remain authoritative. The native wrapper measures its original operation before observer work, reports failure in `finally`, and leaves original errors/pending content intact. History/restore, maintenance lifecycle and bounded CPU/event-loop context retain their exact inventory endpoints, units and attribution limits.

All personas remain considered: the Operator receives truthful bounded evidence and protected active downloads; the Owner retains private content and separate durable-save assurances; the Collaborator retains access/current-state/recovery behavior and deliberate feedback durability; Link guests remain outside browser diagnostics and feedback authority. No new visible product design was introduced by this ticket relative to actual main, so I make no additional visual-approval claim. Actual rendering and native/platform acceptance are still required.

## 🧪 My independent current-head execution

The coordinator explicitly granted the sole Mac workload slot after SPN-090 released it. I ran one first-attempt batch, then immediately released the slot. No additional workload, Linux-only maintenance process suite, heavy compiler, install or browser run was launched.

Exact command (working directory `/Users/mxbaylee/projects/spinel-spn-123-production`):

```text
/tmp/spinel-dependabot-2026-11-11/node-v26.13.0-darwin-arm64/bin/node
/tmp/spinel-dependabot-2026-11-11/watch.ts spn123-review-6ef9-a
/tmp/spinel-dependabot-2026-11-11/node-v26.13.0-darwin-arm64/bin/node
node_modules/vitest/vitest.mjs run
--config /tmp/spinel-dependabot-2026-11-11/spn123-vitest.config.ts
--configLoader native --cache=false
lib/sync-client/tests/diagnostics.test.ts
src/server/diagnostics/store.test.ts
src/server/diagnostics/routes.test.ts
src/server/diagnostics/feedback.test.ts
src/server/diagnostics/feedback-routes.test.ts
src/server/diagnostics/feedback-capacity.test.ts
src/server/diagnostics/feedback-transfer.test.ts
src/server/diagnostics/supervisor.test.ts
src/ui/spinelSync.test.ts
src/ui/offlinePersistence.test.ts
```

**188/188 tests passed across 10 files.** Vitest duration **5.05 seconds**; watchdog **5,317 ms**, sampled peak **792,240 KiB**, exit **0**, no signal, no resource-guard reason. Pinned Node26.13.0, candidate-owned workspaces/private config, caching disabled, shared serial lock, normal-pressure requirement, 2 GiB/eight-minute limit and 200 ms watchdog interval were retained.

- Full log: `/tmp/spn123-review-6ef9-a.log`.
- Watchdog receipt: `/tmp/spinel-dependabot-2026-11-11/spn123-review-6ef9-a.json`.

The additional source identity checks only read Git blobs/manifest data; they launched no application/test/compiler and changed no candidate files. Their result: eight source hashes, five exact-main files and two full parent blocks matched. Among the current ticket's changed TypeScript files, only `e2e/diagnostics.spec.ts`, client implementation/tests, diagnostics routes/store and supervisor diagnostic test differ from the previously reviewed source; I inspected each new delta and its integration context.

## 📚 Supplied evidence and limitations

I distinguish my execution above from supplied source-bound evidence: repaired 181/181 contracts, the three expected withheld-guard failures, combined 78/78 contracts, changed lint/format/index checks, and the earlier 166 desktop, 85 sync/native, 286 production, 238 SDK passes plus two existing opt-in timing skips and 18 routing controls. Those earlier runs retain their exact applicability and are not newly executed current-head platform acceptance. Packet-wide verification of 1,469 source copies, 48 decoded artifacts, 1,535 files and all 1,218 TypeScript copies is coordinator-supplied; I did not repeat the exhaustive archive audit.

The repaired-source full TypeScript attempt is explicitly **resource-aborted**, not passed: 4,464 ms, 1,151,040 KiB sampled peak, watchdog resource reason, subsequent pressure2. It was not rerun unchanged. Current type acceptance remains pending in the selected hosted gate; the older type pass is not substituted. First raw-evidence formatting failures are retained, with original bytes archived and corrected checks separately identified.

The refreshed repaired-source overhead sample retains all 14 identical native outcome hashes, off/on medians **0.633128/0.739684 ms per save**, observed delta **+0.106555 ms** with overlapping ranges, and pressure reconciliation **500 =64 admitted +244 queue-overflow +192 transport/cooldown discard**, including the real second-batch429. Its in-process native Sheet/collector boundary excludes browser rendering, real network/SQLite/IDB/setup and feedback export latency; it establishes neither a browser latency bound nor a historical mobile cause.

Exact-head local policy records 200 actual paths, 15 selected suites, 60 rejected invalid selected results and 16 source/shared-input cases. This is source-bound classifier evidence, not hosted execution. Original mobile110.4 ms (and104.2/117.4), JXA conversion, callback timeout, Firefox/history/restore failures, unsupported Linux-process attempt and resource aborts remain preserved with their attribution limits.

## 🚦 Required next gates

No source repair or owner decision is requested by this review. Obtain the other independent exact-head review and preserve both reports/current check identities in maintained evidence or the final PR description. Publication remains subject to root coordination.

All seven current-head hosted gates and actual production diagnostics/export, callback/responsiveness, native Chrome/Firefox/Safari, ordinary browser/Storybook/Spaces, Linux maintenance/operational and sized restore acceptance remain pending. Grades do not convert any of them into passes. A new failure requires preserving its first outcome and a concrete new decision, without an unchanged retry or relaxed bound. Merge still requires all applicable acceptance, up-to-date source and no unresolved blockers, followed by guarded branch cleanup. This report makes no push, merge, cleanup or retrospective acceptance claim.
