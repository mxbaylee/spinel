# SPN-071 bounded flush diagnostic — declared 2026-11-02

One hosted job, fixed main then candidate ordering, each with mobile plain-1,
plain-2 and plain-3 once, zero retries. Main is
`df1d910822cba284178f26ac4f6cf359ddcfacef`; candidate is
`53ad6848d79b7b5034db6f6e99a107a518f5d9e5`. The lockfile, browser, runner,
fixture, fourfold CPU throttle, group/retention limits and numerical assertions
remain unchanged. No local application/performance workload is planned. A minimal
blank-page trace-transport preflight is allowed under the serial memory watchdog.

The blocking ordinary first attempt remains run41403554716/job125141657401:
plain-3 capacity flush #49 took165.8ms against100ms, overlapping a225ms long
task. Original artifact13124725476 and metadata are preserved at
`077692be14832b230ce5ec705b4f8557d1b08597`,
`docs/review-assets/spn-071-mobile-first-failure`. Integrity passed but timing
acceptance failed. This investigation neither retries nor replaces that check.

Question: does a slow native flush correlate with composition, synchronous
subscribers, GC, or renderer work, and does the same mechanism appear on main?
Only plain-3 receives CPU sampling and JS/GC timeline tracing, with browser clock
marks and existing profiler brackets. Native application and timing code are
unchanged; both sources receive the same temporary harness edits. Plain-1/2
preserve the sequence before the instrumented third sample. They too belong to
the declared diagnostic, not a new acceptance run.

The CDP ReportEvents transport retains JSONL event batches up to128MiB and
requires a nonempty, loss-free complete trace with start/end clock marks on the
same renderer thread. It avoids the earlier SPN-065 stream-export
failure. A30-second diagnostic finalization limit affects trace collection only,
not product deadlines. Overflow, data loss, missing trace or collection errors
are failures with partial evidence retained. Host writes/profiling/tracing can
affect timing; results are diagnostic only. One source order on one runner is
not a statistical or randomized causal comparison.

Stop after this declared sequence regardless of outcome. Missing recurrence is
inconclusive, not evidence of a repair. No speculative group/timer/budget change
is authorized by this plan. A justified source or harness repair, independent
review and fresh normal unprofiled acceptance remain required before landing.
Retain actual setup/mirror failures and all case outcomes. Archive the helper
and raw results under immutable PR-linked refs before guarded branch cleanup.

Preflight: scoped strict TypeScript passed (303ms,242.4MiB); both exact-source
harness transformations passed syntax checks and changed no application file.
The first scoped TypeScript invocation needed TypeScript6's explicit
`--ignoreConfig`; the first partial-checkout syntax probe needed the repository's
`package.json` module mode. These setup corrections were not test passes. The
blank-page Chromium transport probe exported eight events/1249bytes, both clock
marks on one renderer thread, no data loss, then closed its browser (780ms,
455.9MiB). This proves transport only, not application timing or failure cause.
