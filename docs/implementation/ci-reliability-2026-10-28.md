# Main CI reliability and coverage routing — 2026-10-28

**Status:** verified audit; proposed routing and focused follow-ups registered by
the BrowserStack/backlog grooming. **Authority:** owner asked whether tests could
be gated by PR tags or removed because main seems flaky; agent judgment under
the standing delegation. This records the recommendation, not an implemented
workflow change or permission to waive a failing gate. The
[2026-10-26 repair record](ci-reliability-2026-10-26.md) remains historical evidence.

## Sample and current policy

Fetched main `push` runs, then the jobs and original failed attempts. The fixed
completed-run window is **2026-10-26 21:46:31 through 2026-10-28 01:23:12 UTC**:
19 application CI runs, of which **12 succeeded and 7 failed**, and the 19
corresponding Storybook runs, **all successful**. Three application runs were
documentation-only; 16 exercised browser work. The subsequent SPN-109 main run
was still in progress and is excluded. One latest-success application run had a
failed first workflow attempt; that evidence remains below. This short sample
spans different source revisions and is not a long-term failure probability.

At inspected main `54de870f2f4956a05b190ffcff66c20a374995d4`, every non-documentation
change selects ten Playwright partitions, two paired desktop/mobile Doc benchmark
jobs, container smoke and the retained legacy transition. PR `edited` events
also enqueue the full suite; the existing fix preserves an active run instead
of cancelling it. Main pushes repeat the matrix. No scheduled full backstop yet
exists. The seven stable gates and `failOnFlakyTests: true` are unchanged.
Storybook already uses `visual-review` for routine screenshot capture while
keeping interaction checks automatic. BrowserStack and Spaces acceptance have
their own path-scoped PR/manual workflows.

The latest completed main run took about **49 minutes wall time** and about
**170 summed job-minutes**. Its paired benchmark jobs accounted for about
**63.5 job-minutes** (desktop 869 seconds; mobile 2,943 seconds). These are observed
job durations, not a billing estimate. In the inspected failing runs, healthy
sync soaks took roughly 85–146 seconds, retained transition 40–47 seconds and
offline-upgrade 80–98 seconds. They are not the strongest first removal target.

## Failure evidence

Aggregate jobs are consequences, not additional root failures. Five of the seven
failed workflows had cases that passed on test retry, but remained red under the
existing first-attempt policy. The runtime abort and mobile benchmark failures
are distinct. Historical symptoms require current-revision diagnosis.

| Main run / substantive job | Observed original failure | Follow-through |
| --- | --- | --- |
| [40614724560 / 122574501071](https://github.com/mxbaylee/spinel/actions/runs/40614724560/job/122574501071) | SPN-108 mobile: plain trial 2 p95 206.1 ms against 200 ms; plain trial 3 and profile each hit a 300,000 ms cap. Profile text observation reached only part of paragraph 12 of 16 before the workload deadline. | Preserve latency, exact-content and completion gates. Incomplete input is not proof of permanent data loss. SPN-113 owns established callback lifetime work; these symptoms alone do not establish that one cause explains all failures. |
| [40598674501 / 122521092037](https://github.com/mxbaylee/spinel/actions/runs/40598674501/job/122521092037) | Production 2/2: `offline-sign-out.spec.ts:314` and `passkey-management.spec.ts:61` initially lacked the My files heading within 5 seconds; both passed on retry. | SPN-116: distinguish account/authentication readiness from product behavior. |
| [40576342950 / 122443889408](https://github.com/mxbaylee/spinel/actions/runs/40576342950/job/122443889408) | Development 2/2: Node 26.12.1/Vite aborted with “Lazy deopt after a fast API call with return value is unsupported”, a Buffer.byteLength/HTTP stack and illegal instruction. Later retries saw connection refused; 38 tests did not run. | SPN-117 owns runtime investigation. Report the process crash as the cause rather than retrying navigation against a dead server. |
| [40469868909 / 122074199787](https://github.com/mxbaylee/spinel/actions/runs/40469868909/job/122074199787) | Sync production: `offline-recovery.spec.ts:457`, unfinished Sheet draft, 180,000 ms timeout and context close; second retry passed. | SPN-116: preserve draft recovery; establish which phase timed out. |
| [40461836024 / 122048106950](https://github.com/mxbaylee/spinel/actions/runs/40461836024/job/122048106950) | Sync production: `sync-client.spec.ts:347` snapshot GET encountered ECONNRESET, then passed on retry. | SPN-116: diagnose request/server lifetime without an unconditional retry. |
| [40449582938 / 122008969704](https://github.com/mxbaylee/spinel/actions/runs/40449582938/job/122008969704) | Development 1/2: two `doc-phone-navigation.spec.ts:111` editor/guest cases hit 150,000 ms while navigating/reloading, then passed on retry. | SPN-116: historical reproduction input. Subsequent phone changes may already alter this case. |
| [40424121801 / 121925641718](https://github.com/mxbaylee/spinel/actions/runs/40424121801/job/121925641718) | Production 1/2: same phone-navigation case failed the caret-in-view assertion, then passed on retry. | Retain the visible-caret contract and recheck current code; SPN-072 has since landed. |

Additional first-attempt evidence:
[40537669633 / 122307404648](https://github.com/mxbaylee/spinel/actions/runs/40537669633/job/122307404648)
failed `src/server/sync/transition.test.ts:120`: after the fixture served and edited
the converted destination, resuming the **same bundle** correctly refused with a
verification error, but the destination SQLite digest then differed. This is not
the separate wrong-dataset case. Workflow attempt 2 passed on the same SHA.
WAL/checkpoint timing versus unexpected mutation is unresolved; preserve the
immutability contract and investigate separately from browser fixtures.

## Runtime and destination follow-ups

**Accepted registration, agent judgment 2026-10-28.** Register separate bounded
repairs because the demonstrated runtime and preservation failures have different
causes and acceptance from shared browser fixtures.

- **SPN-117, M effort / Operator M impact:** Node remains pinned to 26.12.1.
  The five-commit range from failing `a9893ce` to `54de870` changed no runtime pin,
  Dockerfile, package manifest/lockfile or Vite configuration. The fatal response
  trace involves a large development asset; it does not establish a production
  crash or a Sheet product defect. Isolate the trigger and choose a supported
  runtime remedy or narrow mitigation, then verify development and production/
  container behavior. Source/runtime comparison establishes continued applicability,
  not a fresh reproduction.
- **SPN-118, M effort / Owner and Collaborator L impact:** the full contents of
  `src/server/sync/transition.ts`, `src/server/sync/transition.test.ts` and
  `scripts/sync-transition/verify.ts` are unchanged from failing `2361a236` to
  `54de870`. The importer already verifies completed destinations read-only;
  fixture teardown awaits history/collaboration closure and closes its database.
  Diagnose writer/lifecycle/checkpoint versus importer mutation with byte and
  logical-content evidence. Preserve the refusal and newer work; a same-SHA
  retry pass does not explain the failure. L impact follows the existing document
  preservation contract, not a claim that actual documents were lost.

Neither follow-up depends on optional CI labels or licenses removal of its failing
assertion. Existing SPN-113 retains native callback ownership; no new ticket
duplicates that supported-upstream repair.

## Coverage routing

**Proposed, agent judgment 2026-10-28; SPN-115.** Start with the largest avoidable
work and prove coverage equivalence. Keep current policy until that ticket's
reviewed implementation lands. Labels are coverage additions, not the sole gate
for safety-relevant code.

| Work | Proposed automatic coverage | Additional runs |
| --- | --- | --- |
| Candidate native Doc correctness and existing latency contracts | Relevant input/history/sync/storage/server/auth/build/runtime/dependency changes; unknown changes fail closed to full coverage | `ci-full`, scheduled and manual full plan |
| Historical paired baseline, native profiles and causal comparison | Changes to performance contracts, input/history scheduling, SDK behavior or benchmark harness; complete dependency closure | `ci-performance`, `ci-full`, scheduled and manual full plan |
| Repeated phone scenarios | Explicit production/mobile-HTTPS owners for ordinary behaviors, instrumented sync owners for observation-dependent cases, retained development compatibility | Full compatibility plan; remove duplicate executions only after mapping unique assertions |
| PR title/body-only edits | Cheap PR-rule validation; preserve already-running code evidence | A base retarget, ambiguous edit or unavailable range selects full coverage |
| Soaks, retained transition and container smoke | Keep existing routing initially; later change only with a documented domain/dependency map | Full backstop before any routine reduction |

`doc-mobile.spec.ts` currently participates in development, production,
mobile-HTTPS, sync-development and sync-production. Seven ordinary phone cases
therefore execute 35 times; three observation-dependent cases execute in the two
sync projects. Similar dimensions do not automatically make every execution
redundant. Preserve HTTPS/service-worker boundaries, real development/production
behavior and instrumented/plain differences while assigning coverage ownership.

Require one explicit event/changed-path plan and keep the seven required check
names stable. A selected job must succeed. An explicitly inapplicable job may be
reported as such; a missing plan, unknown path, unavailable diff, missing selected
job, cancellation or failure must not become success. Labels added or removed
recompute the plan; removal cannot reduce automatic requirements. Test edited
events separately from code pushes and base retargets, using the immutable event
base and the entire PR change range, including deleted paths and both sides of
renames. Metadata-only runs must not replace pending or failed code evidence with
green skipped checks. GitHub allows label-triggered PR events, and a conditionally skipped job
reports success, so an aggregate must validate the plan rather than infer health
from a skipped result. See official
[events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
and [job conditions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-jobs-with-conditions).

Keep main validation in this first routing ticket. Reusing PR results after merge
would add a separate proof problem: up-to-date tested tree identity, full required
evidence, direct pushes and missing results. Defer that mechanism. Schedule and
manual execution must have an explicit full plan, independent of absent PR labels.
BrowserStack and live-provider acceptance keep their separate authorized path/manual
scope rather than gaining recurring external runs implicitly. Update maintained
policy and classifier/aggregate tests with the eventual implementation; do not
retroactively waive the grooming PR's selected checks.

## Focused stabilization and persona effects

**Accepted registration, agent judgment 2026-10-28.** SPN-116 owns shared browser
fixture/state-observation and bounded cleanup repairs after current-main
reproduction. Predeclare a small repetition budget, preserve every attempt and
distinguish a demonstrated fix from failure not reproduced. Missing readiness or
a dead server must still fail. No arbitrary sleeps, blanket timeout increases,
unconditional network retries, skipped assertions or disabled flaky-test gate.

Runtime selection, migration immutability and SDK callback ownership are distinct
investigations. A genuine application defect keeps its reproducer and moves to
the appropriate focused repair; fixture work cannot claim it solved by rerouting.
Operator gets faster and more dependable maintenance feedback. Owner retains
exact authored/saved content, recovery and useful undo. Collaborator retains peer
convergence and current access. Link guest retains scope, viewer denial and
revocation. None of those protections is optional because a label is absent.
