# 🔏 SPN-149 maintained acceptance receipt

## ✅ Current disposition

**The current integrated candidate passed both independent reviews at 100/100 and was published for fresh current-head validation at 2026-11-13T05:39:04Z. Hosted acceptance and guarded landing remain pending.** Earlier successful executions are retained as history and do not qualify the new source/base.

This README and [acceptance.json](acceptance.json) are the maintained latest source, review, run and landing record for [PR #282](https://github.com/mxbaylee/spinel/pull/282). Earlier source revisions, exact first attempts and the fixed diagnostic sample remain intact.

| Current identity | Exact value |
| --- | --- |
| Complete reviewed source | `64d85c15288017bbfe3434d91fe0647eb2a2d613` |
| Candidate tree | `b293f8c3c816415864c09f185d77e717bab11e38` |
| Integrated current main | `977de3a3a7608a05e2103787f4dac01ec180013e` |
| Independent reviews | [A](review-a-integration-977de3a.md): 100/100; [B](review-b-integration-977de3a.md): 100/100 |
| Tested PR merge | `6389a8c29b337b6e993b699d544ed2e43d86ffed`; tree equals reviewed tree |
| Fresh CI / Storybook | [43373411759](https://github.com/mxbaylee/spinel/actions/runs/43373411759) / [43373411761](https://github.com/mxbaylee/spinel/actions/runs/43373411761), attempt 1; pending, acceptance not yet complete |
| Landing | Pending current-head acceptance and an expected-head squash merge |

The [integration record](integration-977de3a-record.json) verifies every changed path and blob. All SPN-149 implementation, regression and historical-evidence bytes remain unchanged. Current main's SPN-148 result is inherited unchanged; only the completion list and CLI-generated index required conflict resolution. Both completions remain recorded, with 21 open tickets. The six relevant local actions passed under Node 26.13.0, shared serialization and the existing memory/time watchdog; each reviewer separately passed the 19 focused controls on this exact committed head. No resource abort occurred.

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

The previous-source metadata run [43370718838](https://github.com/mxbaylee/spinel/actions/runs/43370718838) has a separate [native audit](review-b-native-43370718838-audit.md) and [coverage history](hosted-coverage-43370718838.json). Its development and production revocation cases passed retry 0 in 8,853 ms and 5,385 ms, respectively, with the complete contract and clean cleanup; no actual retry occurred. They are ordinary older-base acceptance observations, separate from the fixed initial diagnostic sample. Its complete aggregate disposition remains pending in this snapshot.

The current integration run's [authoritative plan](ci-plan-43373411759.json) and [artifact audit](ci-plan-audit-43373411759.json) select all 15 suite/mode entries and all 29 expected execution workers. Canonical plan SHA-256: `091ffd83314226a908cfb65ce03c796cd4e7002391da676946efbdeae0ce4e9b`. These files prove selection and immutable execution identity; current results remain pending.

The [receipt integrity audit](receipt-integration-integrity.json) verified the prior 55-file publication against its Git tree and hashes. Its stale copied-file count and tested-merge-pending wording are corrected, and its three missing historical references are now included. The final old-run coverage snapshot will be updated when complete. The current receipt manifest recomputes exact-copy counts from its file entries.

## 🔎 Initial-candidate reviews and controls

[Review A](review-a-2.md) and [Review B](review-b-2.md) are complete independent nonimplementing agent reviews of the initial source above. Each scores **100/100**, with no unresolved findings. They were completed before the validation publication. Their original statements that hosted acceptance was pending remain intact as evidence of that timing; the later audited results below supply hosted acceptance separately. Both reviewers independently passed all **19 focused controls**, with their exact logs and bounded watchdog receipts retained here.

The initial review findings and repairs are preserved in the immutable candidate's [review iteration record](https://github.com/mxbaylee/spinel/blob/db24230dd4df539e2055471f55e50a402596c1fb/docs/implementation/evidence/SPN-149/review-iteration-1.json). The final candidate adds the existing cleanup bound to failed observer setup and retains the required pinned Playwright copyright/license attribution.

[Hosted negative controls](hosted-negative-controls-43364365825.json) independently record all 19 passing in Unit tests (remaining), job 131685834288. A live socket with 401, a closed socket with 200, incomplete establishment, unrelated closes, unclosed targets, reopening, observer loss, and diagnostic overflow still fail the contract. Setup/cleanup controls verify listener ownership, preservation of the original setup error, the existing 5000 ms cleanup bound, and continuation after rejected cleanup. Routing controls preserve existing unit/browser owners for authentication/session, transport, navigation, shared fixtures and harness paths, and reject missing/failed/skipped/cancelled selected results. These controls do not substitute for native closure.

## 🧪 Initial hosted acceptance: passed

The [independent final verdict](hosted-final-verdict-43364365825.json), [full coverage history](hosted-coverage-43364365825.json), and [readable audit](hosted-coverage-43364365825.md) identify every check, worker, source and tested merge. **All 33 CI jobs passed on attempt 1:** one classifier, 29 execution workers, and three aggregates. All 43 current-head checks are accounted for: 33 CI and ten Storybook checks. No selected CI worker was omitted, failed, skipped or cancelled.

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

## 📦 Publication, remaining acceptance and cleanup

This directory is published at `docs/implementation/evidence/SPN-149/acceptance/` on the single maintained branch `evidence/spn-149-acceptance-20261113`. The branch head supplies its current immutable receipt identity. The one consolidated PR description edit links this authoritative record. Its metadata run 43370718838 remains older-source history after main advanced; the guarded source update 64d85c1 requires fresh CI and every applicable companion workflow. Preserve all attempts and exact selected gates/workers here. Recheck main and squash-merge with an expected-head guard only after current-source/current-base acceptance. Record the final immutable receipt locator in the merge message and verify the landed result.

If main changes, append a new complete source/review/acceptance entry here while preserving this initial candidate and fixed sample. Every candidate push intended to run CI still requires two independent complete-candidate reviews strictly above 95/100. A later green or inconclusive diagnostic result cannot waive failed current-head acceptance.

**Archive pin and guarded ref deletion are unavailable in the exposed capabilities.** The connector has no tag/archive-pin or ref-deletion action; shell GitHub push lacks a credential and the public browser is signed out. Keep the named evidence branch as the durable reachable copy until an archive pin is created and verified. Do not describe cleanup as complete or rely solely on an unreferenced commit. After landing, recheck implementation/evidence branch heads and PR ownership before any permitted deletion; record the precise remaining prerequisite and branch disposition here.

## 🔐 Retained material and privacy

[Receipt manifest](receipt-manifest.json) covers every published file except itself and records exact-copy provenance. The original [audit inventory](hosted-audit-manifest-43364365825.json) also names hashed ZIPs and raw aggregate logs used by the auditor; those inputs are deliberately omitted from this directory. References to retained audit inputs in the unchanged review reports describe the original audit workspace, not additional published attachments. The extracted machine-readable plan/results and public GitHub run/job/check metadata are retained instead.

No raw ZIP, trace, screenshot, cookie, storage state, network payload, authored fixture value or actual socket/request identifier is included. The diagnostic field named `socket` is only the bounded local ordinal integer 1. Case IDs and GitHub run/job/check IDs identify the test and validation records, not sessions or sockets. Copied files passed a credential/query/private-field scan and the exact diagnostic schema checks; copied bytes and all auditor-manifest inputs were hash-verified.
