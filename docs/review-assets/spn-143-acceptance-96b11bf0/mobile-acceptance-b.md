# 📱 SPN-143 mobile responsiveness acceptance — reviewer B

**Accepted on the exact current candidate's first attempt.** Independent agent review of raw retained results; no application rerun or additional profiling. This report covers the unprofiled/native responsiveness owner, separately from the callback trace review.

## 🔗 Identity and artifact integrity

Source `96b11bf0374540d28e5537d4a9cddb1280403e21`, base `eb32117f5d09c28cd411063256db6d645335ae8a`, tested `159aa2ab36bdb7313d6a2c7770b685512bf19216`, source/tested tree `9920742df8645f3d963ba5de1b5819efa9d1de7a`. CI `41937955289`, attempt 1, job `126951454507`, artifact `13377002708`.

Independently verified the original ZIP's **2,801,036 bytes** and SHA256 `c1978a807dc532d550e7d0ddb1765d7a82e3490375a164cfa442f4d80ece02f1`, then exact ZIP/extracted equality and SHA256 for all **18 members**. All eight metric records have attempt 0, complete observations and no browser errors. Candidate identities equal the tested merge; historical responsiveness source remains `2c84a18449c7dae09e2817989fac6236be96ef98`, distinct from the callback baseline. All nine harness hashes in each metric and the continuation record match the reviewed source. The current shared fixture is included.

The Playwright reports show **four baseline and seven candidate cases**, every result passing at retry 0, no errors and below its declared timeout. The paired comparison reports passed/timing-valid/candidate-integrity with no failures or unavailable evidence. Baseline redo is explicitly the pre-existing capacity-refusal observation, not a claim that baseline performed the candidate's complete history contract.

## ⏱️ Recomputed unprofiled budgets

For candidate plain samples 1/2/3, respectively:

- Capacity flush p95: **32.7 / 33.0 / 31.9 ms**; maxima **45.8 / 48.1 / 49.3 ms**, below the unchanged mobile 50 ms p95 and 100 ms maximum limits.
- Terminal idle: **2.6 / 2.6 / 4.0 ms**, independently recomputed from raw identity-bound native phases with `docIdleDurations`, below the same mobile limits.
- Key-to-frame p95: **111.8 / 109.3 / 108.1 ms**, below 200 ms; longest tasks **185 / 181 / 184 ms**, below 500 ms.
- First verified browser-local drain after final input: **444.9 / 407.6 / 337.8 ms**, below 1,000 ms.

Each unprofiled case records exactly **2,086 inputs**, **65 capacity groups of 32 history/collaboration states**, and the final **six-state idle episode**. Pending state ends at zero; high-water values remain 32. The terminal idle history/collaboration phases have matching witness identity, returned outcomes and completed-state count; no witness invalidation appears. This sample's actual owner is `policy-idle`; later native timers are recorded empty rather than misrepresented as owning the already completed drain. Raw recomputation agrees with stored distributions and all budget results. Later Node-read upper bounds are descriptive and are not substituted for the browser-local drain witness.

## 📝 Content, history and access

All candidate samples preserve exact sender/live-peer/saved text: **2,088 characters**, SHA256 `6c714aa1049090072c1b3c4acb27bf6e12c9e56426c8df01cf069a23c6529b44`, sender selection 2,086 and peer selection 0. Their pre-Undo records have empty pending queues and no reloads.

Plain-1 actually exercises **all 66 Undo and Redo groups**: after Undo, sender/peer/saved content is exactly the two-character CRLF empty document, sender history 0 undos/66 redos; Redo restores the original full text/hash, selection and 66 undos/0 redos. Remaining samples exercise their declared last-group Undo/Redo. No implicit reload repairs the state.

The quiet-pause continuation retains 2,087 inputs and exact sender/peer/saved **2,089-character** content ending in `x`, SHA256 `f21602221e3091f141f63ff89697afed6413ab4f9798c3a832b714e55830c96d`, selection 2,087 and zero pending state. Request return is190.4 ms, continuation key-to-frame145.5 ms, key-to-native-read145.7 ms, final-original-key-to-frame681.1 ms and to-native-read681.3 ms; each stays within its original explicit budget.

The native composition boundary preserves composing-Enter text/history, cancellation/finalization and atomic Undo/Redo with exact saved/peer correctness. The revocation boundary records one held write, `forwardedAfterRevocation: [false]`, rejected pending/late guest edits and unchanged persisted snapshot/revision/old-capability denial. Both browser reports pass and retain no errors/dropped composition events. These are protocol-driven native composition observations, explicitly not physical IME or physical-device evidence.

## 🔬 Profiles and limitations

Both complete CPU profiles match their metric and clock-sidecar hashes. Profile observations are separately paired and do not enforce or replace primary unprofiled timing budgets. Clock uncertainty is **1,893.5 ms baseline / 1,845.7 ms candidate**. Baseline has one negative/two reordered deltas; candidate has two negative/four reordered deltas. Candidate composition samples exist, but exact containing-task attribution is unavailable for both families. No exact reducer-task duration, causal speedup, heap-retention or physical-phone claim follows from these profiles.

The earlier 102.4/115.6 ms capacity and 25.3 ms desktop idle failures remain retained failures under their documented SPN-142 disposition. This current pass verifies the accepted production predecessor remains within its contracts under SPN-143's shared fixture; it does not relabel those older results as noise or establish their exact cause. SPN-143 adds no product composition optimization here.

Supporting evidence: `mobile-proof-b.json`, `audit-mobile-b.ts`, `mobile-proof-b.log`, `mobile-proof-b-watchdog.json`. The one serialized audit passed in **1,319 ms**, sampled combined peak **233,312 KiB**, normal pressure. A subsequent small proof inspection verified the continuation's exact text/hash. Native applications and profiles were not rerun; original artifact bytes remain unchanged.
