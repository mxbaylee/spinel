# 🌷 SPN-128 independent complete-ticket review A

Reviewed head: `3812ed9b153237b3b6da75fdbf31319f67844d19`.
Actual base: `ec42f0741415e4e712395fb47c30b911bc4e64ea`.
Reviewer: independent nonimplementing agent `/root/spn128_current_a`, 2026-11-14.
Execution worktree: `/Users/mxbaylee/projects/spinel-spn-128-production`.
Inspection packet: `/tmp/spn128-review-packet-3812ed9b-v2`.

## ✅ Assessment

**100/100. No actionable source, test-design, documentation or workflow findings; no unresolved review blocker.** This is an agent pre-push quality assessment of the complete original L outcome, not a CI pass or permission to merge. I did not consult the other reviewer's assessment or prior numerical assessments. Historical documents were inspected through the blinded packet.

Rubric:

- Ticket scope and acceptance: **35/35**.
- Correctness, data integrity and access boundaries: **25/25**.
- Meaningful regression protection and evidence: **20/20**.
- Workflow and operational usability: **10/10**.
- Maintainability, documentation, bookkeeping and complexity: **10/10**.

Steps to 100: **none identified**. No points are withheld for hosted results or the explicitly recorded local resource limitation. Remaining acceptance below is still mandatory and is not represented as passed.

## 🔎 Complete outcome inspected

I read the original base ticket, AGENTS, process/run-backlog/testing/personas policies, current SPN-128 canonical record, relevant superseding workflow decisions and original recovery/authority/integration lineage in SPN-112/124/131/138/158/160. I inspected the full changed executable implementation and tests, the complete change inventory, affected surrounding supervisor/registry/journal/installer/reconciliation code, CLI, runbooks, CI routing and retained local evidence. The review covers the original recovery delivery, not only the latest clock repair.

- **Fresh private authority and frozen history:** `supervisor.ts:2226` admits only the exact private-host operation against the bound deployment policy, instance, inode, pending record and stopped ownership. `restore-jobs.ts:1838` journals a distinct bounded grant before adoption, authenticates its predecessor (including unadopted admissions), and retains the original intent/execution and earlier attempts. `restore-cold-state.ts` validates historical grants at their own timestamps, limits attempts to eight and binds phase-specific evidence and revisions. Original passkey authority is not renewed.
- **Raw custody and authenticated source:** `restore-files.ts` captures and retains the closed tuple without assigning it a logical witness; identity, private directory, barrier, sidecar, byte/hash and mutation boundaries remain enforced. Partial copies are retained/refused. `restore-cold.ts` authenticates every recorded source, requires the independent original shutdown fingerprint, only freezes a private trial against its sealed expected fingerprint, and passes complete known negative evidence into the existing rollback preparation. A partial installation is never treated as valid SQLite authority.
- **Reconciliation and private activation:** the new path calls existing `prepareRestoreRollback`/`reconcileRestoreRollback`, startup rehearsal, original staging/activation and original trial/commit protocol. Original content/access remain the source; sessions/capabilities and native generations are reconciled. The final prepared fingerprint deliberately differs from the frozen original because those fields change. Tests authenticate both fingerprints at the correct boundaries rather than excluding fields to manufacture equality.
- **Durable winners and replay:** the committed path rejects backup winners, later generations and a different current maintenance operation. Restart commitment cleanup and repeated original recovery verify/open current live content; they do not reinstall prepared bytes. The crash suite checks preserved acknowledged work and passkey counters after restart and repeated commands, plus cross-operation refusal.
- **Process custody and cleanup:** a planned-but-unadopted private child is handled only through its exact selected permit, predecessor operation/generation and existing boot/start/UID/session/token-checked group stop. Unknown active groups remain refusals. Test cleanup preserves the primary error and all secondary failures; its Linux control checks the unadopted child closes while an unrelated group survives.
- **Observable product outcome:** `restore-registry.ts` uses effective cold phase when selecting the existing `original-recovered` outcome. The integration tests check Operator status, Owner recovered session notice, old-session denial, guest link/session revocation and retained content. No new UI design/state is added; existing rendering and browser checks remain required.

## 🧪 Regression and integration assessment

The existing real-process harness owns eleven original crash cuts and six cold-command cuts. It observes durable markers before SIGKILL, retains source/raw evidence, checks partial writes, expires persisted original and cold-grant deadlines, validates fresh grants and history, refuses missing/altered originals and changed private-trial fingerprints, and checks commitment/replay/owned cleanup. Focused custody/state cases cover malformed or stale authority, wrong operation/generation/boot/inode, exhausted attempts, live owners, changed tuples, cancellation and immutable terminal selection. Linux-only cases remain Linux-only.

The latest clock change is confined to fixtures: restart offset derives from the persisted original expiry and later cold deadline, preserves prior advances, and is applied consistently by supervisor and application fixtures. Production lifetime remains 30 minutes. The old six-minute negative control fails the same strict expiry assertion; the crash assertions were retained.

The first-attempt browser diagnostics are bounded and content-free: fixed route/error tokens, 32 observations, bounded private tails, safe journal fields, one-second health/status probes and explicit unavailable evidence. Original request rejection and existing retries/fail-on-flaky behavior remain intact. Main's SPN-158 writable-admission wait and SPN-138 folder readiness are retained; obsolete mirror behavior was not reintroduced. Older snapshot-reset, mobile latency and preparation failures remain historical observations with explicit causal limits.

Source/shared dependencies still select service and broader browser/native coverage. The recovery partition includes maintenance tests, the remaining partition includes the new Node privacy suite, and existing required aggregates retain fail-closed missing/failed selected-worker handling. No routing narrowing, new platform, weaker assertion, retry increase or budget waiver was introduced.

## 💻 Independent local execution and limits

Pinned Node: `/tmp/spinel-dependabot-2026-11-11/node-v26.13.0-darwin-arm64/bin/node` (26.13.0). All workload attempts used `/tmp/spinel-dependabot-2026-11-11/watch.ts`, which invokes shared `scripts/serial.ts`; I held the sole granted slot and released it after each bounded attempt. No source, dependencies, donor links/caches or remote state were changed.

Focused command attempted:

```sh
PATH=/tmp/spinel-dependabot-2026-11-11/node-v26.13.0-darwin-arm64/bin:$PATH /tmp/spinel-dependabot-2026-11-11/node-v26.13.0-darwin-arm64/bin/node /tmp/spinel-dependabot-2026-11-11/watch.ts spn128-review-a-3812-contracts node node_modules/vitest/vitest.mjs run --config /tmp/spn128-vitest.config.ts --configLoader native --cache=false src/server/maintenance/restore-crash-clock.test.ts src/server/maintenance/restore-cold-custody.test.ts src/server/maintenance/restore-cold-state.test.ts
```

1. Initial invocation: watchdog refused before launching a test process, `Memory pressure elevated before start`; exit 1. Full log: `/tmp/spn128-review-a-3812-contracts.log`. No JSON receipt was produced because refusal precedes receipt creation.
2. After root independently observed normal pressure and granted a slot, the same focused selection with guard name `spn128-review-a-3812-contracts-admitted` launched, then the watchdog stopped it as memory pressure rose. Receipt: elapsed **1,134 ms**, peak **366,784 KiB**, code 1, reason `Resource guard`. Log: `/tmp/spn128-review-a-3812-contracts-admitted.log`; receipt: `/tmp/spinel-dependabot-2026-11-11/spn128-review-a-3812-contracts-admitted.json`. No completed test summary: **resource-aborted, neither product failure nor pass**. No unchanged full-batch retry followed.
3. Root granted a materially smaller feasible related check:

```sh
PATH=/tmp/spinel-dependabot-2026-11-11/node-v26.13.0-darwin-arm64/bin:/usr/sbin:$PATH /tmp/spinel-dependabot-2026-11-11/node-v26.13.0-darwin-arm64/bin/node /tmp/spinel-dependabot-2026-11-11/watch.ts spn128-review-a-3812-privacy node --test scripts/ci/maintenance-evidence.test.ts
```

**Passed 5/5**, zero failures/skips, guarded **257 ms / 227,120 KiB peak**, code 0, no guard reason. Test duration 121.395 ms. Log: `/tmp/spn128-review-a-3812-privacy.log`; receipt: `/tmp/spinel-dependabot-2026-11-11/spn128-review-a-3812-privacy.json`.

Separately inspected the packet's complete decoded logs and receipts: the producer's 30 focused passes/21 Linux skips, five privacy passes, typecheck/lint/backlog/PR-shape checks are evidence on source `65b7c98208be011aaa2f4675952471905df74984`, not my own runs. Read-only Git inspection confirms that source-to-reviewed-head changes contain only documentation/evidence, and that the reviewed worktree remains clean. This does not turn my interrupted focused run into a pass.

## 👥 Personas, scope and landing consistency

Operator gets a finite supported command, explicit refusal/runbook steps, private authority, bounded attempts and useful failure evidence. Owner and Collaborator retain the latest original content, filing/access and acknowledged postcommit work under existing reconciliation; the recovered notice and new sign-in requirements remain accurate. Link guest receives no maintenance authority, and prior link capabilities/sessions are revoked.

The retained L estimate fits the complete integration of established custody, restricted workers, rollback and private trial mechanisms. It does not hide a new persistence architecture or omit native/process acceptance. Pruning remains separately owned by SPN-125; launch-host recovery remains in SPN-038. No unnecessary dependency or speculative generic framework was added. The textual base-relative diff is 5,577 additions and 231 deletions (5,808 total; 5,761 after the generated index exclusion), plus six gzip evidence blobs, below the 10,000-line soft threshold.

Only SPN-128 is removed from the open backlog and added to completion bookkeeping. Main's SPN-098 completion, November 14 grooming, next ID161 and consumed reservation state remain preserved. Canonical decisions and runbook replace the unsupported manual-recovery gap. Final branch cleanup remains an after-merge obligation; no cleanup or merge is claimed by this review.

## ⏳ Acceptance still required

Actual current-head Linux interrupted-restore/cold-command process acceptance; selected browser/native/platform checks and their first-attempt failure dispositions; all seven current-head CI gates; the other independent exact-head assessment; final PR evidence and guarded merge/branch cleanup. My source approval does not replace any of them. No CI-result deduction was taken.
