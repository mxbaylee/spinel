# SPN-149 older-base execution audit — passed

**All 33 jobs in run 43370718838, attempt 1, succeeded. This is older-base execution history and is not eligible for acceptance of the integrated head.** Main advanced during this run; no prior result is substituted for current-head validation.

Final observation: 2026-11-13T06:13:00.485Z. Reviewer A (`/root/review_a`), read-only audit. Independent source grades are unchanged and separate from hosted outcomes.

## Exact identities

| Identity | Value |
| --- | --- |
| Source/head | `db24230dd4df539e2055471f55e50a402596c1fb` |
| Source tree | `42cd4dfe89d0281ff5b11aa984053bd0493e22bb` |
| Tested base | `04baabd6a68abe7c0b225f8699681532e2205b60` |
| Tested merge | `9ee8ac68165f25e097c93f84bb2b20f00fcaf09e` |
| Event/action | `pull_request` / `edited` |
| Workflow/run/attempt | `387826308` / `43370718838` / `1` |
| Check suite | `117441910102` |
| Authoritative plan SHA-256 | `c4c4f94d3d94f21f13ad5fa131e595970127f6f04a226489a9dcffd5eb93b097` |
| Newer main | `977de3a3a7608a05e2103787f4dac01ec180013e` |
| Separately reviewed integration head | `64d85c15288017bbfe3434d91fe0647eb2a2d613` |
| Eligible for integration-head merge acceptance | **False** |

## Seven required gates for this historical source

| Gate | Job ID | Check-run ID | Conclusion |
| --- | --- | --- | --- |
| [Backlog](https://github.com/mxbaylee/spinel/actions/runs/43370718838/job/131706614038) | `131706614038` | `131706614038` | success |
| [Pull request](https://github.com/mxbaylee/spinel/actions/runs/43370718838/job/131705572328) | `131705572328` | `131705572328` | success |
| [Lint](https://github.com/mxbaylee/spinel/actions/runs/43370718838/job/131706613962) | `131706613962` | `131706613962` | success |
| [Typecheck](https://github.com/mxbaylee/spinel/actions/runs/43370718838/job/131706614019) | `131706614019` | `131706614019` | success |
| [Unit tests](https://github.com/mxbaylee/spinel/actions/runs/43370718838/job/131710336179) | `131710336179` | `131710336179` | success |
| [Lib tests](https://github.com/mxbaylee/spinel/actions/runs/43370718838/job/131711256842) | `131711256842` | `131711256842` | success |
| [Playwright smoke](https://github.com/mxbaylee/spinel/actions/runs/43370718838/job/131719185560) | `131719185560` | `131719185560` | success |

All seven were matched to check suite 117441910102, source db24230dd4df539e2055471f55e50a402596c1fb, run 43370718838 and attempt 1. The complete raw job listing returned 33 of 33 entries. The source-check collection returned 76 of 76 entries: exactly 33 for this run, 33 for the original CI run and 10 original Storybook checks. Each of this run’s job/check identities and conclusions was verified individually.

## Complete selected coverage

The plan selects full coverage for a PR edit: all 15 selections are true. All 29 execution workers, all three required aggregates and the classifier succeeded. No selected worker is missing, skipped, failed or cancelled. No failed or cancelled step was observed.

| Selected family | Successful workers with job/check-run IDs |
| --- | --- |
| `backlog` | Backlog (`131706614038`) |
| `pull-request` | Pull request (`131705572328`) |
| `lint` | Lint (`131706613962`) |
| `typecheck` | Typecheck (`131706614019`) |
| `unit-tests` | Unit tests (supervisor) (`131706613998`); Unit tests (recovery) (`131706614042`); Unit tests (remaining) (`131706614017`) |
| `lib-test-run` | Lib tests (dense-cells) (`131706614052`); Lib tests (cells) (`131706614021`); Lib tests (mixed-fuzz) (`131706614047`); Lib tests (remaining) (`131706614082`) |
| `playwright-run` | Playwright smoke (development 1/2) (`131706614391`); Playwright smoke (development 2/2) (`131706614415`); Playwright smoke (production 1/2) (`131706614259`); Playwright smoke (production 2/2) (`131706614248`); Playwright smoke (mobile-https) (`131706614472`); Playwright smoke (sync-development) (`131706614272`); Playwright smoke (sync-production) (`131706614553`); Playwright smoke (sync-soak-sheet) (`131706614408`); Playwright smoke (sync-soak-doc) (`131706614360`); Playwright smoke (offline-upgrade) (`131706614441`); Playwright smoke (supervised-restore) (`131706614384`) |
| `container-smoke` | Container smoke (`131706614016`) |
| `restore-timing` | Sized restore acceptance (`131706613987`) |
| `sync-transition` | Retained sync transition (`131706614059`) |
| `doc-responsiveness` | Doc responsiveness (desktop) (`131706614078`); Doc responsiveness (mobile) (`131706614103`) |
| `doc-callback-lifetimes` | Doc callback lifetimes (desktop) (`131706614089`); Doc callback lifetimes (mobile) (`131706614088`) |

The remaining three selections are mode flags. Both responsiveness owners passed baseline, candidate and paired evidence/comparison steps. Both callback owners passed baseline first attempt, candidate first attempt and complete paired callback evidence. Phone compatibility applies full mode to the existing 11-worker browser matrix; all 11 workers passed. These flags do not require three additional standalone jobs.

## Artifact integrity and aggregates

| Artifact | ID | ZIP SHA-256 |
| --- | --- | --- |
| ci-plan | `14012561913` | `6008b8fb4b666d50745cddf251338d9bf2ee0d0596cd422f8ffd66bc895a3bc5` |
| ci-results-unit | `14012329487` | `9ff6ab5aeb04b0d544f25f18e0accf804650c329b6ef2cb7d16ab39e245bf9dc` |
| ci-results-lib | `14012952962` | `a2b1a69ce6bdb7f26d336858dfa5b77af844e5e58efd68632b41f85e856ae880` |
| ci-results-browser | `14014508156` | `33da0687fdb16a3b687b054435c81bdc24711bcbfb5788af28b569150a6045ca` |

Every downloaded ZIP hash matches GitHub artifact metadata. All three aggregate receipts have passed=true and embed exactly this run’s authoritative plan and digest. The browser receipt contains exactly 12 selected execution-family rows, all success, and exactly three successful required inputs: typecheck, unit-tests and lib-tests. The full final aggregate log independently confirms checkout of the tested merge, the plan digest and the successful result maps.

The plan digest excludes its final file newline. The saved plan file SHA-256 including that newline is `e7c36b96d2a6d65b70bab28dfdf4c9c78aa244b5e45636fc307bf65cef5cd89d`. No hash or plan from the original or integrated run is substituted.

## Native case evidence and Storybook

Reviewer B’s separate `review-b-native-43370718838-audit.md` establishes both actual target owners: development 1/2 job 131706614391 and production 1/2 job 131706614259. Both passed once at retry 0, completed the full contract and cleanup, and retained their exact diagnostic bytes and artifact identities. That report distinguishes ordinary required validation from the closed initial diagnostic sample. This aggregate audit does not enlarge that sample or reconstruct the unavailable historical first-attempt ordering.

The edited event did not dispatch Storybook. Its applicable successful run remains 43364365751, attempt 1, on this same old source and tested merge; its original receipt is preserved. The integrated source has its own separate Storybook run 43373411761.

## Preservation and limits

All 19 files in the first-run integrity manifest were rehashed and remain unchanged. Original dispatch observations, the main-advance note, unit/library/browser artifacts and exact final job/run/check identities are retained under this run’s filenames. The machine-readable audit explicitly sets mergeAcceptanceEligible=false.

The reviewed source/head for this run remains db24230dd4df539e2055471f55e50a402596c1fb over base 04baabd6a68abe7c0b225f8699681532e2205b60. Current-head merge readiness must come from separately reviewed integration source 64d85c15288017bbfe3434d91fe0647eb2a2d613 against base 977de3a3a7608a05e2103787f4dac01ec180013e and its own selected checks.

This audit made no source, branch, PR, run or workflow changes. It triggered no rerun, cancellation, browser execution or local validation workload. All observed work in this run remained attempt 1.
