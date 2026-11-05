# ✅ SPN-144 mobile responsiveness — independent acceptance B

Accepted for this selected first-attempt owner. All 11 cases (four historical observations, seven candidate cases) passed at retry 0, with no test errors and durations below their configured limits. All eight sustained-typing metrics and the paired comparison are complete. This review is separate from callback collection and overall PR merge readiness.

## 🔗 Provenance and integrity

Source `7b06d7516c4c386f5a23044e74d0c09b95a5a929`, base `1045e729c391c47a9b6a895782a2fa69dc6fa044`; tested merge `eb91917064bd9d7665683fade860cd82457fbca4`; equal source/tested tree `d451532408b37f1cb5da12511c6fca38520599e2`. CI `41959231289` attempt 1, job `127021613605`, artifact `13386227177`. Historical application baseline is `2c84a18449c7dae09e2817989fac6236be96ef98`, with the current nine-file harness inventory hash-checked against the reviewed source. This is distinct from the callback baseline.

Original `responsiveness-mobile.zip`: 2,755,515 bytes, SHA-256 `2c1c743c49f7081ae18b3d8f9b16e61837d73d777c88ec18f3a567282780a5bd`, matching GitHub metadata. Every one of 18 ZIP members was streamed through size, CRC32 and SHA-256 checks, exclusively extracted and re-read. Nothing was excluded. Both raw CPU profiles are hash-bound by their metrics and profile-clock records. Raw job JSON binds exact source/run/attempt and terminal success; the log corroborates four baseline and seven candidate passes and the successful comparison. Job/log/metadata hashes are retained in the semantic proof.

## ⏱️ Primary unprofiled measurements

Recomputed directly from raw samples with the current mobile budget constants, plain-1/2/3 respectively:

- Capacity paired-flush p95 **32.6 / 29.0 / 32.1 ms**, maximum **45.6 / 44.1 / 41.9 ms** (limits 50/100 ms).
- Actual terminal idle paired episode **0.6 / 34.4 / 4.3 ms** (limits 50/100 ms).
- Key-to-frame p95 **99.2 / 101.6 / 102.0 ms** (limit 200 ms); longest browser task **188 / 176 / 187 ms** (limit 500 ms).
- First verified browser-local drain **462.8 / 352.7 / 343.3 ms** (limit 1,000 ms).

Each plain sample contains 2,086 native inputs and 65 capacity flushes of 32 history/collaboration states, high-water exactly 32, then a six-state terminal idle episode. Native sequences identify actual `policy-idle` history and collaboration calls, each returning between the terminal pending witness and first-empty witness. Plain-2's 34.4 ms episode contains history 2.5 ms and collaboration 31.9 ms; this is measured work under the **mobile** limits, not an inferred idle interval or a desktop-limit claim. Episode samples equal the published idle distributions. Witnesses have no invalidation, identical browser time origin, 2,086 completed states and zero final pending work. Their sealing occurs after pre-Undo integrity and before Undo, avoiding attribution of test cleanup to natural drain.

Late observer reads are descriptive only: plain-3's read upper bound is 1,211.6 ms while its actual first local empty is 343.3 ms. Acceptance uses the registered local witness, not that late Node/browser read. Profile sample timings do not substitute for these three unprofiled distributions.

## 🧪 Content, history and access boundaries

Every candidate pre-Undo and final sender/peer/saved snapshot has 2,088 characters with SHA-256 `6c714aa1049090072c1b3c4acb27bf6e12c9e56426c8df01cf069a23c6529b44`; pending queues are empty, sender selection is 2,086 and peer selection 0. Plain-1 traverses **all 66 history groups** to exact CRLF-only content across sender, peer and storage, then restores all 66 with exact original text. Other sustained samples exercise one group. Candidate reload lists are empty. Historical baseline explicitly records its original 50-group capacity refusal after valid initial integrity; it is not presented as a candidate history pass.

The separate continuation case records all 2,087 inputs and exact 2,089-character sender/peer/saved text ending in the new `x`, SHA-256 `f21602221e3091f141f63ff89697afed6413ab4f9798c3a832b714e55830c96d`, selection 2,087 and no pending states. Browser quiet gap is 427.1 ms; request return 89.239 ms; continuation frame/native read 106.6/107.5 ms; original last key through continuation frame/read 533.7/534.6 ms. All meet the unchanged respective 1,000/500/500/1,850/1,850 ms bounds, with no reload.

Composition records preserve composing-Enter provisional text, selection, pending state and history, include cancellation-end and converted-commit, have zero dropped events and end with zero pending work. Passing current source assertions verify cancelled text absence, atomic finalized Undo/Redo and exact saved/peer content. This is native browser composition-protocol coverage, explicitly **not physical IME** coverage.

Revocation begins with 31 pending history/collaboration states, captures one held write, and records `forwardedAfterRevocation: [false]`. The current source assertions verify persisted snapshot/revision unchanged, late composition refused and the old capability denied. Empty error records and passing report support that boundary; the compact boundary record is not a separate raw database dump.

## 🔬 Profile interpretation and limits

Both profiles are retained intact, but no CPU event reanalysis was run locally. Clock uncertainty is **1,897.6 ms baseline / 1,821.2 ms candidate**. Baseline has two negative deltas/four reordered samples; candidate one/two, explicitly disclosed. Baseline native reducer samples occur within certain **whole tasks** of 40,764 ms history and 42,091 ms collaboration. These durations are not exclusive reducer CPU time.

Candidate reducer functions are sampled, but exact containing-task attribution remains unavailable. The registered comparison conservatively uses the worst candidate whole task, 188 ms, as an upper bound: relative reductions 99.5388% and 99.5533%; the three unprofiled baseline tasks yield conservative whole-task reduction 99.5138%. These are the existing comparative metrics, not a claim that SPN-144 optimized editor code or precisely caused those differences. Profile-minus-plain-median typing differences (21,862.8/9,965.8 ms) include run variation and do not isolate profiler overhead. This is 390px browser emulation rather than a physical-device benchmark.

Prior capacity/idle failures remain historical measured violations with their recorded dispositions. Current first-attempt passes do not erase those records or establish their causes. No threshold change, native rerun, or converter execution was performed for this review.

## 📁 Reproducible review evidence

`retain-responsiveness-mobile-b.ts` and its member proof cover all ZIP bytes. `audit-responsiveness-mobile-b.ts` / `responsiveness-mobile-proof-b.json` cover raw budgets, current harness/source identities, profiles, all 11 reports and comparison. `audit-responsiveness-mobile-semantic-b.ts` / `responsiveness-mobile-semantic-b.json` cover actual idle ownership, history sealing, exact continuation text, composition/revocation and hosted receipts. Final summary is `responsiveness-mobile-review-b.json`.

All three serialized watchdog operations passed on their first execution: extraction 332 ms / 93,392 KiB peak; raw audit 1,436 ms / 238,880 KiB; semantic audit 209 ms / 91,312 KiB. Pressure stayed normal. No implementation edits, browser runs or whole-profile parsing occurred. The serial slot was released before report writing.
