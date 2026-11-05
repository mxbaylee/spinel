# ✅ SPN-143 desktop responsiveness acceptance — reviewer A

**Accepted for this current-source owner. No actionable evidence finding.** Mobile, callback and other selected owners remain separate; this is not overall merge approval. No browser/benchmark rerun or profile-event reanalysis was performed.

## 🔐 Identities, attempts and integrity

Source `96b11bf0374540d28e5537d4a9cddb1280403e21`, base `eb32117f5d09c28cd411063256db6d645335ae8a`, tested merge `159aa2ab36bdb7313d6a2c7770b685512bf19216`; source/tested tree `9920742df8645f3d963ba5de1b5819efa9d1de7a` was independently verified in the companion callback audit. CI **41937955289**, attempt **1**, job **126951454580**, artifact **13374893883**. Job log confirms the tested merge and immutable responsiveness baseline `2c84a18449c7dae09e2817989fac6236be96ef98` with the matched harness overlay.

Independently verified original ZIP **1,212,529 bytes**, SHA256 `b08c1173b355c9a747e00e9134940b3527eaf755f5d9fcfafb1a42672a3ee111`. All **18 extracted members** are byte-identical to their ZIP entries. All nine harness/lock hashes in each of the eight metric records match the reviewed source. Baseline reports four passing observations; candidate reports seven passing cases. Every test has one result, retry 0, no errors, skipped/flaky/unexpected result. Same runner **1000041653**, Chromium **156.0.8078.4**, Node **26.12.1**, Playwright **1.64.1**, desktop 1440×1000, throttle 1; no physical-device claim.

Raw budget/hash verification passed once under the serial watchdog in **1.137 s**, sampled combined peak **214,608 KiB**, normal pressure. The script, log, watchdog and complete file proof are `audit-responsiveness-desktop-a.ts`, `desktop-audit-a.log`, `desktop-audit-a-watchdog.json` and `desktop-audit-a.json`. These are reviewer verification resource costs, not hosted browser memory measurements.

## ⏱️ Primary unprofiled budgets

Independently recomputed distributions from raw input, long-task, capacity-flush and idle-witness values. Plain 1/2/3 each have **2,086 inputs**, **65 capacity pairs**, high-water **32/32**, a complete terminal **six-history/six-collaboration** idle episode and zero final pending. All budget-result flags are true and no debounce-breaking gap is recorded.

- Capacity p95 **6.2 / 6.3 / 6.8 ms**, below 16 ms; maxima **7.8 / 9.2 / 9.1 ms**, below 50 ms.
- Idle episode p95/max **0.7 / 2.4 / 0.4 ms**, below 16/50 ms. All three plain cases use the actual **native timers** path. Their idle episodes are correctly included from native witnesses even though ordinary flush arrays contain only capacity records; no missing policy-idle entry hides the six-state tail.
- Input-to-frame p95 **30.3 / 29.6 / 29.7 ms**, below 100 ms. Plain 1 has no observed task at the 50 ms observer threshold; this is censored observation, not zero work. Plain 2/3 longest tasks are **51 / 52 ms**, below 200 ms.
- First verified browser-local drain **301.6 / 303.2 / 301.5 ms**, below 1,000 ms. Later reads are **106.9 / 136.1 / 108.5 ms** afterward and remain descriptive, not replacement acceptance clocks. Witnesses retain all 2,086 completed states, are not invalidated and transition 6/6 to 0/0.

The profile sample completes separately: capacity p95/max **6.8/25.7 ms**, policy-idle **0.7 ms**, browser-local drain **334.4 ms**. It is not substituted for the three primary unprofiled samples.

## 🧪 Content, actual history, continuation and access

All candidate sustained-input cases retain matching sender, peer and saved **2,088-character** content, SHA256 `6c714aa1049090072c1b3c4acb27bf6e12c9e56426c8df01cf069a23c6529b44`. Sender selection is 2086/2086, peer selection remains 0/0, both native queues are drained, errors/reloads are empty and correctness completes.

Plain 1 requests the actual observed **66 history groups**. Its first Undo removes the terminal six-character group; full Undo reaches the two-character empty stream with history 0 Undo/66 Redo, then all 66 Redos restore exact sender/peer/saved content, selection and 66 Undo/0 Redo. Other sustained cases exercise the terminal group and exact restoration. Retained native history states and the executed loops support this, not merely a passing status string.

Continuation observes **388.1 ms** browser quiet gap. The new key reaches frame/native read in **31.9/31.9 ms**, request return **43.756 ms**, and final-original-key to frame/native read **420/420 ms**, all within unchanged limits. Exact 2,089-character sender/peer/saved content and caret 2087 are retained without errors or reloads.

The two native boundary cases pass. Composition records and source assertions preserve provisional text/history/selection across composing Enter, exclude cancelled provisional text and atomically Undo/Redo final composition with exact saved/peer content. Guest revocation retains one held write, `forwardedAfterRevocation: [false]`, unchanged persisted snapshot/revision and denied old capability; the executed source explicitly requires HTTP **403**. Both records have no dropped composition events or application errors. They explicitly record `physicalIme: false`.

## 📊 Pairing and profile limitations

Paired comparison is passed/timing-valid with candidate integrity true and no failures or unavailable requirements. Historical baseline records preserve uncapped queues, multi-second tasks and the narrowly checked baseline-capacity redo refusal with recovered integrity; those observations are not presented as candidate budget passes.

Verified profile hashes: baseline `962502c2364b07737a796a3d15026761157d3396a033df43ac6545ec738e1c22`; candidate `abd1477526e2ce975240f91e59b8672be1b434863de567ba9bd93630f6e64e99`. Clock bracket uncertainties are **343.0 / 342.4 ms**. Baseline sampled reducers have certain whole containing tasks of **7,201 / 7,522 ms**. Candidate reducers are sampled but have **no certain containing task**; its profile discloses one negative delta and two reordered samples under the existing handling. Exact candidate reducer task duration remains unavailable. The relative gate uses the conservative **52 ms whole-task bound**; this is not an isolated causal timing measurement of SPN-143 or any prior guard optimization.

The shared fixture change passes these current native content/history/access owners without changing the performance algorithm or budgets. Previous SPN-142 responsiveness failures retain their original dispositions and unknown inner causes; this current pass does not erase them or establish a new performance improvement. SPN-143's separate historical callback recurrence is assessed by the callback owners. Preserve these complete raw records/profile files and byte proofs in final durable evidence, then require the remaining selected current-head checks and fresh merge guards.
