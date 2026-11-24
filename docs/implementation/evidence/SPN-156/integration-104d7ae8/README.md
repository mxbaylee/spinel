# 🔗 SPN-156 current-main integration evidence

Recorded 2026-11-15 (America/Los_Angeles). Integrates actual main
`104d7ae89d3ed5ff328cc87b838ed9246f0f42ce` into original candidate
`5c764793f03f7f885873d08d6eca0660cd401bf0`. See the
[decision and failure dispositions](../../../SPN-156.md#-current-main-integration-and-replay-lifetime-repairs).

## 🧪 Local results

All workloads use freshly installed dependencies, pinned Node 26.13.0,
`scripts/serial.ts`, an eight-minute deadline and a 2 GiB owned-process-tree
watchdog. No workload was resource-aborted. Peak values below are sampled total
process-tree RSS, not a single-process heap or a claimed continuous maximum.

| Receipt                                        | Actual result                                                                 |      Elapsed ms |        Peak KiB |
| ---------------------------------------------- | ----------------------------------------------------------------------------- | --------------: | --------------: |
| `install`                                      | Fresh `npm ci` passed                                                         |          16,485 |         754,972 |
| `replay-diagnostics-negative`                  | 2 failed, 2 passed; enabled/sink-throw cases lacked durable-save observations |           4,887 |       1,236,100 |
| `replay-diagnostics-positive`                  | All 4 modes passed after shared attachment repair                             |           2,917 |         774,480 |
| `replay-release-wake-negative`                 | Required replay call absent at actual lock release                            |           1,666 |         500,528 |
| `replay-owner-positive`                        | All 8 owner cases passed after wake repair                                    |           1,637 |         494,220 |
| `reviewer-b/editor-admission-overlap-original` | Independent actual-lock reproduction failed on premature refusal              |             554 |         288,580 |
| `editor-overlap-negative`                      | Maintained native-session case failed: refused instead of queued              |           3,117 |         792,680 |
| `editor-overlap-positive`                      | Real second session opened read-only; first writer retained; cleanup empty    |           2,879 |         801,320 |
| `types-first`                                  | Failed on missing `LockGrantedCallback` type argument in the new adapter      | See raw receipt | See raw receipt |
| `types-corrected`                              | Typecheck passed after type-only correction                                   |          21,103 |       1,970,036 |
| `integrated-owner-native`                      | 242 passed in 8 offline/sync/native-checkpoint suites                         |          14,347 |         916,008 |
| `lint`                                         | Dependency boundary, oxlint and full standard formatting passed               |          21,736 |         825,632 |
| `routing-controls`                             | All 85 pointer, CI-plan, immutable-range and aggregate controls passed        |           2,319 |         587,348 |
| `backlog`                                      | Backlog consistency passed                                                    |             533 |         336,680 |

Focused `-t` negatives/positives intentionally select their named contract; their
other skipped cases are not claimed as passes. The integrated run executes the
whole eight-suite owner set. First failures remain intact and are not overwritten
by positive executions. Index generation and targeted formatting receipts are
also retained. Exact commands, timestamps, exit codes and watchdog observations
are in the original receipts.

## 🧬 Source and evidence identity

The original receipts' `source` value is the original HEAD while a merge was
**uncommitted**. It does not identify the executed integrated tree. Negative
source snapshots and their decompressed SHA-256 hashes are retained under
`integration-controls/`; the independent probe source is retained under
`reviewer-b/`. The 242-case run preceded one documentation-comment correction in
`web/offline/offlineStore.ts`; typecheck and lint followed it. No executable
source changed after that run. Final reviews execute and bind to the complete
committed candidate separately; these dirty-tree receipts are never relabelled.

`source-audit.json.gz` records the prepared source's 1,342 non-documentation
inputs and the incoming-main audit: 875 of 889 incoming paths match main exactly;
14 retain an intentional SPN-156 delta. Main's workflows, routing, dependency
manifests and compiler configuration are unchanged. The PR still changes native
Desktop CI helpers, so full coverage is selected by the existing policy.

`raw-evidence.json.gz` contains 44 original files, each with its path, byte count,
SHA-256 and base64 bytes. This includes logs, receipts, detecting source copies,
the independent probe and the watchdog source. Gunzip and parse this standard
JSON; decode each `content` field as base64 to reproduce the exact file bytes.
`SHA256SUMS` binds both compressed bundles. Compression preserves raw evidence
without expanding routine logs into the review diff.

## 🚦 Remaining gates

These are local preparation results, not a hosted or installed-phone pass. Both
independent exact-commit reviews precede validation publication. Fresh selected
CI, native Desktop and Storybook results must bind that candidate and actual
tested merge. The separate repaired-build installed-phone Home Screen/offline
authorship/file-list reconnect/peer-content observation is still unavailable and
unperformed. The PR remains draft/unmerged until acceptance is complete.
