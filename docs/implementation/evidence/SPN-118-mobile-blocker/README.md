# SPN-118 prerequisite mobile-flush diagnostic

This branch is **evidence only and is not for merge**. It preserves a failed
required acceptance result while collecting one separately declared hosted
diagnostic. Neither product PR head, any acceptance budget, nor the original
workload is changed by publishing this branch.

## Product state

- [SPN-118 / PR #213](https://github.com/mxbaylee/spinel/pull/213), source
  `c89047aeaacb912e1e877566ed40cbdfd95229df`, remains blocked on its original
  shared-folder restart fixture failure.
- [SPN-116 prerequisite / PR #214](https://github.com/mxbaylee/spinel/pull/214),
  source `5bf920d663593bd9f7d991bdfc801310277f5361`, fixes that demonstrated
  readiness race and passed all 92 sync-production tests without retries or
  flakes. Its required mobile responsiveness check subsequently failed.
- The independent nonimplementing reviewers assessed each unchanged product
  head at 94/100 and 95/100, respectively. Both are blocked; the merge gate
  requires each score to be strictly above 95, successful required CI on that
  same head, and no unresolved findings. Neither head may borrow the other's
  passing checks.

## Original failure

[Mobile job 123007950609](https://github.com/mxbaylee/spinel/actions/runs/40742179619/job/123007950609)
measured one 102.1 ms capacity flush against the original 100 ms maximum in
mobile plain-1, with the original fourfold CPU throttle. It was the 60th of 65
capacity flushes, after key 1,920 of the completed 2,086-key workload. Both native
queues held 32 states. The corresponding browser task lasted 179 ms; neighboring
flushes took 21.6 and 22.6 ms. All other recorded budgets and exact content,
selection, synchronization, Undo/Redo and Online assertions passed.

The failed plain sample has no event-level CPU or GC trace. Its wall-time pause
is established, but its specific cause is unresolved. A separate profile, a
small overrun, or a later pass cannot establish transient infrastructure or
resolve this original required failure. The paired-comparison step did not run
after the candidate failure.

`failed-ci-metrics.zip` contains ten byte-for-byte members from the original
artifact: all eight baseline/candidate raw metric files, the candidate report,
and the failed plain-1 error context. `failed-ci-manifest.json` records the
original artifact hash, included member hashes and exclusions. It does not
claim the subset duplicates the full original artifact.

## Local diagnostic disposition

`local-resource-abort.zip` preserves the declared local plan, tracing patch,
build log, zero-test selector setup error, first actual diagnostic log and its
partial error context. The first actual workload exceeded its declared 2 GiB
process-tree RSS cap at 2,054 MiB and was stopped with SIGTERM. It retained no
usable trace or sample metrics. The local series is stopped; no product or
acceptance conclusion follows from that resource abort. The temporary product
worktree edits were restored, and no local Chromium process remained.

## One hosted diagnostic

`hosted-plan.json` is registered before the one hosted execution. The separate
workflow triggers only on this exact evidence branch and changes to that plan
path. It uses the existing pinned actions, runtime, dependencies, browser fixture
and ordinary hosted runner, without deployments or provider secrets.

The job executes the original mobile plain-1 workload once, with zero retries.
It adds task/V8/GC tracing and sender clock anchors, retains completion/data-loss
metadata, and bounds the test tree to 8 GiB RSS and eight minutes within a
15-minute job. A declared resource or host-memory-pressure stop terminates only
its owned descendant processes. The original product code and all workload,
content, history, selection, permission, synchronization and latency assertions
remain unchanged.

The trace uses an explicit non-overwriting 1 GiB browser buffer and the existing
repository's streamed gzip capture pattern, with 1 MiB reads and a 1 GiB
compressed-file retention cap. This avoids holding an event array plus a second
large serialized copy in the 512 MiB Node heap. Completion, byte length and
SHA256 are retained; a missing or truncated stream remains inconclusive.

Trace overhead makes this **diagnostic evidence only**. A traced pause may
identify a useful mechanism; it cannot retroactively prove the exact cause of
the unprofiled CI event. No non-reproduction, trace failure or resource abort
authorizes an unplanned repeat. A source-supported remedy, original current-head
acceptance and renewed independent reviews are still required before merging.

## Source audit

The pinned Apache-2.0 `@univerjs/docs` 1.1.0 implementation composes redo and undo
operations independently for history and collaboration during the public paired
flush. This establishes four composition folds for the usual mirrored caches,
but does not explain the isolated event or establish a safe replacement. The
caches can legitimately diverge. No public setting was found that skips the
folds while preserving both histories.

Spinel's later synchronization capture and its post-flush diagnostic callback
fall outside the measured interval. The terminal drain subscriber returns
immediately at the failing key position. No demonstrated unnecessary Spinel
snapshot, serialization, network operation or layout was found inside the
measured flush. No proprietary Pro internals were inspected.

## Checkpoint placement

The current blocker is recorded in
[PR #214's conversation](https://github.com/mxbaylee/spinel/pull/214#issuecomment-6478025461)
and linked from
[PR #213](https://github.com/mxbaylee/spinel/pull/213#issuecomment-6478028018).
These conversation checkpoints deliberately depart from the runbook's requested
PR-body location: this repository runs full acceptance on PR metadata edits,
and an unchanged acceptance rerun is not an established remedy. Neither product
PR is changed merely to record this evidence.

## Hosted result

The single declared hosted trial completed on diagnostic source
`18cdd80d0f34a48b4b077c0dfad6e548c69ec34c` in
[run 40752287899, job 123041884756](https://github.com/mxbaylee/spinel/actions/runs/40752287899/job/123041884756).
The original mobile plain-1 case passed in the reported 4.1 minutes with zero
retries, zero flakes and no resource abort. Peak process-tree RSS was reported
as 2,844 MiB. This is a **non-reproduction in a diagnostic**, and does not resolve
the original 102.1 ms acceptance failure or establish its cause.

[Artifact 12843972822](https://github.com/mxbaylee/spinel/actions/runs/40752287899/artifacts/12843972822)
contains 34,380,679 bytes, SHA256
`d8c9de4c20e34680fc8ceac4bcfa054a3711d01cb0aa25bfad92aabbc45e4e75`.
[hosted-result.json](hosted-result.json) records the outcome and qualifications.
[hosted-result-evidence.zip](hosted-result-evidence.zip) preserves the compact
metrics, metadata, report, logs and focused trace analysis; its
[manifest](hosted-evidence-manifest.json) records member hashes and the exclusion
of the full raw gzip trace, which remains in the original hosted artifact.

The gzip trace completed with no reported data loss and contains 1,548,383
events. Both clock anchors identify sender renderer/main thread `3334/3334`,
with the same time origin and navigation identity. End-anchor alignment differs
by -22 microseconds. The sender's begin/end events have no unmatched events or
pairing problems. The derived analysis field `sender.spanUs` is
`[0, 293725200]` because it includes metadata events at `ts = 0`; it is not a
measured workload duration or independent proof of coverage. Correlation uses
the sender anchors, relevant event intervals and complete/no-data-loss stream
metadata instead.

| Capacity-flush index (zero-based) | Measured paired flush | Sender main-thread GC-labelled interval union |
| --- | --- | --- |
| 4, largest in this diagnostic | 60.1 ms | 0 ms |
| 0, second largest | 59.6 ms | 0 ms |
| 5, third largest | 55.2 ms | 8.474 ms, including a `MinorGC` event |
| 59, the position of the original failing flush | 28.6 ms | 0 ms |

Both queues held 32 states at each listed capacity flush. The GC figures are
unions of overlapping GC-labelled intervals on the identified sender main
thread, not exclusive GC CPU time. The two largest pauses had no such overlap;
the third had one. These observations do not establish what caused the original
unprofiled event. The exact saved/live peer text, sender/peer selections,
Undo/Redo and Online checks passed in this diagnostic. The original workload,
fourfold CPU throttle and numerical budgets were retained.

## Run checkpoint

The user's objective remains to work on and merge SPN-118. The local and hosted
diagnostic series are stopped at their declared limits. No additional
acceptance retry follows from this non-reproduction, and no supported product
remedy has been established. The original failed checks remain failures.

At the 2026-10-28 19:25 UTC refresh, main had advanced from
`bc05dbc0d2595750f0bbf9502c2aba7e3d0b7463` to
`1a2f8aa2695400dd90ab8f10a99ea00c076359a6` through
[SPN-066 / PR #211](https://github.com/mxbaylee/spinel/pull/211).
That guest-link inventory/expiry change is not evidence of a native-flush
remedy. PR #214 remains at `5bf920d663593bd9f7d991bdfc801310277f5361` and
PR #213 at `c89047aeaacb912e1e877566ed40cbdfd95229df`; GitHub now reports
`mergeable_state = dirty` for both. Integration conflicts therefore also need
resolution. The independent review scores remain 94/100 and 95/100 against the
unchanged product heads, below the requirement that each be strictly above 95.
Both product PRs remain blocked and unmerged.

The next investigation is a focused examination of the public native-flush
functions, with an explicit, falsifiable hypothesis before any further
diagnostic execution. The source audit establishes four native composition
folds; it has not demonstrated unnecessary application work or a safe fold to
remove. A source-supported remedy that preserves behavior is required before
the original acceptance is run on an integrated product head, followed by
renewed independent reviews on that same head. This evidence supports no
speculative SDK, grouping or budget change.

This checkpoint is a result-only evidence update. `hosted-plan.json` and the
executable diagnostic harness remain unchanged, so publishing this result
alone does not match the workflow's plan-path trigger or schedule another
capture. The evidence branch remains outside the product merge path.
