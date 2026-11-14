# 🔎 Independent complete SPN-123 review B

Candidate **`6ef945eae3168da7f3706088dc7c2b78fad39cd5`**.
Actual main base **`ec42f0741415e4e712395fb47c30b911bc4e64ea`**.
Date: 2026-11-14. Independent, nonimplementing, **agent review only**.

**100/100. No unresolved source-review finding.** The refused-ACK correctness defect and missing regression are repaired. This complete-outcome review qualifies for the pre-push review gate on this exact SHA. It does not establish hosted acceptance, authorize an uncoordinated push, or approve merging before required gates complete. No points were deducted for CI results, pending hosted acceptance, or the explicitly resource-aborted compiler attempt.

## ✅ Prior finding disposition and current repair

The earlier technical finding was a false `document-save-server-ack` success after a nonpreserving refusal: the terminal branch accepted a shape-valid matched receipt whose revision could not belong to the outstanding immutable request.

At `lib/sync-client/src/client.ts:684–694`, the repaired branch now requires the receipt revision to advance both `this.sent.baseRevision` and `this.revision`, and to equal `replayBase + 1` when guarded replay applies. Inconsistent chronology settles the diagnostic wait as cancelled, emits no acknowledged detail, and retains the existing terminal request clearing and original refusal handoff. It does not replay or mutate a refused replica to collect evidence. The normal ACK path still observes validated durability before local replay, so a subsequent local apply failure does not negate an actual durable receipt.

The seven added native/server fixture cases in `lib/sync-client/tests/diagnostics.test.ts:312–484` cover older/equal-base receipts, an above-base but replay-inconsistent receipt, and actual late/duplicate receipts with guarded and unguarded replay. The negative cases retain real server history with no acceptance of the pending request; the positive cases use actual accepted/retrieved receipts. They assert controlled timing, one result/count, absence or presence of `sync.client.acknowledged`, original refusal, unchanged visible/confirmed native state, actual server content/history and no duplicate completion. All passed independently in my current-head run.

I also inspected the retained withheld-guard negative evidence: three expected failures on exact original client bytes, restoration in `finally`, and matching repaired/restored source hashes. That supplied negative control proves these tests detect the original behavior. I did not rerun a mutating negative experiment in this read-only review. The finding is resolved with no remaining local source or regression step.

## 📏 Full rubric

- **Scope and acceptance — 35/35.** The complete original L outcome remains implemented and owned here: usable open, distinct local persistence/server ACK, search, snapshot restore, connection/resync/refresh/queue, offline publication/recovery, native flush/checkpoint/persistence, history, maintenance and runtime context. Feedback/retention/SPN-160 do not substitute for any of those obligations. Integration and operational/native verification remain part of the outcome rather than hidden follow-ups.
- **Correctness and safety — 25/25.** The ACK finding is resolved. Source inspection and supported contracts retain precise monotonic boundaries, truthful handoff versus ready semantics, once-only completion, original errors, bounded queues/sampling/loss, exact admission, source attribution, account/session/access/generation fences and guest exclusion. Feedback integration preserves separate deliberate-submission authority and primary export ownership.
- **Regression confidence — 20/20.** My exact-head 94-test run covers repaired ACK and native history plus the integrated store/routes/feedback/export/capacity/transfer/supervisor boundaries. Existing whole-ticket evidence and source identities retain the other distinct layers. The new negative cases demonstrably fail with the repair withheld. No required current-source/platform result is represented as supplied by an old pass.
- **Workflow and usability — 10/10.** The inventory explains what timings and sampled counts mean, what loss remains possible, and what local persistence and ACK success prove. The merged guide retains feedback workflow and retention limits. No new visible design differs from actual main, so no additional visual review is needed for this SPN-123 diff; real rendering/interaction/native acceptance remains required.
- **Maintainability and overcomplexity — 10/10.** The solution reuses the existing registry, collector, store and exports, with small optional sinks and fixed bounded vocabularies. Group timing follows actual PendingBuffer identities without durable diagnostic timestamps. The fixed sampling map, one cooldown and secondary maintenance writer solve concrete observed boundaries without generic tracing infrastructure or speculative abstractions. The repair is a localized chronology predicate and focused regressions.

**Every actionable step to 100:** none remains in this source review. No owner exception or hosted-only score deduction is requested. The separate acceptance work below still gates merge.

## 🧪 Independent current-head checks

I verified exact HEAD `6ef945ea…` and an empty `git status --porcelain` before testing. I used the assessment-free complete packet and review delta, not raw archival review reports/grades or the old PR body. Packet source-manifest SHA-256: `92c325bcf36ef23e04ae83c71c5efcfdfa586a3e2f232c4a37b4f75b412e5015`. The coordinator's complete 1,469-copy / 48-decoded / 1,535-file packet audit is supplied evidence; I do not claim to have repeated every binding.

I independently compared all **60 executable `.ts`/`.tsx` paths changed against actual main**: **54 are byte-identical to the previously reviewed `cae5a586…` candidate**. The six changed paths are precisely `e2e/diagnostics.spec.ts`, SyncClient implementation/tests, diagnostic routes/store and supervisor diagnostics tests. I inspected those changes and their integration context, continuing the same full-ticket review rather than narrowing approval to the ACK fix.

After the explicit sole-slot grant, my first supported batch passed **94/94 tests across nine files**, exit **0**, elapsed **5,290 ms**, peak process-tree RSS **822,400 KiB**, guard reason **null**. The slot was released immediately. Exact command:

```text
/tmp/spinel-dependabot-2026-11-11/node-v26.13.0-darwin-arm64/bin/node /tmp/spinel-dependabot-2026-11-11/watch.ts spn123-review-b-6ef945ea /tmp/spinel-dependabot-2026-11-11/node-v26.13.0-darwin-arm64/bin/node node_modules/vitest/vitest.mjs run lib/sync-client/tests/diagnostics.test.ts src/server/diagnostics/routes.test.ts src/server/diagnostics/store.test.ts src/server/diagnostics/supervisor.test.ts src/server/diagnostics/feedback.test.ts src/server/diagnostics/feedback-routes.test.ts src/server/diagnostics/feedback-capacity.test.ts src/server/diagnostics/feedback-transfer.test.ts src/ui/boundedDocHistory.test.ts --config /tmp/spinel-dependabot-2026-11-11/spn123-vitest.config.ts --configLoader native --cache=false
```

Working directory was `/Users/mxbaylee/projects/spinel-spn-123-production`. Pinned Node 26.13.0, candidate `scripts/serial.ts`, pressure level 1, unchanged 2 GiB/eight-minute/200 ms guard, candidate-local workspaces and task-private uncached Vitest were used.

- Log `/tmp/spn123-review-b-6ef945ea.log`, SHA-256 `223e1164d313c992e4bbd406c9fd640d2446a15aec659add5c4f4a098d795ede`.
- Receipt `/tmp/spinel-dependabot-2026-11-11/spn123-review-b-6ef945ea.json`, SHA-256 `e9c3be0e89b0a965e77ef7371822d20ae260c7b7f04cff2921da4ee0e08ee67d`.

No failed attempt or retry occurred in this current-head review run. I did not rerun the Linux-only process-supervisor suite, full compiler, install or browser matrix. My original mistaken Linux suite attempt remains preserved with its platform refusal and owned-group termination; it is not relabelled as a product pass. No repository source, dependency or cache mutation, push or PR metadata edit was performed.

## 🔗 Actual-main integration and full boundary assessment

I independently verified both E2E insertion blocks are retained verbatim from their respective parents:

- SPN-123 production open/search/persistence/ACK/privacy/admission block from `a37289b4…`: SHA-256 `0d8e42436a358c880c5fb98d20fe2a755f9aca650d0102b97299fa810610b8ac`.
- SPN-098 feedback helpers/lost-ACK/paired-download/truncate block from actual main `ec42f074…`: SHA-256 `5279fb08387057ac19677b29f1382ba7d812d37c3d0ba7b21b02952a16bc4bb9`.

The merged fixture imports support both cases and retain isolated databases, identities, contexts and owned cleanup. Source equality is not execution of the browser cases; their current-head hosted owner remains pending.

`DiagnosticsStore` initializes both `secondaryWriter` and main's `FeedbackExports` owner. Startup cleanup of `.diagnostics-export-*` and `.diagnostics-feedback-*` belongs only to the primary app. A secondary writer constructs no export job, so its close only drains its own observations and closes its own handle. The expanded supervisor test checks both staging artifacts at startup and close, generation fencing, process loss records and unchanged application content. It passed independently.

The route merge adds only the explicit SPN-123 event admission to main's integrated routes: the four exact operation names, exact client registry and three explicit resync names. Server runtime/history/maintenance events remain inadmissible from the browser. Main's feedback session binding, deliberate durable idempotent submission, per-actor rate, fresh access checks, operator export ownership, cancellation and transfer fences remain separate. The main feedback export worker, exports and transfer implementations are independently byte-identical to actual main.

Other full-ticket contracts remain as reviewed and source-bound:

- Local save success follows the real checkpoint transaction; no-prepared/read-only skips do not claim a write. Browser/server save observations use distinct names and scopes.
- Queue counts remain native mutation counts, unknown restored/rebased ages stay null, and suppressed cadence checks avoid queue scans. Actual group identity follows main's incremental PendingBuffer. Retry and receipt observations settle once.
- Collection scopes retain initiating account/session/generation; offline/hidden/account transitions discard rather than rebind. Routine samples use fixed families and complete selection bundles; the 429 path visibly drops once and performs bounded fresh verification. These controls never govern edit delivery.
- Native flush observes return or original throw in `finally`; optional sinks cannot replace exceptions. Main's 16-state/200-history policy remains. The unchanged 70-character lost-ACK case verifies all five groups through actual Undo/Redo, selection, peer, server, stored and reopened content; my native-history run covers it.
- History/restore/publication boundaries preserve authorized context and deliberate duplicate classification without invented background-user attribution. Automatic events stay content-free. Metrics do not grant read/write or recovery authority.
- Maintenance still blocks ordinary writes while its bounded internal observation path records phases/drain/refusals and the secondary writer observes verification while the app is stopped. Runtime context uses one bounded histogram and explicit microsecond/nanosecond conversion, with allocation/read/reset/close isolation.
- The opaque-pointer Safari loader remains combined with current main's identity/revalidation, constructor-only recovery, consent/action/readiness guards. I independently verified main's history account-transition and whole-browser storage-quiescence files are byte-identical to actual main.

The current 18,964 filtered lines comprise 11,200 evidence, 1,674 other documentation and 6,090 runtime/tests/config. The record continues to explain cohesive L scope, historical failures and integration without changing exclusions, thresholds or acceptance. I independently checked `backlog.json`: actual main's `[SPN-098]` becomes `[SPN-098, SPN-123]`, both next IDs are 161 and size rules are equal. SPN-110 ticket/canonical handoff, SPN-157 full audit, and November 14 grooming are byte-identical to actual main. Only SPN-123 is provisionally completed. The CLI-generated 25-ticket index and exact-head policy/selection receipts are supplied evidence, not a merge claim.

## 👥 All four personas

Operator gets bounded, truthful diagnostic outcomes and active exports that survive supervisor startup. Owner keeps explicit local-versus-server save meaning and durable deliberate feedback. Collaborator keeps original refusal handoff, native content/history/access and peer guarantees. Link guest remains excluded from browser collection and feedback authority and retains access/revocation boundaries. The maintained repair/integration decisions weigh all four; no new permission or product UI flow is introduced by this actual-base diff.

## 🚦 Evidence limits and remaining acceptance

The supplied repaired-source checks retain 181 focused tests, the three expected withheld-guard failures, 78 combined integration tests, lint/format/index and exact identities. The compiler first attempt remains **resource-aborted** at 4,464 ms / 1,151,040 KiB with subsequent pressure 2; no unchanged retry or older pass substitutes for current-source type acceptance. Both first formatting failures involved raw evidence JSON; exact original bytes and failures remain archived. Earlier 166 desktop, 85 sync/native, 286 production and 238 SDK results retain their exact applicability rather than becoming new executions.

Refreshed in-process off/on/pressure evidence reports 0.633128/0.739684 ms per save (delta +0.106555), overlapping ranges and all 14 matching native outcome hashes. Pressure reconciles 500 attempts = 64 admitted + 244 queue overflow + 192 transport/cooldown discard, including the real second-batch 429. This excludes browser rendering, network/SQLite/IDB, setup and feedback-export latency. It does not establish a browser latency guarantee or historical cause.

The current exact-head local policy record reports 200 actual paths, 15 selected suites, 60 rejected missing/skipped/failed/cancelled selected-result cases and 16 source/shared-input controls. It is local routing evidence, not actual CI execution. The earlier overbroad per-file probe failure remains retained and no routing policy was weakened.

**Still required before merge:** all seven current-head hosted gates; actual production diagnostics/export; callbacks/responsiveness; native Chrome/Firefox/Safari; standard browser/Storybook/Spaces; Linux maintenance/operational and sized-restore owners. Historical mobile 110.4 ms and earlier maxima, JXA conversion, callback baseline timeout, Firefox storage and restore/history failures remain failed historical evidence with original attribution limits. Changed source permits fresh validation but cannot retroactively establish passes or explain unprofiled causes. Preserve first failures and resolve any actual current-head failure without unchanged retries, relaxed limits or reduced workloads.

There is no further source-review step to earn points. Coordinate publication only after both exact-head independent review gates are satisfied; retain the pending hosted acceptance as real merge requirements.
