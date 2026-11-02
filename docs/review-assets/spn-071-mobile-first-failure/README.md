# SPN-071 first mobile responsiveness failure

PR #226 head `53ad6848d79b7b5034db6f6e99a107a518f5d9e5`, base `df1d910822cba284178f26ac4f6cf359ddcfacef`, tested merge `511dba1abe8019c699ce9cb08e54255dbafc1fdd`; head/tested tree `a5a1898d269b5db5338c97f84365ac270af2451f`.

CI run 41403554716, attempt 1, mobile job 125141657401 failed. Original artifact 13124725476 is retained as `artifact.zip`, SHA-256 `9d947e82e8158c5d28f433c4008cdfbd52c42cfeca0d69b7b4dd7f12cd9fb45f`. This ZIP includes the original baseline/candidate measurements, profile, failure images/context and report. No rerun was performed.

Candidate mobile plain-3, attempt 0, capacity flush #49 began at browser time 84128.6 ms and took 165.8 ms against the unchanged 100 ms maximum. It overlaps a 225 ms long task starting at 84126.2 ms. The remaining 64 capacity pairs were at most 28.6 ms; capacity P95 was 18.9 ms. All groups retained 32 history/collaboration states. Exact saved/live-peer text, selection, undo/redo, Online and browser-local drain passed. The case did not complete because the registered maximum assertion failed.

The original unprofiled sample contains no CPU/GC trace. A later separately profiled sample cannot attribute the earlier stall. No infrastructure, GC or SPN-071 source cause is established. The unchanged measurement wraps synchronous native flushing before the diagnostics observer. Both independent reviewers confirmed the failure remains blocking; no numeric final grade was issued. Other CI jobs passed, except the required Playwright aggregate which correctly failed because of this job. Storybook and native desktop passes do not waive this failure.

Next: one predeclared matched main/candidate mobile sequence, three plain samples each, tracing plain-3 only. Preserve fixed ordering, workload, throttle, budgets and zero retries. Instrumented outcomes are diagnostic only; if the stall does not recur, record an inconclusive result. A justified repair and fresh normal acceptance are still required.
