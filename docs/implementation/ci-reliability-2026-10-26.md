# Main CI reliability — 2026-10-26

**Date/status:** 2026-10-26, accepted investigation and bounded repairs.
**Authority:** Owner, backlog-grooming chat: main often fails CI; investigate why
and make it more resilient. This extends the
[full grooming](grooming-2026-10-26.md), not a whole-backlog implementation run.

## Evidence and denominator

The audit covers the 30 main application CI runs and 30 main Storybook runs
immediately before the Caddy merge: **2026-10-24 00:08:34 through
2026-10-27 00:05:31 UTC**, across 30 main commits. PR runs and Dependabot's own
dynamic jobs are excluded. Later grooming/dependency verification is separate
evidence, not silently added to this denominator.

| Workflow | Runs | Latest success | Latest failure | Latest cancelled | First-attempt success | First-attempt failure | First-attempt cancelled |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Application CI | 30 | 23 | 4 | 3 | 22 | 5 | 3 |
| Storybook | 30 | 20 | 0 | 10 | 20 | 0 | 10 |

Fifteen of the 30 commits had at least one non-green first attempt; fourteen
retain a non-green latest workflow conclusion. Application first-pass success
was 22/30 (73.3%); Storybook was 20/30 (66.7%). The only sampled rerun was
[40397529961](https://github.com/mxbaylee/spinel/actions/runs/40397529961): its
first attempt failed a sync timing assertion, and its second passed. Retrying
does not erase the first-attempt evidence. Nested failed jobs and aggregate
failures are not additional workflow failures.

For all seven earlier affected PRs inspected (#163, #172, #170, #164, #167, #185
and #188), the final PR head tree equals its squash/main tree, and the PR's
application and Storybook workflows passed before merge. For example,
[#170's passing PR run](https://github.com/mxbaylee/spinel/actions/runs/40304130278)
and its failing main run below used the same tree. The sample does not support
source drift after a green PR as the cause. Identical source can still expose
environment-sensitive timing or intermittent product behavior.

## Findings

### Browser setup and old screenshot workloads exhausted job budgets

Seven of the ten cancelled Storybook runs spent **422–700 seconds** installing
Chromium and OS dependencies inside a 15-minute job. For example,
[40309711810](https://github.com/mxbaylee/spinel/actions/runs/40309711810) spent
700 seconds in installation and had only 188 seconds left for tablet review.
Its logs show a 19.8 MB apt transfer taking 11 minutes 21 seconds. An application
run, [40309711804](https://github.com/mxbaylee/spinel/actions/runs/40309711804),
similarly spent 693 seconds on setup inside a 20-minute browser job.

The other three older Storybook cancellations spent 853–869 seconds capturing
both mobile themes in one job. They predate current theme partitions and
on-demand routine captures. These were budget expirations; missing artifacts
and red aggregates were consequences. There was no intervening main push before
the inspected deadlines, and main in-progress cancellation is already disabled.

**Existing mitigation:** `scripts/ci/prefer-ubuntu-archive.ts` landed with #167
at `8a5135643e8ed9b3030251d9cd21e4c8c9430037`. All nine Storybook main runs from
that commit onward in this sample passed. Keep this fix, the full story catalog,
theme/viewport coverage and existing partitions. This evidence does not justify
raising all screenshot job limits or adding more sharding now.

### Application failures have distinct causes

| Main run | Observed evidence | Disposition |
| --- | --- | --- |
| [40424121801](https://github.com/mxbaylee/spinel/actions/runs/40424121801) | Phone Doc editor caret anchor `(0, 0)` lay outside canvas bounds `(0, 149, 390, 654)` after focus and `Control+Home`. Initial attempt failed; retry passed. Production 1/2 reported `1 flaky, 52 passed` and exited 1. | Keep the failure gate; reconcile this scenario with active SPN-072. |
| [40370994379](https://github.com/mxbaylee/spinel/actions/runs/40370994379) | Phone guest-viewer seed remained unsaved across 150-second attempts. Development 1/2 then reached its 20-minute job limit; workflow conclusion is cancelled. | Actual save/setup failure as well as a job deadline. It is not proven harmless. |
| [40319298710](https://github.com/mxbaylee/spinel/actions/runs/40319298710) | Phone editor saw `Reconnecting` when `Online` was required; retries also expired waiting for exact saved snapshots. | Investigate save/connection phases with SPN-072; retain content and permission assertions. |
| [40306762888](https://github.com/mxbaylee/spinel/actions/runs/40306762888) | The 2,016-checkpoint native history storage test exceeded 30 seconds; 976 other Vitest cases passed. | Give this storage acceptance case a bounded 60-second budget, preserving all workload and storage assertions. |
| [40284000946](https://github.com/mxbaylee/spinel/actions/runs/40284000946) | Whole Unit job hit 10 minutes with no failed case logged. Separately, admin revocation's transient `Access changed` status disappeared; retry passed. | One cancelled workflow with a separate failed browser job. Current Unit workload is shorter; inspect revocation lifecycle rather than raising every cap. |
| [40240326501](https://github.com/mxbaylee/spinel/actions/runs/40240326501) | Admin revocation reached 90 seconds and teardown saw a closed browser context; retry passed (`1 flaky, 45 passed`). | Fix the observable revocation lifecycle; do not treat retry success as proof of health. |
| [40397529961, attempt 1](https://github.com/mxbaylee/spinel/actions/runs/40397529961/attempts/1) | Native Sheet delivery observed 1,210 ms against a 1,000 ms requirement; retry passed, and the first workflow attempt remained red. | Current main already measures actual sender Enter to first matching peer snapshot with partial timing diagnostics. Keep the real latency target and improved measurement. |

Current main's Unit job took about **214 seconds**, with 1,193 Vitest cases.
The busy-week storage case passed in **14.513 seconds**; its same-tree earlier
PR passed in **16.522 seconds** before main exceeded 30 seconds. Its contract is
storage retention/footprint, not a 30-second latency SLA. All 2,016 saves/ticks,
64 KiB input, at most 64 retained checkpoints, less than 4 MiB compressed history,
and less than 8 MiB database assertions remain. No global timeout or retry is added.

### Phone Doc failures remain real investigation

The latest caret failure proves that focus alone did not establish the visible
caret anchor in that run. It does not establish whether the cause is an SDK
selection race, test synchronization, or another rendering issue. Earlier
unsaved/reconnecting failures are likewise unresolved by a passing rerun.

SPN-072 and
[PR #191](https://github.com/mxbaylee/spinel/pull/191) already own the phone
integration, selection, save and device acceptance. Keep these concrete failures
in that work instead of making competing product changes here. Require actual
saved text, reload, permissions, visible caret and applicable device evidence.
The new diagnostic artifacts improve the next failure's evidence; they do not
claim the product issue fixed. Human visual sign-off is superseded by the
[standing independent agent review](grooming-2026-10-26.md#agent-decisions-and-visual-review).

## Selected workflow and evidence repairs

1. **Preserve active CI during PR edits.** Keep `edited` subscribed because it
   includes base retargets, and retain the full suite and every required check
   name. Disable in-progress cancellation for `edited` only. New code pushes
   still supersede older PR runs. An edit still queues full validation and can
   replace another pending run under normal Actions concurrency; this is
   protection for active work, not complete metadata isolation. The observed
   title/body cancellation of Caddy PR #184 was separate from the main failures
   counted above.
2. **Use the event's immutable base for PR rules.** Pass `base.sha` to the
   backlog PR checker, matching classification's event range. A later change to
   `origin/main` must not silently change the ticket/settings baseline after the
   tested merge was created. This is a preventive consistency repair, not a
   claimed cause of the sampled main failures.
3. **Retain failure traces and case timing.** Keep the line reporter and add
   CI JSON reports under `playwright-report/<project>[-<shard>-of-<total>].json`.
   Upload them and `test-results/**/trace.zip` with the existing project/shard
   artifact for seven days. Traces were already generated on first retry but
   omitted from the upload allowlist. Reports include outcomes, retries and
   duration; they live outside Playwright's automatically cleared output folder.
   A clean run without a retry need not have a trace.
4. **Adjust only the history storage-test budget.** Use 60 seconds for the
   measured 2,016-interval case as described above. Keep the overall Unit job cap.
5. **Assert durable admin revocation outcomes.** The existing application may
   fence an open editor with the specific `Access changed.` status, or redirect
   a later authenticated request to the real passkey sign-in screen. The test
   accepts only those explicit UI outcomes, with mandatory HTTP 401 and a fresh
   closure of that document's sync socket for each passkey removal/account
   disable. Retain session invalidation, ownership, collaborator access and
   operator boundaries; additionally require HTTP 200 with the saved content for
   the retained device and collaborator. Cleanup preserves an original failure
   alongside a context-close error and always closes the database. The 90-second
   test cap stays unchanged. This repairs the transient-message assumption; it
   does not claim every earlier timeout had the same cause.

All nine browser partitions, one-worker execution, existing two retries,
`failOnFlakyTests`, application container/retained-transition checks, real sync
latency assertions and fail-closed aggregates remain. No acceptance requirement
is weakened to make main appear green. Full metadata dispatch/isolation would require more
policy machinery to preserve base-retarget checks; defer it until its cost is
justified. The small cancellation guard avoids that complexity.

**Personas:** Operator gets fewer discarded runs, reproducible failure evidence
and proportional runner budgets. Owner retains document preservation, accurate
save feedback and access checks. Collaborator retains real propagation and
revocation verification. Link guest retains read-only, anonymous and scope
boundaries. No persona benefits from hiding a flaky acceptance failure.

## Verification and follow-through

Run the full hosted suite because workflow, configuration and test code changed.
The same final grooming head needs both independent reviews and all seven
required checks, plus applicable Storybook checks, before its authorized squash
merge. Confirm the history test's unchanged assertions, JSON artifact upload,
trace-path coverage, exact required check names and fixed base SHA. Record actual
check/review outcomes on the grooming PR. A successful final run is validation of
this patch; sustained improvement still needs subsequent main-run observations.

When investigating another failure, read the original failing attempt and its
structured report, trace and screenshot before rerunning. Identify whether setup,
fixture preparation, product behavior, assertion observation or cleanup failed.
Fix the demonstrated cause, preserve first-attempt results, and avoid using
unbounded retries, skipped checks or weakened acceptance as a substitute.
