# 🔎 Independent SPN-123 review B

Candidate: `cae5a58689b049e4f62c3a815482e21bb5212f49`.
Actual base: `c525aa933505d6e78b8fdd7a89940d87506d5cb3`.
Review date: 2026-11-14. Independent, nonimplementing, agent review only.

**94/100; source repair required before validation publication.** One P2 finding remains. This is a full-ticket review, not approval of a narrow loader fix. No points are deducted for missing, pending or failed CI results. Current-head hosted acceptance remains a separate merge gate.

## 🐛 Finding and every step to 100

**B1 — P2: An already-refused client can report an impossible durable acknowledgment as success.** `lib/sync-client/src/client.ts:684–685` calls `finishSave('success', ack.duplicate)` when `this.reason` is set, after only `validate(ack)`. The validator at line 549 checks shape, a general revision minimum, touched shape and hash syntax. It does not establish that the receipt revision can belong to the retained immutable request. This branch bypasses the normal path's revision/replay-order checks at lines 692–703.

Concrete reproduction: commit a first save at revision 2, enqueue/send a second request whose `baseRevision` is 2 but never accept it on the server, call `refuse('divergence')` on a nonpreserving client, then deliver a shape-valid ACK with the second request's mutation ID and the first save's revision-2 receipt body. The candidate reports `document-save-server-ack` success and `sync.client.acknowledged` even though the server still contains only the first history row. Without the preceding refusal, the same input is classified stale and the diagnostic outcome is cancelled. This violates the ticket's validated-ACK boundary and the production inventory's explicit order/receipt semantics. It can mislead an Operator investigating an unsaved edit; it is not a claim that this instrumentation newly corrupts stored content.

I independently inspected this branch and its validator while reviewing ACK timing. The coordinator subsequently supplied an assessment-free technical reproduction, which I read to corroborate the source finding: `/tmp/spn123-review-cae5-a-stale-ack.ts` and `.log`. I did not run or author that probe and did not read another reviewer's numerical assessment. Its exit zero asserts the defect, not a passing product contract.

To restore **4 correctness points**, validate the minimum receipt/request revision consistency before emitting success in the already-refused branch. At minimum an ACK revision at/below its immutable request's base must never prove durability; account for the existing unchanged-resume/replay constraint where applicable. Preserve native recovery handoff, request identity and authority behavior; do not replay a refused replica merely to observe it. Settle an unprovable observation as cancelled rather than success and avoid duplicate outcome emission. A legitimate late durable receipt must retain its meaningful successful observation.

To restore **2 regression points**, add focused cases to `lib/sync-client/tests/diagnostics.test.ts` for the already-refused path: matching ID with stale/equal request-base revision, applicable replay-bound inconsistency, and a legitimate late ACK. Assert exact observation cardinality and absence/presence of `sync.client.acknowledged`; retain unchanged native content, actual durable history, existing resync reason and handoff. The current unmatched/malformed/conflicting cases at approximately line 273 exercise the normal ACK path and do not cover this branch. Run the focused tests under the shared local guard, commit the complete repair and obtain both exact-head reviews again. These are local source/test obligations, not hosted-only deductions.

No other actionable deduction was identified. There is no owner-decision deduction or requested exception.

## 📏 Rubric

- Scope and acceptance: **35/35**. Reviewed the original L contract, full actual-base diff and production inventory. Open, distinct local/ACK save, search, restore, connection/resync/refresh/queue, publication/recovery, flush/checkpoint/persistence, maintenance and runtime observation seams are implemented. B1 is a correctness defect in an implemented boundary, not an omitted subsystem; it is deducted below once. No requirement is deferred to SPN-098, SPN-110 or SPN-160.
- Correctness and safety: **21/25**. Deduct 4 for B1. Otherwise exact field admission, browser/backend source separation, account/session/generation fences, guest exclusion, fixed dimensions, timing units, preservation of operation failures and bounded loss paths are coherent.
- Regression confidence: **18/20**. Deduct 2 for the missing refused-ACK negative/positive contract described above. Meaningful local and retained tests cover native behavior, admission, persistence, cancellation, retries and observer isolation. No deduction for current-head CI or the Mac's inability to run Linux process-maintenance acceptance.
- Workflow and usability: **10/10**. The maintained inventory explains endpoints, partial sampling and loss, local save versus server durability, and export interpretation. No visible product UI design change requires a new visual approval. Rendering/interaction/native acceptance remains required.
- Maintainability and overcomplexity: **10/10**. Fixed schemas and small optional sinks reuse the existing collectors/store/export. The WeakMap keys follow actual PendingBuffer groups without durable timestamps or reintroducing whole-buffer accounting. Fixed sampling buckets and a single bounded cooldown avoid per-file maps and durable telemetry queues. The secondary writer/lifecycle path is justified by maintenance continuing after application shutdown; no generic tracing framework or speculative infrastructure was introduced.

## 🧪 Independent execution and exact limits

I verified the worktree HEAD is the candidate above and `git status --porcelain` was empty. Review source packet manifest SHA-256 is `4d1606e33d8fe069908991e999bcf0a83828eec74b4778007f6ceff1e93c31c7`. The coordinator's 1,429 Git/copy bindings and full packet/archive verification are supplied evidence, not checks I claim to have independently rerun.

With the coordinator's explicit sole-slot grants, I ran pinned Node 26.13.0 through `/tmp/spinel-dependabot-2026-11-11/watch.ts` and candidate `scripts/serial.ts`, with normal pressure, the unchanged 2 GiB/eight-minute/200 ms guard, candidate-local workspaces, the task-private Vitest config, `--configLoader native --cache=false`.

The first batch mistakenly included `src/server/maintenance/supervisor.test.ts`. It reached the explicit `Supervised maintenance requires Linux and its local filesystem profile.` refusal from `journal.ts:86`. After the coordinator's platform clarification I verified owned serial PID 63201 and group 63209, sent TERM to that serial runner, and its handler stopped the owned group. This batch exited 1 after 25,805 ms, peak 508,368 KiB, watchdog resource reason null. It is a platform-inapplicable, deliberately stopped attempt, not a product pass or resource abort. It remains preserved at `/tmp/spn123-review-b-cae5a586.log` (SHA-256 `e471e6851cce67b40bbe5b5dcd42b80c37b6240a58c67c53ef3beb6f77b3fbc6`) and `/tmp/spinel-dependabot-2026-11-11/spn123-review-b-cae5a586.json`.

The corrected supported batch, granted separately, passed **214/214 tests across 13 files**, exit 0, **4,359 ms**, peak **844,768 KiB**, watchdog reason null. It ran:

- `lib/diagnostics/client.test.ts` and `server.test.ts`;
- `lib/sync-client/tests/diagnostics.test.ts`;
- `src/server/diagnostics/account.test.ts`, `browser.test.ts`, `runtime.test.ts`, `store.test.ts`, `supervisor.test.ts`;
- `src/server/maintenance/gate.test.ts`;
- `src/ui/offlinePersistence.test.ts`, `operationDiagnostics.test.ts`, `spinelSync.test.ts`, `boundedDocHistory.test.ts`.

The exact argv is retained in `/tmp/spinel-dependabot-2026-11-11/spn123-review-b-cae5a586-supported.json`. Log: `/tmp/spn123-review-b-cae5a586-supported.log`, SHA-256 `4ae42c4763001b75a7a10b75ace528071636c884f39006f6c7abc5c86fdd0416`. I released the slot immediately afterward. No heavy browser/compiler/install rerun, dependency mutation, repository edit or push was performed.

## 🧭 Full outcome and integration assessment

I inspected the changed runtime and associated tests across the diagnostic registry/client/server modules; SyncClient and PendingBuffer integration; account collector/hook and editor/search sources; offline persistence/publication/recovery; history/search/restore server paths; native flush and evidence controls; runtime sampler; maintenance gate/supervisor/store; Safari loader; native SDK proof regressions; overhead harness; browser export scenario; and process/bookkeeping changes. Read `docs/todo/process.md`, `docs/testing.md`, the base ticket, all four personas, the maintained emitter inventory and source-bound implementation checkpoints. Historical numerical assessments were not used.

Key preserved boundaries:

- Local success is set only after `saveCheckpoint` resolves; skipped unprepared/read-only writes do not invent a durable operation. ACK observations are separate, sampled as bundles and bound to original scopes. B1 is the exception requiring repair.
- Queue count remains native mutations rather than groups/saves; restored/rebased age is unknown. Cadence checks precede queue scans. Reconnect attempts are observed across retries, with host handoff distinct from usable replacement readiness.
- Browser event admission is explicit and exact; runtime/history/maintenance/server events remain excluded. Existing current-access rechecks and session binding precede ingestion; guest roots receive no collector. Sampling uses eleven fixed families, loss is bounded, a 429 discards once and obtains a fresh verification after a cancellable cooldown.
- Native flush reports in `finally` and isolates the optional observer while preserving the original native exception. Current main's 16-state group / 200-history policy is retained. The unchanged 70-character lost-ACK case now verifies all five undo/redo groups through native selection, server receipt, peer, storage and reopen.
- Server history observations avoid invented user attribution; restore completion is observed once per owning run rather than each receipt waiter. Publication/recovery distinguish newly published work from duplicate durable receipts. Operation observations do not replace permission checks.
- Maintenance's fixed internal event path preserves ordinary application admission, caps pre-auth refusal writes and exposes queue loss. Secondary writer captures current generation, preserves old queued generation fences and cannot delete application exports. Runtime uses one bounded histogram, explicit unit conversion and isolated allocation/read/reset/close failures.
- The Safari repair compares opaque pointers without string conversion or dereference. Existing main identity/revalidation, constructor-only recovery, action/consent/readiness guards remain. Main's storage-quiescence and account-transition history fixtures remain unchanged relative to the actual base.

The complete 17,811-line soft-limit accounting contains 10,401 lines of retained evidence, 1,551 other documentation and 5,859 runtime/tests/config. The recorded scope checkpoints retain the full L outcome and justify cohesive evidence/repair review without changing thresholds or exclusions. The actual-base diff preserves SPN-157's audit and unknown historical cause and current grooming plans. Only SPN-123 is provisionally completed; `next_id` 161, November 14 grooming and other tickets remain. The generated index and exact-head backlog/PR policy receipts are supplied local evidence. No unrelated acceptance is silently completed.

Persona assessment: Operator gains bounded, interpretable observations but B1 currently risks a false durability conclusion. Owner and Collaborator retain content/history/access/native delivery guarantees; true local durability remains distinct from server durability. Link guest receives no browser collection and retains access/revocation boundaries. The implementation record explicitly weighs all four.

## 🚦 Separate hosted acceptance and evidence dispositions

The retained final local record reports 286 production contracts, 238 SDK tests plus two existing opt-in timing probes, 166 desktop controls, 85 sync/native tests, full types/quality, 18 routing controls and source-bound overhead results. I inspected their maintained identities and limitations; these are supplied evidence, not additional independent executions by me. The 14 off/on/pressure native hashes match, reported medians are 0.664583/0.726514 ms per save, and 500 pressure attempts reconcile 64 admitted + 244 overflow + 192 transport/cooldown discard. The harness explicitly excludes renderer, real network/SQLite/IDB and setup; it does not establish browser latency or explain an old pause.

The supplemental policy probe preserves its first overbroad e2e-only sized-restore expectation failure and corrected expectation. No classifier policy was loosened: the complete 152-path plan selects all 15 suites, rejects 60 missing/skipped/failed/cancelled selected results and retains representative shared dependencies. This is local selection proof, not an actual hosted execution.

All seven current-head gates, production diagnostics/export, callbacks/responsiveness, native Chrome/Firefox/Safari, standard browser/Storybook, Linux maintenance/operational and sized-restore owners remain pending. The historical mobile 110.4 ms failure, nullable JXA error, callback baseline timeout, Firefox storage and restore/history fixture failures retain their original status; current-main source changes justify changed-source validation, not retrospective passes or causal certainty. Do not rerun unchanged unsupported/resource-aborted work or weaken budgets. After B1 repair and both qualifying exact-head reviews, publish the concrete candidate for file-selected validation, retain first attempts and resolve actual failures. Merge still requires all applicable acceptance; this review grants no waiver.
