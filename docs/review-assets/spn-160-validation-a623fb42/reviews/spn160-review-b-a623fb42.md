# 🧯 SPN-160 independent review B — integrated candidate

**Head:** `a623fb42aa58096695ec4d4c09e9111e42d99386`  
**Actual main/base:** `b1b18165543ed800c0847a63201504c90c46272c`  
**Worktree:** `/Users/mxbaylee/projects/spinel-spn-160`  
**Role:** Independent nonimplementing reviewer, read-only candidate assessment, 2026-11-14 UTC. No candidate edits, mutation, installation, push or merge. No other/prior numerical review was used.

## Result and rubric

**100/100.** Scope35/35, correctness/data/access25/25, regression20/20, CI workflow/operations10/10, maintainability/complexity10/10. **No actionable findings or deductions.** No locally repairable step to100 remains identified on this exact head. CI results were not used for deductions.

The candidate qualifies for the review-before-validation stage, not a claim of completed Linux acceptance or permission to merge. Actual current-head Linux checks and all required gates remain merge conditions. Original SPN-157 recovery causes and repairs remain unproved; diagnostic success cannot fulfill that separate L outcome. A subsequent source/base change requires exact-new-head revalidation.

## Full contract and integration assessment

Reviewed the original SPN-160 and SPN-157 specifications from actual base, full current47-file candidate diff, canonical records, applicable process/runbook/testing requirements, all four personas and the grade-free packet. The full M contract preserves useful pre-barrier failure, immutable handoff progress, readiness/action/journal context, privacy and cleanup without changing recovery, authority, persistence or deadlines. This has independently useful behavior even if neither historical failure recurs. It does not reduce or complete SPN-157.

The integration preserves all three landed SPN-158 runtime/test files and its canonical implementation record byte-for-byte against actual main. Relative to the previously inspected integration, these are the only non-document runtime changes: `http.test.ts`, `restore-crash.integration.test.ts` and `restore-http-test-client.ts`. They belong to actual main and are absent from this ticket's delta against b1. Their admission helper is not imported by the SPN-160 supervisor/portable fixtures. The six SPN-160 implementation/test files match checked source `d2a0ae20c8e62fe526a42815d9e8ef8fa0cc9c2a` by bytes and SHA-256. Their original-base states also match between the old and current bases, including absence of the newly added files. Consequently the complete previously inspected source changes remain the same changes against this actual base.

The candidate removes only the SPN-160 ticket, removes its dependency from SPN-157 and retains the full L recovery specification. SPN-098 still depends on SPN-157. Neighboring SPN-098/123/128 tickets are byte-identical to actual main; no telemetry or preserved-original recovery scope is transferred. The completion list retains148/145/149/158 before appending160, next ID remains161 and full-groom date remainsNovember12. Canonical history explicitly supersedes the earlier provisional decision to wait for unrelated159 drawing work, explaining the current highest-eligible selection and all persona effects. This is reasonable sequencing and does not waive a validation or product dependency.

## Correctness, privacy and regression evidence

`ownership.ts` snapshots fixed sender/receiver counts and booleans at first failure, preserving the original Error cause. Frozen copies prevent late callbacks from rewriting retained progress. Extracting through the actual single `WitnessedRestoreTrialFailure` wrapper uses own data descriptors, with no getter invocation or arbitrary cause traversal. Receipts add no content, paths, nonce/transfer identity or credentials. Production public maintenance errors remain generic. Existing authority checks, original handles, receiver copy cleanup, parent listener ownership and deadlines are retained; no extra protocol observer, timer or awaited work is introduced.

`supervisor-test-control.ts` observes the barrier before starting the action. Synchronous/asynchronous early rejection retains the original contextual cause immediately and clears its listener/deadline. Rejection after the observed barrier is handled as the intended crash response. Timeout and late rejection are bounded and handled. Durable context retains only fixed action/stage and bounded journal machine codes; journal-read failure cannot replace the first error.

`supervisor.test.ts` captures readiness phase/job/controller state before cleanup, including unavailable state/polling failure, without relaxing original crash, row, authentication, selected-candidate or ownership assertions. `ownership-fixture.ts` supplies receiver progress to the original interrupted-transfer/no-SQLite-open/original-bytes/late-handle-close contract. Real Linux IPC/kernel/process semantics remain with their existing native owner.

The six ownership and four coordination controls cover ordering, wrong/duplicate acknowledgements, zero/two callback progress, missing-held deadline, frozen late results, retained parent resources, wrapper/getter/cycle limits, immediate pre-barrier rejection, intended post-barrier rejection, and timeout/late rejection cleanup. The retained actual swallowed-error mutation fails both early cases directly at the original-cause assertion after zero fake-clock advance, not merely by hanging. Its exact source/restoration evidence remains applicable by verified identity; repeating a mutation adds no new evidence.

Existing CI recovery/supervisor selection retains these source/shared paths and fail-closed selected work. No workflow or dependency change narrows coverage. No UI component/state changes require new routine captures or visual approval.

## Own feasible local checks and cleanup

After explicit manager grant, checked normal macOS memory pressure and ran only the two portable owners under pinned Node26.13.0, the shared serial runner and runtime watchdog with unchanged2GiB/eight-minute bounds:

```text
node /tmp/spinel-dependabot-2026-11-11/watch.ts spn160-review-b-a623-controls node node_modules/.bin/vitest run src/server/maintenance/ownership.test.ts src/server/maintenance/supervisor-test-control.test.ts --cache=false --fsModuleCachePath=/tmp/spinel-dependabot-2026-11-11/spn160-review-b-a623-module-cache
```

The pinned Node bin was prepended to PATH. **10/10 passed**, first and only current-head runtime attempt, exit0, **489ms**, peak **302,240KiB**, no resource abort or assertion failure. Receipt and log: `/tmp/spinel-dependabot-2026-11-11/spn160-review-b-a623-controls.json` and `.log`. Disabled result caching/private module cache avoids shared install writes. No compiler repeat, browser matrix, Linux-on-Mac run or source mutation occurred.

Post-run command and cwd audit at `2026-11-14T06:34:11.916260+00:00` found no owned worker/server/browser/compiler processes; no process was killed. Cleanup receipt `/tmp/spinel-dependabot-2026-11-11/spn160-review-b-a623-cleanup.json` binds the exact head. Candidate remained clean. The Mac slot was explicitly released immediately after the audit; no further workload was run.

## Provenance and evidence applicability

Independently verified all **31 payload hashes** across the17 original-current,4 ecef and10 b1 manifest entries; also verified byte counts where the manifest provides them. Verified **241 dependency input hashes** in candidate and donor, **53 installed direct versions** and **7 workspace link targets**. The donor remains the stated SPN-098 install; no dependency installation or candidate source modification was performed.

The integrated worker's ten-control and full-typecheck receipts bind merge `2ed1e39fe2bed49213d27e9f0a7b07a6a364d341`; current six-file source identity is unchanged. Integrated full typecheck passed9013ms/1793968KiB with the recorded native Go640MiB/50/2 tuning, without narrowed compiler scope. Source-bound format/lint/direct-negative results retain their original identities. Inspected exact candidate PR evidence and integrated backlog/index receipts; short unsampled checks are not claimed to use zero memory. `git diff --check b1b18165 HEAD` passed. Earlier setup/compiler/resource failures remain retained technical history rather than being replaced by a pass.

Two read-only reviewer audit script assumptions were corrected during inspection: the new manifest intentionally omits byte counts, and absent paths must be compared by absence rather than `git rev-parse` error text containing different refs. Neither was a product/check failure; corrected audits verified all claimed identities without candidate edits or workload reruns.

## Personas and remaining delivery conditions

Operator gains bounded, actionable evidence without another service. Owner and Collaborator retain original rows, selected-candidate and fail-closed access/recovery guarantees. Link guest gains no management visibility or document authority. The implementation is proportionate to these boundaries and adds no unnecessary framework, dependency or speculative flexibility.

**No point-bearing repairs remain identified.** Before merge, the existing Linux Node/Tini/private-PID-namespace/kernel-lease/real-IPC/SQLite environment must complete native diagnostic acceptance on the publication head, including interrupted transfer, durable phase and authenticated restore readiness. Preserve the first instrumented outcome and cleanup; do not retry unchanged until green. All current-head required gates remain mandatory. These are external/native acceptance conditions, not CI-result deductions or a claim that a pre-push score passes them.

The failed43544143900 source2204/archive5e1b7a9 and successful comparator remain distinct evidence. The SIGKILL scenario may have failed before the crash, and the observed handoff timeout has not been causally attributed. Even an instrumented pass without recurrence cannot diagnose or repair the historical incidents. SPN-157 retains every original L requirement and SPN-098 remains dependent on it. No push exception, merge waiver or completed recovery is asserted.
