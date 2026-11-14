# 🔎 Independent review A — SPN-128

Reviewed candidate: `628d77987e7d9a08863465a7553a2ed82579728b`.
Actual base: `8e9dccbd90f04ad79bd12cba3695e5c4ff04e02d`.
Worktree: `/Users/mxbaylee/projects/spinel-spn-128-production`.
Packet: `/tmp/spn128-review-packet-628d7798`.

**100/100. No actionable findings or deducted points.** This is an independent, nonimplementing review of the complete L outcome and its integration, not a CI pass or permission to merge. I did not consult another reviewer's assessment, a prior numerical report, or the PR body. Earlier source inspection was retained only where exact current source equivalence supports it. No source, dependency, shared donor, reference or remote was changed.

## Scope and evidence identity

Read the original/base ticket, current rules/process/run-backlog/testing/personas, canonical decisions and implementation record, the full original recovery scope and current integration packet. Reviewed the original recovery implementation and its custody/state/trial/replay/access/cleanup tests in the preceding review, then revalidated its exact retained source and the integrated supervisor against this candidate. The scope includes Linux crash and native/browser acceptance; neither is silently delegated to a later ticket. SPN-125 pruning remains separate.

Independent checks of packet/candidate identity:

- All 1,609 packet payload hashes and 1,602 copied-source hashes matched their manifests.
- The packet's full binary/full-index diff exactly matched local Git for the actual base and candidate; SHA-256 `16b0368166c53ec1ddbc7640acb8ff607f1eaa2fb81383d26a0915a174811b5c`.
- All 419 incoming and 62 retained final-source-equivalence rows matched the actual Git parent and candidate blobs. These include all 20 retained executable recovery/fixture paths. Intentional documentation changes are separately identified; the earlier 420-path pending-index count is not represented as the final inventory.
- The complete `recoverOriginalOwned` method is byte-identical to previously inspected `81841c50916aa6038df16f4598c0d1d37b0c0b71`. I inspected the integrated supervisor diff and main's transition/phase/verification changes in full.
- No non-document source changed between tested merge `ae97ca8b6587617ecccce5bbb80e0da4a4aa295a` and the reviewed candidate. HEAD matched the requested SHA and the worktree was clean after checks.

## Rubric and rationale

- **Scope, 35/35.** Exact-operation fresh private service authority, immutable original intent, bounded separate attempts, authenticated frozen original, raw partial custody, prepared-original reconciliation, private trial/new-generation commitment, acknowledged-work/cross-operation replay protection and exact-owned cleanup remain one outcome. The canonical record explains the complete L estimate and 10,292 counted textual lines crossing the approximate 10,000-line soft threshold. Required evidence/provenance explains that growth; splitting it away would detach acceptance from the recovery outcome. There is no hidden remainder in a closed parent. Generated completion bookkeeping retains SPN-098/090/120/123/128, next allocation 161 and grooming date November 14.
- **Correctness, 25/25.** Recovery requires the exact journal/intent/instance/path/inode/policy and sole closed unresolved operation. Fresh bounded grants do not rewrite expired original authority; current durable state and monotonic/deadline checks surround destructive steps. Raw partial custody does not become SQLite authority. Frozen and prepared fingerprints have different intentional roles. Existing rollback reconciliation preserves access/session/guest and negative evidence before private original trial. Original-committed replay verifies current live contents rather than reinstalling an old image; committed backup/later generation/another operation are refused. Recorded process cleanup checks exact ownership. Integrated diagnostics remain observational and cannot choose durable outcomes.
- **Meaningful regressions, 20/20.** The state/custody/refusal/replay/access/cleanup contracts use deterministic lower-layer controls; Linux crash tests own actual kill/write/lease/descriptor semantics, and native/browser tests own readiness, authentication and editor behavior. The persisted-deadline fixture repair keeps assertions and production authority unchanged. Crash markers are fsynced after actual effects and block for external SIGKILL, so isolating throwing transition observers does not disable crash cuts. My current focused checks exercised the changed observer/maintenance boundaries and owned-process/privacy contracts. Missing or skipped platform execution is explicitly not a pass.
- **Workflow and operability, 10/10.** The CLI/runbook preserve exact deliberate private authority and fail-closed recovery. Canonical evidence names source/check identities, preserves earlier failure dispositions and distinguishes current execution, inherited evidence and pending hosted acceptance. Resource limits and shared serial ownership were respected; local checks were feasible on Mac. No routine browser matrix or Linux-only supervisor workload was duplicated. Landing requires current-head gates, base freshness, queue eligibility and post-merge branch ownership/cleanup checks.
- **Maintainability, 10/10.** Recovery preparation/state helpers preserve a single shared rollback/activation path rather than duplicating reconciliation. The SPN-120 process owner has bounded readiness/cleanup, exact child ownership, post-readiness draining and first-error preservation. SPN-123 observers use fixed content-free schemas and isolated sinks. The new maintenance inventory clarification accurately distinguishes phase observations from recovery completion and actual verification outcomes. The separate supervisor diagnostics writer preserves application database closure, truncate generation fencing and active exports.

## Persona assessment

**Operator:** private exact-command authority, bounded attempts, content-free diagnostic loss evidence and honest operational instructions fit a small instance without granting document access. **Owner:** authenticated preserved originals, reconciliation and committed replay protect retained and subsequently acknowledged edits. **Collaborator:** access/session and revision reconciliation prevent stale restored authority or silent loss; trial readiness precedes public access. **Link guest:** link/session revocation and negative evidence remain enforced, with no dashboard/document-content exposure through recovery controls or observations. No new visual state relative to actual main needs a separate SPN-128 design approval.

## Independent current local execution

Both commands ran from the candidate worktree with the pinned Node 26.13.0, `/usr/sbin` on PATH, the unchanged continuous pressure/2 GiB/eight-minute watchdog and shared `scripts/serial.ts`. The Vitest config was private and cache disabled. No installation or donor/cache mutation occurred.

```sh
PATH=/tmp/spinel-dependabot-2026-11-11/node-v26.13.0-darwin-arm64/bin:/usr/sbin:$PATH /tmp/spinel-dependabot-2026-11-11/node-v26.13.0-darwin-arm64/bin/node /tmp/spinel-dependabot-2026-11-11/watch.ts spn128-review-a-628d-observers node node_modules/vitest/vitest.mjs run --config /tmp/spn128-vitest.config.ts --configLoader native --cache=false src/server/maintenance/gate.test.ts src/server/diagnostics/supervisor.test.ts src/server/diagnostics/store.test.ts src/server/diagnostics/runtime.test.ts

PATH=/tmp/spinel-dependabot-2026-11-11/node-v26.13.0-darwin-arm64/bin:/usr/sbin:$PATH /tmp/spinel-dependabot-2026-11-11/node-v26.13.0-darwin-arm64/bin/node /tmp/spinel-dependabot-2026-11-11/watch.ts spn128-review-a-628d-owned node --test --test-concurrency=1 scripts/ci/maintenance-evidence.test.ts scripts/ci/app-process.test.ts
```

First command: **4 files, 28 tests passed**, Vitest 647 ms; watchdog exit 0, 940 ms, 308,832 KiB peak, no signal/reason. Log `/tmp/spn128-review-a-628d-observers.log`; receipt `/tmp/spinel-dependabot-2026-11-11/spn128-review-a-628d-observers.json`.

Second command: **20 tests passed**, Node 1,887.640584 ms; watchdog exit 0, 1,975 ms, 285,776 KiB peak, no signal/reason. Log `/tmp/spn128-review-a-628d-owned.log`; receipt `/tmp/spinel-dependabot-2026-11-11/spn128-review-a-628d-owned.json`.

The workload slot was released immediately after these checks. Shared lock was subsequently absent; worktree remained clean. `src/server/diagnostics/supervisor.test.ts` is portable; I did not run Linux-only `src/server/maintenance/supervisor.test.ts` on Mac.

Producer evidence, separately attributed: tested-source recovery 30 passed/21 Linux skipped; diagnostics 28 passed; script controls 36 passed; integrated types/lint/backlog/PR checks passed. The final exact-source PR check records the transparent 10,292-line soft warning. These are source-bound producer results, not additional executions by this reviewer.

## Preserved limitations and earlier outcomes

The original A review's guard preflight refusal launched no test child and wrote no JSON receipt (`/tmp/spn128-review-a-3812-contracts.log`). Its later admitted focused batch was aborted by runtime pressure after 1,134 ms/366,784 KiB, with no completed test verdict (`/tmp/spn128-review-a-3812-contracts-admitted.log` and matching watchdog JSON). The separate smaller privacy control passed 5/5. At 8184, the 21-control preflight also launched no child/no receipt (`/tmp/spn128-review-a-8184-scripts.log`); the materially smaller bootstrap/renderer selection passed 4/4. Neither refusal nor abort becomes a product failure or pass. I did not retry the unchanged resource-aborted batch to obtain green evidence.

The historical a6dd nine expiry failures/651 passes, 116.3 ms versus 100 ms mobile failure and unidentified ECONNRESET remain historical observations. Later passes do not establish their cause.

## Steps remaining to 100 and merge boundary

There are **no actionable steps or point deductions remaining to 100** on this reviewed source. No CI result was deducted. This does not remove acceptance gates: actual current-head Linux crash/security/process behavior, native/browser acceptance, all seven required hosted checks, current base/queue eligibility and eventual obsolete ticket-branch cleanup remain required where applicable. They require the designated external/hosted environment and are not represented by Mac skips or this grade.
