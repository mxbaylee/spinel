# SPN-108 evidence record

This branch preserves the uncapped source and the inspected result/checksum
record for [PR #202](https://github.com/mxbaylee/spinel/pull/202). The comparison
contract is maintained in `docs/implementation/SPN-108.md` on the PR/main branch.

## Immutable baseline provenance

The original observation-only baseline is
`a0c3154ae6b548d68ba8be9d143df781e47dc623`. The replacement baseline is
`161b9874f3ac0e89a277c713ceb965e5ac39ca05`. It adds the exact supported mobile
Enter shortcut repair used by the candidate.
That prior baseline's only application-source difference from the original is:
`web/docPhoneView.ts` registers the public native Enter command with the public
document-focus precondition, owned by the mobile plugin's disposable lifetime.
It retains the unbounded native history/collaboration queues. The workflow pins
this replacement baseline by full commit SHA.

The first mobile attempt exposed 2,071 pending character changes rather than the
required 2,086 changes: all 15 Enter boundaries were missing. Both measured
versions need the identical compatibility repair before their workload can be
compared. The harness still uses `keyboard.type` and native keydown Enter.
No input is bulk-inserted and no command shortcut is substituted by the harness.

## Attempts retained so far

| Attempt | Disposition |
| --- | --- |
| Local baseline build | Passed; peak process-tree RSS 1,668.4 MiB |
| Local browser, initial launch | Loopback listen permission denied; no workload |
| Local browser, authorized launch | Resource-aborted at 2,099.0 MiB during two-editor startup; no accepted sample |
| CI `40579224187`, source `49a86ad` | Both presets stopped during registration before typing; reports and manifest are in `attempt-49a/` |
| CI `40581429512`, source `cf611f7`, desktop | All four original-baseline workloads typed; post-measurement redo failed because the full-document non-Mac shortcut is Ctrl+Y |
| CI `40581429512`, source `cf611f7`, mobile | All four original-baseline cases exceeded the 300-second collection deadline; typing alone took 255–266 seconds and Enter was omitted by the mobile SDK |

The registration repair uses explicit context tracing only for boundary tests,
after timed samples. The redo repair uses Ctrl+Y. The next baseline allows
600 seconds per observation and the paired job allows 60 minutes; candidate
cases retain 300 seconds and every responsiveness budget is unchanged.
These failed attempts supply diagnostic observations, not accepted improvement
percentages. No successful candidate result is asserted by this checkpoint.

## Evidence retention

The public record contains inspected numeric results, attempt dispositions and
checksums. A durable private measurement bundle supplied to the owner contains
the raw profiles, clock sidecars, input/long-task timelines, environment
manifests and test reports. Screenshots remain in the original CI artifacts.
Automatic approval review rejected publication of the complete mixed CI ZIP;
that payload is not republished here. The archive preserves failed first
attempts as well as the eventual acceptance result.

The inspected numeric record and original artifact checksums for the failed
`cf611f7` first-attempt set are in [attempt-cf/result-summary.json](attempt-cf/result-summary.json).
The `6f219b8` and `dbb2207` runs were interrupted during correction of a viewer
observation gap. The `d099a22` run `40586732900` finished all eight baseline
typing/initial-content windows, then failed post-Undo Redo. No candidate sample
ran, and no accepted improvement is asserted by these attempts.

## Schema 3 amendment before candidate measurement

After those baseline failures, an exact 2,086-input native replay established
the cause: the uncapped redo mutation is 166,056 bytes and its reserved envelope
is 166,206 bytes, exceeding the unchanged 65,536-byte sync limit. Typing and Undo
pass real client/server/peer ACK and hash verification. Redo applies locally,
then SyncClient refuses with `capacity`; confirmed/server/peer content stays
empty. The mounted recovery reloads that saved state.

This revision adds only the same read-only, evidence-build reload event used by
the candidate to the prior uncapped application. Alongside the identical mobile
Enter compatibility repair, it records unit, reason, clean flag and browser-clock
time. It does not install the 64-change cap, change transport limits, suppress
recovery, clear history or otherwise repair the old redo behavior.

Schema 3 explicitly separates valid primary timing and initial integrity from
the baseline's observed redo outcome. It accepts a baseline capacity outcome
only after exact successful Undo, actual Ctrl+Y, exactly one same-unit sender
reload with reason `capacity` and `clean: false` in the Redo phase, and exact
empty sender/saved/peer recovery. Other failures remain failures. The candidate
must pass all exact content, selection, saved/peer, all-group undo/redo and
zero-reload requirements. Timing budgets, original workload, three plain plus
one profile sample per preset/source, first attempts and causal gates are
unchanged. All old schema-2 attempts remain failed; only fresh paired schema-3
samples may establish acceptance. Two nonimplementing reviewers assessed this
amendment before any candidate measurement; final grades remain pending.

The `d099a22` development browser shard also failed on one flaky existing Sheet
preview permission-notice assertion. Its retry passed, but the gate remains
failed. This record does not substitute a retry or an older revision for required
current-commit CI.
