# SPN-108 evidence record

This branch preserves the uncapped source and the inspected result/checksum
record for [PR #202](https://github.com/mxbaylee/spinel/pull/202). The comparison
contract is maintained in `docs/implementation/SPN-108.md` on the PR/main branch.

## Immutable baseline provenance

The original observation-only baseline is
`a0c3154ae6b548d68ba8be9d143df781e47dc623`. The commit adding this checkpoint
also adds the exact supported mobile Enter shortcut repair used by the candidate.
That is its only application-source difference from the original baseline:
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
