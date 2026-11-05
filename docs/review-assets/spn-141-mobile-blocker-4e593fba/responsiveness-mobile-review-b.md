# ⛔ SPN-141 current mobile responsiveness — reviewer B

**Rejected for current-head acceptance.** Source `4e593fbaf9ea89585920053b9415f9a8eac0944f`, base `2f442317dd2e1c188ae4a810ac094fd1162a4a2a`, tested merge `f0e74d52629923737985ce03e4f32ff218dcf76d`, equal tree `a2b37aa82336224ac40e92f7364e52ccebfb6d74`. CI `41970163093` attempt 1, mobile job `127056548327` completed failure at 2026-11-05 05:29:39Z. Candidate plain-1 and plain-3 exceed the unchanged 100 ms capacity maximum; no retry, waiver or source repair was performed by this reviewer.

## 🔎 Exact evidence and complete outcome

Artifact `13391071739`, original ZIP 2,580,780 bytes, SHA-256 `bac3a23814e2a1d3fb406b748bb7f85f554e0121049eed497ba0eb5ad9f3f7f7`, matches API metadata. **23 actual members** (not the 18 of an all-pass package) all passed CRC32, size, SHA-256, safe unique names and extracted-byte reread; nothing omitted. Four failure PNGs and two error contexts are retained. Eight metric records and both CPU profiles/clock receipts are present; paired comparison is absent because the candidate failed, not accepted or silently unavailable.

Both source trees, historical baseline `2c84a18449c7dae09e2817989fac6236be96ef98`, nine current harness hashes, run/attempt and artifact/job identities were verified. All eleven cases ran once at retry 0: four historical observations pass their separate contract; five candidate cases pass; candidate plain-1 and plain-3 fail the capacity maximum at `e2e/doc-responsiveness.spec.ts:718`, after input p95, longest task and capacity p95 assertions pass. The failures take 177,674 and 164,769 ms, below their 300,000 ms test timeout. The other candidate cases are plain-2, profile, continuation, composition and revocation. No flaky, skipped or retried application case exists.

## ⏱️ Measured violations and actual native phases

Recomputed from all raw capacity entries, with each sample retaining 65 capacity pairs of 32/32 states:

- **Plain-1: capacity p95 28.7 ms, maximum 116.5 ms >100.** Pair 62 (index 61), completed state 1,984, spans browser time 143,736.1–143,852.6 ms. Native history sequence 185 takes 56.9 ms; collaboration sequence 186 takes 59.6 ms. Both return, 32/32 → 0/32 → 0/0, matching pair sequence 184 and the outer measured interval. Neighbor pairs are 8.0, 10.1, 9.1 and 10.6 ms. A 197 ms browser task beginning 143,732.1 overlaps the failed pair.
- **Plain-3: capacity p95 34.2 ms, maximum 122.30000000004657 ms >100.** Pair 17 (index 16), completed state 544, outer interval 25,117.9–25,240.2 ms. History sequence 50 takes 67.3 ms; collaboration sequence 51 takes 54.2 ms. Both return and clear 32/32 →0/0. Native pair sequence 49 ends at 25,239.4: **121.5 ms of recorded native pair plus 0.8 ms outer measurement remainder**, not an invented equality. Both the native pair and the registered outer interval exceed 100 ms. Neighbors are 7.2, 8.0, 8.8 and 8.1 ms; a 177 ms task starting 25,114.5 overlaps it.
- Plain-2 passes: capacity p95 28.7 ms, maximum 40.9 ms. Its pass does not average away either failed maximum.

The failed manifests have `timingComplete=true`, `completed` absent, `flushMaximum=false`, no application error strings and no reloads. Missing `completed` is expected because the budget assertion prevents final success assignment; it must not be replaced with a pass. The separate profiled candidate peaks at 41.5 ms and cannot explain either unprofiled failure. No CPU profile or trace accompanies either failed sample. The durations are measured synchronous elapsed intervals, which may include runtime pauses; no evidence establishes GC, scheduling, a particular reducer, fixture noise or instrumentation defect as the cause.

Other recomputed unprofiled observations, plain-1/2/3 respectively: idle 2.0 /0.8 /2.3 ms (50 ms p95,100 ms max limits); input-to-frame p95 94.5 /96.5 /95.1 ms (200 ms); longest tasks 197 /166 /177 ms (500 ms); first verified browser-local empty 313.4 /457.1 /386.0 ms (1,000 ms). The 1,148.3 ms late-read upper bound in plain-2 is descriptive and is not substituted for its correct local drain witness. These raw metrics meet their individual bounds; later assertions were not reached after the two maximum failures, so they are not described as completed test acceptance.

## 📝 Content, history, actual idle owner and boundaries

All candidate samples retain exact 2,088-character sender/peer/saved content SHA-256 `6c714aa1049090072c1b3c4acb27bf6e12c9e56426c8df01cf069a23c6529b44`, selection2086 for sender/0 for peer and empty pending work. Plain-1 completed all **66 Undo/Redo groups** before its budget failure: exact CRLF-only sender/peer/storage after Undo with0undos/66redos, then original full content and66undos/0redos restored. Other samples pass their registered one-group check. No candidate reload substitutes for integrity. Baseline initial content is exact; its historical50-group capacity-refusal outcome remains explicit, not a candidate guarantee.

All2,086 native states, matching browser origin/epoch/generation and noninvalidated drain witnesses are retained. Remaining6/6 terminal states are released by actual policy-idle history/collaboration operations, both returned between pending and first-empty observations, with witness sealed after pre-Undo integrity and before Undo. This distinguishes natural idle completion from later test cleanup.

Continuation passes with2,087 keydowns, exact2,089-character native/peer/saved result ending in `x`, SHA-256 `f21602221e3091f141f63ff89697afed6413ab4f9798c3a832b714e55830c96d`, selection2087 and no pending work/reload. Quiet gap454.5 ms; request return100.559 ms; frame/read88.7/88.8 ms; original-final-key to continuation frame/read543.2/543.3 ms, all within unchanged bounds.

Composition preserves provisional text/selection/pending/history through composing Enter, records cancellation-end and converted-commit with no dropped events, and ends with empty queues. Passing exact-source assertions enforce atomic finalized Undo/Redo and saved/peer content; this is browser composition protocol, not a physical IME claim. Revocation records31/31 pending states, one held write, `forwardedAfterRevocation:[false]`; executed source asserts unchanged stored snapshot/revision and refusal of late composition/old capability. These compact records and exact-source assertions are not a retained database replay.

## 🧹 Cleanup, visuals and diagnostic limits

The failed cases persist final metrics/reload observations and their reports contain only the capacity assertion, no secondary fixture error. The inspected finally path disposes observers, writes evidence, attempts CDP detach and awaits fixture closure before the runner proceeds; detach errors are caught in this responsiveness harness. **There is no independent callback-style session/stream cleanup journal here, so do not claim proven session-detach success or system-wide process absence.** Terminal completion and later cases show the owned test flow progressed; they cannot cure a failed budget.

I inspected all four actual390×844 light-theme failure screenshots: synthetic “Sustained typing” content and sender/peer document states, no visible credentials or personal content. A sender/peer pair from plain-1 is useful failure context; plain-3 images are supplementary, not a timing explanation. No dark/physical-device visual qualification is inferred.

Both profile hashes match their metrics/clock records. Clock uncertainties are1,720.0 ms baseline and1,733.9 ms candidate. Candidate sampled reducers have no certain containing-task attribution, with one negative delta/two reordered samples; no new whole-profile analysis was run. Profiles belong to separate successful observations and must not be attached to the failed intervals causally. Unprofiled first-attempt limits remain decisive.

## 🧭 Ownership and disposition

Existing **SPN-146 (XL)** owns this same sixteen-paragraph4× mobile capacity/idle performance contract, including prior129.1 and114.4 ms failures. These new116.5/122.3 ms observations belong in that existing causal investigation; no duplicate ID, unchanged rerun, budget relaxation or registration-only exemption is justified. Source separation from SPN-141's five native desktop storage files does not make a selected current-head failure harmless. Current native storage and callback passes remain valid owner evidence but cannot accept this source for merge.

The supported next step is preserve the complete failed checkpoint, then follow SPN-146's finite preregistered capability/causal investigation with unchanged workload, budgets and stop conditions. Actual failure cause remains unknown. No additional execution is authorized by this report.

Bounded audit proofs/scripts/logs/watchdogs are retained. All three reviewer operations passed first execution at normal pressure: extraction229 ms/92,688 KiB sampled peak; raw measurement/integrity805 ms/230,160 KiB; semantic128 ms/91,136 KiB. Failure-specific native spans and neighbors are preserved in `responsiveness-mobile-failures-b.json` and `responsiveness-mobile-native-spans-b.json`. No browser/converter/benchmark rerun occurred. **Merge remains blocked.**
