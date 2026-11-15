# 🔎 Independent review A — complete repaired SPN-128

Candidate: `d22baa6997e27c123ef351a8f5321089cc9e345b`.
Actual base: `8e9dccbd90f04ad79bd12cba3695e5c4ff04e02d`.
Worktree: `/Users/mxbaylee/projects/spinel-spn-128-production`.
Packet: `/tmp/spn128-review-packet-d22baa69` (`review-input.md`).

**100/100. No remaining actionable findings on this exact candidate.** This grade assesses source, tests and operability; it is not a hosted acceptance pass. All seven required gates and selected Linux/native/browser/performance owners remain pending on the repaired head. No CI result receives a deduction.

## Review correction and independence

My earlier 628d review missed an explicit Verify requirement: assertions in successful crash tests did not retain the actual per-cut fingerprint/generation/authority/process receipts after temporary directories were removed. It also missed the manual/runner trace ownership collision and the missing file-backed upload evidence. Those are source/workflow defects, not deductions for failing CI. The earlier report remains unchanged as history and does not waive these requirements.

I reviewed the repaired requirements and code afresh without using a prior numerical report, another reviewer's grade, or the PR body. The two pre-freeze findings communicated by the coordinator—per-controller SIGKILL enforcement and capture-before-assertion ordering—were independently inspected and verified in the final source. No implementation, dependency, remote or Git reference was changed. Only private review/probe output was written.

## Scope and exact-source qualification

This review retains the complete original L outcome: exact-operation fresh private authority, immutable original intent, separately bounded recovery attempts, authenticated frozen original, partial raw custody without promoting it to SQLite authority, access/session/guest/negative-evidence reconciliation, private original trial and new-generation commitment, acknowledged-work and cross-operation replay protection, exact-owned cleanup, CLI/runbook, Linux crash and native/browser acceptance. It also covers actual-main SPN-120/123 integration and the retained acceptance repair. SPN-125 pruning remains separate.

I reread the original/base ticket Verify wording, the canonical repair record and final packet; current process/testing/persona rules and the original recovery implementation were inspected in this same review sequence. Prior full source inspection is reused only through independently checked unchanged bindings:

- The packet manifest SHA-256 is `3f105b060350c736406c9b69ffc8cb998d96319c47de2ef4368f2041fc3221d2`; all **1,713** listed payload copy hashes matched. Historical numerical assessments are masked in external copies, with original evidence unchanged.
- The complete binary/full-index packet diff exactly equals local Git for this candidate/base; SHA-256 `668c81ea49c41cd4364e47ce121376b71bdb0fcc82bc83b4a6f9df2415fe1534`.
- Git confirms **1,413 non-document paths unchanged from 628d**. Exactly seven non-document paths differ: CI workflow; supervised restore tracing helper and spec; receipt helper, validator and controls; and the crash integration harness. I inspected all seven, including the whitespace-insensitive full crash-harness delta to distinguish receipt enclosure/reindentation from changed behavior. Production recovery/authority and diagnostic emitters are unchanged.
- No non-document path changed after type/lint-tested `524dca9ed0679716a3db6a16b4d78c58f07b58a7`. Package/lock and existing workspace dependencies remain unchanged from the published source.
- All **84** original repair evidence copies matched their stored and decoded hashes. I inspected the preserved initial TS2322 failure, the injected privacy-control failure, and their corrected source-qualified controls/types/lint receipts. These failures are not erased by later passes.
- The final exact-head PR-shape receipt reports **14,082 counted changed lines**, the existing soft-limit warning, and success. Canonical scope notes explain that the additional receipt controls, failure custody, upload owner and retained evidence belong to this same L acceptance outcome. No requirement is deferred or hidden in a closed parent. Completion bookkeeping still retains SPN-098/090/120/123/128, allocation 161 and November 14 grooming.

## Findings disposition

The retained-receipt gap is repaired in `src/server/maintenance/restore-crash-evidence.ts`, its integration harness, `scripts/ci/restore-crash-evidence.ts`, and the recovery partition of `.github/workflows/ci.yml`. Seventeen exact distinct cases now have bounded, explicitly projected JSON receipts. The source head, tested checkout/tree and run/attempt are bound. Frozen, prepared-original, actual live and outcome fingerprints remain distinct; unavailable observations have an explicit boundary rather than an invented value. Raw journals, database content and token/session/permit material are excluded. Success evidence is persisted before private data deletion and rewritten with actual cleanup completion; failed work retains private data and the primary error classification. Recording or cleanup failures remain failures with the original exception as the cause.

The validator rejects missing/duplicate/stale/failed receipts, incomplete cleanup, fingerprint/generation/phase inconsistencies and unproved process termination. Every original and cold controller needs its own SIGKILL. Only the postcommit initial controller may already have exited; postcommit still requires actual SIGKILL of the selected application writer. The new negative controls mutate both controller roles across all six cold cases.

Initial and cold cut marker/state projections are captured before their cut assertions. Observed marker names use the allowlist rather than the expected case label; unsupported marker text is redacted explicitly. Recovered authority/generation/state is captured before its assertions, while live fingerprint is added only after the existing closed read-only probe. The injected assertion control verifies that already-available observations and the original failure classification survive persistence, cleanup is attempted and private data stays retained.

Recovery CI creates a fresh evidence directory, refuses stale output, runs completeness verification even after test failure and uploads available safe JSON even when verification fails. Missing files cannot satisfy the owner. Existing file routing and the node-test glob include these source/control changes. The actual Linux run remains necessary to verify generated receipts against real process semantics.

Browser tracing now has one explicit manual owner for both supervised journeys with runner tracing disabled. Traces start before navigation, stop into `restore-first-failure-N/trace.zip`, and use named file-backed JSON/PNG/text attachments before reporter copies are attached. Actual workflow globs cover both originals and copies. Collection failures remain attached and aggregated behind the original feature error; later context/page collection and owned cleanup still run. Configured retries, deadlines and acceptance assertions are unchanged.

## Rubric

- **Scope — 35/35.** The original recovery outcome and all retained acceptance obligations are implemented and accounted for, including the newly repaired receipt and trace/upload boundaries. Full size and the soft-limit reconciliation are explicit.
- **Correctness — 25/25.** Exact private authority, journal/identity/policy/generation checks, closed-handle custody, shared rollback reconciliation, bounded grants/trials and fail-closed refusal remain intact. Terminal replay protects already-acknowledged work and rejects another operation or later generation. The repair observes these transitions without modifying them.
- **Meaningful regressions — 20/20.** Portable controls exercise privacy, completeness, failure preservation, per-cut SIGKILL requirements and capture ordering. Real Chromium probes verify trace ownership and actual retained files/upload selection with negative controls. Existing Linux crash effects and assertions remain intact; native/browser/platform execution has a separate owner and is not represented by Mac skips.
- **Workflow/operability — 10/10.** Supported private recovery/runbook behavior, bounded cleanup, source-bound evidence, fail-closed artifact ownership and first-failure preservation are coherent. Original failures are preserved and no budget waiver or unchanged retry is used to claim acceptance.
- **Maintainability — 10/10.** A small receipt projection/helper and standalone validator isolate fixture evidence from production recovery. Shared tracing/attachment ownership replaces duplicated failure handling. Existing diagnostics emitter semantics and inventory stay accurate; no new product emitter is introduced by this repair.

## All four personas

**Operator:** supported private authority and bounded safe receipts permit audit without document or credential access. **Owner:** authenticated originals, reconciled generation commitment and replay fencing protect work saved after backup and work acknowledged after recovery. **Collaborator:** retained native/access/session reconciliation evidence protects their edits and prevents stale access from returning. **Link guest:** link and guest-session revocation remain enforced; receipts do not expose session/capability material. Phone/native acceptance remains required where selected. The repair adds no new product visual state.

## Independent checks on d22baa69

All execution used pinned Node 26.13.0, `/usr/sbin` on PATH, the unchanged normal-pressure/2 GiB/eight-minute watchdog and shared serial owner. No Linux-only maintenance suite was run on Mac, no full matrix was duplicated, and no install or shared cache/donor mutation occurred.

From the candidate worktree:

```sh
PATH=/tmp/spinel-dependabot-2026-11-11/node-v26.13.0-darwin-arm64/bin:/usr/sbin:$PATH /tmp/spinel-dependabot-2026-11-11/node-v26.13.0-darwin-arm64/bin/node /tmp/spinel-dependabot-2026-11-11/watch.ts spn128-review-a-d22b-receipts node --test --test-concurrency=1 scripts/ci/restore-crash-evidence.test.ts

PATH=/tmp/spinel-dependabot-2026-11-11/node-v26.13.0-darwin-arm64/bin:/usr/sbin:$PATH PWTEST_CACHE_DIR=/tmp/spn128-review-a-d22b-probes/cache /tmp/spinel-dependabot-2026-11-11/node-v26.13.0-darwin-arm64/bin/node /tmp/spinel-dependabot-2026-11-11/watch.ts spn128-review-a-d22b-probes node node_modules/@playwright/test/cli.js test --config /tmp/spn128-review-a-d22b-probes/playwright.config.ts
```

Receipt controls: **11/11 passed**, Node duration 106.171916 ms; watchdog exit 0, 198 ms, no signal or resource reason. The command finished before its first RSS sample: receipt peak 0 means **unsampled**, not zero memory. Raw log `/tmp/spn128-review-a-d22b-receipts.log`; receipt `/tmp/spinel-dependabot-2026-11-11/spn128-review-a-d22b-receipts.json`.

Chromium controls: **3/3 passed**, one worker, no retries, 1.8 s runner duration; watchdog exit 0, 2,116 ms, 909,520 KiB process-tree peak, no signal/reason. These cover two manual-context complete traces, rejection of the withheld old dual-owner setting, and named attachment bytes/upload globs plus injected capture/cleanup failure preserving the primary cause. The probe copies use current maintained helpers and separate outputs; originals were not overwritten. Their only data attribution adjustment identifies the current reviewed head. Config/specs/cache/results/actual ZIP/JSON/PNG/text artifacts are under `/tmp/spn128-review-a-d22b-probes`; raw log `/tmp/spn128-review-a-d22b-probes.log`; guard `/tmp/spinel-dependabot-2026-11-11/spn128-review-a-d22b-probes.json`.

I released the workload slot immediately afterward. Shared lock was absent and the worktree clean. These are fixture-bound checks, not an execution of the Linux catalog or native application acceptance.

## Historical outcomes and remaining external acceptance

The original 628d hosted result stays failed: all three catalog attempts hit the trace ownership collision; the mobile callback baseline completed behavior but timed out during postprocessing while the candidate completed. Cleanup was confirmed. The comparison records identical baseline/harness bindings but different runner machines; it does not establish a source cause, built-bundle hash equality or a performance waiver. No budget increase or baseline waiver is part of this repair. The new head must run every selected owner, including callback acceptance; a repeated failure requires investigation.

Earlier reviewer-local preflight refusals launched no child and have no JSON receipt; the admitted 3812 batch was resource-aborted without a test verdict. Those remain distinct from the smaller completed checks and from the current successful commands. The historical expiry/mobile/ECONNRESET observations remain source-bound and are not explained by later green checks.

**Every actionable step remaining to 100: none.** Required current-head Linux crash/security/process execution and retained completeness, supervised/native/browser/performance acceptance, all seven hosted gates, current-base/queue eligibility and post-merge exact branch ownership/cleanup remain external landing obligations. None is claimed complete by this review or charged as a CI-result deduction.
