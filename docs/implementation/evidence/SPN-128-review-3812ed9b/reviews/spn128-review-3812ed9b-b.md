# 🌷 SPN-128 independent complete-candidate review B

Reviewer: independent nonimplementing agent `/root/spn128_current_b`, 2026-11-14. **Agent review only.**

Reviewed head: `3812ed9b153237b3b6da75fdbf31319f67844d19`.
Actual-main base: `ec42f0741415e4e712395fb47c30b911bc4e64ea`.
Worktree: `/Users/mxbaylee/projects/spinel-spn-128-production`.
Blinded packet: `/tmp/spn128-review-packet-3812ed9b-v2`.

## ✅ Assessment

**100/100; no actionable source, test-design, documentation or scope findings.** This is a complete-ticket pre-push assessment, not a grade of only the deadline fixture repair, and not merge approval. I did not consult another reviewer's grade or historical numerical assessments. No points are deducted for CI results or pending platform execution.

Rubric:

- Scope and acceptance: **35/35**. The complete L outcome remains present: fresh exact-operation cold authority, immutable old intent/history, authenticated frozen source, raw custody, existing rollback reconciliation, private original trial/commit, committed-generation protection, bounded cleanup, CLI/runbook and process acceptance coverage. Pruning remains SPN-125; the existing 30-minute SPN-124 lifetime is preserved. The renewed checkpoint explicitly includes main integration and verification rather than presenting the clock repair as the whole outcome.
- Correctness/data/access: **25/25**. The inspected grant, source authentication, file installation, private readiness and terminal-selection paths remain fail-closed, with no demonstrated unsafe replacement or authority regression.
- Meaningful regressions/evidence: **20/20**. Relevant portable checks independently passed below. The suite contains actual process cuts and material negative cases; the clock repair preserves the strict expiry assertions. Provided broader evidence is identified separately from my execution. Linux/browser/native execution remains a separate acceptance obligation.
- Workflow/operability: **10/10**. The documented supported command replaces manual byte restoration, explains refusal/retry/attempt limits and preserves the emergency fallback. Existing file-based routing selects the affected suites and required aggregates reject missing or unsuccessful selected work. Historical failures are retained without unsupported causal claims.
- Maintainability/process/complexity: **10/10**. The additional state model is justified by independent historical authority and crash boundaries. Recovery reuses rollback preparation, file installation and original-trial machinery rather than duplicating content reconciliation. No new runtime dependency or speculative framework. Landing bookkeeping preserves main's completion/grooming state and adds only SPN-128.

**Every actionable step to 100:** none; no points withheld and no source repair requested. Outstanding acceptance below is not disguised as a deduction or a pass.

## 🔎 Full-outcome inspection

Read the original base ticket; AGENTS, process/run-backlog/testing/personas; SPN-128's decisions, scope checkpoints and failure dispositions; relevant superseding workflow/scope/evidence policies and SPN-112/124/131/138/158/160 integration lineage. Inspected the full changed-file inventory and source diff, including runtime, fixtures, diagnostics, CLI, runbooks and landing bookkeeping.

Key independently inspected boundaries:

- `restore-jobs.ts` cold admission/checkpoint methods bind exact job/hash/revision, target identity, predecessor generation, current operation, boot epoch, stopped state, witness and sole unresolved job. `restore-cold-state.ts` validates the original record at its historical revision/time and enforces bounded append-only attempts, exact schemas, unique attempt identities, sequential phases and permit/output bindings. Original authority is never extended.
- `restore-cold.ts` checks authorization, unchanged durable evidence and physical closure before/after asynchronous work. It authenticates the frozen original and every known complete evidence input before existing `prepareRestoreRollback`; the original logical fingerprint is independently bound to the shutdown witness. Reconciled output deliberately has a different full fingerprint. Interrupted private trials are frozen only against their sealed expected fingerprint; partial replacement phases do not open raw tuples as SQLite.
- `restore-files.ts` retains DB/WAL/SHM bytes in separate cold slots, verifies immutable copies, refuses changed/partial overwrite retries and uses the existing identity/barrier/install mechanism. Cancellation preserves partial retained evidence. New descriptor-based hashing checks path/descriptor identity, metadata and byte bounds.
- `supervisor.ts` accepts the command through the existing private service-UID control boundary, stops only the exact selected unadopted planned process with existing identity checks, journals a new bounded grant, then uses the existing original permit/readiness/durable commit path. A committed backup is refused; an original winner only verifies/opens the selected live generation, checks competing operation IDs and never reinstalls prepared bytes over subsequent acknowledged work.
- Crash tests retain eleven original restore cuts and six cold-command cuts, durable phase observation before SIGKILL, immutable-history/custody checks, missing/altered source and changed private-trial refusals, original/reconciled fingerprints, revoked sessions/links, acknowledged Owner content/passkey counter and cross-operation replay. The cold-state/custody tests exercise malformed authority, stale revision, wrong operation/identity, expiration, eight-attempt limit, partial copy cancellation, changed barriers/copies and terminal replacement refusal. Cleanup controls preserve primary plus secondary failures and keep unrelated process groups alive.
- The repaired clock derives initial and subsequent advances from persisted authority/attempt deadlines and preserves previous virtual advances. Both supervisor and application fixtures receive the offset. The old six-minute negative control still fails the same strict `grantedAt > expiresAt` relation; production lifetime, clocks and assertions are unchanged.
- The browser fixture adds bounded, content-free first-attempt observations without retries or weakened budgets. The optional identity read follows lifecycle cleanup registration. Existing native/browser interaction owners remain required; SPN-158 writable-admission and trace ownership changes survive integration. No new visual component/state/design is introduced, so this assessment is not a new screenshot approval.

All four personas were weighed: Operator gets a finite private supported recovery path and explicit failure guidance; Owner retains post-backup saved work and acknowledged later edits; Collaborator retains the established content/access and retry reconciliation; Link guest's sessions and capabilities are revoked. Administrative recovery does not add document-reading capability to the Operator.

## 🧪 Independent local execution and limits

Exact head was independently confirmed before and after inspection; worktree remained clean. No source, dependency, shared donor cache, remote branch or PR metadata was changed.

Used pinned Node `26.13.0`, task-private Vitest config/cache, shared `scripts/serial.ts` lock and `/tmp/spinel-dependabot-2026-11-11/watch.ts` with normal-pressure admission, continuous process-tree monitoring, 2 GiB and eight-minute bounds. Root allocated the sole workload slot. After the broader local selection encountered host pressure elsewhere, my independent allocation was deliberately restricted to the distinct lower-cost controls; I did not retry that full selection or run Linux-only cases on macOS.

1. Initial privacy command never started a test: my explicit PATH omitted `/usr/sbin`, so watchdog setup raised `spawnSync sysctl ENOENT`. Retained in `/tmp/spn128-review-b-privacy-3812ed9b.log`. Corrected only PATH; this was a diagnosed runner-preparation failure, not a passing check or an unchanged resource retry.
2. `node --test scripts/ci/maintenance-evidence.test.ts`: **5 passed**, no failures/skips. Test duration 88.5315 ms; watchdog 183 ms. RSS was unsampled because completion preceded the first 200 ms sample, not zero memory. Log `/tmp/spn128-review-b-privacy-fixedpath-3812ed9b.log`; receipt `/tmp/spinel-dependabot-2026-11-11/spn128-review-b-privacy-fixedpath-3812ed9b.json`.
3. `node node_modules/vitest/vitest.mjs run --config /tmp/spn128-vitest.config.ts --configLoader native --cache=false src/server/maintenance/restore-crash-clock.test.ts`: **4 passed**, no failures/skips. Vitest 87 ms; watchdog 352 ms, peak 189,024 KiB. Log `/tmp/spn128-review-b-clock-3812ed9b.log`; receipt `/tmp/spinel-dependabot-2026-11-11/spn128-review-b-clock-3812ed9b.json`.

The maintained source-bound implementation evidence reports 30 focused passes/21 Linux-only skips, five privacy passes, typecheck, full lint/dependency/format and backlog/PR-shape checks at `65b7c982`; final `3812ed9b` adds documentation/evidence only. These are supplied results, not my executions. I inspected their provenance and source relationship. I did not duplicate full typecheck or a hosted matrix.

A full `git diff --check` observation reports only the single-space blank context line inside the immutable retained `SPN-128-readiness-fix.patch` (line 14). That space is unified-diff context syntax in evidence, not new executable trailing whitespace; altering historical patch bytes is not a requested repair.

## 🚦 Separate completion gates

Still pending, with **zero grade deductions for CI status**: corrected Linux real-process crash/cold-command acceptance and custody/grant/refusal/replay/cleanup; selected browser/native/platform first attempts; all seven exact-current-head CI gates; the other independent complete-head review. Preserve the prior nine expiry-order failures, mobile 116.3/100 ms failure, uncaptured ECONNRESET, cancellations and resource-aborted attempts with their original dispositions. A later green result cannot establish the old reset's cause.

Before merge, refresh durable PR/maintained evidence with exact source/check/review identities and failure dispositions. After merge, enumerate ticket-created branches, preserve unique evidence, recheck heads/active PR ownership and perform guarded cleanup or record access-blocked refs. These are workflow completion obligations, not reasons to fabricate a code deduction or claim merge readiness now.
