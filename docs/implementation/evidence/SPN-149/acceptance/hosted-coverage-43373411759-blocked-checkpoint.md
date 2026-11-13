# SPN-149 current-head hosted audit — blocked checkpoint

**Acceptance is blocked: `accepted=false`, `mergeAcceptanceEligible=false`.** The selected development 2/2 worker was cancelled and its report/log independently records a failed first attempt followed by a passing retry, classified as flaky. Neither passing revocation targets nor the six successful required gates waive that result.

Observation: **2026-11-13T06:34:28.469Z**. This is a dated checkpoint while the workflow is still running. It is not a completed-run verdict. No pending job or absent artifact is counted as passed.

## Exact identity

| Identity | Value |
| --- | --- |
| Source/head | `64d85c15288017bbfe3434d91fe0647eb2a2d613` |
| Source and tested tree | `b293f8c3c816415864c09f185d77e717bab11e38` |
| Current/tested base | `977de3a3a7608a05e2103787f4dac01ec180013e` |
| Tested merge | `6389a8c29b337b6e993b699d544ed2e43d86ffed` |
| Workflow / run / attempt | `387826308` / `43373411759` / `1` |
| Check suite | `117448946471` |
| Event / action | `pull_request` / `synchronize` |
| Plan digest, excluding final newline | `091ffd83314226a908cfb65ce03c796cd4e7002391da676946efbdeae0ce4e9b` |
| Exact plan file SHA-256 | `58e7eb4d7951df39331a72b170ee55770a876d70283d507c8913f5003ad1ddff` |
| Plan ZIP SHA-256 | `b18b7b0849cefed15e967f64b5b79f80c8123054a50cbf0d10ffc35ddff62b84` |

The authoritative plan artifact is `14013253207`. Its exact source, base, tested merge, 18 changed paths and all 15 selections were verified. Source and tested commit objects independently establish the same reviewed tree. At this checkpoint the live PR head, base, tested merge and main ref still matched these identities. Freshness cannot overcome the failed selected gate.

The independent source review remains **100/100**: scope 35/35, correctness/access 25/25, regression/local verification 20/20, CI/operations design 10/10, maintainability/docs/process 10/10. There are no remaining source-review steps to 100 in `review-a-integration-977de3a.md`. Hosted status is not a scoring component.

## Seven required current-head gates

| Gate | Job ID | Check-run ID | Observed state |
| --- | --- | --- | --- |
| [Backlog](https://github.com/mxbaylee/spinel/actions/runs/43373411759/job/131715558972) | `131715558972` | `131715558972` | success |
| [Pull request](https://github.com/mxbaylee/spinel/actions/runs/43373411759/job/131714231020) | `131714231020` | `131714231020` | success |
| [Lint](https://github.com/mxbaylee/spinel/actions/runs/43373411759/job/131715558929) | `131715558929` | `131715558929` | success |
| [Typecheck](https://github.com/mxbaylee/spinel/actions/runs/43373411759/job/131715558993) | `131715558993` | `131715558993` | success |
| [Unit tests](https://github.com/mxbaylee/spinel/actions/runs/43373411759/job/131722748867) | `131722748867` | `131722748867` | success |
| [Lib tests](https://github.com/mxbaylee/spinel/actions/runs/43373411759/job/131725643298) | `131725643298` | `131725643298` | success |
| Playwright smoke | — | — | pending; not created at checkpoint |

All observed CI jobs/check runs match source `64d85c1…`, run `43373411759`, attempt 1 and check suite `117448946471`. The final browser aggregate has not been created; its ID is deliberately absent. The raw current-head check listing returned all **42 of 42** entries: exactly 32 CI checks and 10 checks for current-head Storybook suite `117448946483`. Every observed entry is accounted for.

## Every selected worker

**32 current CI jobs: 30 successful, one cancelled and one running.** The plan’s 12 execution families contain 29 workers: 27 successful, one cancelled and one running. All 29 selected workers are present. The other observed jobs are the successful classifier and successful unit/library aggregates. The third aggregate is still pending.

| Selected family | Exact job/check-run identities and results |
| --- | --- |
| `backlog` | Backlog (`131715558972`): **success** |
| `pull-request` | Pull request (`131714231020`): **success** |
| `lint` | Lint (`131715558929`): **success** |
| `typecheck` | Typecheck (`131715558993`): **success** |
| `unit-tests` | Unit tests (supervisor) (`131715559008`): **success**; Unit tests (recovery) (`131715559026`): **success**; Unit tests (remaining) (`131715559074`): **success** |
| `lib-test-run` | Lib tests (dense-cells) (`131715558963`): **success**; Lib tests (cells) (`131715559014`): **success**; Lib tests (mixed-fuzz) (`131715559010`): **success**; Lib tests (remaining) (`131715558966`): **success** |
| `playwright-run` | Playwright smoke (development 1/2) (`131715559510`): **success**; Playwright smoke (development 2/2) (`131715559252`): **cancelled**; Playwright smoke (production 1/2) (`131715559199`): **success**; Playwright smoke (production 2/2) (`131715559183`): **success**; Playwright smoke (mobile-https) (`131715559376`): **success**; Playwright smoke (sync-development) (`131715559295`): **success**; Playwright smoke (sync-production) (`131715559136`): **success**; Playwright smoke (sync-soak-sheet) (`131715559159`): **success**; Playwright smoke (sync-soak-doc) (`131715559173`): **success**; Playwright smoke (offline-upgrade) (`131715559196`): **success**; Playwright smoke (supervised-restore) (`131715559115`): **success** |
| `container-smoke` | Container smoke (`131715558949`): **success** |
| `restore-timing` | Sized restore acceptance (`131715559043`): **success** |
| `sync-transition` | Retained sync transition (`131715559030`): **success** |
| `doc-responsiveness` | Doc responsiveness (desktop) (`131715558925`): **success**; Doc responsiveness (mobile) (`131715559046`): **in_progress** |
| `doc-callback-lifetimes` | Doc callback lifetimes (desktop) (`131715559123`): **success**; Doc callback lifetimes (mobile) (`131715559133`): **success** |

The remaining three selections are mode flags, not additional standalone jobs. `responsiveness-baseline` has both desktop/mobile owners: desktop completed, mobile’s candidate responsiveness/boundary step is still running and its paired comparison is pending. `callback-baseline` has both successful callback owners with baseline, candidate and paired evidence steps. `phone-compatibility` applies full mode to the existing 11-worker Playwright matrix; development 2/2 is cancelled, so that full selected mode is not accepted. Exact owner-step states are retained in the machine receipt.

## Decisive development 2/2 blocker

Selected job and check `131715559252` ran from `2026-11-13T06:05:37Z` to `2026-11-13T06:25:48Z`. The Playwright step is `cancelled`; artifact upload and cleanup completed. The report/log records a failed first attempt in `e2e/space-guests.spec.ts:892`, “an Edit Space guest manages native pages and loses every child on rotation, downgrade and revocation”. The error category is `apiRequestContext.get: read ECONNRESET` during the fixture export snapshot at line 139, called from line 905. Retry 1 passed. The final report summary is 74 expected/passed, one skipped and one flaky. `failOnFlakyTests` remains true.

The selected cancellation blocks acceptance, and the observed first-attempt failure/passing retry independently violates the flaky-test gate. The failed first attempt is retained; it is not replaced by the retry. The exact failure cause is unresolved. Sharing an `ECONNRESET` category with a different historical case does not establish the same cause or assign this case to SPN-120.

The job’s 1,211-second duration is consistent with the existing 20-minute cap at `.github/workflows/ci.yml:435`; that observation does not prove the cancellation trigger. The check advertises three annotations, but the connected endpoint rejects annotation retrieval. Root’s single public job-page fallback returned `DisabledError` without content. No user cancellation or pure infrastructure cause is inferred. These access limits are not the primary acceptance blocker.

| Failure evidence | Exact identity |
| --- | --- |
| Artifact | `14015561426`, `theme-screenshots-development-2` |
| Archive SHA-256 | `2c4da380aa1aa1ff9b29abbd2355ce33060a8e2b61537cd27725edd4945d302c` |
| Report member | `playwright-report/development-2-of-2.json` |
| Report member SHA-256 | `4831258dcc8fa9bca9e7b571147c972911dea5616390709b3c0cdb377a7a9ec2` |
| Decoded full log SHA-256 | `b1e0bf68b99b17f48551a27ece72b8a311543c29bf8e5919ddd9f018ff21bc32` |
| Content-free exact line extract SHA-256 | `13c845ebf586acd3f3b27a9ab0d0c45fc7806c709388baa00dd320bdc06a5685` |

Reviewer B completed the bounded case/retry/first-trace inventory and scope assessment using the same scratch archive. The independent inventory confirms retry 0 failed after 7,822 ms, retry 1 passed after 41,501 ms, no retry 2, and no first-attempt trace in either the report or that attempt’s archive directory. Only the retry has a trace; it cannot reconstruct the first failure. The SPN-149 target is absent from this shard. The failing owner, shared process/export boundaries and CI configuration are unchanged from base; no causal link to the SPN-149 observer is demonstrated. Broader fixture/export repair would require a separate scope decision. See `review-b-development-2-failure-43373411759.json`, `spn149-current-head-source-boundaries.json` and `spn149-current-head-scope-assessment.md`. Reviewer A’s `selected-worker-failure-43373411759-131715559252.json` preserves exact job/check/run/step identities and content-free log lines. Raw request URLs, fixture cookies, private IDs, traces, screenshots and authored content are excluded from the publishable receipt. The temporary full job log was deleted after hashing and extraction.

## Completed aggregates and supplementary evidence

| Evidence | Identity | State |
| --- | --- | --- |
| Unit aggregate artifact | `14015196118` | passed; exact current plan |
| Library aggregate artifact | `14015067361` | passed; exact current plan |
| Browser aggregate artifact | absent at checkpoint | pending; not passed |
| Hosted session-revocation controls | Unit remaining job/check `131715559074` | all 19 passed |
| Development target | native owner job `131715559510` | retry 0 passed; no retry/error |
| Production target | native owner job `131715559199` | retry 0 passed; no retry/error |
| Storybook aggregate | run `43373411761`, attempt 1, job/check `131721043444` | success |

Both downloaded unit/library ZIPs match GitHub’s artifact digests and their saved JSON members. Both aggregate receipts contain `passed=true`, the exact current plan/digest and their correct successful selected-family result. The artifact listing contains all 21 entries; `ci-results-browser` is absent at the checkpoint.

The content-free hosted control receipt `hosted-negative-controls-43373411759.json` preserves all 19 exact passing lines once each, actual Node 26.13.0 / npm 11.20.0, checkout of tested merge `6389a8c…`, and job/run identity. Its exact selected-line SHA-256 is `93608cc687a5c56eadfae8e3bd47ef885bbfe85a5116965234a2c045384f1f89`; its full decoded-log hash is recorded without publishing the raw log.

Reviewer B’s current native receipt confirms both actual owning cases passed on retry 0 with full revocation contract and clean cleanup: real 101 establishment, every frozen protocol target closed, independent 401 denial, editor removal, surviving login continuity, queued write forwarded and saved with 200, exact saved content, native cell after reload and no later matching frames. The actual protocol close precedes post-revocation navigation in both observations. The two native owners used different hosted image revisions, which B records separately. These are ordinary current-head validation results and do not enlarge the closed original two-case diagnostic sample or establish the unavailable historical first-failure order.

Current-head Storybook is independently complete: all five reviews, build, classifier and aggregate succeeded; only inapplicable preview/deployment jobs were skipped. All 10 Storybook job/check identities match this head and its suite. The aggregate log confirms tested merge `6389a8c…`. The head-filtered workflow listing contains exactly the CI and Storybook runs, both attempt 1.

Desktop offline is inapplicable for the 18-path current-base diff: none matches `.github/workflows/desktop-offline.yml` path filters. Incoming SPN-148 desktop helpers are already in the base. No desktop workflow was dispatched or substituted for a selected job.

## Preservation and disposition

All 19 first-run manifest files and all 21 older-base edited-run manifest files were rehashed and remain unchanged. Their passed results stay tied to their original source/base/tested identities and never substitute for this blocked current-head result. All observed current workflows remain attempt 1; this audit triggered no new validation.

**The current candidate is not accepted for merge.** The current-head check record is complete as a dated checkpoint, while mobile responsiveness and the downstream browser aggregate remain pending. A later mobile success would complete that portion of the record but would not waive the cancelled/flaky selected worker.

No source change, PR metadata change, branch action, rerun, cancellation, browser execution or local validation workload was performed. Any later completion record must be appended as new evidence without rewriting this checkpoint or the failed first attempt.
