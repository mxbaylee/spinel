# 🌷 SPN-128 independent complete-candidate review B

Independent nonimplementing reviewer `/root/spn128_current_b`, 2026-11-14. **Agent review only.**

Exact candidate: `628d77987e7d9a08863465a7553a2ed82579728b`.
Actual-main base: `8e9dccbd90f04ad79bd12cba3695e5c4ff04e02d`.
Worktree: `/Users/mxbaylee/projects/spinel-spn-128-production`.
Grade-free packet: `/tmp/spn128-review-packet-628d7798`.

## ✅ Assessment and complete rubric

**100/100. No actionable findings or unresolved source blockers.** This covers the entire original L recovery outcome and the actual SPN-120/SPN-123 integration, not only the supervisor merge or deadline fixture. I continued my own source analysis and original findings through explicit source equivalence, without consulting old numerical reports, the PR body or the other reviewer's assessment. Current instructions, including diagnostic upkeep, govern this assessment.

- **35/35 — scope and acceptance.** Supported exact-operation cold authority, immutable intent/history, authenticated frozen source, raw partial custody, access/negative-evidence reconciliation, private original trial/durable commitment, acknowledged-generation and cross-operation replay protection, bounded cleanup, runbooks and process/platform coverage remain implemented. No requirement has been moved to a hidden follow-up. SPN-125 pruning stays separate; SPN-124's existing thirty-minute authority stays intact.
- **25/25 — correctness, integrity and access.** The previously inspected recovery boundaries are preserved. The sole overlapping executable, the supervisor, combines cold recovery with observer-isolated phase/verification events without changing authority, source selection or durable commitment. The independent diagnostics writer does not hold an application database connection or authorize reopening.
- **20/20 — meaningful regression protection and evidence.** Independently executed current-head portable controls passed: 58 tests plus 36 script/process controls; 21 Linux cases remain skipped. Material crash, refusal, replay, custody and cleanup tests remain present, and source-level integration does not invalidate their cut mechanism. Supplied full integrated checks are explicitly distinguished from my executions.
- **10/10 — workflow and operational usability.** CLI/runbooks explain exact IDs, bounded grants, retained attempts, refusal/retry and fallback. Coverage routing and required aggregates remain fail-closed. Diagnostic inventory accurately separates phase observation from recovery success and actual verification outcomes. Historical failures and source identities remain explicit.
- **10/10 — maintainability, documentation, process and complexity.** The distinct cold state/custody representation is necessary for historical authority and crash recovery; existing rollback, installer and private original-trial mechanisms are reused. No new speculative framework. The 10,292-line soft-limit crossing is reassessed in the canonical record and consists of the coherent L outcome plus preserved evidence; splitting mandatory evidence into another PR would detach acceptance from its implementation. No substantive requirement is hidden, and the hard limit/settings are unchanged.

**Every actionable step to 100: none.** No points withheld or repair requested. CI results, including missing/pending/failing results, cost no points. This score is not merge approval or a claim that hosted/platform acceptance passed.

## 🔎 Scope, policies and source identity

Compared original and current-main tickets (identical), read the refreshed canonical SPN-128 record, current process/AGENTS additions and diagnostic inventory, and weighed all four personas. The preceding full-ticket source review and SPN-112/115/124/125/131/138/158/160/090 lineage remain source-qualified; current SPN-120/SPN-123 contracts and incoming fixtures were inspected for recovery interaction.

Independently verified **481 Git parent-path comparisons**: 419 incoming paths equal actual main and 62 retained paths equal prior source `81841c50916aa6038df16f4598c0d1d37b0c0b71`, with **zero mismatches**. Also independently compared method bodies: `recoverOriginalOwned` is byte-identical to prior 8184; transition/phase observer and `verify()` bodies are byte-identical to main 8e9. Own detailed evidence: `/tmp/spn128-review-b-source-equivalence-628d7798.json`.

The final source-equivalence proof is distinct from the earlier pending-index audit. Intentional canonical/inventory/bookkeeping/evidence changes are not falsely counted as parent-identical documentation. Independently inspected the `ae97ca8b` to `628d7798` path delta: documentation/evidence only. Current supplied runtime checks therefore retain their exact executed source instead of being mislabeled as final-head executions.

All seven private workspace links still resolve into this candidate. Manifest/lock bytes are correctly described as changed: the sync-client workspace adds existing `@spinel/diagnostics`, root scripts expand formatting coverage, and the dependency audit qualifies unchanged external lock entries against the immutable donor. No install, link rewrite or donor mutation was performed by this review.

## 🛡️ Complete recovery boundaries

- `restore-jobs.ts` / `restore-cold-state.ts`: fresh grants bind job/hash/revision, target identity, predecessor generation, current operation, boot, closed state and original witness. Historical source validation, exact schemas, bounded append-only attempts and sequential permit/output bindings preserve original intent and prior attempts.
- `restore-cold.ts`: authorization, unchanged durable record and physical closure are checked around asynchronous work; frozen original and complete retained inputs are authenticated before existing rollback reconciliation. Source logical fingerprint remains bound to the independent shutdown witness; prepared output has its own full fingerprint after access/session/generation reconciliation. A partial installation remains raw custody, not SQLite source authority; an interrupted private trial must match its sealed fingerprint.
- `restore-files.ts`: private DB/WAL/SHM capture, descriptor/path identity and bounded hashing, preserved cancelled-copy bytes, immutable retained evidence, barrier checks and shared installation still protect file replacement. Missing/altered evidence is refused rather than redefined.
- `supervisor.ts`: private service-UID command authority grants bounded exact-operation recovery, checks and closes only the selected planned child, and reuses the original permit/private readiness/durable commitment. A committed backup or later generation cannot be replaced. Reopening a committed original uses the current selected live generation, preserves later acknowledged content and refuses a competing current maintenance operation.
- Existing process acceptance includes eleven original restore cuts and six cold-command cuts, durable phase observation before actual SIGKILL, source/prepared fingerprints, immutable history, missing/altered evidence and changed-private-trial refusal, revoked sessions/links, acknowledged Owner work/passkey counters and cross-operation replay. Cleanup controls preserve the primary failure plus secondary cleanup errors and protect unrelated process groups.
- Persisted-deadline fixture offsets continue to derive from original authority and then the previous cold grant. The previous virtual advance cannot move backward; both fixture processes share the offset. The old six-minute negative control rejects the same strict expiry relation without weakening assertions or changing production clocks/budgets.

No SPN-128 visual component or state is newly introduced against this main. The established recovered outcome/banner and its integration coverage remain required; this review is not a new screenshot approval.

## 📊 Diagnostic and lifecycle integration

Inspected `supervisor.ts` transition/observePhase/verify, `server/supervisor.ts`, diagnostics supervisor/configuration/store/runtime, the public `observe` isolation helper, maintenance gate, current regression owners and `docs/diagnostics.md:265` onward.

Phase events describe distinct supervisor states, not a completed recovery attempt. Only actual `verify()` calls emit verification outcomes; committed-original replay legitimately invokes it, while unresolved cold recovery uses its image/journal/private-trial protocol. Fixed fields omit operation IDs, content and authority. Observer exceptions are caught and cannot replace recovery outcomes. The inventory and canonical decision explain the unchanged schema/attribution contract and added caller context, satisfying the new upkeep rule.

The supervisor writer uses the separate bounded diagnostics DB with application-alias protection, secondary-writer export preservation, per-observation generation capture, old-queue truncate fencing and explicit process-local loss reporting. Store/runtime shutdown and observer errors remain isolated. Incoming native/sync/history/runtime observers stay main's source, with their meaningful regression owners and required native/browser acceptance retained.

The crash fixture fsyncs its private marker after the actual journal/write effect and blocks with `Atomics.wait`; an external test sends SIGKILL. It does not depend on an `onTransition` exception escaping. Therefore SPN-123's callback isolation does not silently disable SPN-128's crash cuts. The maintenance supervisor Linux tests additionally retain throwing phase/verification observers; they were inspected, not executed on macOS.

SPN-120's owned-app helper keeps exact complete-line readiness, post-readiness draining, bounded content-free evidence, owned-child shutdown and primary-error cleanup. Current Node controls independently exercise withheld readiness, cancellation, crashes, inherited-pipe timeout and cleanup failures. The restore-browser fixture observes the application's session-reset redirect instead of starting a competing navigation; it preserves the original reauthentication/content/access assertions.

Personas: Operator gains finite private recovery and honest bounded diagnostics without document visibility; Owner keeps post-backup work and later acknowledged edits; Collaborator keeps content/access and retry reconciliation; Link guest's sessions/capabilities remain revoked. Observations grant no authority and do not become a substitute for content/access assertions.

## 🧪 Independent current-head checks

Waited for root's explicit sole-slot grant. Used pinned Node 26.13.0, candidate private config/cache, `--cache=false`, shared serial lock and the existing normal-pressure/2 GiB/eight-minute watchdog. No compiler/full browser/build matrix or Linux-only maintenance supervisor run.

1. Vitest: clock/cold-custody/cold-state, maintenance gate and diagnostics supervisor/store/runtime. **58 passed, 21 Linux-only skipped** across seven files. Vitest 1.51 s; watchdog **1,821 ms / 387,024 KiB peak**. First attempt, exit 0, no failure/abort/retry. Log `/tmp/spn128-review-b-portable-628d7798.log`; receipt `/tmp/spinel-dependabot-2026-11-11/spn128-review-b-portable-628d7798.json`.
2. Node scripts, `--test-concurrency=1`: maintenance-evidence, bootstrap-evidence, renderer-chunks, plan, app-process. **36 passed**, no failures/skips. Node duration 2,121.830333 ms; watchdog **2,207 ms / 286,704 KiB peak**. First attempt, exit 0, no failure/abort/retry. Log `/tmp/spn128-review-b-scripts-628d7798.log`; receipt `/tmp/spinel-dependabot-2026-11-11/spn128-review-b-scripts-628d7798.json`.

Full exact argument arrays are retained in those receipts. Cleanup confirmed clean exact head, pressure 1, absent serial lock/breaker and no owned workload survivors, then released the slot: `/tmp/spn128-review-b-cleanup-628d7798.json`. `/tmp/spn128-review-b-provenance-628d7798.json` SHA-256-binds own logs, receipts, cleanup and source-equivalence audit.

Supplied implementer checks at `ae97ca8b` include full types, lint/dependencies/format and index/backlog/PR-shape. I inspected their source/provenance and final-head PR-shape log, including the actual 10,292-line soft warning and successful checker result, but did not rerun the full compiler. These are supplied evidence, not my execution. Prior own checks remain bound to their original 3812/8184 sources; earlier PATH/sysctl setup failure and resource refusals/aborts remain historical observations, not converted to passes. Archived log/patch whitespace is preserved evidence, not an executable regression.

## 🚦 Remaining acceptance and completion

Still pending with **zero CI-result deductions**: current Linux SIGKILL/cold grants/custody/refusal/replay/cleanup; applicable first-attempt native/browser/build acceptance; all seven current-head gates; the other independent exact-head review. The 94 portable passes and 21 skips do not establish those outcomes. Preserve the original nine expiry-order failures, 651 passes, mobile cancellation/aggregate failures, 116.3 ms against 100 ms failure and uncaptured first-attempt ECONNRESET with exact original sources. Incoming fixes, successful retries or diagnostics cannot reconstruct their historical causes.

The candidate keeps next ID 161, November 14 grooming and completions SPN-098/SPN-090/SPN-120/SPN-123/SPN-128, with index CLI evidence. Before merging, refresh durable PR/repository evidence with exact review/check/tested identities and dispositions. A later actual-base or source change requires new-head revalidation. After merge, preserve unique evidence and perform head/ownership-guarded cleanup of obsolete ticket refs or record blocked cleanup. No source/ref/remote/PR mutation or publication occurred during this read-only review.
