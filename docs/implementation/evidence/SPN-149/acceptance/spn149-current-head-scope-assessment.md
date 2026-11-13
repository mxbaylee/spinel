# SPN-149 current-head scope assessment and blocking acceptance

## Decision

**Keep PR #282 blocked and unmerged. The retained failure does not support a repair inside SPN-149's approved observation-boundary scope.** The failing first attempt belongs to the Space guest export-snapshot journey, and its transport cause is unproved. A repair to that observer, the shared owned-process fixture, the export route or process lifetime would be separate work from the completed two-login revocation correction.

The current Space guest case is also **not one of SPN-120's finite recorded historical cases**. SPN-120 already owns shared process/readiness diagnostics and its named snapshot-reset investigation, but a similar error string does not silently add this new case to that inventory or prove the same mechanism. Proceeding with broader shared-fixture work here would absorb separate SPN-120 obligations unless scope were explicitly reassessed.

This is an acceptance and scope assessment, not a new source grade. The existing 100/100 review of the complete integrated candidate is unchanged. No hosted result status is deducted from that grade, and the grade does not waive the failed selected-worker gate.

## Exact source and bounded inspection

- Candidate: `64d85c15288017bbfe3434d91fe0647eb2a2d613`.
- Tree: `b293f8c3c816415864c09f185d77e717bab11e38`.
- Base: `977de3a3a7608a05e2103787f4dac01ec180013e`.
- Tested merge: `6389a8c29b337b6e993b699d544ed2e43d86ffed`.
- Workflow: [43373411759](https://github.com/mxbaylee/spinel/actions/runs/43373411759), attempt 1.
- Selected job: [development 2/2, 131715559252](https://github.com/mxbaylee/spinel/actions/runs/43373411759/job/131715559252), concluded `cancelled`.
- Artifact: `14015561426`, `theme-screenshots-development-2`, 29,051,950 bytes, 323 members.
- Archive SHA-256: `2c4da380aa1aa1ff9b29abbd2355ce33060a8e2b61537cd27725edd4945d302c`; independently verified against the existing downloaded archive and GitHub's digest.
- Report member: `playwright-report/development-2-of-2.json`, 1,567,744 bytes.
- Exact report-member SHA-256: `4831258dcc8fa9bca9e7b571147c972911dea5616390709b3c0cdb377a7a9ec2`.

One existing archive was inspected. No source edit, local workload, browser execution, retry, rerun, cancellation or GitHub write was performed. The raw archive was not duplicated or published. Only categorical failures, source locations, runtime identity, attachment metadata and hashes are retained.

The cancelled owner ran Node `v26.13.0`, npm `11.20.0`, Playwright `1.64.1`, Chromium `156.0.8078.4` / revision `1248`, Ubuntu `24.04.5`, image `ubuntu-24.04 20261111.370.1`, and runner agent `2.338.2`. The checkout log independently contains the exact head/base merge and tested merge above. Runner identity is `1000052604`.

## Every actual attempt of the failing case

The report identifies `e2e/space-guests.spec.ts:892`, “an Edit Space guest manages native pages and loses every child on rotation, downgrade and revocation”, as `flaky`. Its ID is `616f14ec52821b3809e5-b31d48a01c2d8f025cbc`.

| Attempt | Start, UTC | Duration | Result | Playwright worker | Retained attachments |
| --- | --- | ---: | --- | ---: | --- |
| Retry 0 | 2026-11-13 06:20:34.280 | 7,822 ms | Failed | 1 | Screenshot and error-context |
| Retry 1 | 2026-11-13 06:20:42.940 | 41,501 ms | Passed | 2 | Trace |

There is exactly one first-attempt error, categorized as an `ECONNRESET` transport read failure in `APIRequestContext.get`. The source locations are `e2e/space-guests.spec.ts:139:44` and the caller at `:905:21`. The raw error and call log contain sensitive fixture details and are omitted.

The first attempt has **no trace attachment**, and its artifact directory contains no trace ZIP. This agrees with the unchanged `on-first-retry` policy at `playwright.config.ts:65`. Its screenshot and error-context are present, but their contents were not copied or used to infer server health. Only retry 1 has a trace; that trace cannot reconstruct the failed attempt. The second attempt also ran in a different Playwright worker.

Configuration remains two retries, one repeat, one worker, `maxFailures: 1`, `failOnFlakyTests: true`, shard 2/2, and a 210,000 ms timeout for this case. There is no retry-2 result. The report records 74 expected cases, one skipped case, one flaky case and zero unexpected cases. This is the only non-expected/non-skipped case in the report. The SPN-149 two-login target case is absent from this shard.

Attachment hashes are retained without publishing their contents:

| Attempt | Attachment | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| 0 | Screenshot | 61,231 | `2d43ddddac121d44cbae0605215ae5aab5ec395235b36484f28d3e9e18e8700c` |
| 0 | Error-context | 9,770 | `fd1a1f20d89a83702eecbaefa9ac3ab3d8c4157583cc7263434da59da94a916c` |
| 1 | Trace | 13,110,785 | `a953fe429d448725d807b6fabf675962de565f23a1e2ded5603ca809c01c3276` |

## What the failure does and does not establish

The failing read observes a Space child's native export through the fixture's authenticated account request context. The source first performs a native Doc edit and awaits its saved UI checkpoint, then awaits the snapshot before comparing saved content. The reset occurs at that read, before the content assertion completes. Later link rotation, downgrade and guest revocation checks in this attempt were not reached. See `e2e/space-guests.spec.ts:898`, `:904`, `:905`, `:1012`, `:1045` and `:1080`.

This is distinct from SPN-149's direct login-session revocation at `e2e/collaboration.spec.ts:458`. Both case titles mention revocation, but the failing boundary is an earlier export observation in a different fixture and shard.

The retained evidence does not establish:

- An infrastructure-only or transient failure.
- A server crash, successful server health check at the failing boundary, or process-exit cause.
- Reuse of a stale connection as the cause of this particular reset.
- An authorization defect, lost content or a failure of SPN-149's closure observer.
- The exact cancellation trigger.

The passing retry proves that the separately executed retry passed. It does not establish which condition differed or cure the first-attempt failure.

### First-cause process evidence is missing

The Space guest fixture starts its own child application using `startApp` at `e2e/space-guests.spec.ts:23`. In `e2e/app-process.ts:82`, startup output is bounded while waiting for readiness. At `:86`, completion removes the readiness close listener and both output collectors; at `:92` and `:93`, stdout/stderr are drained without retaining a post-readiness tail. At `:101`, the helper returns only `close`.

The helper internally notices exit for cleanup, but it does not expose the first-failure process state or a retained post-readiness stderr/stdout tail to this test. Therefore the missing cause cannot be recovered by interpreting a later screenshot, a passing retry, or the generic job cancellation message.

The existing SPN-120 requirements explicitly call for that bounded post-readiness tail and prompt unexpected-exit evidence (`docs/todo/SPN-120.md:41` and `:44`). Implementing that shared boundary would be substantive separate fixture work with its own consumers and negative controls.

### Cancellation remains a separate observed outcome

Reviewer A's job/check receipt establishes a cancelled Playwright step and job. The job ran 1,211 seconds against the unchanged 20-minute job budget. This duration is consistent with the configured limit, but the generic cancellation line does not prove the trigger. The check advertises three annotations; their contents are unavailable through the connected endpoint. Do not infer a user cancellation or a specific timeout annotation.

The flaky first attempt independently blocks acceptance under `playwright.config.ts:39`, irrespective of why cancellation occurred. Neither increasing the job budget nor relabeling the cancellation would make this first-attempt result acceptable.

## Exact source boundaries

The complete current-base diff contains 18 paths. Its executable additions/changes are the single collaboration journey, its private revocation observer and the focused observer controls. The remaining changes are documentation, retained evidence, attribution and completion bookkeeping.

The new observer is invoked only by the collaboration journey at `e2e/collaboration.spec.ts:409`; its other consumer is the focused control file. It is not imported by the Space guest fixture. It makes no global request-client or process-supervision change. The cancelled report does not contain the SPN-149 target case.

I independently compared Git blob identities at base and candidate for every row below. All are byte-identical; exact blob IDs and file SHA-256 values are retained in `spn149-current-head-source-boundaries.json`.

| Unchanged source | Relevant boundary |
| --- | --- |
| `e2e/space-guests.spec.ts` | Owned fixture at line 19; export snapshot read at 139; failing caller at 905 |
| `e2e/app-process.ts` | Child creation, readiness observation and post-readiness evidence limitation |
| `src/server/workspace/space-native-routes.ts` | Existing account-scoped export handler at line 141 |
| `src/server/workspace/portable.ts` | Existing portable export implementation at line 275 |
| `server/app.ts`, `server/index.ts` | Application composition and child entry point |
| `e2e/restore-snapshot.ts` | Separate existing restore observer |
| `playwright.config.ts` | First-retry tracing, retry count and flaky-test gate |
| `.github/workflows/ci.yml` | Selected worker and its existing budget |
| `docs/todo/SPN-120.md` | Existing finite inventory and shared-process obligations |

These boundaries show no direct implementation overlap or demonstrated causal link to the SPN-149 correction. They do not justify dismissing a selected failure merely because its owner is unchanged.

## Maintained scope and historical ownership

1. **SPN-149 is the bounded session-revocation observation correction.** The original ticket, retained at the current base, separates it from SPN-120's finite inventory and requires all selected current-head gates. The maintained implementation states the distinct M scope at `docs/implementation/SPN-149.md:25`, limits the outcome to observation correction at `:56`, and expressly incorporates no SPN-120 work at `:221`. The grooming record repeats that separation at `docs/implementation/grooming-2026-11-12.md:62` and `:90`.

2. **SPN-120's historical snapshot reset is a different recorded case.** The original audit identifies `sync-client.spec.ts:347`, run `40461836024`, job `122048106950`, in sync production (`docs/implementation/ci-reliability-2026-10-28.md:51`). Its explicit split to SPN-120 retains the finite historical inventory (`:164`). The current failure is a later development Space guest export observation on different source and phase. `docs/implementation/SPN-118.md:226` already warns that a shared observation symptom at a different endpoint/phase does not establish identical causality.

3. **SPN-120 is not an unrestricted repair bucket.** `docs/todo/SPN-120.md:35`, `:38`, `:39` and `:47` require named-case dispositions and bounded shared-boundary work. Its allowed setup recovery requires a healthy owned server and fatal negative controls (`:43`); the current evidence does not establish that health classification, and this read occurs after product editing rather than initial setup. Its original first-attempt and no-retry-to-green rules remain binding (`:45`).

4. **The existing restore transport correction is a precedent, not proof for this case.** `docs/implementation/SPN-115.md:450` records first-attempt trace evidence, an observed idle interval and concurrent successful requests before the narrow restore observer correction. `e2e/restore-snapshot.ts:4` requests a fresh connection lifecycle without adding a retry. That helper is unchanged and is not used by this Space guest snapshot. The current first attempt lacks the corresponding trace/process evidence; copying that transport change based only on the error code would be a new, unproved repair.

A demonstrated shared fixture defect could be addressed through an explicitly scoped shared-fixture workstream while preserving all SPN-120 requirements. A demonstrated export/product/runtime defect would need the appropriate separate owner. Neither mechanism has been established in this bounded read-only assessment.

## Smallest allowed next step and merge block

**Finish and publish the blocked checkpoint.** Retain this exact first failure, its passing retry, absent first-attempt trace, process-observability limit, cancellation uncertainty and terminal aggregate verdict. Keep the PR draft/unmerged and the candidate unchanged. Reviewer A owns the remaining matrix/aggregate record.

The current authorization does not justify a speculative Space export fix, broad `startApp` rewrite, newly classified setup retry, additional diagnostic sample, timeout increase or repeat of the same workflow to seek green. The initial SPN-149 sample remains closed, and both successful SPN-149 current-head target cases remain valid case-level evidence without satisfying the failed selected-worker gate.

If work resumes beyond this checkpoint, the next decision is a separately scoped, evidence-backed diagnosis/repair ownership decision. It must not silently expand SPN-120's historical inventory or SPN-149's completed M correction. No new ticket, repair, execution or acceptance waiver is created by this report. Required current-head acceptance remains blocked; no source-review points are changed.

## Retained content-free deliverables

All files are under `/workspace/scratch/13a7bba7afec/validation/`:

- `review-b-development-2-failure-43373411759.json`: independently verified archive/report/member hashes, exact case identity, every actual attempt, categorical error, runtime and limitations.
- `spn149-current-head-source-boundaries.json`: current base/head blob equality and file hashes for the failing owner and shared boundaries.
- `selected-worker-failure-43373411759-131715559252.json`: Reviewer A's job/check/step/cancellation receipt and annotation-access limitation.
- `spn149-current-head-scope-assessment.md`: this assessment.

No raw error, fixture URL, cookie, private request ID, authored value, screenshot content or trace content is included in these review deliverables.
