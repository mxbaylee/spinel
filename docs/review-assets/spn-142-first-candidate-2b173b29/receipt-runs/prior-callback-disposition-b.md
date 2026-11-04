# 🔎 Overlooked SPN-134 mobile callback failure — independent disposition B

## Finding

**This is a genuine failed historical/candidate comparison and must remain failed.** A closed-PR receipt edit can trigger selected CI; my earlier endorsement of that sequence as avoiding further CI was incorrect. The trigger does not make completed failed tests ignorable metadata. No unchanged rerun, timeout extension, skipped baseline, or retroactive acceptance is justified by this review.

CI `41899145584`, attempt 1, mobile callback job `126816804086`, artifact `13359363775`; run head `97b0db550385b51cdbc8f0543aaa21524c1e05dc`, created `2026-11-04T19:40:06Z`, failed. The candidate manifest identifies squash source `13b74ecea5f2552627ff638be9413ad4754ef581`; both commits independently resolve to tree `dfeb3d10b8367f2edf331a0bfc76bc8a2ac70a9b`. Historical baseline is `0e1df4725d9eccb77574d25e3eecdf678fe6ff44`. Both manifests have identical harness identities, all verified against `13b74ece`. Both tests are retry 0; the baseline timed out and candidate passed.

Original ZIP SHA-256 independently matches `dab3dbf42fd5cbb8c2f90b796636d3a61b608f1f948e06f40cf3c3ffeae0b463`. All seven extracted JSONs match their ZIP entries. The 58-member ZIP contains a candidate trace but **no baseline trace**. Review used retained JSONs, logs, exact source and the useful first failure PNG; no test execution or inner trace inflation/reanalysis occurred.

## Supported interruption and limits

The new baseline phase journal removes the old stale-typing ambiguity:

- All 16 paragraphs completed by 331,293.1 ms; typing wall time was 326,827.7 ms. The manifest retains 2,086 observed keydowns, expected 2,088-character content/hash, and drained native history/collaboration queues.
- Content, caret, ordinary zoom and route-disposal assertions passed; `behaviorPassed` is true at 348,004.1 ms. The PNG and error context show My files with the synthetic Sustained typing document, consistent with ordinary route disposal. The image is useful diagnostic evidence and shows no credentials or private user content.
- `trace-end-request` occurs at 348,009.0 ms. `trace-completion` at 348,013.8 ms means the awaited `cdp.send('Tracing.end')` already returned. Exact helper source then awaits its registered `Tracing.tracingComplete` promise.
- Terminal first failure is `timedOut` in `trace-completion` at 420,046.4 ms: approximately **72,032.6 ms waiting for trace completion** within the unchanged overall 420,000 ms test budget. There is no stream-open event or baseline raw stream. Persistence failure is null and no events were dropped.

This identifies the outstanding operation when the deadline fired. It does not establish why Chromium had not delivered completion, that a renderer crashed, that data was lost, or that baseline runtime work/runner scheduling/trace finalization caused the delay. Typing consumed much of the shared budget; that arithmetic is not a causal allocation of trace latency. No baseline stream, source collection, callback analysis, CDP detach, or fixture-cleanup completion is evidenced. Ordinary application route disposal passed; owned fixture/browser cleanup must not be conflated with that disposal or credited as complete. The absence of those later records is not proof they could never occur after runner teardown, either.

The comparator correctly rejected missing source artifacts, incomplete collection, unconfirmed trace format/completion and absent recomputed analysis. Its generic messages about browser errors or missing/lost trace data refer to absent required fields; they do **not** observe an actual browser error or confirmed trace data loss. The candidate completed at approximately 322.1 s, including trace completion/read/close, analysis and cleanup. Its success cannot rescue the failed pair.

## Ownership and current acceptance

SPN-134's demonstrated repair was durable, nonmasking phase/terminal observation. That contract worked in this recurrence: the previously ambiguous collection/finalization gap is now specifically an outstanding trace-completion event, with the original timeout preserved. This is not evidence that SPN-134 introduced a data, callback, or attribution regression. It is also not proof that historical baseline collection reliability has been repaired.

**Before closing the current failure disposition, give the remaining historical-baseline trace-completion/cleanup reliability investigation an explicit maintained owner and bounded scope.** Preserve this run beside the earlier SPN-134 failures and accepted run, noting that the new boundary is proven for this run only; the exact interrupted operation in the older uninstrumented failures remains unknown. The ownership record must cover inspection of the shared overall deadline and trace-completion authority, diagnostic/cleanup limits, and any proposed repair's semantic and resource constraints. Do not silently fold it into SPN-142's inverse-compose algorithm or SPN-141/140 native storage/process prerequisites. No new browser sample is authorized here; any further execution needs its own prospective finite hypothesis and budget under sustainable testing.

The current SPN-142 source `2b173b29` has an independently accepted first-attempt mobile callback pair in CI `41916623281`, with full source/trace/cleanup evidence and the unchanged baseline, workload and caps. It can satisfy **that current selected gate**. It is neither a retry of this old source nor proof this historical collection issue is gone. The old failure should not automatically invalidate every later complete pair, but current merge readiness requires the honest historical disposition and explicit remaining owner, all current selected gates, and resolution of any separately identified product-budget violations. Registering an owner cannot replace a missing or failing current comparison. I do not grant overall merge approval here; the ordinary responsiveness findings are under separate review.

Operator needs the precise first failure and an accountable investigation; Owner and Collaborator must retain content/input/callback budgets without a weaker baseline; Link guest authority is unaffected and remains covered by selected access checks. There is no evidence supporting a product-data-loss claim or a persona-based exception.

## Receipt policy correction

Treat every PR body edit, open **or closed**, as potentially CI-triggering until repository routing proves otherwise. Prepare and audit the final receipt and immutable evidence before the guarded merge; avoid repeated body edits. If one canonical post-merge receipt edit is necessary, explicitly account for its possible workflows, inventory the actual runs, deliberately cancel unintended extra workloads and verify terminal cancellation. Preserve and triage any test failures that already occurred; cancellation is not acceptance and cannot erase them. Do not edit the body repeatedly to report each cancellation, creating a loop. Retain the cancellation inventory in the immutable evidence record or a separately scoped record that does not itself retrigger that PR workflow.

A workflow-level change to suppress unnecessary closed/edit-only executions would require its own reviewed selection/negative-case contract. This retrospective review makes no such code change and does not assume any currently requested cancellations are terminal.
