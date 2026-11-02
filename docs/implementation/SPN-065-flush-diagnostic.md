# SPN-065 bounded flush diagnostic — predeclared 2026-11-01

One hosted job, one desktop `plain-1` attempt each, in fixed main/candidate/repaired
order. Sources: current main `0bdbbcb5ca23b84e172e41a11bd0cf555e911130` and reviewed
candidate `c3636afe3f21216805af80de0dabe129a92d57c6`; repaired uses that candidate
with connection-change guards in both editors. Same runner, browser, lockfile,
harness, synthetic workload, thresholds and zero retries. This small sequence
is diagnostic, not a randomized statistical comparison or acceptance evidence.

Question: quantify the added synchronous publication work within native flushes
and inspect composition, callbacks, GC and scheduling in the quiet tail. Both
sources get identical callback counters, native flush timing marks, CPU profiling
and browser trace. Marks and counters are diagnostic overhead; native duration
is captured before post-flush marking/recording. The normal numerical assertions
remain enabled, but instrumented timings cannot replace ordinary first attempts.
All source modifications and hashes are retained. Trace output has a 128 MiB bound.

The failed ordinary first attempt remains: run41384628382/job125082949646,
mergee8db050, plain-1 one six-state idle flush19.6ms against16ms; correctness and
other budgets passed. Neither preceding115ms long task nor successful later
samples establishes its cause. The separate historical baseline is not a
current-main control. No performance limit, history group or p95 rule changes.

Hypothesis for the specific source repair: repeated unchanged connection reports
produce one extra full save-status publication in the candidate. The guarded
variant should restore main's callback count while preserving genuine transitions.
A lower observed timing cannot by itself attribute all19.6ms or prove a repair.
Retain every outcome and inspect traces; normal full unprofiled validation and
independent review remain required after any source change.

One setup attempt; preserve the actual nonsecret mirror profile if browser setup
fails. No automatic scenario retry. No local browser/performance workload. The
helper branch must be archived with immutable PR-linked evidence then deleted.
