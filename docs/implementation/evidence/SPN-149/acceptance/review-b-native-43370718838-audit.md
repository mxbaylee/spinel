# SPN-149 older-base native acceptance history — run 43370718838

## Outcome and classification

**The development and production target cases both passed on retry 0, with zero failed attempts and no actual retries.** Both completed the full reviewed revocation contract and cleanup. This run is preserved as older-base execution history: it does **not** satisfy acceptance for the integrated candidate `64d85c15288017bbfe3434d91fe0647eb2a2d613`, and `mergeAcceptanceEligible` is false.

The run was ordinary required validation triggered by publication of the PR description. It was not an additional diagnostic experiment. The fixed two-case sample in run `43364365825` remains closed and unchanged; its natural-ordering disposition remains “not reproduced within the declared two-case sample.” Nothing in this report reconstructs the original failed attempt's unavailable socket/session/navigation ordering.

This audit was read-only: no source changes, local tests, browser runs, reruns, cancellations or GitHub mutations were performed for it. The case report, raw decoded diagnostic and artifact metadata use run-specific filenames so the fixed-sample files remain unchanged.

## Exact source and execution identity

- PR: [#282](https://github.com/mxbaylee/spinel/pull/282).
- CI run: [43370718838](https://github.com/mxbaylee/spinel/actions/runs/43370718838), attempt 1.
- Candidate head: `db24230dd4df539e2055471f55e50a402596c1fb`.
- Candidate tree: `42cd4dfe89d0281ff5b11aa984053bd0493e22bb`.
- Tested base: `04baabd6a68abe7c0b225f8699681532e2205b60`.
- Actual tested merge: `9ee8ac68165f25e097c93f84bb2b20f00fcaf09e`, independently confirmed by both target jobs' checkout logs and decoded diagnostics.
- Newer main: `977de3a3a7608a05e2103787f4dac01ec180013e`.
- Exact target: `e2e/collaboration.spec.ts:365`, “revoking one login preserves another login’s queued edit and stops later broadcasts”.

| Actual owner | Job | Attempt start (UTC) | Retry | Result | Duration |
| --- | --- | --- | ---: | --- | ---: |
| Development 1/2 | [131706614391](https://github.com/mxbaylee/spinel/actions/runs/43370718838/job/131706614391) | 2026-11-13T05:31:06.609Z | 0 | passed | 8,853 ms |
| Production 1/2 | [131706614259](https://github.com/mxbaylee/spinel/actions/runs/43370718838/job/131706614259) | 2026-11-13T05:28:15.211Z | 0 | passed | 5,385 ms |

The actual report owners are development 1/2 and production 1/2. Each report configures two retries, one repeat and one worker, with `failOnFlakyTests: true`. Each target has exactly one recorded result, retry 0; no retry 1 or 2 exists to omit or substitute. The case timeout remains 60,000 ms, and the reviewed source retains the five-second closure assertion.

Both target jobs used Node `v26.13.0`, npm `11.20.0`, Playwright `1.64.1`, Chromium `156.0.8078.4` / revision `1248`, Ubuntu `24.04.5` and runner image `ubuntu-24.04 20261101.360.1`. Selected source/runtime log lines are retained in each artifact metadata file. The durations above are observations, not a performance comparison.

## Ordinary acceptance observations

The event named `page-close` records Playwright's WebSocket object `close` callback for the page, not closure of the Page/tab itself.

Times are milliseconds relative to each observer's installation. The navigation row is the post-revocation navigation, not the initial navigation. This is recorded observer delivery order, without a claim about underlying server timing.

| Event | Development | Production |
| --- | ---: | ---: |
| Socket established | 3,607 | 2,149 |
| Queued write held | 4,792 | 3,189 |
| Revocation requested | 4,793 | 3,190 |
| Revocation written | 4,793 | 3,191 |
| Playwright WebSocket close callback | 5,183 | 3,261 |
| Protocol socket close | 5,183 | 3,261 |
| Post-revocation navigation | 5,201 | 3,288 |
| Closure assertion completed | 5,645 | 3,291 |
| Sign-in/editor-removal assertions completed | 6,021 | 3,679 |
| Independent denial checked | 6,023 | 3,682 |
| Queued write released | 6,023 | 3,682 |
| Surviving write saved | 6,119 | 3,724 |
| Native saved cell verified after reload | 8,675 | 5,207 |

Both final snapshots have one established target, one closed target, zero open sockets and six total received frames. Both report `contractCompleted: true`, `primaryFailed: false`, `overflow: false`, `observerLost: false`, `reopened: false` and no cleanup failures.

Protocol closure is directly recorded; sign-in is a separate assertion. In these ordinary acceptance observations, the Playwright WebSocket close callback and protocol-close precede post-revocation navigation. This does not expand or alter the fixed diagnostic sample, and does not establish why the historical first attempt failed.

## Full contract assessment

The passed exact-source case and `contractCompleted` establish that the assertions before cleanup completed: real HTTP 101 establishment; protocol closure for every frozen target; independent revoked-session HTTP 401 denial; sign-in and editor removal; surviving-login socket continuity before deliberate reload; actual forwarding of the held write; surviving-login HTTP 200; exact saved cell content; native cell value after reload; and unchanged received-frame counts after the revocation boundary. The final denial/closure assertion also rejects reopened connections or lost observation.

The final frame total of six is not a per-boundary measurement. The completed source assertions compare the captured frame boundary after save, reload and the final denial request. Likewise, content equality and status codes are supported by the passed assertions rather than published authored values. Both cleanup-failure arrays are empty, and each attempt has its content-free diagnostic attachment.

No new first-failure timeline was observed because both cases passed on the first attempt. The controlled negative cases and bounded-cleanup controls remain separate evidence. This report does not replace those controls or reinterpret the original flaky-test history.

## Retained exact bytes and hashes

The original base64 diagnostic bodies were decoded and saved byte-for-byte, without reserialization or an added newline. Their schemas were checked for finite event names, relative times, ordinal socket identifiers, bounded counts and source/runtime identity. No URL, cookie, ticket, private request ID, frame payload or authored cell value was copied into these deliverables.

| Owner | Exact decoded file | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Development | `review-b-native-43370718838-development-retry-0-observation.json` | 1,539 | `5fee90d6f3cbff9d2c29931c5e72bfed990c3e12c8a11897751fec9752898531` |
| Production | `review-b-native-43370718838-production-retry-0-observation.json` | 1,538 | `6fe44601d4ef95669b99ea05bf1a0e0685969ca41b6b0911b7dc3db299823390` |

| Owner | Artifact ID | Archive bytes | Archive SHA-256 | Report member SHA-256 | Expiry (UTC) |
| --- | ---: | ---: | --- | --- | --- |
| Development | 14013696153 | 33,566,189 | `51a1d8b8ac1a7bb4345f78a3a131a196fddf65bf4daf08a426ff6658031d040d` | `a9e9761734d40a7b5fbb9c41fd145b70b4a0106acbffb7a05c67c9d8f23e9316` | 2026-11-20T05:40:02Z |
| Production | 14013795586 | 35,271,278 | `46849c6a3df9fe8603de202c0891461e5d57fb8a9a01fe405fcfb1be6be32eec` | `5a16605cfb864b7f4fad12d5a60599527634a60283f8dd4d63d0a79c1cf2d9a6` | 2026-11-20T05:35:50Z |

Both archive hashes match GitHub's artifact digests. Report members are `playwright-report/development-1-of-2.json` and `playwright-report/production-1-of-2.json`. The archive-member counts, report byte lengths, exact case IDs, all recorded attempts and configuration are in the case extracts.

Files under `/workspace/scratch/13a7bba7afec/validation/`:

- `review-b-native-43370718838-development-case.json` and `review-b-native-43370718838-production-case.json`.
- `review-b-native-43370718838-development-artifact.json` and `review-b-native-43370718838-production-artifact.json`.
- The two exact diagnostic files in the table above.
- `review-b-native-43370718838-poll-receipt.json`.
- This report, `review-b-native-43370718838-audit.md`.

Raw ZIPs remain temporary inspection inputs; they include unrelated browser artifacts and are not the content-free receipt. No raw traces, screenshots or unrelated authored content were extracted into the review deliverables.

## Limits and disposition

Both target contracts passed without a hidden failed attempt, retry, observer loss, reopen or cleanup failure. The first report owners were established from the reports themselves, independently of guessed shard assignments. Whole-matrix plan selection, other test cases, full workflow acceptance and current-base readiness remain the aggregate audit's scope.

The retained poll receipt contains the actual query timestamps. One transition interval was 54 seconds instead of the requested minimum 60 seconds; subsequent polling uses an explicit timestamp guard. This did not trigger or repeat any test execution.

The new integrated candidate has its own CI run `43373411759`; its native evidence must be audited separately. Neither a successful older-base case nor this report is a substitute for that current-head acceptance.
