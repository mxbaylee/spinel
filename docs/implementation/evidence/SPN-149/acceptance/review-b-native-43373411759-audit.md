# SPN-149 current-head native acceptance audit — run 43373411759

## Outcome and scope

**Both current-head native target cases passed on retry 0, with zero errors, zero failed attempts and no actual retries.** Development and production completed the full reviewed revocation contract and cleanup on the integrated candidate.

This is ordinary required acceptance for candidate `64d85c15288017bbfe3434d91fe0647eb2a2d613` against base `977de3a3a7608a05e2103787f4dac01ec180013e`. It is separate from the closed fixed two-case diagnostic sample in run `43364365825` and the older-base execution history in run `43370718838`. The fixed sample remains closed, its original files remain unchanged, and this run does not expand that sample or revise its historical-cause limits.

This audit covers the exact revocation case in its two actual owning reports. Other CI gates, remaining matrix workers, final base/head readiness and merge authorization belong to the aggregate/root workflow. The source review remains **100/100** in `review-b-integration-977de3a.md`; hosted result status was not a scoring component.

The audit was read-only. No source changes, local test workloads, browser runs, reruns, cancellations or GitHub mutations were performed. The retained current-run status query timestamps have a minimum interval of 60 seconds, satisfying the once-per-minute polling bound.

## Exact source and run identity

- PR: [#282](https://github.com/mxbaylee/spinel/pull/282).
- Workflow: [CI run 43373411759](https://github.com/mxbaylee/spinel/actions/runs/43373411759), attempt 1.
- Reviewed candidate: `64d85c15288017bbfe3434d91fe0647eb2a2d613`.
- Reviewed tree: `b293f8c3c816415864c09f185d77e717bab11e38`.
- Base: `977de3a3a7608a05e2103787f4dac01ec180013e`.
- Actual tested merge: `6389a8c29b337b6e993b699d544ed2e43d86ffed`, independently confirmed by both target jobs' checkout logs and decoded diagnostics.
- Exact case: `e2e/collaboration.spec.ts:365`, “revoking one login preserves another login’s queued edit and stops later broadcasts”.

The retained authoritative plan member was independently read: action `synchronize`, the exact head/base/tested identities above, full mode, and all 15 plan selections enabled. Plan artifact `14013253207` has archive SHA-256 `b18b7b0849cefed15e967f64b5b79f80c8123054a50cbf0d10ffc35ddff62b84`; its exact `ci-plan.json` member has SHA-256 `58e7eb4d7951df39331a72b170ee55770a876d70283d507c8913f5003ad1ddff`. The compact JSON representation used by the existing plan comparison has a different, explicitly identified SHA-256: `091ffd83314226a908cfb65ce03c796cd4e7002391da676946efbdeae0ce4e9b`.

| Actual owner | Job | Attempt start (UTC) | Retry | Result | Duration |
| --- | --- | --- | ---: | --- | ---: |
| Development 1/2 | [131715559510](https://github.com/mxbaylee/spinel/actions/runs/43373411759/job/131715559510) | 2026-11-13T06:13:31.541Z | 0 | passed | 8,070 ms |
| Production 1/2 | [131715559199](https://github.com/mxbaylee/spinel/actions/runs/43373411759/job/131715559199) | 2026-11-13T06:05:29.444Z | 0 | passed | 6,431 ms |

Both reports configure two retries, `repeatEach: 1`, one worker and `failOnFlakyTests: true`. Each target contains exactly one actual result, retry 0. There is no retry 1 or retry 2 to omit or substitute. Both retain the 60,000 ms case timeout, and the reviewed source retains its five-second closure assertion.

## Runtime identity

Both native owners used Node `v26.13.0`, npm `11.20.0`, Playwright `1.64.1`, Chromium `156.0.8078.4` / Playwright revision `1248`, Ubuntu `24.04.5`, and runner agent `2.338.2`. Their hosted image revisions differed and are recorded separately:

| Owner | Hosted image | Runner ID | Job start (UTC) | Job completion (UTC) |
| --- | --- | ---: | --- | --- |
| Development 1/2 | ubuntu-24.04 20261101.360.1 | 1000052617 | 2026-11-13T06:09:12Z | 2026-11-13T06:22:28Z |
| Production 1/2 | ubuntu-24.04 20261111.370.1 | 1000052593 | 2026-11-13T06:01:32Z | 2026-11-13T06:13:59Z |

Exact run attempt, job head, runner IDs/names and selected source/runtime log lines are retained in each artifact metadata file. Durations are observations only; no performance comparison is inferred across projects, image revisions or runs.

## Observed ordinary-acceptance timelines

The event named `page-close` records the Playwright **WebSocket object's close callback for the page**. It does not record closure of the Page/tab. The independent `socket-closed` event comes from `Network.webSocketClosed`. This terminology is also clarified for the earlier receipt in `review-b-native-event-terminology.md`, without modifying the fixed-sample bytes.

Times below are milliseconds relative to each attempt's observer installation. The navigation row is the navigation after revocation; initial navigation is omitted from this comparison. These timestamps establish recorded observer delivery order and do not reconstruct underlying server timing or the original historical failure.

| Event | Development | Production |
| --- | ---: | ---: |
| Socket established | 3,511 | 2,139 |
| Queued write held | 4,670 | 3,284 |
| Revocation requested | 4,670 | 3,284 |
| Revocation written | 4,671 | 3,285 |
| Playwright WebSocket close callback | 4,787 | 3,784 |
| Independent protocol socket close | 4,787 | 3,785 |
| Post-revocation navigation | 4,815 | 3,814 |
| Closure assertion completed | 5,023 | 4,137 |
| Sign-in/editor-removal assertions completed | 5,843 | 4,167 |
| Independent request denial checked | 5,846 | 4,170 |
| Queued write released | 5,846 | 4,170 |
| Surviving write saved | 5,881 | 4,215 |
| Native saved cell verified after reload | 7,900 | 6,243 |

Each final snapshot has one established target, one closed target, zero open sockets and six total received frames. Each reports `contractCompleted: true`, `primaryFailed: false`, `overflow: false`, `observerLost: false`, `reopened: false` and an empty cleanup-failure list.

Both ordinary acceptance observations record the Playwright WebSocket close callback and the independent protocol close before post-revocation navigation. This observation is not added to the closed fixed sample and does not establish the cause of the historical failed first attempt. Sign-in remains a separate checkpoint and is never interpreted as socket-closure proof.

## Full revocation contract

The passed exact-source cases and `contractCompleted` flags establish completion of all reviewed assertions before cleanup: HTTP 101 socket establishment; protocol closure of every frozen matching target; independent revoked-session HTTP 401 denial; sign-in and editor removal; surviving-login socket continuity before its deliberate reload; actual forwarding of the held queued write; surviving-login HTTP 200; exact saved cell content; the native cell value after reload; and unchanged received-frame counts after the revocation boundary. The final denial/closure assertion also rejects reopened sockets or lost observation.

The final frame total of six is not itself a per-boundary broadcast measurement. Absence of later broadcasts is established by the completed exact-source comparisons against the captured boundary count after save, reload and the final denial request. Likewise, the saved/reloaded content and HTTP statuses are proved by the passed assertions; authored cell values are excluded from these extracts.

The cleanup-failure arrays are empty, and each successful target retained its content-free observation attachment. No failed attempt was hidden by a retry. Because both first attempts passed, this audit does not claim a newly observed first-failure timeline. Browser-free negative controls and adverse cleanup controls remain separate retained evidence.

## Exact bytes, hashes and retained files

Each original base64 diagnostic body was decoded and saved byte-for-byte, without reserialization or an added newline. The saved bytes were compared back to the original report attachment and independently hashed. Schema validation restricts the extracts to finite event names, relative times, ordinal socket numbers, counts, flags and source/runtime identity. No socket URL, cookie, ticket, private request ID, frame payload or authored value is published in these files.

| Owner | Exact decoded file | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Development | `review-b-native-43373411759-development-retry-0-observation.json` | 1,539 | `439e355c531e7ad6547efa5a8d953d72dce08d4460d69d93a3945f60073f583d` |
| Production | `review-b-native-43373411759-production-retry-0-observation.json` | 1,538 | `7e7ac010ecd97e4442e179c913ab8ae4aefb6d12d0f7890402ae98a156e3f93c` |

| Owner | Artifact ID | Archive bytes | Archive SHA-256 | Report member SHA-256 | Expiry (UTC) |
| --- | ---: | ---: | --- | --- | --- |
| Development | 14015555446 | 33,588,807 | `b6e911576c66d0a1dec2c1b11c6374226269c046a8d3bafde053aad20fe82494` | `8422cb7b87cee830bc07b3ce6a1c64084e6cd872e422883c2b137ea8df5e47d3` | 2026-11-20T06:22:23Z |
| Production | 14014966855 | 35,342,968 | `b416f7184f448c900ee2abd43edbdecd8a73c587375528ce1e2b5c11fa487867` | `f7f5fcb3d0752fcaf0b6b8bd18109f97bb82da9d954cb7a5a8c2a1ec32bcc0c6` | 2026-11-20T06:13:55Z |

Both archive hashes match GitHub's artifact digests. The report members are `playwright-report/development-1-of-2.json` and `playwright-report/production-1-of-2.json`. The case extracts retain exact source IDs, every actual attempt, configured retries, byte lengths, member counts, observations and limitations.

Deliverables under `/workspace/scratch/13a7bba7afec/validation/`:

- `review-b-native-43373411759-development-case.json` and `review-b-native-43373411759-production-case.json`.
- `review-b-native-43373411759-development-artifact.json` and `review-b-native-43373411759-production-artifact.json`.
- The two exact decoded diagnostic files above.
- `review-b-native-43373411759-poll-receipt.json`.
- This report, `review-b-native-43373411759-audit.md`.

The raw archives are temporary inspection inputs and contain unrelated browser artifacts. They are not part of the content-free receipt. No raw trace, screenshot, storage state or unrelated authored content was extracted into the review deliverables.

## Disposition and limits

The two current-head native revocation contracts are accepted: each passed retry 0 with a complete protocol-close/denial/continuity/save/reload/no-later-broadcast contract and clean cleanup. No new source defect was identified.

The fixed diagnostic sample in run `43364365825` remains complete and closed with its original “not reproduced within the declared two-case sample” disposition. The older edited-event run `43370718838` remains older-base execution history. The original first-attempt ordering remains unavailable and its historical failure is preserved.

This report makes no claim that every unrelated case or workflow gate has finished. At the last recorded native status query, the two target owners and production 2/2 were successful; development 2/2 was still running. The aggregate audit retains responsibility for remaining workers, complete acceptance and final current-base readiness.
