# SPN-149 current-head hosted audit — terminal blocked result

**The completed current-head workflow is blocked: `accepted=false`, `mergeAcceptanceEligible=false`.** Run `43373411759`, attempt 1, concluded **cancelled**. Its final required browser aggregate concluded **failure** and retained `passed=false` because the selected Playwright family contains a cancelled worker. The worker also has an independently observed failed first attempt followed by a passing retry, classified as flaky.

Final observation: **2026-11-13T06:38:11.745Z**. All **33 CI jobs** are terminal: **31 successful, one cancelled and one failed aggregate**. All **29 selected execution workers** are accounted for: **28 successful and one cancelled**. No selected result is omitted; no job, gate or artifact remains pending in this audit.

## Exact source, event and run

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

The authoritative plan artifact is `14013253207`: full mode, the exact 18-path current-base diff and all 15 selections enabled. Source and tested commit objects independently establish the reviewed tree. The terminal PR/main observation still matches head, base and tested merge; the PR remains draft and unmerged. Matching source identities do not waive the failed selected gate.

The independent complete-source review remains **100/100**: 35/35 scope, 25/25 correctness/access, 20/20 regression/local verification, 10/10 CI/operations design, and 10/10 maintainability/docs/process. `review-a-integration-977de3a.md` identifies no remaining source-review steps to 100. Hosted status is a separate acceptance gate and did not change the source grade.

## Seven required current-head gates

| Gate | Job ID | Check-run ID | Final conclusion |
| --- | --- | --- | --- |
| [Backlog](https://github.com/mxbaylee/spinel/actions/runs/43373411759/job/131715558972) | `131715558972` | `131715558972` | **success** |
| [Pull request](https://github.com/mxbaylee/spinel/actions/runs/43373411759/job/131714231020) | `131714231020` | `131714231020` | **success** |
| [Lint](https://github.com/mxbaylee/spinel/actions/runs/43373411759/job/131715558929) | `131715558929` | `131715558929` | **success** |
| [Typecheck](https://github.com/mxbaylee/spinel/actions/runs/43373411759/job/131715558993) | `131715558993` | `131715558993` | **success** |
| [Unit tests](https://github.com/mxbaylee/spinel/actions/runs/43373411759/job/131722748867) | `131722748867` | `131722748867` | **success** |
| [Lib tests](https://github.com/mxbaylee/spinel/actions/runs/43373411759/job/131725643298) | `131725643298` | `131725643298` | **success** |
| [Playwright smoke](https://github.com/mxbaylee/spinel/actions/runs/43373411759/job/131734863793) | `131734863793` | `131734863793` | **failure** |

Every CI job/check pair was matched individually to source `64d85c1…`, run `43373411759`, attempt 1 and suite `117448946471`, including exact names, states and result URLs. The final raw check collection returned **43 of 43** entries: exactly 33 CI checks and 10 current-head Storybook checks. All are accounted for. The head-filtered workflow collection contains exactly the CI and Storybook runs, both attempt 1.

## Complete selected execution

| Selected family | Exact job/check-run identities and conclusions |
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
| `doc-responsiveness` | Doc responsiveness (desktop) (`131715558925`): **success**; Doc responsiveness (mobile) (`131715559046`): **success** |
| `doc-callback-lifetimes` | Doc callback lifetimes (desktop) (`131715559123`): **success**; Doc callback lifetimes (mobile) (`131715559133`): **success** |

The classifier, unit aggregate and library aggregate also succeeded; the browser aggregate failed. These four jobs plus the 29 selected workers account for all 33 CI jobs. No selected worker was skipped or absent. The cancelled development 2/2 worker is preserved as cancelled and is not treated as a pass.

The other three plan selections are mode flags. Both responsiveness owners completed their selected baseline observations, candidate verification and paired evidence/comparison successfully. Both callback owners completed the selected baseline, candidate and paired evidence steps successfully. Phone compatibility applies full mode to the existing 11-worker Playwright matrix; 10 workers passed and development 2/2 was cancelled, so that selected mode is not accepted. Exact flag-owner step states are retained in the machine receipt.

## Aggregate result and artifact integrity

| Artifact | ID | ZIP SHA-256 | Result |
| --- | --- | --- | --- |
| ci-plan | `14013253207` | `b18b7b0849cefed15e967f64b5b79f80c8123054a50cbf0d10ffc35ddff62b84` | authoritative full plan |
| ci-results-unit | `14015196118` | `c25af54e78445b24a9945ee7edeffdeffd5a02b5d21528eb6f66e52e486edc3d` | `passed=true` |
| ci-results-lib | `14015067361` | `81ced1845613fd5047fd804c86c9671fb3915e2b7ede7e24507b5c47674e0032` | `passed=true` |
| ci-results-browser | `14015887735` | `62ef52973e10b78bea05af4c54d85ab442ccd22114ec104c9c2dde9e0bd3267e` | `passed=false` |

The final artifact list contains all **23 of 23** entries. Every downloaded plan/aggregate ZIP digest matches GitHub metadata. Unit and library receipts embed the exact current plan/digest and their successful selected-family results.

The browser failure receipt has its failure-specific shape: plan digest, error and serialized 12-family result map. It does not embed the full plan or prerequisite gate map. Those were independently verified from the aggregate log against the authoritative plan artifact. The log also confirms checkout of tested merge `6389a8c…`.

The exact browser error is `Incomplete coverage playwright-run: selected=true, result=cancelled`. The result map records `playwright-run=cancelled`; all other 11 selected execution-family results are `success`. The three prerequisite results are exactly `typecheck=success`, `unit-tests=success`, and `lib-tests=success`. This is the aggregate rejecting incomplete selected coverage.

The browser JSON member SHA-256 is `8942e9927e35786daa7d35255c9f12f406c251a8c1a7b4286a95ff105e0b8d76`. The decoded aggregate-log SHA-256 is `7ba3a48ad79a2d55a733c6e46c93e69275eeb7b2ca0ef4de7448a02d7b5605b8`. The workflow-level conclusion remains **cancelled**, distinct from the aggregate job/check conclusion **failure**; neither is rewritten as success.

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

## Successful case-level and supplementary evidence

All 19 session-revocation controls actually ran and passed in Unit remaining job/check `131715559074`. `hosted-negative-controls-43373411759.json` retains each exact passing line once, actual Node 26.13.0/npm 11.20.0, exact checkout and job/run identities. The selected-line SHA-256 is `93608cc687a5c56eadfae8e3bd47ef885bbfe85a5116965234a2c045384f1f89`; the full decoded-log hash is retained without publishing the raw log.

Reviewer B’s `review-b-native-43373411759-audit.md` confirms both actual SPN-149 owners: development 1/2 job `131715559510` and production 1/2 job `131715559199`. Both passed at retry 0 with no retry/error, complete revocation contract and clean cleanup. The assertions cover real 101 establishment, closure of every frozen protocol target, independent 401 denial, editor removal, surviving-login continuity, the held write forwarded and saved with 200, exact persisted content, native cell after reload and no later matching frames. In both observations the actual protocol close occurred before post-revocation navigation. The owners used different hosted image revisions, separately recorded by B.

Those passing target cases remain valid case-level evidence, but they do not waive the failed selected worker. These current-head observations are ordinary validation. They do not enlarge the closed original two-case diagnostic sample or recover the unavailable historical first-attempt order. The new Space guest failure is separately preserved with its absent first-attempt trace and unresolved process/transport cause.

Current-head Storybook run `43373411761`, attempt 1, completed successfully. All five review workers, build, classifier and aggregate passed; only inapplicable preview/deployment jobs were skipped. All 10 job/check identities match this head and suite `117448946483`; aggregate job/check `131721043444` and its log confirm the tested merge. No previous-head Storybook result is substituted.

Desktop offline remains inapplicable: none of the 18 current-base paths matches `.github/workflows/desktop-offline.yml` filters, and incoming SPN-148 desktop helpers are already in the base. The workflow-discovery result contains no desktop run. This is an applicability determination, not an omitted selected result.

## Preservation, publication and disposition

All 19 first-run manifest files, all 21 older-base edited-run manifest files and all 37 files in the earlier current-head blocked checkpoint were rehashed and remain unchanged. The checkpoint at `2026-11-13T06:34:28.469Z` remains an immutable observation with mobile/aggregate pending then; this separate terminal record supplies their final results. All current workflows remain attempt 1. No failed first attempt was removed or replaced by a retry.

The terminal integrity manifest identifies the verified scratch bytes. The separate publication allowlist identifies the JSON/Markdown content to publish and retains only hashes/byte counts for ZIP and raw `.log` inputs. Raw failed browser archives, screenshots, traces, request data and fixture cookies are excluded. The temporary full cancelled-worker log was deleted after hashing and extracting content-free lines.

**Keep this candidate blocked and unmerged.** The complete selected acceptance is unsuccessful even though source review is 100/100 and the SPN-149 target cases pass. The bounded scope assessment supports preserving the failure and deciding separate evidence-backed diagnosis/repair ownership; it does not justify a speculative shared-process/export repair, added retry, timeout increase, broader diagnostic sample or rerun to seek green.

This audit performed no source/PR/branch mutation, rerun, cancellation, browser execution or local validation workload. It created evidence files only. Final source/base/tested identities, every selected result, the failing first attempt, passing retry, first-attempt evidence limits and exact terminal gate conclusions are retained.
