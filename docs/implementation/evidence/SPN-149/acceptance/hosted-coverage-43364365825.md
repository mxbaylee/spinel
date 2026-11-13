# SPN-149 hosted acceptance audit — passed

Observed at 2026-11-13T05:04:18.598Z. Read-only acceptance audit by reviewer A (`/root/review_a`). The independent code review remains 100/100 on the exact source; hosted results are a separate acceptance decision.

## Exact identities

| Identity | Value |
| --- | --- |
| PR | [282](https://github.com/mxbaylee/spinel/pull/282) |
| Reviewed source/head | `db24230dd4df539e2055471f55e50a402596c1fb` |
| Reviewed source tree | `42cd4dfe89d0281ff5b11aa984053bd0493e22bb` |
| Base | `04baabd6a68abe7c0b225f8699681532e2205b60` |
| Tested merge | `9ee8ac68165f25e097c93f84bb2b20f00fcaf09e` |
| CI workflow/run/attempt | `387826308` / `43364365825` / `1` |
| CI check suite | `117425360718` |
| Storybook run/attempt | `43364365751` / `1` |
| Storybook check suite | `117425360558` |
| Authoritative plan SHA-256 | `e26b485c286be51036d5d213da96fea7fe251aa4600bdd76612964edbf90d15d` |

CI run 43364365825 completed successfully. All 33 jobs succeeded: 29 selected execution workers, three required aggregates and the classifier. The full raw job listing returned all 33 of 33 entries. The current-head check-run collection returned all 43 of 43 entries, covering 33 CI checks and 10 Storybook checks. Every CI job was matched to its exact check-run ID, source SHA, run, attempt, name and successful conclusion. No selected worker was omitted, skipped, failed or cancelled.

## Seven required current-head gates

| Gate | Job ID | Check-run ID | Conclusion |
| --- | --- | --- | --- |
| [Backlog](https://github.com/mxbaylee/spinel/actions/runs/43364365825/job/131685834150) | `131685834150` | `131685834150` | success |
| [Pull request](https://github.com/mxbaylee/spinel/actions/runs/43364365825/job/131685158763) | `131685158763` | `131685158763` | success |
| [Lint](https://github.com/mxbaylee/spinel/actions/runs/43364365825/job/131685834166) | `131685834166` | `131685834166` | success |
| [Typecheck](https://github.com/mxbaylee/spinel/actions/runs/43364365825/job/131685834289) | `131685834289` | `131685834289` | success |
| [Unit tests](https://github.com/mxbaylee/spinel/actions/runs/43364365825/job/131693806635) | `131693806635` | `131693806635` | success |
| [Lib tests](https://github.com/mxbaylee/spinel/actions/runs/43364365825/job/131690436695) | `131690436695` | `131690436695` | success |
| [Playwright smoke](https://github.com/mxbaylee/spinel/actions/runs/43364365825/job/131701094769) | `131701094769` | `131701094769` | success |

All seven belong to CI check suite `117425360718`, workflow run `43364365825`, attempt 1, and source `db24230dd4df539e2055471f55e50a402596c1fb`. Final PR metadata retained the same head, base and tested merge.

## Complete selected execution mapping

| Plan selection | Successful execution workers, with job/check-run IDs |
| --- | --- |
| `backlog` | Backlog (`131685834150`) |
| `pull-request` | Pull request (`131685158763`) |
| `lint` | Lint (`131685834166`) |
| `typecheck` | Typecheck (`131685834289`) |
| `unit-tests` | Unit tests (supervisor) (`131685834180`); Unit tests (recovery) (`131685834129`); Unit tests (remaining) (`131685834288`) |
| `lib-test-run` | Lib tests (dense-cells) (`131685834240`); Lib tests (cells) (`131685834198`); Lib tests (mixed-fuzz) (`131685834236`); Lib tests (remaining) (`131685834191`) |
| `playwright-run` | Playwright smoke (development 1/2) (`131685834643`); Playwright smoke (development 2/2) (`131685834554`); Playwright smoke (production 1/2) (`131685834559`); Playwright smoke (production 2/2) (`131685834600`); Playwright smoke (mobile-https) (`131685834542`); Playwright smoke (sync-development) (`131685834511`); Playwright smoke (sync-production) (`131685834603`); Playwright smoke (sync-soak-sheet) (`131685834618`); Playwright smoke (sync-soak-doc) (`131685834612`); Playwright smoke (offline-upgrade) (`131685834684`); Playwright smoke (supervised-restore) (`131685834611`) |
| `container-smoke` | Container smoke (`131685834161`) |
| `restore-timing` | Sized restore acceptance (`131685834267`) |
| `sync-transition` | Retained sync transition (`131685834305`) |
| `doc-responsiveness` | Doc responsiveness (desktop) (`131685834588`); Doc responsiveness (mobile) (`131685834311`) |
| `doc-callback-lifetimes` | Doc callback lifetimes (desktop) (`131685834287`); Doc callback lifetimes (mobile) (`131685834347`) |

The authoritative plan is `full` and selects all 15 entries. The other three entries are owned mode flags, accounted for below. The classifier (`131685159022`) succeeded.

| Mode selection | Owner and verified result |
| --- | --- |
| `responsiveness-baseline` | Both desktop and mobile responsiveness workers passed baseline, candidate and paired comparison steps; both retained every attempt. |
| `callback-baseline` | Both desktop and mobile callback workers passed baseline first attempt, candidate first attempt and complete paired callback evidence checks. |
| `phone-compatibility` | The full plan supplies `SPINEL_CI_FULL_COMPATIBILITY=true` to the existing Playwright matrix. All 11 selected matrix workers succeeded. This flag is not a separate worker. |

## Aggregate receipts and integrity

| Artifact | ID | ZIP SHA-256 | Verified content |
| --- | --- | --- | --- |
| ci-plan | `14009413519` | `ef0cf326ba0a39700a2a1c1f8310e67c398d6520b4db243b9b499e1c1c738c07` | Original authoritative source/base/tested identities; all 15 selections. |
| ci-results-unit | `14010379204` | `d21cdf7eb7dcc813aed06a7abb89c4ebbcb8295f58ae7197c243de05a07f501d` | Selected unit family succeeds; all 3 underlying partitions succeed. |
| ci-results-lib | `14011012035` | `d6caf928093abe699a93fefd27af2c3b37ebb24b5edb9b94ae505279f9a2f446` | Selected library family succeeds; all 4 underlying partitions succeed. |
| ci-results-browser | `14012001088` | `83529060d61746d40127442dfe3561850295355a0d33e6e0f6b64bcd2554245d` | Exactly 12 selected execution results succeed; all 3 required aggregate gate inputs succeed. |

Every downloaded ZIP digest matched GitHub artifact metadata. Each aggregate embeds exactly the authoritative plan and its SHA-256 `e26b485c286be51036d5d213da96fea7fe251aa4600bdd76612964edbf90d15d`. The plan hash excludes the final file newline; the saved plan file hash including that newline is `078f6e5dfd36b69b8b7cb9c5007236c1044ea132a324318a67d74da2a574b5ca`.

The browser receipt has `passed: true`, exactly the 12 execution-family rows listed above, every row `selected: true` and `result: success`, and exactly these required inputs: `typecheck: success`, `unit-tests: success`, `lib-tests: success`. The final aggregate log independently confirms checkout of the tested merge and the same plan digest and result maps.

## Storybook

Run `43364365751`, attempt 1, concluded success. Classifier and build succeeded; all five selected review workers (desktop light/dark, tablet, mobile light/dark) succeeded. The final “Review Storybook states and interactions” job/check run `131692373625` succeeded on the same source and tested merge. PR preview publication and GitHub Pages deployment were the only two skipped jobs, both explicitly inapplicable to this PR. The aggregate log confirms all desktop, tablet and mobile checks passed.

## Evidence and limits

The final raw job, run, artifact, current-head check-run and PR snapshots are retained beside this report. The unit/library/browser artifact ZIPs and extracted JSON, classifier log, final browser aggregate log, Storybook final snapshot and aggregate log are also retained. The machine-readable audit contains exact mappings, all artifact hashes, paired-step evidence and the original dispatch observations. Earlier observations remain historical receipts; the explicit final acceptance above supersedes their then-pending status.

Reviewer B separately audited the native development and production target case evidence; root reported retry 0 passed in each, full revocation/cleanup contract true and actual close before navigation. This reviewer’s task verifies aggregate coverage and identities; it does not replace reviewer B’s case-level audit. No missing historical first-attempt timeline is inferred from current green results.

No source, branch, PR metadata, workflow, run or check was changed by this auditor. No rerun, cancellation, browser execution or local validation workload was performed during this acceptance audit. All observed hosted work remains attempt 1. Independent review score and report remain unchanged.
