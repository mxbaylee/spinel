# 🔏 SPN-149 maintained acceptance receipt

## ⛔ Current disposition: blocked and unmerged

**PR #282 remains draft and unmerged. The complete current candidate passed both independent source reviews at 100/100, but current-head hosted acceptance failed.** Run 43373411759 ended `cancelled`: 31 jobs succeeded, development 2/2 was cancelled after a recorded flaky first-attempt failure, and the final Playwright aggregate failed. All workers are terminal. Six required gates and Storybook passed; Playwright smoke did not. Earlier successful executions and the two passing SPN-149 cases do not waive this failed current-head acceptance.

This README and [acceptance.json](acceptance.json) are the maintained latest source, review, run and landing record for [PR #282](https://github.com/mxbaylee/spinel/pull/282). Earlier source revisions, exact first attempts and the fixed diagnostic sample remain intact.

| Current identity | Exact value |
| --- | --- |
| Complete reviewed source | `64d85c15288017bbfe3434d91fe0647eb2a2d613` |
| Candidate tree | `b293f8c3c816415864c09f185d77e717bab11e38` |
| Integrated current main | `977de3a3a7608a05e2103787f4dac01ec180013e` |
| Independent reviews | [A](review-a-integration-977de3a.md): 100/100; [B](review-b-integration-977de3a.md): 100/100 |
| Tested PR merge | `6389a8c29b337b6e993b699d544ed2e43d86ffed`; tree equals reviewed tree |
| Fresh CI / Storybook | [43373411759](https://github.com/mxbaylee/spinel/actions/runs/43373411759) / [43373411761](https://github.com/mxbaylee/spinel/actions/runs/43373411761), attempt 1; CI cancelled, final Playwright gate failed; Storybook passed |
| Landing | **Blocked; not merged.** Current-head selected-worker and Playwright-gate acceptance are unsatisfied. |

The [integration record](integration-977de3a-record.json) verifies every changed path and blob. All SPN-149 implementation, regression and historical-evidence bytes remain unchanged. Current main's SPN-148 result is inherited unchanged; only the completion list and CLI-generated index required conflict resolution. Both completions remain recorded, with 21 open tickets. The six relevant local actions passed under Node 26.13.0, shared serialization and the existing memory/time watchdog; each reviewer separately passed the 19 focused controls on this exact committed head. No resource abort occurred.

## 🚫 Current failure and scope checkpoint

The [terminal audit](hosted-final-verdict-43373411759.json) records every selected worker, all seven required gates and the failed browser aggregate. [Current coverage](hosted-coverage-43373411759.md) and [machine-readable history](hosted-coverage-43373411759.json) preserve the complete execution rather than substituting an earlier successful run. All 29 planned execution workers were dispatched: 28 succeeded and development 2/2 was cancelled. The one classifier and three aggregates bring the terminal CI total to 33 jobs: 31 success, one cancelled and one failure. The companion Storybook run succeeded with all five selected review workers.

| Required current-head gate | Exact check / job | Result |
| --- | --- | --- |
| Backlog | [131715558972](https://github.com/mxbaylee/spinel/actions/runs/43373411759/job/131715558972) | Success |
| Pull request | [131714231020](https://github.com/mxbaylee/spinel/actions/runs/43373411759/job/131714231020) | Success |
| Lint | [131715558929](https://github.com/mxbaylee/spinel/actions/runs/43373411759/job/131715558929) | Success |
| Typecheck | [131715558993](https://github.com/mxbaylee/spinel/actions/runs/43373411759/job/131715558993) | Success |
| Unit tests | [131722748867](https://github.com/mxbaylee/spinel/actions/runs/43373411759/job/131722748867) | Success |
| Lib tests | [131725643298](https://github.com/mxbaylee/spinel/actions/runs/43373411759/job/131725643298) | Success |
| Playwright smoke | [131734863793](https://github.com/mxbaylee/spinel/actions/runs/43373411759/job/131734863793) | **Failure** |

The selected [development 2/2 worker](https://github.com/mxbaylee/spinel/actions/runs/43373411759/job/131715559252) retained a first-attempt failure in `e2e/space-guests.spec.ts:892`, “an Edit Space guest manages native pages and loses every child on rotation, downgrade and revocation”. Its authenticated Space export snapshot GET at line 139, called from line 905 after native editing and saved UI checkpoints, failed with `ECONNRESET`. The saved-content assertion and later rotation/downgrade/revocation phases were not reached by that attempt.

| Actual attempt | Duration | Result | Retained first-cause evidence |
| --- | ---: | --- | --- |
| Retry 0 | 7,822 ms | Failed | Screenshot and error-context; **no trace or post-readiness process tail** |
| Retry 1 | 41,501 ms | Passed | Trace belongs to this separate retry in a new Playwright worker |

The report has 74 expected cases, one skipped case and one flaky case. Two retries were configured, but only retries 0 and 1 actually ran. With unchanged `failOnFlakyTests: true`, the first-attempt failure independently prevents acceptance. The job ended cancelled after 1,211 seconds against its existing 20-minute cap. That timing is consistent with the cap; the cancellation trigger remains unconfirmed because the generic cancellation output does not establish it and annotation contents were unavailable. Neither the passing retry nor a timeout explanation could cure the flaky result.

The [independent failed-artifact audit](review-b-development-2-failure-43373411759.json) verifies the 29,051,950-byte archive SHA-256 `2c4da380aa1aa1ff9b29abbd2355ce33060a8e2b61537cd27725edd4945d302c`, the exact report SHA-256 `4831258dcc8fa9bca9e7b571147c972911dea5616390709b3c0cdb377a7a9ec2`, both actual attempts, runtime and attachment inventory. The [selected-worker receipt](selected-worker-failure-43373411759-131715559252.json) preserves content-free job/check/log evidence and the annotation-access limitation. Raw request details, cookies, fixture content, screenshots and traces are excluded from publication.

The [independent scope assessment](spn149-current-head-scope-assessment.md), [source-boundary comparison](spn149-current-head-source-boundaries.json), and [historical ownership audit](spn149-snapshot-owner-history.json) establish no demonstrated causal connection to the SPN-149 observer. The SPN-149 target does not run in the cancelled shard; its fixture, export implementation, shared process helper and relevant configuration are unchanged from main. This does not waive the failed selected worker. SPN-120's finite historical snapshot-reset case is a different `sync-client.spec.ts:347` observation on different source, endpoint and phase; similar error text does not establish the same cause or expand that inventory.

**The next prerequisite is a separately scoped, evidence-backed diagnosis of the Space guest export reset.** The missing first-attempt process/trace evidence does not justify a speculative transport or shared-fixture repair inside SPN-149. No additional test workload, workflow rerun, source repair push, timeout increase, acceptance waiver or new backlog ticket followed this discovery. The original fixed SPN-149 diagnostic sample remains closed. Source-review grades remain 100/100 because hosted acceptance is a separate gate. All required current-head acceptance must be satisfied before any later expected-head squash merge.

The [GitHub checkpoint](spn149-final-github-checkpoint.json) independently verifies that PR #282 is open, draft, unmerged and blocked at the exact source/base above. Both active ticket-owned remote branches are retained. The ticket removal, dependency bookkeeping, grooming completion entry and regenerated backlog index are prepared in the candidate; **they have not landed on main**.

## 🗃️ Earlier candidate identities

The complete initial candidate passed its first hosted acceptance before main advanced. Its audit finalized at 2026-11-13T05:04:18.598Z. These identities are historical; they are not relabeled as execution of the integration above.

| Identity | Exact value |
| --- | --- |
| Complete reviewed source | `db24230dd4df539e2055471f55e50a402596c1fb` |
| Candidate tree | `42cd4dfe89d0281ff5b11aa984053bd0493e22bb` |
| Base main | `04baabd6a68abe7c0b225f8699681532e2205b60` |
| Tested PR merge | `9ee8ac68165f25e097c93f84bb2b20f00fcaf09e` |
| CI run / attempt | [43364365825](https://github.com/mxbaylee/spinel/actions/runs/43364365825) / 1 |
| Storybook run / attempt | [43364365751](https://github.com/mxbaylee/spinel/actions/runs/43364365751) / 1 |
| Metadata CI on the earlier base | [43370718838](https://github.com/mxbaylee/spinel/actions/runs/43370718838) / 1 — retained history; not current integration acceptance |

## 🧾 Additional required executions

The previous-source metadata run [43370718838](https://github.com/mxbaylee/spinel/actions/runs/43370718838) has a separate [native audit](review-b-native-43370718838-audit.md) and [coverage history](hosted-coverage-43370718838.json). Its development and production revocation cases passed retry 0 in 8,853 ms and 5,385 ms, respectively, with the complete contract and clean cleanup; no actual retry occurred. They are ordinary older-base acceptance observations, separate from the fixed initial diagnostic sample. Its [final audit](hosted-final-verdict-43370718838.json) now confirms all 33 jobs and all seven source-bound gates passed on attempt 1, with every selected worker and result artifact verified. This successful history is not current integration acceptance.

The current integration run's [authoritative plan](ci-plan-43373411759.json) and [artifact audit](ci-plan-audit-43373411759.json) select all 15 suite/mode entries and all 29 expected execution workers. Canonical plan SHA-256: `091ffd83314226a908cfb65ce03c796cd4e7002391da676946efbdeae0ce4e9b`. These files prove selection and immutable execution identity. Current core gates Backlog, Pull request, Lint, Typecheck, Unit tests and Lib tests passed. The [current hosted controls](hosted-negative-controls-43373411759.json) confirm all 19 focused controls ran once and passed. [Storybook](storybook-43373411761-attempt-1-final.json) passed its build, all five review workers and aggregate. The [current native audit](review-b-native-43373411759-audit.md) verifies both first attempts: development passed retry 0 in 8,070 ms and production passed retry 0 in 6,431 ms, with actual protocol closure, the full contract and clean cleanup. Development used image 20261101.360.1 and production 20261111.370.1; both used the pinned Node/Playwright/Chromium versions. These are separate current-base acceptance executions, not additions to the closed diagnostic sample. The final browser gate failed on the cancelled selected development 2/2 worker; the case-level passes do not qualify the PR for merge.

The [receipt integrity audit](receipt-integration-integrity.json) verified the prior 55-file publication against its Git tree and hashes. Its stale copied-file count and tested-merge-pending wording are corrected, and its three missing historical references are now included. The final older-run coverage and aggregate receipts are now included. The current receipt manifest recomputes exact-copy counts from its file entries. The [blocked-checkpoint privacy review](spn149-blocked-checkpoint-privacy-review.md) approved the five added failure/scope/history records. Its stale owner-history parent reference is corrected while the earlier unpublished snapshot identity is preserved; timed intermediate run observations remain historical, and the terminal record supplies the final cancelled/failed verdict.

## 🔎 Initial-candidate reviews and controls

[Review A](review-a-2.md) and [Review B](review-b-2.md) are complete independent nonimplementing agent reviews of the initial source above. Each scores **100/100**, with no unresolved findings. They were completed before the validation publication. Their original statements that hosted acceptance was pending remain intact as evidence of that timing; the later audited results below supply hosted acceptance separately. Both reviewers independently passed all **19 focused controls**, with their exact logs and bounded watchdog receipts retained here.

The initial review findings and repairs are preserved in the immutable candidate's [review iteration record](https://github.com/mxbaylee/spinel/blob/db24230dd4df539e2055471f55e50a402596c1fb/docs/implementation/evidence/SPN-149/review-iteration-1.json). The final candidate adds the existing cleanup bound to failed observer setup and retains the required pinned Playwright copyright/license attribution.

[Hosted negative controls](hosted-negative-controls-43364365825.json) independently record all 19 passing in Unit tests (remaining), job 131685834288. A live socket with 401, a closed socket with 200, incomplete establishment, unrelated closes, unclosed targets, reopening, observer loss, and diagnostic overflow still fail the contract. Setup/cleanup controls verify listener ownership, preservation of the original setup error, the existing 5000 ms cleanup bound, and continuation after rejected cleanup. Routing controls preserve existing unit/browser owners for authentication/session, transport, navigation, shared fixtures and harness paths, and reject missing/failed/skipped/cancelled selected results. These controls do not substitute for native closure.

## 🧪 Initial hosted acceptance: passed

The [independent final verdict](hosted-final-verdict-43364365825.json), [full coverage history](hosted-coverage-43364365825.json), and [readable audit](hosted-coverage-43364365825.md) identify every check, worker, source and tested merge. **All 33 CI jobs passed on attempt 1:** one classifier, 29 execution workers, and three aggregates. All 43 checks on that earlier source are accounted for: 33 CI and ten Storybook checks. No selected CI worker was omitted, failed, skipped or cancelled.

| Required gate | Exact check / job | Result |
| --- | --- | --- |
| Backlog | [131685834150](https://github.com/mxbaylee/spinel/actions/runs/43364365825/job/131685834150) | Success |
| Pull request | [131685158763](https://github.com/mxbaylee/spinel/actions/runs/43364365825/job/131685158763) | Success |
| Lint | [131685834166](https://github.com/mxbaylee/spinel/actions/runs/43364365825/job/131685834166) | Success |
| Typecheck | [131685834289](https://github.com/mxbaylee/spinel/actions/runs/43364365825/job/131685834289) | Success |
| Unit tests | [131693806635](https://github.com/mxbaylee/spinel/actions/runs/43364365825/job/131693806635) | Success |
| Lib tests | [131690436695](https://github.com/mxbaylee/spinel/actions/runs/43364365825/job/131690436695) | Success |
| Playwright smoke | [131701094769](https://github.com/mxbaylee/spinel/actions/runs/43364365825/job/131701094769) | Success |

The selected execution workers are grouped below; every individual worker and its immutable job URL is retained in `acceptance.json` and the final verdict.

| Selected family | Workers | Result |
| --- | ---: | --- |
| `backlog` | 1 | Success |
| `pull-request` | 1 | Success |
| `lint` | 1 | Success |
| `typecheck` | 1 | Success |
| `unit-tests` | 3 | Success |
| `lib-test-run` | 4 | Success |
| `playwright-run` | 11 | Success |
| `container-smoke` | 1 | Success |
| `restore-timing` | 1 | Success |
| `sync-transition` | 1 | Success |
| `doc-responsiveness` | 2 | Success |
| `doc-callback-lifetimes` | 2 | Success |

The responsiveness/callback baseline modes execute within their existing paired workers; phone compatibility executes through the existing eleven Playwright workers. These three selected mode flags do not imply extra jobs. Their actual selected steps and applicability are verified in the audit.

The exact uploaded plan digest is `e26b485c286be51036d5d213da96fea7fe251aa4600bdd76612964edbf90d15d`. The extracted plan file has SHA-256 `078f6e5dfd36b69b8b7cb9c5007236c1044ea132a324318a67d74da2a574b5ca`; the difference is the workflow's canonical digest representation. The [unit](ci-results-unit-43364365825-attempt-1.json), [lib](ci-results-lib-43364365825-attempt-1.json), and [browser](ci-results-browser-43364365825-attempt-1.json) aggregate receipts all match the source, base, tested merge and plan. Browser artifact **14012001088** verifies all twelve selected result entries and its three gate inputs; final browser check is **131701094769**.

[Storybook](storybook-43364365751-attempt-1-final.json) completed successfully: eight successful jobs include classification, build, five view workers and aggregation; preview/main publication are explicitly inapplicable skips. No skipped publication step is counted as successful selected validation.

Earlier pending observations inside the unchanged full coverage history are historical snapshots. Its final verdict and the current record above supersede those observations. Run attempt 1 is the only actual initial CI execution; the required metadata-triggered CI is separate run 43370718838, attempt 1, following the consolidated description publication at 2026-11-13T05:14:27Z. It is not a retry of the first run.

## 🔬 Fixed native sample and diagnostic conclusion

**Diagnostic terminology:** `page-close` records the page-associated Playwright WebSocket object’s close callback, not closure of the Page or browser tab. Actual protocol termination is the separate `socket-closed` event from `Network.webSocketClosed`. See the [terminology clarification](review-b-native-event-terminology.md). Original diagnostic bytes, hashes, observed timings and historical limitations are unchanged.

The [pre-execution declaration](declaration.json) records the falsifiable hypothesis, exact source/runtime identities, two controlled browser-free dispatch orderings, the fixed two-case first-attempt native sample, resource budget and stop conditions. The installed-runtime probe demonstrated a conditional observation boundary: clearing Playwright's main-frame socket map before protocol close loses the old page-level close notification. Its immutable result is linked in [candidate-evidence-links.json](candidate-evidence-links.json).

The fixed native sample is now complete, without extra diagnostic executions:

| Existing Chromium owner | Job | Retry | Result | Duration | Protocol close / post-revoke navigation (relative ms) |
| --- | ---: | ---: | --- | ---: | --- |
| Development 1/2 | 131685834643 | 0 | Passed | 10861 ms | 6348 / 6382 |
| Production 1/2 | 131685834559 | 0 | Passed | 4845 ms | 2780 / 2807 |

Both cases observed actual protocol close **before** post-revocation navigation, one established target closed, zero open sockets, and the complete contract with no primary/cleanup failure, observer loss, overflow or reopening. The exact-source journey separately asserts actual termination, 401 denial, editor removal, the surviving login's continuity and forwarded queued write, successful save, absence of later matching broadcasts, and native reloaded content. Sign-in UI and cumulative frame counts alone do not prove those requirements.

**Natural recurrence of the observation gap was not reproduced in the declared fixed sample. The original first-attempt timeline is still missing.** Neither these passes nor the controlled dispatch probe establish the original historical ordering or a product/session security defect. Any later required metadata/base-update acceptance is recorded separately and does not enlarge or retry this closed diagnostic sample.

The [native audit](review-b-native-audit.md), both case summaries, both artifact records, and the exact decoded [development](review-b-native-development-retry-0-observation.json) and [production](review-b-native-production-retry-0-observation.json) diagnostic attachments preserve the observed first attempts. Development attachment: 1540 bytes, SHA-256 `8d6325e0a09c8dccd61cb4c12c868032a36bf91ff0c69b946c94b33d86fef90d`. Production: 1538 bytes, SHA-256 `cdf1ee55cf808d12ca90b01ae11f02f5ece85514f72cd78075873bcbe2c0cfde`. Neither attachment was reserialized or given a new newline.

The runtime was Node 26.13.0, npm 11.20.0, Playwright 1.64.1, Chromium 156.0.8078.4 revision 1248, Ubuntu 24.04.5 image 20261101.360.1. The existing 60-second case deadline, 5-second closure deadline, configured retries, and `failOnFlakyTests` remain unchanged. Neither native case used a retry.

## 🗂️ Historical and local provenance

[Candidate evidence links](candidate-evidence-links.json) retain exact commit URLs, Git blobs, SHA-256 hashes and lengths for the existing historical artifact summaries, attributed Playwright source, controlled probe, every local attempt, prior reviews, implementation record and relevant final source. Those repository files are not duplicated here. The original ticket is pinned to the base commit where it existed.

The historical first attempt observed sign-in and zero page close events; it failed before the later contract assertions and had no retained first-attempt trace. Its successful retry and later unrelated pass cannot reconstruct that timeline or waive failed current-head acceptance. Local pinned Chromium installation failed on the installer's five built-in invalid/empty download attempts; no local browser case ran. These limitations and all local repair attempts remain in the linked immutable evidence.

## 📦 Publication, blocked acceptance and retained branches

This directory is published at `docs/implementation/evidence/SPN-149/acceptance/` on the single maintained branch `evidence/spn-149-acceptance-20261113`. The branch head supplies its current immutable receipt identity. The one consolidated PR description edit links this authoritative record. Its metadata run 43370718838 remains older-source history after main advanced; the guarded source update 64d85c1 requires fresh CI and every applicable companion workflow. Preserve all attempts and exact selected gates/workers here. Recheck main and squash-merge with an expected-head guard only after current-source/current-base acceptance. Record the final immutable receipt locator in the merge message and verify the landed result.

The current failed gate is unresolved, so the candidate is ineligible for merge or post-merge branch cleanup. Keep the active source branch attached to draft PR #282 and retain this reachable evidence branch. The branch heads and PR ownership were rechecked in the GitHub checkpoint; neither branch is obsolete while this work remains unmerged.

If main changes, append a new complete source/review/acceptance entry here while preserving this initial candidate and fixed sample. Every candidate push intended to run CI still requires two independent complete-candidate reviews strictly above 95/100. A later green or inconclusive diagnostic result cannot waive failed current-head acceptance.

**Archive pin and guarded ref deletion are unavailable in the exposed capabilities.** The connector has no tag/archive-pin or ref-deletion action; shell GitHub push lacks a credential and the public browser is signed out. Keep the named evidence branch as the durable reachable copy until an archive pin is created and verified. Do not describe cleanup as complete or rely solely on an unreferenced commit. After landing, recheck implementation/evidence branch heads and PR ownership before any permitted deletion; record the precise remaining prerequisite and branch disposition here.

## 🔐 Retained material and privacy

[Receipt manifest](receipt-manifest.json) covers every published file except itself and records exact-copy provenance. The original [audit inventory](hosted-audit-manifest-43364365825.json) also names hashed ZIPs and raw aggregate logs used by the auditor; those inputs are deliberately omitted from this directory. References to retained audit inputs in the unchanged review reports describe the original audit workspace, not additional published attachments. The extracted machine-readable plan/results and public GitHub run/job/check metadata are retained instead. The [terminal publication allowlist](hosted-publication-allowlist-43373411759.json) and [publication summary](terminal-publication-summary.json) separately identify publishable contents and hashes-only raw inputs. The preceding blocked checkpoint is retained unchanged; terminal records supersede its then-pending observations.

No raw ZIP, trace, screenshot, cookie, storage state, network payload, authored fixture value or actual socket/request identifier is included. The diagnostic field named `socket` is only the bounded local ordinal integer 1. Case IDs and GitHub run/job/check IDs identify the test and validation records, not sessions or sockets. Copied files passed a credential/query/private-field scan and the exact diagnostic schema checks; copied bytes and all auditor-manifest inputs were hash-verified.
