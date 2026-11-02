# SPN-071 bounded flush diagnostic: failed, partial traces retained

Helper `6008c8e026ee4101a2c792fe8601bbe0d7be79f9` ran one declared main then
candidate sequence, each mobile plain-1/2/3 once. Sources were main
`df1d910822cba284178f26ac4f6cf359ddcfacef` and candidate
`53ad6848d79b7b5034db6f6e99a107a518f5d9e5`. Application, fixture, grouping,
retention, fourfold throttle, numerical budgets and zero retries were unchanged.
Only plain-3 had profiling/tracing. No additional diagnostic sequence was run.

Run 41409338771 / job 125158541502 failed. Original artifact 13125538390 is
retained as `original-artifact.zip` (25,326,482 bytes), SHA-256
`a7f5ba20cf583f2e117a7181a39dc7ebcfae9c9027b4025dc1ef9656470fbd8f`.
The ZIP preserves both identities/patches, every metric/profile, partial JSONL
trace, error context/screenshots, mirror profile and raw outcome report.

Main's three numerical samples passed, maxima 47.8, 58.7 and 63.5 ms. Its third
case failed trace completeness. Candidate maxima were 54.9, 113.5 and 197.7 ms;
plain-2 failed the unchanged 100 ms maximum, and plain-3 also failed that budget
and trace completeness. Content, peer/selection, undo/redo and drain checks
passed. Main/candidate step conclusions were masked by continue-on-error; the
explicit outcome report and overall job correctly failed. An interim chat update
misread main's step conclusion as success; the retained actual outcome is failure.

Both trace exports reached the 128 MiB retention bound. `overflow=true` and
`complete=false` remain authoritative despite both clock marks and CDP reporting
no source data loss. Retained clock marks align within 0.002 ms (main) and
0.009 ms (candidate) on their respective sender renderer threads. The retained
data is partial, not a complete trace. No completeness guard or byte bound was
relaxed to rescue it.

Candidate's instrumented peak starts at browser 109132.9 ms and lasts 197.7 ms.
Its retained trace interval is 1257339996–1257537696 microseconds, pid/tid 4847.
V8 incremental marking starts for the global allocation limit: 106.250 ms,
including 103.411 ms waiting for sweeping. A later GC request is 40.686 ms,
including 39.690 ms major GC. Nested durations are not added. Independent review
computed a 151.101 ms union of retained GC spans within this flush; CPU samples
independently assign 149.187 ms there to the garbage collector. This supports
GC attribution for this instrumented peak only. It does not establish the cause
of the original untraced 165.8 ms or new untraced 113.5 ms observations.

Residual CPU samples include cloning through native composition. A hosted map for
`model-BmaRrXAR.js` maps `ai` to the current patched `composeDocStateActions` and
`_emitChangeState` to the native Doc manager. The corresponding chunk from current
private dependencies was byte-identical to that hosted artifact (SHA-256
`3038ca93e50f5f5fe68f95af57d904d8455ee2100945a2aa53fad5fa5128f6ac`).
The original shared local install was missing current docs/docs-ui patches;
its source cannot be substituted for the patched hosted composition code.

Independent review confirmed the GC interval and limitations. Next is a finite
semantic/allocation discriminator for a strictly narrower plain-text shortcut,
comparing original native, current balanced and experimental results. No production
repair is claimed, and no code has yet changed on the PR head. No cross-publication
cache/sharing, changed grouping, GC subtraction or relaxed budget is justified.
The original CI failure and all new failed observations remain blocking until a
justified repair receives current normal acceptance and both independent grades.
