# ✅ SPN-142 desktop acceptance — reviewer A

Independent nonimplementing audit; agent review only. **Current-source desktop responsiveness acceptance is supported, with no findings.** Mobile, other selected CI and final merge guards remain separate obligations. No overall merge approval is implied and no old pass is reused.

## 🔎 Identity, protocol and attempts

Source 2b173b29b3c0894a45b8d48d92073c3645110673; base 7679351822caaa9535d73d656191f2a6597a3380; tested merge 3b11e1e7469b2d3fc59ac95195bf4da6333c16c4. Independently resolved merge parents and source/tested equal tree eac584b6bb8e9a377e69ae58551df67df5b7bcde. CI 41916623281 attempt 1, desktop job 126878184028; supplied artifact 13365976989. Recomputed ZIP SHA-256 db6c0d255d9ff3eca2cc2d780c1a444a53708719718bbd3a97084e8963aed532.

Read the retained full job log, plan, both Playwright reports, all eight typing metric records, comparison, profile hashes/clocks and candidate post-burst/boundary records. The full plan identifies this head/base/tested merge and selects responsiveness plus its historical comparison. Log checkout agrees. The baseline is immutable 2c84a18449c7dae09e2817989fac6236be96ef98 with the declared matched harness overlay; candidate dirty state contains only the separate baseline checkout. All nine retained harness/lockfile hashes in every typing record match the reviewed current files and one another.

Both sides ran on GitHub Actions 1000041289, Linux x64 AMD EPYC 9V45, four exposed CPUs, Chromium 156.0.8078.4, Playwright 1.64.1 and Node v26.12.1. Desktop is the configured 1440×1000 browser preset at CPU throttle 1, not a physical-device or macOS/Safari/Firefox result. Every typing sample retains 16 paragraphs, 2071 typed characters plus 15 Enter keys, 2086 key/frame observations and the exact 2088-character native stream. Profiles are separate samples; primary samples disable profiling, Playwright trace and per-mutation snapshots.

Baseline report has exactly four expected passes; candidate has exactly seven expected passes: plain-1/2/3, profile, post-burst, pending-composition boundary and guest revocation. Every result list contains one passed retry-0 record with no errors. Neither report has skipped, unexpected or flaky cases. All eight typing records have attempt 0 and completed true. Comparator schema 2/protocol 5 is paired, timingValid/candidateIntegrity/passed true, with failures and unavailable arrays empty.

## ⏱️ Primary desktop measurements

Independently recomputed capacity maximum/p95 from raw observations and checked integrity/drain records, rather than relying only on comparator status. Plain-1/2/3 capacity p95 values are 5.1/6.0/5.5 ms against 16 ms; maxima are 24.9/6.6/7.6 ms against 50 ms. Each has 65 full 32-state capacity flushes and one six-state terminal idle episode. Idle durations are 0.6/0.5/0.4 ms, satisfying both idle limits. Plain-2/3 use the native history/collaboration timer episode; plain-1 uses policy-idle. The canonical paired episode includes the interval between its two native phases. None is missing or diluted into the capacity distribution.

Input-to-frame p95 is 28.9/28.4/26.8 ms against 100 ms. Delivered longest tasks are none/52/61 ms against 200 ms. An empty long-task list reflects the 50-ms reporting threshold, not proof of zero work. Browser-local drain is 313.9/301.5/301.2 ms against 1000 ms; late-read upper bounds 511/464.7/401.9 ms remain descriptive. Native high-water values are 32/32, first-empty queues 0/0, terminal completion 2086 and witness invalidations empty.

The profile's capacity maximum is 9.8 ms and idle 0.5 ms, descriptive rather than a substitute for primary acceptance. It retains the same workload and integrity gates. No budget, timeout, input count, group policy or first-attempt rule changed.

## 📝 Content, history, renewed input and access

All four candidate typing records retain exact saved/sender/peer hashes before replay and at final restoration. Sender/peer selections match the expected positions, errors and reloads are empty, and both reload observers report zero dropped/malformed events. Plain-1 replays all 66 actually observed groups: Undo reaches the two-character empty native stream and Redo restores the complete document and 66/0 history. Other typing samples correctly request one group, briefly reducing text to 2082 characters before restoring 2088; they are not mislabeled full-history replays.

Post-burst has its own completed attempt-0 source/harness record: 2087 keys, 405.8-ms browser quiet gap, 41.6-ms continuation frame, 41.7-ms native read and 58.3-ms request return, all within the original limits. Frame/read from final original key are 447.4/447.5 ms. Exact continued text is 2089 characters, saved/peer hashes agree, selection is 2087/2087, native history 67/0, reloads/errors empty.

Read source assertion wiring alongside both boundary records. Composition retains 31/31 pending near the cap, all 70 provisional updates and 226 delivered composition events without drops; composing Enter preserves provisional text, selection, pending state and history. Cancellation excludes provisional text, final composition creates one atomic replayable group, and exact saved/peer text follows Undo/Redo. This is CDP/browser-event coverage with physicalIme false, not an OS keyboard qualification.

Revocation retains one held write, forwardedAfterRevocation [false], pending guest work and four recorded provisional events without drops/errors. The successful source case asserts removal of the guest editor, late detached input unable to submit, 403 for the old capability, and exact unchanged server snapshot/revision. These claims are enforced in the executed harness; the compact JSON is not a standalone dump of all server snapshots. Cleanup is in the exercised finally paths, and complete test results have no teardown failure.

## 📊 Historical comparison and attribution limits

Both profile byte hashes match their retained clock/metrics records. Baseline clock-start uncertainty is 311.6 ms; candidate is 295 ms. Baseline certain whole tasks containing reducer samples are history 5538 ms and collaboration 5974 ms. The registered conservative comparison uses the worst entire candidate task, 61 ms, yielding about 98.899% and 98.979% reductions; all three plain baseline tasks independently exceed one second and corroborate the gate. These percentages compare the historical uncapped baseline, **not the pre-SPN-142 patch**, and do not assign the whole baseline task to composition alone.

Candidate reducers are sampled, but there are no certain containing-task assignments for them; native per-task attribution remains unavailable. No negative/reordered CPU-profile deltas are recorded. Profile-minus-plain-median differences include run variation, not isolated profiler overhead. Baseline cases retain the protocol's explicit capacity-refusal/reload recovery to saved empty state after verified original content/Undo; they are not candidate latency/history successes. Historical missing capacity timings remain unavailable rather than zero.

This desktop success does not identify the cause of SPN-141's earlier unprofiled 102.4-ms mobile interval and does not establish mobile acceptance. No routine screenshots are needed for this unchanged UI; artifact JSON/profiles contain synthetic benchmark evidence. No browser, benchmark or full-validator workload was rerun during review. A lightweight reviewer check initially assumed every idle episode appeared in the policy flush list; reading docIdleDurations and native timer witnesses corrected that reviewer assumption, with no change to source or evidence.
