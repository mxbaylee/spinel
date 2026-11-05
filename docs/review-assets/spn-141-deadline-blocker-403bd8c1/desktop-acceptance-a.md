# ✅ SPN-141 desktop responsiveness acceptance — reviewer A

Accepted for this exact first-attempt desktop responsiveness owner. No blocker. Current application/browser acceptance is separate from the completed three macOS native owners, mobile gates and final merge readiness. This integration does not introduce a new responsiveness improvement claim.

## 🔎 Exact pair and integrity

Source `403bd8c1dfdf0b266ca93c0354abef0ef37cea64`, accepted base `5c565b61e11ce29780581f33410749436ecef42f`, tested `28897ac1e143492bae980abf29f73c0e3daa8717`, matching tree `4893ed46f3c483d1da1d9e753b106af22d6cb65a`. CI `41945378505`, attempt 1, job `126977563770`, artifact `13378888899`. ZIP: 1,343,555 bytes, SHA256 `1b108441a470d526f8971b17b96a8791069344f7ffbb607a355a90f98cef023e`, matching the API digest. All 18 original ZIP members match extracted bytes/hashes, including both CPU profiles and clock records.

All eight metrics records (three plain plus one profile per role) are complete with zero errors and attempt 0; current-source hashes match all nine maintained harness paths. Candidate uses the tested current merge; baseline uses immutable `2c84a18449c7dae09e2817989fac6236be96ef98` with the current registered observation protocol. Baseline's four tests and candidate's seven tests each have exactly one successful retry-0 result, no errors. Both profiles are separately identified by their metrics SHA256. The retained comparison reports paired protocol revision 5 accepted, with no failures/unavailable requirements. Job log independently shows four baseline and seven candidate passes and successful comparison.

## ⏱️ Strict primary budgets from raw records

I recomputed distributions from raw capacity flushes, native idle observations, input/frame events and long-task records, using the current strict budget definitions. In plain-1/2/3 order:

- Capacity p95 **5.8 / 6.4 / 4.4 ms**, maxima **6.7 / 21.1 / 5.6 ms**, within 16-ms p95 and 50-ms maximum limits. Each sample has 65 actual capacity flushes.
- Terminal idle p95/max **0.5 / 0.7 / 0.4 ms**, within the same limits. Terminal state has six pending history and collaboration states, with matching epoch/generation/unit/time-origin and 2,086 completed states. Plain-1 uses an observed policy-idle pair; plain-2/3 show actual history-timer then collaboration-timer owners. Both phases transition the six-state residue to zero. The current `docIdleDurations` validates identity and computes the actual terminal native episode; it does not substitute the nominal policy wrapper or a delayed driver read.
- Input-to-frame p95 **26.1 / 26.0 / 26.7 ms**, below 100 ms. Each has all 2,086 native keydowns/frame observations. No >50-ms long tasks are recorded in the three plain samples, so observed longest task is 0 against the 200-ms limit.
- First verified browser-local drain **328.8 / 301.4 / 301.3 ms**, below 1,000 ms. Both queues are zero, with high-water exactly 32/32. The witness remains valid and is sealed after native/peer/saved integrity but before Undo. Late driver read upper bounds remain descriptive.

All stored budget decisions agree with the independent raw recomputation. Profile sample is distinct from these primary unprofiled gates; it records capacity max 7.6 ms, idle 0.6 ms and one 50-ms long task, without replacing the plain samples.

## 📦 Real history, peer and boundary behavior

Every candidate sample verifies exact 2,088-character text hash on sender, live peer and saved server state, sender selection 2086:2086, peer selection 0:0 and 66 accumulated native history groups. Plain-1 performs the complete **66 Undo / 66 Redo** walk: after the first six-state undo, all groups undo to exact `\r\n` on sender/peer/server with 0 undo/66 redo entries, and redo returns exact full text with 66 undo/0 redo entries. Other candidate samples execute their registered one-group undo/redo, not another 66-group walk. All candidate pre-Undo/final observations retain exact content and empty reload records. The executed current harness also requires Online state and exact saved/live content.

Historical baseline retains its documented `baseline-capacity-refusal` and capacity-triggered reload after redo, with valid pre-Undo integrity. It is descriptive baseline behavior, not treated as candidate success or concealed by reopening.

Post-burst continuation preserves exact text plus `x`, saved hash, peer state and no reloads. Its actual quiet gap is 380.1 ms; continuation request/return 43.351 ms, key-to-frame 37.7 ms, key-to-native-read 37.9 ms, final-original-key-to-continuation frame/native read 417.8/418.0 ms: all within registered budgets. Current harness hashes and run/test identities also match this record.

The two boundary tests retain zero errors/dropped input events. Composition cancellation/composing Enter preserve provisional text/selection/history appropriately, then converted commit atomically Undo/Redoes with exact saved/peer text. Revocation starts with 31 pending states and a held write; forwarding is `[false]`, late guest composition is rejected, the old capability returns 403 and persisted snapshot/revision stays unchanged. I inspected current boundary assertions and retained records. These are browser CDP-driven composition checks with explicit synthetic completion where applicable; `physicalIme: false`, not a hardware IME claim.

## 📈 Profile and historical limits

Retained baseline profile clock uncertainty is **281.1 ms**, candidate **310.1 ms**, with zero negative deltas/reordered samples in each. Baseline history/collaboration samples have certain containing tasks of 5,361/5,539 ms; these are whole-task durations, not exclusive reducer time. Candidate reducers are sampled but have no certain containing task; their task attribution remains unavailable. The registered relative comparison uses a conservative 50-ms worst candidate whole-task upper bound (including profile) and separately corroborating plain baseline long tasks, not an invented precise reducer duration. Profile/plain timing variation mixes run variation with profiler effects. I verified profile byte identity and retained attribution/clock limits without recomputing CPU sample attribution.

This current pass preserves the strict idle/capacity contract repaired by accepted prerequisites; it does not identify the historical 102.4/115.6-ms capacity or idle recurrence's cause or waive any prior failure. Evidence is a desktop Playwright Chromium preset, not physical-device performance.

## 🧾 Reviewer execution evidence

`audit-responsiveness-desktop-a.ts` and `desktop-audit-a.json` verify ZIP, identities/hashes, first attempts and raw budgets; first execution passed in 1,166 ms / sampled 222,048 KiB under serial/watchdog. Additional `audit-desktop-semantics-a.ts` / `desktop-semantics-a.json` verify exact history, idle owners and continuation/boundary records. Its first reviewer-only attempt incorrectly required historical baseline final reloads to be empty; it correctly encountered the recorded baseline capacity refusal. The first script/log/watchdog are retained. I corrected that assertion to candidate-only and restricted composing-Enter equality to semantic fields rather than observation timestamps; the corrected verifier passed in 302 ms / sampled 90,480 KiB. No application source, acceptance requirement or browser execution changed. All local audit runs had normal memory pressure; no application/profile rerun occurred.
