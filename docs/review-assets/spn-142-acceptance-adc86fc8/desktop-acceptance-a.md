# ✅ SPN-142 fixed-list candidate — desktop acceptance A

**Accepted for the desktop responsiveness owner on this exact source. No actionable evidence finding. Other selected gates/mobile/callback owners remain separate; this is not overall merge approval.**

Source `adc86fc835e93f1960b1b1133864fb43b0aa69e7`, base `7679351822caaa9535d73d656191f2a6597a3380`, tested `a0cb7906f06c986411cda24b790c3b2dadac6252`. Independently verified source and tested trees both equal `fabcde8b11ee851d31ebe3e6a3a3b80f699b7dc3`. CI `41928232046`, attempt 1, job `126919181166`, artifact `13370534367`.

## 🔍 Source, attempts and artifact integrity

Independently checked the plan, job/step record and log, both Playwright reports, all eight metric records, comparison, continuation and composition/revocation records, raw idle/capacity/native witnesses and executed source assertions. Plan records the exact synchronize head/base/tested identities and selects this owner. Job and every step succeeded. Baseline has four expected passing observations; candidate has seven expected passing cases. Every test has exactly one result, retry 0; no skipped/flaky/unexpected test or report error.

ZIP SHA-256 independently matches `2a43cd4433dfd8eae7073cc225db5fef8b7783e6e5ad3eb98343a8b38ddc7d2d`, also in the upload log. All 18 extracted file members are byte-identical to the ZIP. All nine harness/lock hashes in all eight metric records match current files. Baseline is immutable `2c84a18449c7dae09e2817989fac6236be96ef98` with the declared matched compatibility/workload overlay. Current candidate is the tested merge above. Same runner `1000041511`, Chromium `156.0.8078.4`, Node `26.12.1`, Playwright `1.64.1`, 1440×1000 desktop, throttle 1. This is automated Chromium desktop evidence, not a physical-device claim.

No browser, benchmark or inner trace analysis was launched. Profile files were hashed without recomputing their analysis.

## ⏱️ Unchanged unprofiled budgets and six-state idle path

Plain samples 1/2/3 each contain 2,086 native inputs, 65 capacity flush pairs and a complete terminal six-history/six-collaboration idle episode. All native groups retain high water 32/32; final pending is zero, witnesses are not invalidated, completed-state count is 2,086 and all reported budget flags are true. Independently recomputed capacity p95/max from the raw flush values and checked witness phases.

- Capacity p95: **5.1 / 4.4 / 5.1 ms**, below 16 ms; maxima **6.5 / 6.2 / 7.0 ms**, below 50 ms.
- Idle episode p95/max: **0.4 / 2.6 / 0.6 ms**, below both 16/50 ms. History phases are approximately **0.3 / 2.4 / 0.4 ms**; collaboration phases **0.1 / 0.2 / 0.2 ms**.
- Plain 1 and 2 use actual **policy-idle**; plain 3 uses **native history/collaboration timers**. The latter is included from the native idle witness, not silently omitted for lacking a policy-idle flush entry. Both queues transition from 6/6 to 0/0.
- Input-to-frame p95: **27.0 / 28.2 / 27.9 ms**, below 100 ms. Plain 3's longest observed task is 55 ms, below 200 ms. Plain 1/2 record no task at the observer's 50 ms threshold; that means censored-below-threshold observation, not zero work.
- First verified browser-local drain: **308.5 / 328.9 / 301.3 ms**, below 1,000 ms. Later reads are approximately 143–144 ms after that local witness and are not substituted as the acceptance metric. No debounce-breaking gap is recorded.

The profile sample separately completes with capacity p95/max 5.2/8.4 ms and policy-idle 0.7 ms; it is not substituted for primary unprofiled acceptance.

## 🧪 Content, actual history and boundaries

Every candidate sustained-input case has exact sender, peer and saved 2,088-character stream hash `6c714aa1049090072c1b3c4acb27bf6e12c9e56426c8df01cf069a23c6529b44`, sender selection 2,086/2,086, completed correctness and no application errors or unexpected reloads. Plain 1 uses the actual observed 66 history groups, undoes to the two-character empty document and redoes all 66 to exact original content/selection/saved-peer state. Other sustained cases verify their terminal six-character group and restoration. Executed loops and retained before/after history states agree.

Continuation records a 378.7 ms browser quiet gap, then the extra key reaches a frame in 24.1 ms and native read in 24.2 ms; request return is 27.58 ms. Final-original-key to continuation frame/read is 402.8/402.9 ms, within unchanged limits. Exact 2,089-character saved/peer content agrees, and the case completes without errors.

Composition boundary evidence and executed assertions preserve provisional text/history/selection through composing Enter, exclude cancelled provisional text, and atomically Undo/Redo finalized content with exact saved/peer text. No composition event is dropped; physical IME is explicitly false. Guest revocation retains one held write, `forwardedAfterRevocation: [false]`, unchanged persisted snapshot/revision and denied old capability; source explicitly asserts HTTP 403. Both boundary tests passed, with no errors or dropped events.

## 📊 Pairing, profile limits and retained failures

Paired comparison passes with no failures/unavailable requirements. Historical baseline observations correctly preserve uncapped queues, multi-second tasks and baseline-only redo-at-capacity refusal/recovered empty state. Their passing observation contract is not represented as passing candidate budgets.

Independently matched profile hashes: baseline `e6a43e4f6f976dd987b13668e2a6c7e10b9fd2ad0b32218764d94e8734796682`; candidate `0a4775ec6474e01a9104c59ef1004d73f684a5a9b14bef5e9bc181686650432f`. Clock bracket uncertainty is 295.1 ms baseline and 298.0 ms candidate. Baseline reducer samples have certain whole containing tasks of 5,327/5,606 ms. Candidate reducers are sampled but have no certain containing long tasks; attribution of an exact candidate reducer duration remains unavailable. The registered historical whole-task comparison uses the conservative 55 ms candidate bound, not a causal before/after measurement of this fixed-list change. It cannot diagnose any older plain interval or isolate JIT/GC/profiler overhead.

The old 25.3 ms desktop idle observation remains a real failed observation with unknown inner cause. This candidate now has a supported, independently controlled qualification-work mitigation on the ordinary six-state path (274 repeated literal evaluations replaced by nine region-initialized lists), and fresh first-attempt unprofiled policy-idle/native-timer acceptance with intact semantic/content/history/access obligations. That supports the **desktop acceptance disposition** without claiming actual V8 allocation/GC savings, proving what caused the old 24.1 ms collaboration span, or guaranteeing that a future latency tail cannot occur. The older 115.6/102.4 ms mobile failures and separate callback recurrence remain durably retained; mobile and callback acceptance must be assessed on this source by their owners.
