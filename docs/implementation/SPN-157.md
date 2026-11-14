# SPN-157 — Maintenance and restore process handoffs

## 🧭 Registration and complete outcome

**Date/status/source:** 2026-11-13, accepted registration and scope; implementation
and acceptance pending. Agent delivery-manager judgment under the standing
[decision authority](../todo/process.md#decisions), following required CI evidence
from SPN-098. This is not an owner instruction to waive a failed check.

**Question:** how should the newly observed supervisor failure be owned without
expanding the feedback or phone outcomes, or treating a prior green run as a pass
for a subsequent failing run?

The supervisor source files are unchanged from main, but the failing runs used
the SPN-098 candidate. Its broader startup/drain effects remain a possible
contributor; source identity alone proves neither causation nor independence. Options considered
were to absorb the investigation into feedback or phone work, rerun the failed
suite until green, or register a separate complete pre-launch repair. Choose the
separate **L** outcome: diagnose failures in the named durable-running SIGKILL
reconciliation and readiness-first authenticated restore scenarios, then repair the
demonstrated product or fixture cause, including authority, durable state,
process ownership, orphan cleanup and actual Linux verification. Add SPN-157 as
an explicit prerequisite of the still-open SPN-098 ticket. Its failed required Unit
tests aggregate remains failed; registration does not repair or waive it.

SPN-090 has no dependency on SPN-157 for these two named scenarios. Its own later
validation found a distinct postcommit authentication-readiness fixture gap, now
owned by [SPN-158](SPN-158.md); SPN-090 explicitly waits on that repair. All of its
current-head checks, reviews and visual acceptance still apply.
This does not complete the distinct pre-launch SPN-156 list-view reconnect outcome.
No maintenance runtime change is included in this registration. The grooming date
and completion counter are retained; this is not a full grooming.

**Early capability checkpoint:** establish the durable journal, fixed-role process
handoff and IPC/kernel ordering at each failing boundary before substantial code
changes. Reassess **L** if isolation requires a broader lifecycle architecture.
Account for implementation, persistence, authority, cleanup, deterministic negative
controls and bounded real Linux acceptance together; any split must retain every
remaining requirement and estimate. Keep all existing deadlines and assertions.
Blanket retries, timeout increases and skips are not a repair.

**Persona tradeoffs:**

- **Operator — L:** reliable recovery, truthful phase/failure reporting and closed
  orphan resources protect the instance; a separate investigation keeps the cause
  and operational acceptance reviewable.
- **Owner — L:** original rows and a correctly authenticated selected restore must
  survive interrupted ownership without a false writable/ready state.
- **Collaborator — L:** shared documents and access must survive the same lifecycle;
  recovery cannot admit work against an uncertain or wrong candidate.
- **Link guest — M:** availability of an already-authorized share may improve after
  recovery. No new document, dashboard or management authority is granted, and
  revoked/unauthorized access must remain refused.

## 🧪 Retained first failure and comparator

The delivery manager independently verified these run identities. Both attempt 1
runs used source `2204b8c40ce6feb8ad03c65720c976510535ad00`, base
`ebf0842f51b60d54649cf8a03065914bec0944bf`, tested merge
`62bc0229c5675ff519b733cfc8f3c9a7e6e918d8` and tree
`d6bb81924f90aab2d2f2172927f847e412366816`. The supervisor files match main; these observations establish neither that
feedback caused the failures nor that feedback startup/drain behavior is independent.

- **First successful comparator:** [run 43540593013](https://github.com/mxbaylee/spinel/actions/runs/43540593013),
  [supervisor job 132280423639](https://github.com/mxbaylee/spinel/actions/runs/43540593013/job/132280423639).
  The two later-failing cases passed in **824 ms** and **10.181 s**, respectively.
- **Retained failure:** [run 43544143900](https://github.com/mxbaylee/spinel/actions/runs/43544143900),
  [supervisor job 132291548937](https://github.com/mxbaylee/spinel/actions/runs/43544143900/job/132291548937):
  **129 passed, 2 failed of 131**. `SIGKILL at durable running reconciles into
maintenance with original rows and closed orphan handles` failed after **8.814 s**
  with a generic maintenance error. `complete application and authenticated archive
commit and release the selected candidate: readiness-first` failed after
  **23.720 s**, with ready false / recovery-required.
- [Required Unit tests aggregate 132293846852](https://github.com/mxbaylee/spinel/actions/runs/43544143900/job/132293846852)
  failed correctly. The successful comparator does not supersede that failure.

The subsequent SPN-157 agent source audit found that the named SIGKILL test verifies
and starts maintenance before arming the crash, and swallows the transition RPC
rejection. Its generic maintenance error could arise in pre-crash setup or later
status; the failed scenario does **not** establish that SIGKILL reconciliation itself
failed. Isolate the failing stage before attributing a product or fixture defect.
The complete recovery contract above remains required.

[Immutable first-failure evidence](https://github.com/mxbaylee/spinel/tree/5e1b7a9fac17c69ff9174caa9da9f8d13713737d/docs/review-assets/spn-098-failure-43544143900)
preserves the original hosted failure beyond expiring job artifacts.

A child handoff timeout at `src/server/maintenance/ownership.ts:221` was observed;
its exact causal relationship to either failing case is **unproved**. Preserve
phase/action/lastFailure/controllerFailure and fixed-role handoff diagnostics when
isolating it. Distinguish an observation from an established product or fixture
cause. This is an actual Linux boundary; no macOS result establishes Linux repair.

The existing `src/server/maintenance/supervisor.test.ts` and ownership/restore
fixtures own the regression. Deterministic ordering tests should establish the
specific state transition and negative control before bounded Linux integration
confirms actual SIGKILL, kernel/process ownership, persistence and cleanup. Retain
original rows, candidate identity, authenticated admission and access refusal
through success, failure and interruption. Review CI selection for all shared
source and fixture dependencies, with selected missing/failed work unable to pass.
The separate SPN-157 local diagnostic work is not imported here and does not
complete the original L outcome. No implementation, fresh reproduction or repair
acceptance has been performed by this registration; the exact hosted job links supplement this maintained narrative.

## 🧯 Diagnostic prerequisite with full recovery retained

**Date/status/source:** 2026-11-13, accepted agent delivery-manager sequencing
under standing four-persona authority. [SPN-160](SPN-160.md) registers the complete
**M** first-failure diagnostic outcome: immediate pre-barrier rejection, immutable
bounded handoff receipts, readiness context, privacy/cleanup controls and actual
Linux diagnostic acceptance. Its source-level swallowed-rejection defect is useful
to repair independently of reproducing either original incident.

Add SPN-160 as a prerequisite; SPN-157 remains **open, L**, retaining both original
SIGKILL/original-row/orphan and readiness-first authenticated candidate commit/release
investigations and demonstrated repairs, with every authority, persistence, process,
interruption and native requirement above. Remaining effort is **M + L**. SPN-098
continues to wait on SPN-157. An instrumented pass without recurrence proves no
historical cause or repair; a failure still blocks the diagnostic PR. No original
acceptance is removed to change a review result.

Operator receives actionable bounded private evidence; Owner and Collaborator
retain original/shared data and authenticated fail-closed admission; Link guest
gains no new access or management visibility. The cost is a distinct complete
verification step before unresolved recovery work. SPN-123's production emitter
inventory and SPN-128's preserved-original recovery command remain independent
full outcomes, as recorded in [the boundary decision](SPN-160.md#-retained-recovery-scope-and-neighboring-work).

## 🔬 Feedback-source investigation checkpoint

**Date/status/source:** 2026-11-14, accepted investigation disposition, recovery
outcome incomplete. SPN-157 agent judgment, coordinated with the delivery manager,
under the [standing decision authority](../todo/process.md#decisions). This is a
local checkpoint for later review, not a completed ticket or permission to merge
SPN-098. SPN-160 has landed; the historical M + L accounting above is preserved.
SPN-157 remains **open, L**, with both original investigations and all authority,
persistence, ordering, interruption, data and native cleanup acceptance intact.
SPN-098 still depends on SPN-157.

**Question and options:** after instrumented main and feedback-source Linux runs
pass, is there a demonstrated defect supporting a repair or another experiment?
Options were to repeat broad validation, introduce speculative protocol changes
or more instrumentation, or retain the unresolved outcome with a precise evidence
boundary and continue other eligible work. Choose the last option: no current
demonstrated defect supports an arbitrary repair or unchanged rerun. No human
product/design sign-off is needed, and no historical failure is relabelled a pass.

### 🧪 Current source and native evidence

The first instrumented feedback-source run used source
`5e72d33ac9cb3a86b3496345209493d6c86e469c`, base
`754e65317744e5ce97ede501935c6586e4875f2a`, tested merge
`c603a21de6446d623145589eca811ab6dfb38152`, and source/tested tree
`f9cf0bc6e26551713a0d66f5b273d944c44a10fc`:

- [CI 43572824567](https://github.com/mxbaylee/spinel/actions/runs/43572824567),
  attempt 1, [supervisor 132380865473](https://github.com/mxbaylee/spinel/actions/runs/43572824567/job/132380865473):
  **131/131 passed, 258.22 s**; durable-running **696 ms**, readiness-first
  **7,092 ms**.
- [Recovery 132380865510](https://github.com/mxbaylee/spinel/actions/runs/43572824567/job/132380865510):
  **619/619 passed across 49 files, 258.03 s**, on the same attempt/source.
- The agent independently decoded and checked the complete staged original logs
  in `/tmp/spn098-post160-20261114/hosted/publication/`. For
  `supervisor-original.log.gz`, stored SHA-256 is
  `2f233121f79699727bf7c6d3cea7038ad1e81b513d5fd07f5d85d0e0eb12b01a`
  and decoded SHA-256 is
  `f5f45fe1b82506c70371cf416dac98d1aa1dc9bd89765f516081f14802bec593`.
  For `recovery-original.log.gz`, stored SHA-256 is
  `d8ec3de9252efa6353dfbc35dee3ab836f903839abc147de3cfc5f7494a07e36`
  and decoded SHA-256 is
  `5bff837dee2e10592ac3513266e72ac499a7a6e1c2c491035edd9b895716a911`.
  These scratch paths are resumable receipts, not a claim of durable publication;
  SPN-098 owns the terminal archive. Other jobs were still pending at this
  checkpoint; these two successes are not an all-gates verdict.

This closes the earlier main-only validation gap: the complete feedback consumer
now ran with SPN-160's evidence controls. Neither case recurred, so no new failing
stage was observed. The original failed verdict and successful comparator above
remain independent evidence, not superseded history.

### 🧬 Source boundary and hypothesis disposition

Comparison of original `2204b8c4` with `5e72d33a` found no change in `server/app.ts`,
diagnostics or backup runtime, the database adapter, manifests/lockfile, or
`supervisor.ts`. Relevant maintenance changes are SPN-160's ownership failure
reporting and controls, and SPN-158's separate restore-crash fixture/client repair.

- **Durable-running:** the test launches `supervisor-fixture.ts`, which launches
  `app-fixture.ts`, not `server/index.ts`. The inspected relative runtime import
  closures of the supervisor, application, verifier and seed fixtures contain no
  SPN-098 changed module. Its CI partition runs only `supervisor.test.ts`.
  Direct feedback construction/worker/drain execution is therefore not a supported
  mechanism for this case. Shared runner conditions remain unmeasured. The original
  generic error still cannot distinguish pre-crash verify/start from reconciliation.
- **Readiness-first:** the full application imports changed diagnostics modules,
  but `server/index.ts:29` awaits maintenance connection and ownership before
  `server/app.ts:208` constructs `DiagnosticsStore`. Synchronous construction can
  consume the parent's startup budget, but cannot block that same child's
  still-pending ownership receiver. The historical timeout lacks reliable child
  attribution. The fixture deliberately buffers `held`; that alone cannot explain
  its observed `privateReadyObserved:false`, set immediately on private readiness.
- **Feedback lifetime:** neither scenario prepares feedback. `FeedbackExports`
  construction only assigns fields; workers, timers and staging directories start
  in `prepare`. Its idle `close` adds an await without an outstanding job. No
  blocking feedback resource or matching feedback cleanup directory is established.
- **Durability setting:** the authorized bounded Mac comparison observed each
  actual `DiagnosticsStore` connection at exact base `ebf0842f` and candidate
  `2204b8c4`: both were available, `synchronous=2` (FULL), WAL, busy timeout zero.
  Pinned Node 26.13.0 used identical adapter/lock/workspace sources and the same
  libsql 0.5.29 Darwin arm64 binary. Both connections closed and temporary databases
  were removed. Receipts, source snapshots and command are retained under
  `/tmp/spn157-synchronous-6_80n_85/`; the watchdog passed in 198 ms, before its
  first 200 ms RSS sample. This eliminates the measured Mac configuration
  differential only; it does not establish Linux defaults, timing or causality.
- **Failure attribution:** ordinary startup schedules its generic start timer
  before the ownership timer, so the first promise rejection can hide later
  ownership detail. That is an interpretation limit, not evidence of an incorrect
  recovery result. No new source-proven contract violation was found.

### 🧭 Remaining evidence and next action

Authorized hosted Linux capabilities are available and have exercised actual IPC,
kernel leases, process identity, persistence and cleanup on the feedback source.
The missing inputs are historical: the failed durable-running RPC action and
whether its barrier was reached; readiness-first's first failing durable job phase,
selected child role and ownership progress; reliable attribution of the receiver
timeout; and process/event-loop/filesystem progress during those intervals. The
retained original artifacts do not contain these observations. Later successful
runs cannot reconstruct them.

Preserve this checkpoint, the original failures and the full L outcome; continue
other eligible work. Resume runtime implementation when a stage-specific failure
receipt or source-proven invariant violation supplies a concrete counterexample.
Then first establish the smallest deterministic negative control for that exact
violation, reuse existing fixtures, repair it, and retain current-source Linux
acceptance under unchanged deadlines. A readiness repair must prove both orderings
and refusal of incomplete ownership; a reconciliation repair must preserve original
rows and actual orphan closure; authority expiry must never become fresh admission.
Arbitrary delay injection proves deadline behavior, not these historical causes.
No new diagnostic-only ticket, speculative framework, timeout increase, skip or
blanket rerun is selected. Reassess L if demonstrated work expands into broader
lifecycle architecture; elapsed uncertainty alone does not change the estimate.

**Four-persona tradeoffs:** the Operator receives honest recovery evidence with
bounded investigation cost; the Owner retains exact original/candidate data
requirements; the Collaborator retains truthful readiness and unchanged document
permissions; the Link guest retains isolation and immediate revocation. The cost
is that SPN-098 remains unmerged while SPN-157's recovery outcome is unresolved.
None of these interests is served by inventing a cause or weakening acceptance.

The earlier local branch `codex/spn-157-supervisor-handoffs` remains at
`44f9a5365fe290236b882606933e63b8ef317363`, preserving its unique code and evidence.
This checkpoint starts from actual main `754e6531` on
`codex/spn-157-current-investigation`; it changes documentation only, with no
completion bookkeeping, runtime change, new test run, PR or push.
