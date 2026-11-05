# ⏱️ SPN-141 current desktop responsiveness acceptance — reviewer A

**Accepted for this current-source owner.** All11 first-attempt cases and raw primary budgets pass. No source change, application/browser/converter rerun or old-pass credit. Other current owners and final CI readiness remain separate.

## 🔎 Identity, complete artifact and source assertions

Source `4e593fbaf9ea89585920053b9415f9a8eac0944f`; base `2f442317dd2e1c188ae4a810ac094fd1162a4a2a`; tested merge `f0e74d52629923737985ce03e4f32ff218dcf76d`; independently equal source/tested tree `a2b37aa82336224ac40e92f7364e52ccebfb6d74`. CI41970163093 attempt1, job127056548338 is terminal success (2026-11-05 04:57:29Z–05:13:17Z), with every step successful.

Artifact13389838658: `responsiveness-desktop.zip`, **1,553,501 bytes**, SHA256 `531ac034b5e8b347ca258fd9e7b10e02c8858798503a47e42de8baaa3e21a74f`. API size/digest/run/source match. Independently streamed and CRC32/SHA256 checked all18 original members, exclusively extracted and reread them; a second raw/member equality check also passed. All18 retained, none omitted; complete original ZIP remains. No passing PNG/video is present.

All eight metrics have completed status, attempt0, no errors, actual source identities and harness hashes matching the current reviewed source. Four historical observations use `2c84a18449c7dae09e2817989fac6236be96ef98`; four candidate observations use the current tested merge. This baseline is distinct from the callback baseline. Four baseline plus seven candidate Playwright cases each have one passed retry0 result and no errors. The candidate cases include three plain samples, one profile and the three boundary/post-burst cases. Browser156.0.8078.4, Nodev26.12.1, Playwright1.64.1, runner and instrumentation match between paired samples. Profile file hashes, clocks and bounds match their raw retained records.

## 📏 Raw unprofiled acceptance

Recomputed distributions from raw flushes, input timestamps and long tasks, and independently recomputed idle duration from terminal native ownership records using the current helper. Computed values equal stored summaries; stored passing flags are not the only evidence. Candidate plain1/2/3 respectively:

- Capacity p95 **9.0/5.7/8.7ms**, maximum **9.7/10.2/19.9ms**; unchanged limits16ms p95 /50ms maximum. Each sample has65 capacity groups, all32 history and32 collaboration entries.
- Terminal idle duration **0.5/1.5/0.8ms**, independently below the same16/50ms limits.
- Input-to-frame p95 **35.4/35.8/35.1ms**, below100ms.
- Longest browser task **65/67/58ms**, below200ms.
- First verified browser-local empty **304.7/318.0/302.8ms**, below1,000ms. Later read upper bounds538.6/579.0/443.8ms are descriptive, not substituted for the acceptance clock.

Each candidate records all2,086 completed native states and keydown observations, high-water32/32, terminal pending6/6 and final pending0/0. Clock/unit/generation ownership is checked by the current idle validator; no witness invalidation occurs. The witness is sealed after content integrity and before Undo.

All three plain samples and the profile actually drain through **policy-idle**. Plain1 history/collaboration owners each measure0.2ms and the pair record0.4ms, while the acceptance episode including its complete observed bounds is0.5ms; plain2 history1.2ms/collaboration0.3ms yields1.5ms; plain3 history/collaboration0.4ms each yields0.8ms. Profile owners measure0.7/0.4ms within1.2ms. No absent timer or policy owner is invented, and no synthetic summary replaces native ownership evidence.

## 📝 Content, history and access

Reconstructed the full16-paragraph text and verified pre-Undo sender/peer/saved identities across all metrics:2,088 characters, SHA256 `6c714aa1049090072c1b3c4acb27bf6e12c9e56426c8df01cf069a23c6529b44`. Candidate plain1 undoes all66 groups to the exact empty CRLF document on sender, peer and persisted storage, then redoes all66 to exact original content and history66/0. The other candidate observations exercise the existing one-group round trip. Final sender selection is2086; peer remains0. Candidate pre-Undo, Undo/Redo and final reload records are empty; both reload observers have zero dropped/malformed events. Historical baseline capacity refusals and capacity-triggered reloads remain explicitly recorded, not promoted to candidate correctness.

The quiet-pause continuation retains the exact original-plus-`x` saved content, no reloads, and source/harness/run identity. Request return39.522ms, key-to-frame33.7ms, key-to-native-read33.8ms; original-final-key to continuation frame424.3ms and native read424.4ms. Browser quiet gap390.6ms. All registered continuation limits pass.

Composition records show Enter leaves provisional text, selection, pending groups and history unchanged; cancellation leaves no provisional text; converted commit is atomic under Undo/Redo with exact saved/peer content. Revocation retains31/31 pending work, one held write, forwardedAfterRevocation `[false]` and zero dropped composition events. Inspected current boundary source: it requires guest document removal, rejects the old capability with HTTP403, compares persisted snapshot/revision unchanged, and verifies empty owner content after a late detached composition event. This is a synthetic composition boundary, explicitly not physical IME acceptance.

The sustained and boundary source awaits fixture close in `finally`; all cases and job cleanup passed. There is no separately recorded OS-wide process absence inventory, and none is claimed.

## 🔬 Profiles and interpretation limits

Profile clock uncertainty is **423.2ms baseline /430.4ms candidate**, with zero negative deltas or reordered samples in both records. History/collaboration sampled CPU is8155.412/8637.357ms baseline and127.188/113.017ms candidate. These are sample-weighted descriptive estimates, not precise exclusive CPU measurements.

Baseline has certain reducer samples inside whole browser tasks9061/9467ms. Candidate precise containing-task attribution is unavailable; the existing comparison uses the conservative worst observed candidate whole task70ms across plain/profile samples, separately from sampled reducer attribution. The three baseline plain long tasks9220/9264/9321ms corroborate the existing historical workload comparison. This does not isolate an SPN-141 improvement or identify a historical transient's cause. Raw unprofiled budgets above own latency acceptance; profile timing cannot replace them. No whole-profile event reanalysis was repeated locally; exact profile bytes/clocks and retained analyses were verified.

## 📦 Independent verification record

First executions all passed under the shared serial2GiB watchdog at normal pressure:

- Complete artifact extraction:200ms /90,704KiB sampled peak.
- Raw metrics/source/member audit:703ms /220,960KiB.
- History/idle-owner/continuation/boundary audit:188ms /90,640KiB.

Small final metadata checks bind artifact/job/log identities, paired instrumentation, reload observers, profile clocks and raw-summary equality. No helper failure occurred for this current owner. Reports and proofs: `responsiveness-desktop-review-a.json`, `responsiveness-desktop-members-a.json`, `responsiveness-desktop-audit-a.json`, `responsiveness-desktop-semantics-a.json`; corresponding retained TypeScript helpers/logs/watchdogs are in this evidence root. All current evidence is independent of prior SPN-144 owner acceptance.

## ⚠️ Remaining readiness and acquisition disclosure

Current Storybook run41970163084 has a separately reported provisioning failure and is not accepted by this responsiveness pass. Parent is investigating it. Mobile responsiveness/current aggregate reconciliation, final publication and fresh merge guards remain required. No overall merge approval.

The GitHub connector supplied the ZIP and job log; full job/artifact metadata were read through the CLI REST endpoints because the connector job tool provides only step summaries. An initial download connector call used the wrong argument key and was rejected by schema validation before dispatch; the corrected request succeeded. This acquisition mistake is recorded in `responsiveness-desktop-download-disposition.json`, not treated as a native scenario attempt. Local audit helpers all passed their first execution.
