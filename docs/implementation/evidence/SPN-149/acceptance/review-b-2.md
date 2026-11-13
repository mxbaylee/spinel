# Independent review B — SPN-149 revalidation

## Verdict and exact identity

**Score: 100/100. Both earlier findings are resolved; no actionable findings or unresolved blockers remain in the reviewed candidate.** This is an independent, nonimplementing review of the complete change. It does not certify hosted acceptance or authorize merge.

- Candidate: `db24230dd4df539e2055471f55e50a402596c1fb`
- Candidate tree: `42cd4dfe89d0281ff5b11aa984053bd0493e22bb`
- Base: `04baabd6a68abe7c0b225f8699681532e2205b60`
- Prior reviewed candidate: `8ee824a9787c630f7c9b02263461280611f68d59`, score 97/100.
- Reviewer: `/root/review_b`; no implementation, repository edits, commits, pushes, browser execution or remote validation performed.
- Working copy: `/workspace/scratch/13a7bba7afec/spinel`, clean at the beginning and conclusion of review.

| Rubric | Awarded | Assessment |
| --- | ---: | --- |
| Ticket scope and acceptance | 35/35 | The complete conditional investigation and revocation contract are preserved. Failed observer setup now uses the same finite cleanup bound. |
| Correctness, data integrity and access boundaries | 25/25 | Established protocol targets, all-target closure, independent denial, surviving queued writes and persisted/reloaded content remain required. No application authority code changes. |
| Meaningful regression protection and local verification | 20/20 | All 19 focused controls pass on the exact candidate. The added test exercises the previously demonstrated failed-setup/stalled-detach boundary and preserves the primary error. |
| CI and operational design | 10/10 | Existing suite owners, complete dependency selection, fail-closed aggregates and retained content-free per-attempt reports remain intact. |
| Maintainability, documentation, process and over-complexity | 10/10 | The repair reuses the existing cleanup helper. Required copied-source attribution is complete. Evidence retains the earlier review and attempts with accurate source identities. No unnecessary abstraction or dependency. |
| **Total** | **100/100** | No deductions, including none for hosted CI status. |

**Every step to 100:** none remain. There are no local, hosted-only or owner-decision deductions and no impossible steps being withheld.

## Earlier finding dispositions

### B1 — copied-source attribution: resolved, 1 point restored

`docs/implementation/evidence/SPN-149/original-13557930894-playwright-source.json` now retains the original copyright/license header and an accurate diagnostic extraction notice. `THIRD-PARTY-NOTICES.md` registers the exact evidence path, pinned Playwright source commit, license and unchanged-excerpt treatment.

I independently fetched the original `packages/playwright-core/src/server/frames.ts` at upstream commit `cfe490d941f992655948eee8fd4fd94e1c4234bf` through the read-only GitHub file connector. Its blob SHA is `d9080e4e2dce5bf5374ef18829765592af93c75f`, matching the maintained evidence. A direct string comparison confirmed that the stored header equals the pinned source header exactly. The attribution repair makes no change to the installed dependency or experiment.

### B2 — failed-setup cleanup bound: resolved, 2 points restored

At `e2e/session-revocation.ts:119–122`, the catch for failed `Network.enable` now awaits `cleanupSessionRevocation([{ name: 'observer', run: stop }])` and then throws the original error. The existing helper bounds the detach attempt to five seconds and reports failure without replacing the setup error; `stop()` removes owned listeners before awaiting detach.

The new control at `scripts/ci/session-revocation.test.ts:237–274` makes enable reject and detach remain pending. It checks command/detach counts and owned-listener removal, observes the still-pending rejection before the deadline, advances to 5,000 ms and verifies rejection with the identical primary error. It passed in this review. The existing rejecting-detach case also still passes. The change introduces no new cleanup abstraction, browser project, assertion retry or longer deadline.

## Independent local verification

I waited for reviewer A's workload to finish and for the parent to release the shared slot, then ran:

```sh
PATH=/workspace/scratch/cece61e42934/runtime/node-v26.13.0-linux-x64/bin:$PATH node ../validation/watchdog.ts ../validation/review-b-2-controls-watchdog.json node scripts/serial.ts node --test scripts/ci/session-revocation.test.ts > ../validation/review-b-2-controls.log 2>&1
```

Result: **19 passed, 0 failed, 0 skipped, 0 cancelled**, using Node `v26.13.0` on the exact candidate. Watchdog measurements: start `2026-11-13T04:13:22.079Z`, finish `2026-11-13T04:13:22.636Z`, elapsed **557 ms**, peak process-tree RSS **233,840 KiB**, minimum available system memory **8,088,724 KiB**, exit 0 and no abort. I released the slot after completion.

The execution evidence is retained outside the repository in:

- `/workspace/scratch/13a7bba7afec/validation/review-b-2-controls.log`
- `/workspace/scratch/13a7bba7afec/validation/review-b-2-controls-watchdog.json`

I did not repeat the declared two-ordering boundary experiment, run native browsers or run a full suite.

## Full-candidate revalidation and evidence

The first review read the original ticket, full base-to-candidate diff, current repository/process/testing/persona instructions, authority and navigation ownership, browser fixtures, routing/aggregate wiring and all retained evidence. Those unchanged assessments remain part of this complete review, tied to their original source and rechecked against the new candidate's file identities.

For this iteration I inspected all seven changed files since the prior reviewed candidate, including the complete repair diff, new review receipt, updated implementation record and revised local manifest. Every current source SHA-256 in the manifest matches the checked-out candidate. The difference from local repaired source commit `8ea17ad308b5fe77b293f58f35c803575cede0d6` is confined to the implementation record and review/validation evidence; executable bytes match. `git diff --check <base>..HEAD` succeeds. The original source snapshot and previous attempts remain present, and my earlier full report is preserved verbatim in `review-iteration-1.json`.

The full contract remains intact: actual 101 establishment and closure of every frozen target, independent 401 request denial, editor removal, surviving login continuity, successful release of its captured queued write, HTTP 200 and exact saved value for that surviving session, native content after reload, and absence of later matching frames. Live sockets, retained authorization, unrelated closes, late successful handshakes, observation loss and overflow all remain negative controls. The small retained timeline excludes private socket/query identifiers, credentials and content. Normal teardown and failed setup now both preserve primary errors while bounding owned cleanup.

CI routing, required aggregates, browser matrix, retry policy and original assertion deadlines are unchanged. The existing JSON reporter serializes the Buffer attachment per attempt, and the existing artifact upload retains those reports. Landing bookkeeping and all four persona decisions remain consistent; there is no product UI change requiring a visual review. The conditional probe still proves only the dependency observation boundary, and the missing historical first-attempt timeline remains explicitly unavailable.

## Separate remaining gates

Native development/production Chromium acceptance is still pending because pinned local browser installation failed with invalid/empty downloads. All selected current-head CI gates, the declared finite native sample and its accurate natural-recurrence disposition, final immutable acceptance receipt, base readiness and eventual post-merge branch cleanup remain separate requirements. None is represented as passed by this grade, and none costs points merely because its hosted result is pending.

The candidate now satisfies this reviewer's local review gate at the exact SHA above. The other independent current-SHA review and actual required hosted acceptance remain independently necessary.
