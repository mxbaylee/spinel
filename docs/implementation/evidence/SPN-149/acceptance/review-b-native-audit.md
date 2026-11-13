# 🔎 SPN-149 native evidence audit

## Outcome

**Both declared native samples passed on retry 0, with no failed attempts or retries.** The development and production cases completed the full reviewed revocation contract and cleanup. In both, Playwright's page close and the independent protocol close were observed before the post-revocation navigation. **Navigation overtaking the close observer was not reproduced in this fixed two-sample native investigation.** This does not establish the missing ordering of the historical failed attempt.

This was a read-only audit. I did not modify source, start tests, repeat the boundary probe, rerun or cancel CI, or mutate GitHub. Polls were no more frequent than once per minute. All four development/production shard jobs were observed completed successfully at `2026-11-13T04:59:51Z`; this report audits the target case in each owning shard, not the entire CI acceptance matrix.

## Exact source and execution identity

- Pull request: [#282](https://github.com/mxbaylee/spinel/pull/282).
- Candidate head: `db24230dd4df539e2055471f55e50a402596c1fb`.
- Candidate tree: `42cd4dfe89d0281ff5b11aa984053bd0493e22bb`.
- Base: `04baabd6a68abe7c0b225f8699681532e2205b60`.
- Actual tested merge: `9ee8ac68165f25e097c93f84bb2b20f00fcaf09e`, confirmed independently by both target jobs' checkout logs and diagnostic attachments.
- Workflow: [CI run 43364365825](https://github.com/mxbaylee/spinel/actions/runs/43364365825), run number 2211.
- Exact case: `e2e/collaboration.spec.ts:365`, “revoking one login preserves another login’s queued edit and stops later broadcasts”.

| Owner | Job | Attempt start (UTC) | Retry | Result | Duration |
| --- | --- | --- | ---: | --- | ---: |
| Development 1/2 | [131685834643](https://github.com/mxbaylee/spinel/actions/runs/43364365825/job/131685834643) | 2026-11-13 04:47:57.774 | 0 | Passed | 10,861 ms |
| Production 1/2 | [131685834559](https://github.com/mxbaylee/spinel/actions/runs/43364365825/job/131685834559) | 2026-11-13 04:45:51.120 | 0 | Passed | 4,845 ms |

Both owning reports configure two retries, `repeatEach: 1`, one worker and `failOnFlakyTests: true`. Each target has exactly one actual result, retry 0, with zero errors. There are no retry-1 or retry-2 attempts to replace, omit or interpret. Each target retains its 60,000 ms case timeout; the source's five-second closure assertion is unchanged.

Both target jobs used Node `v26.13.0`, npm `11.20.0`, Playwright `1.64.1`, Chromium `156.0.8078.4` / revision `1248`, Ubuntu `24.04.5`, and runner image `ubuntu-24.04 20261101.360.1`. Versions are supported by the report, exact diagnostic payloads and selected job-log lines. Durations are observed results, not a performance comparison.

## Observed timeline

Times below are milliseconds relative to installation of each attempt's observer. They describe recorded observer delivery order, not reconstructed server or historical browser timing. The initial page navigation is omitted from this comparison; the navigation row is the one after revocation.

| Event | Development | Production |
| --- | ---: | ---: |
| Socket established | 4,815 | 1,891 |
| Queued edit held / revocation requested | 6,183 | 2,639 |
| Session revocation written | 6,184 | 2,760 |
| Playwright page close | 6,348 | 2,780 |
| Independent protocol close | 6,348 | 2,780 |
| Post-revocation navigation | 6,382 | 2,807 |
| Closure assertion completed | 6,537 | 2,868 |
| Sign-in/editor-removal assertions completed | 7,441 | 3,157 |
| Request denial checked / held edit released | 7,445 | 3,160 |
| Surviving edit saved | 7,516 | 3,232 |
| Native saved cell verified after reload | 10,655 | 4,674 |

Each final snapshot has one established target, one closed target, zero open sockets and six total received frames. Both have `overflow: false`, `observerLost: false`, `reopened: false`, `contractCompleted: true`, `primaryFailed: false` and an empty cleanup-failure list.

The final frame count is a total, not itself a per-boundary broadcast measurement. Absence of later frames is established by the completed exact-source assertions that compare the captured boundary count after save, reload and the final denial request. Likewise, saved/reloaded content and HTTP statuses are proved by the passed reviewed assertions; authored cell values are deliberately excluded from these extracts.

## Full contract assessment

The passed exact-source case and `contractCompleted` flag establish completion of every assertion before cleanup: a real HTTP 101 socket establishment, actual protocol closure of every frozen target, independent HTTP 401 denial, sign-in plus editor removal, surviving-login socket continuity before its deliberate reload, successful forwarding of its captured queued write, surviving-login HTTP 200, exact saved cell content, the native value after reload, and unchanged post-boundary received-frame counts. The final denial/closure assertion also rejects reopened connections or lost observation.

These conclusions do not rely on the sign-in screen as evidence of socket closure. Actual protocol close events are present, and both independent denial assertions ran. The attached cleanup lists are empty, and each target's only attachment is its content-free observation JSON; successful completion includes the attachment operation itself.

The first-failure evidence gap is addressed for these new attempts by retaining the diagnostic on retry 0. Neither sample failed, so this audit does not claim to have observed a new first-failure timeline. Browser-free controls remain the evidence for negative cases and adverse cleanup behavior.

## Retained artifacts and exact diagnostic bytes

The original decoded diagnostic bytes were saved **without reserialization or an added newline**. I verified their lengths and SHA-256 values against the base64 bodies in the original report members. Their schemas contain only finite event names, relative times, ordinal socket numbers, counts, statuses and source/runtime identity; no socket URL, ticket, cookie, private request ID, frame payload or authored value is present.

| Owner | Exact decoded file | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Development | `review-b-native-development-retry-0-observation.json` | 1,540 | `8d6325e0a09c8dccd61cb4c12c868032a36bf91ff0c69b946c94b33d86fef90d` |
| Production | `review-b-native-production-retry-0-observation.json` | 1,538 | `cdf1ee55cf808d12ca90b01ae11f02f5ece85514f72cd78075873bcbe2c0cfde` |

All files listed here are under `/workspace/scratch/13a7bba7afec/validation/`:

- `review-b-native-development-case.json` and `review-b-native-production-case.json`: content-free exact case identities, every actual attempt, configuration, diagnostic payloads, hashes and limitations.
- `review-b-native-development-artifact.json` and `review-b-native-production-artifact.json`: original artifact metadata, run/job URLs and selected runtime/source log lines.
- The two exact decoded diagnostic files above.
- `review-b-native-poll-receipt.json`: read-only polling and final shard-status receipt.

| Owner | Artifact | Archive SHA-256 | Report member SHA-256 | Artifact expiry (UTC) |
| --- | ---: | --- | --- | --- |
| Development | 14011352752 | `813a5e0f999d42b971f808929898daa80af283412b282f923135229c81e8e112` | `aeac88f592f9bb3bf63132211307f1764a42c57baa0562d659806ead72b8e863` | 2026-11-20 04:58:10 |
| Production | 14011368158 | `40e8cf7e81f67037eec9d10bba184faffba6a7a9ced1f72171894d2470439a8f` | `2eaade7533d2596a7d0cd0d950542785b9294a876140ac1a40651054fbeacf78` | 2026-11-20 04:53:00 |

Both archive hashes match GitHub's artifact digest. The temporary raw ZIPs were downloaded for inspection and are named `native-audit-14011352752.zip` and `native-audit-14011368158.zip`; they are not the content-free final receipt. No raw trace, screenshot, storage state, credentials or unrelated authored content was extracted into the review deliverables.

I also checked development 2/2 artifact `14011600282` to establish ownership: its report contains no target case. Its archive hash matches the recorded digest, and `review-b-native-development-2.json` explicitly says it is not a development revocation pass. Production 1/2 contains the unique production case, so no additional production shard archive was needed for this target-case audit.

## Limits and disposition

The declared sample is complete: one development and one production retry-0 case, with all actual retries accounted for and no extra run requested. The supported natural-recurrence disposition is **not reproduced within this two-attempt native sample**. The conditional map-clearing defect remains supported by the previously retained controlled Playwright probe and focused controls; these successful native attempts do not prove that conditional ordering caused the original failure or that it cannot recur.

The original first-attempt socket/session/navigation timeline remains unavailable. The original failed run and flaky-test outcome remain failed historical evidence. This audit establishes the two current native contracts only; all other selected current-head gates, final receipt publication, base readiness and merge/branch-cleanup requirements remain the root workflow's separate responsibility.
