# ⏱️ SPN-144 integrated desktop responsiveness acceptance — reviewer A

**Accepted for this current-source owner.** All11 first-attempt cases and raw primary budgets pass. No source change, application/browser/converter rerun or old-pass credit. Other current owners and final CI readiness remain separate.

## 🔎 Identity, complete artifact and source assertions

Source `968649bdec92469e8761d6e09ed7f6900c79abc0`; base `89d93c8b23db65d3fe6a83d1853acc716c024b80`; tested merge `9e27273f7b616dd48b641f544fac1ab1cb72b13a`; independently equal source/tested tree `5552cf754b509ac4ce8f2857c08ea24509304722`. CI41965105059 attempt1, job127040403708 is terminal success (2026-11-05 04:01:27Z–04:18:04Z), with every step successful.

Artifact13387857563: `responsiveness-desktop.zip`, **1,711,679 bytes**, SHA256 `1cca41c0e9ee9f8ad41589d210fa6101b584995a79a784618a47d37b17b95813`. API size/digest/run/source match. Independently streamed and CRC32/SHA256 checked all18 original members, exclusively extracted and reread them; a second raw/member equality check also passed. All18 retained, none omitted; complete original ZIP remains. No passing PNG/video is present.

All eight metrics have completed status, attempt0, no errors, actual source identities and harness hashes matching the current reviewed source. Four historical observations use `2c84a18449c7dae09e2817989fac6236be96ef98`; four candidate observations use the current tested merge. This baseline is distinct from the callback baseline. Four baseline plus seven candidate Playwright cases each have one passed retry0 result and no errors. The candidate cases include three plain samples, one profile and the three boundary/post-burst cases. Browser156.0.8078.4, Nodev26.12.1, Playwright1.64.1, runner and instrumentation match between paired samples. Profile file hashes, clocks and bounds match their raw retained records.

## 📏 Raw unprofiled acceptance

Recomputed distributions from raw flushes, input timestamps and long tasks, and independently recomputed idle duration from terminal native ownership records using the current helper. Computed values equal stored summaries; stored passing flags are not the only evidence. Candidate plain1/2/3 respectively:

- Capacity p95 **8.0/7.8/6.7ms**, maximum **22.4/32.0/15.2ms**; unchanged limits16ms p95 /50ms maximum. Each sample has65 capacity groups, all32 history and32 collaboration entries.
- Terminal idle duration **0.6/0.6/0.8ms**, independently below the same16/50ms limits.
- Input-to-frame p95 **35.3/36.3/36.4ms**, below100ms.
- Longest browser task **55/71/52ms**, below200ms.
- First verified browser-local empty **301.6/324.5/305.2ms**, below1,000ms. Later read upper bounds445.9/509.2/530.3ms are descriptive, not substituted for the acceptance clock.

Each candidate records all2,086 completed native states and keydown observations, high-water32/32, terminal pending6/6 and final pending0/0. Clock/unit/generation ownership is checked by the current idle validator; no witness invalidation occurs. The witness is sealed after content integrity and before Undo.

Plain1 terminal work actually drains through **history-timer** (0.3ms) then **collaboration-timer** (0.2ms), with the complete episode measured0.6ms. Plain2/3 use **policy-idle**: history0.5ms plus collaboration0.1/0.2ms inside paired0.6/0.8ms records. Profile terminal work also uses the individual timers. These are actual observed owners; a policy-idle event was not invented for plain1. No synthetic summary can replace missing native owners.

## 📝 Content, history and access

Reconstructed the full16-paragraph text and verified pre-Undo sender/peer/saved identities across all metrics:2,088 characters, SHA256 `6c714aa1049090072c1b3c4acb27bf6e12c9e56426c8df01cf069a23c6529b44`. Candidate plain1 undoes all66 groups to the exact empty CRLF document on sender, peer and persisted storage, then redoes all66 to exact original content and history66/0. The other candidate observations exercise the existing one-group round trip. Final sender selection is2086; peer remains0. Candidate pre-Undo, Undo/Redo and final reload records are empty; both reload observers have zero dropped/malformed events. Historical baseline capacity refusals and capacity-triggered reloads remain explicitly recorded, not promoted to candidate correctness.

The quiet-pause continuation retains the exact original-plus-`x` saved content, no reloads, and source/harness/run identity. Request return43.341ms, key-to-frame37.9ms, key-to-native-read38.0ms; original-final-key to continuation frame427.2ms and native read427.3ms. Browser quiet gap389.3ms. All registered continuation limits pass.

Composition records show Enter leaves provisional text, selection, pending groups and history unchanged; cancellation leaves no provisional text; converted commit is atomic under Undo/Redo with exact saved/peer content. Revocation retains31/31 pending work, one held write, forwardedAfterRevocation `[false]` and zero dropped composition events. Inspected current boundary source: it requires guest document removal, rejects the old capability with HTTP403, compares persisted snapshot/revision unchanged, and verifies empty owner content after a late detached composition event. This is a synthetic composition boundary, explicitly not physical IME acceptance.

The sustained and boundary source awaits fixture close in `finally`; all cases and job cleanup passed. There is no separately recorded OS-wide process absence inventory, and none is claimed.

## 🔬 Profiles and interpretation limits

Profile clock uncertainty is **432.8ms baseline /433.0ms candidate**, with zero negative deltas or reordered samples in both records. History/collaboration sampled CPU is8755.507/9102.352ms baseline and128.632/118.150ms candidate. These are sample-weighted descriptive estimates, not precise exclusive CPU measurements.

Baseline has certain reducer samples inside whole browser tasks9699/9921ms. Candidate precise containing-task attribution is unavailable; the existing comparison uses the conservative worst observed candidate whole task71ms across plain/profile samples, separately from sampled reducer attribution. The three baseline plain long tasks9510/9895/9462ms corroborate the existing historical workload comparison. This does not isolate an SPN-144 improvement or identify a historical transient's cause. Raw unprofiled budgets above own latency acceptance; profile timing cannot replace them. No whole-profile event reanalysis was repeated locally; exact profile bytes/clocks and retained analyses were verified.

## 📦 Independent verification record

First executions all passed under the shared serial2GiB watchdog at normal pressure:

- Complete artifact extraction:283ms /91,616KiB sampled peak.
- Raw metrics/source/member audit:1,188ms /226,416KiB.
- History/idle-owner/continuation/boundary audit:298ms /91,488KiB.

Small final metadata checks bind artifact/job/log identities, paired instrumentation, reload observers, profile clocks and raw-summary equality. No helper failure occurred for this current owner. Reports and proofs: `responsiveness-desktop-review-a.json`, `responsiveness-desktop-members-a.json`, `responsiveness-desktop-audit-a.json`, `responsiveness-desktop-semantics-a.json`; corresponding retained TypeScript helpers/logs/watchdogs are in this evidence root. All current evidence is independent of prior7b owner acceptance.
