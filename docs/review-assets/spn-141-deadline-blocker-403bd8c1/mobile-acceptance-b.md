# 📱 SPN-141 integrated mobile responsiveness acceptance — reviewer B

**Accepted on the exact current candidate's first attempt.** Independent agent review of raw retained results; no application rerun or additional profiling. This report covers the unprofiled/native responsiveness owner. The separately reviewed current mobile callback pair failed and continues to block merge; this pass does not override it.

## 🔗 Identity and artifact integrity

Source `403bd8c1dfdf0b266ca93c0354abef0ef37cea64`, base `5c565b61e11ce29780581f33410749436ecef42f`, tested `28897ac1e143492bae980abf29f73c0e3daa8717`, source/tested tree `4893ed46f3c483d1da1d9e753b106af22d6cb65a`. CI `41945378505`, attempt 1, job `126977563661`, artifact `13380481750`.

Independently verified the original ZIP's **2,055,725 bytes** and SHA256 `dbe69aea2f50e5464aca4f880b692537e6e3d522665b98ba9a16044c8ffeecf3`, then exact ZIP/extracted equality and SHA256 for all **18 members**. All eight metric records have attempt 0, complete observations and no browser errors. Candidate identities equal the tested merge; historical responsiveness source remains `2c84a18449c7dae09e2817989fac6236be96ef98`, distinct from the callback baseline. All nine harness hashes in each metric and the continuation record match the reviewed source. The current shared fixture is included.

The Playwright reports show **four baseline and seven candidate cases**, every result passing at retry 0, no errors and below its declared timeout. The paired comparison reports passed/timing-valid/candidate-integrity with no failures or unavailable evidence. Baseline redo is explicitly the pre-existing capacity-refusal observation, not a claim that baseline performed the candidate's complete history contract.

## ⏱️ Recomputed unprofiled budgets

For candidate plain samples 1/2/3, respectively:

- Capacity flush p95: **25.4 / 23.9 / 23.9 ms**; maxima **66.2 / 60.5 / 42.0 ms**, below the unchanged mobile 50 ms p95 and 100 ms maximum limits.
- Terminal idle: **3.0 / 1.8 / 1.4 ms**, independently recomputed from raw identity-bound native phases with `docIdleDurations`, below the same mobile limits.
- Key-to-frame p95: **83.6 / 90.0 / 89.5 ms**, below 200 ms; longest tasks **150 / 177 / 169 ms**, below 500 ms.
- First verified browser-local drain after final input: **336.9 / 321.1 / 371.7 ms**, below 1,000 ms.

Each unprofiled case records exactly **2,086 inputs**, **65 capacity groups of 32 history/collaboration states**, and the final **six-state idle episode**. Pending state ends at zero; high-water values remain 32. The terminal idle history/collaboration phases have matching witness identity, returned outcomes and completed-state count; no witness invalidation appears. This sample's actual owner is `policy-idle`; later native timers are recorded empty rather than misrepresented as owning the already completed drain. Raw recomputation agrees with stored distributions and all budget results. Later Node-read upper bounds are descriptive and are not substituted for the browser-local drain witness.

## 📝 Content, history and access

All candidate samples preserve exact sender/live-peer/saved text: **2,088 characters**, SHA256 `6c714aa1049090072c1b3c4acb27bf6e12c9e56426c8df01cf069a23c6529b44`, sender selection 2,086 and peer selection 0. Their pre-Undo records have empty pending queues and no reloads.

Plain-1 actually exercises **all 66 Undo and Redo groups**: after Undo, sender/peer/saved content is exactly the two-character CRLF empty document, sender history 0 undos/66 redos; Redo restores the original full text/hash, selection and 66 undos/0 redos. Remaining samples exercise their declared last-group Undo/Redo. No implicit reload repairs the state.

The quiet-pause continuation retains 2,087 inputs and exact sender/peer/saved **2,089-character** content ending in `x`, SHA256 `f21602221e3091f141f63ff89697afed6413ab4f9798c3a832b714e55830c96d`, selection 2,087 and zero pending state. Request return is 109.456 ms, continuation key-to-frame 91.9 ms, key-to-native-read 92.5 ms, final-original-key-to-frame 526.5 ms and to-native-read 527.1 ms; each stays within its original explicit budget.

The native composition boundary preserves composing-Enter text/history, cancellation/finalization and atomic Undo/Redo with exact saved/peer correctness. The revocation boundary records one held write, `forwardedAfterRevocation: [false]`, rejected pending/late guest edits and unchanged persisted snapshot/revision/old-capability denial. Both browser reports pass and retain no errors/dropped composition events. These are protocol-driven native composition observations, explicitly not physical IME or physical-device evidence.

## 🔬 Profiles and limitations

Both complete CPU profiles match their metric and clock-sidecar hashes. Profile observations are separately paired and do not enforce or replace primary unprofiled timing budgets. Clock uncertainty is **1,448.4 ms baseline / 1,510.6 ms candidate**. Baseline has one negative/two reordered deltas; candidate has zero negative/reordered deltas. Candidate composition samples exist, but exact containing-task attribution is unavailable for both candidate families. Baseline certain whole-containing tasks are 29,901 ms (history) and 31,398 ms (collaboration); these are not reducer-only times. The registered relative gate uses the conservative 177 ms candidate whole-task upper bound and reports 99.408% / 99.436% reductions, corroborated by the three unprofiled baseline runs (99.412% conservative aggregate). This is the existing registered comparison, not a new SPN-141 optimization or proof that all baseline task time belongs to the reducer. No causal speedup, exact reducer-task duration, heap-retention or physical-phone claim follows.

The earlier 102.4/115.6 ms capacity and 25.3 ms desktop idle failures remain retained failures under their documented SPN-142 disposition. This current pass verifies the integrated production predecessor remains within these contracts; it does not relabel those older results as noise or establish their exact cause. SPN-141 changes native storage preparation, not product composition or these responsiveness budgets. The current mobile callback timeout is preserved independently in `callback-mobile-failure-b.md`.

Supporting evidence: `mobile-proof-b.json`, `audit-mobile-b.ts`, `mobile-proof-b.log`, `mobile-proof-b-watchdog.json`. The one serialized audit passed in **1,292 ms**, sampled combined peak **219,472 KiB**, normal pressure. A subsequent small proof inspection verified the continuation's exact text/hash. Native applications and profiles were not rerun; original artifact bytes remain unchanged.

## 🚦 Blocked checkpoint scope

This selected responsiveness job is accepted on the exact first attempt. Four baseline observations retain their declared 600,000 ms limits; candidate sustained/continuation cases retain 300,000 ms and composition/revocation 120,000 ms. All eleven reports remain below their respective limits. No source edits, browser retry, profile rerun or budget changes were made during this audit. The CI run is not accepted overall: mobile callback and its aggregate are failed. Preserve both this pass and that failure in the immutable checkpoint, together with the distinct native desktop owner reviews.
