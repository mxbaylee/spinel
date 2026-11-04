# 🔎 Closed-PR receipt runs: independent responsiveness disposition A

## Decision

Both newly discovered failures are real retained acceptance failures. Closed-PR metadata edits did trigger application CI; the previous assumption that this publication sequence avoided new runs was wrong. Neither failure may be dismissed as metadata noise, counted as a pass, or retried unchanged until green.

SPN-142 remains a justified, narrowly proven work-reduction candidate. Its current-source desktop first-attempt acceptance remains valid for those current samples. However, the newly retained desktop idle recurrence has no demonstrated repair or measurement disposition in SPN-142's existing implementation. Overall merge readiness must remain blocked until that obligation has an explicit owner, scope checkpoint and evidence-backed disposition. Current mobile acceptance also remains pending at this review.

## 📌 Identity and retained evidence

Run `41899145584`, attempt 1, mobile job `126816803945`, artifact `13360981090`: ZIP SHA-256 independently verified as `e40aa082eddb88249ae9e324a3bae3435360ed50e4d919e52fcecd43dc8b40df`.

Run `41899251120`, attempt 1, desktop job `126832034875`, artifact `13359658861`: ZIP SHA-256 independently verified as `2b1358fa2c5c035411e940b82e3e36c040bfb3ea117be9f91318eb1f7f652189`.

Run metadata refers to PR head `97b0db550385b51cdbc8f0543aaa21524c1e05dc`; both actual candidate records identify checked-out squash commit `13b74ecea5f2552627ff638be9413ad4754ef581`. Independently verified that both have identical tree `dfeb3d10b8367f2edf331a0bfc76bc8a2ac70a9b`. The only recorded dirty path is the separate baseline checkout. All nine responsiveness harness/lock hashes match current SPN-142 files; no timing-budget or fixture change explains away these failures.

Each job retains four passing historical-baseline cases and seven candidate cases: six pass, one fails; all are retry 0 with no skipped/flaky cases. Baseline success applies to its separate baseline-observation contract. The source assertions and full job logs agree with each retained failing metric. No new tests, browser runs or profile parsing were performed for this review.

## 📱 Mobile capacity failure

Mobile plain-1, fourfold CPU throttle, fails line 718: capacity maximum `115.60000000009313 ms > 100 ms`. This is pair 17, completed states 544, 32 history and 32 collaboration items, from browser time 20,935.9 to 21,051.5 ms. History occupies approximately 48.2 ms and collaboration 67.4 ms; both return and empty their queues. An observed 165 ms long task encloses the pair. Neighboring capacity pairs 16/18 are 11.7/7.4 ms. Capacity p95 is 24.4 ms within 50 ms, idle 2.4 ms, frame-opportunity p95 85.5 ms, longest task 165 ms, first verified browser-local drain 398 ms. No debounce-breaking gaps are recorded.

Exact saved/live peer content, sender/peer selection, Online state and all 66 actual Undo/Redo groups passed before the timing assertion. Timing collection completed; the final all-assertions completion marker is absent because the budget failed. Passing correctness does not erase the timing violation.

Workload arithmetic maps states 513–544 to an Enter at zero-based index 7, leaving 24 ordinary inverse states before the structural operation in reversed history order. This fits the class addressed by SPN-142's all-32-position manager controls and leading-delete-prefix reduction. It is an arithmetic inference, not a captured failed cache. The dominant 67.4 ms collaboration phase is not proven to be reduced by the inverse-prefix change; forward insert composition/publication is unchanged. The failure may be retained within SPN-142's existing mobile capacity outcome, with explicit limitations and fresh unchanged acceptance, but must not be reported as a diagnosed JSONX/GC/scheduler cause or a proven repair of this exact interval.

## 🖥️ Desktop idle recurrence

Desktop plain-3, throttle 1, fails line 721: idle p95 `25.300000000046566 ms > 16 ms`. There is exactly one idle episode, so p95 is this single observation. It is a real policy-idle pair after 318.7 ms quiet, completed states 2086, with six history and six collaboration items. Browser interval 60,563.2–60,588.5 ms contains history approximately 1.2 ms and collaboration 24.1 ms. Both return and empty their queues. Maximum remains below the independent 50 ms limit; that does not waive p95. The final capacity pair is 4.1 ms, capacity p95/max 7.6/14.2 ms, frame-opportunity p95 33.9 ms, longest observed task 66 ms, browser-local drain 345.3 ms. No enclosing long task is recorded, which is compatible with the observer's 50 ms threshold and is not evidence of zero main-thread work.

Exact content, saved/peer convergence, selection and the actual terminal-group Undo/Redo passed before the timing assertion. The terminal six characters are `ating.` (states 2081–2086), with no Enter/structural boundary. This arithmetic shape is the complete ordinary six-state group already optimized by SPN-135. SPN-142 adds no new composition reduction for a fully qualified delete group and leaves forward insertion/publication and idle scheduling unchanged. Reduced work earlier in the document could affect later runtime behavior, but no retained evidence establishes that causal mechanism. A later green idle sample cannot by itself close this recurrence.

## ⏱️ Attribution and ownership limits

Both failing plain cases have profiler false, Playwright trace false and per-mutation snapshots false. Their native phase spans share browser clocks with local witnesses; those directly support the phase durations above. Separately executed profile cases cannot identify either failed interval. Their clock-start brackets are approximately 1,492.2 ms mobile and 411.8 ms desktop, with separate sample timing and profile identity. No GC, host-contention, network, JSONX or scheduler cause is established; cgroup capacity is unavailable. Do not subtract overhead or substitute profile timing for unprofiled acceptance.

The completed SPN-135 outcome historically owned the six-state idle path and retained its earlier causally unattributed failure. The new desktop recurrence demonstrates that its old accepted sample does not dispose every subsequent failure. No active backlog ticket explicitly owns this new recurrence; SPN-122 remains post-launch upstream retirement and must not be repurposed.

Before proceeding, record either (a) an explicit SPN-142 scope expansion/checkpoint retaining this collaboration-dominated idle obligation, or (b) a distinct pre-launch prerequisite with complete ownership/dependencies. A bounded read-only/offline investigation should inspect the retained collaboration/native publication path first and establish a discriminating hypothesis or supported measurement disposition before choosing new native execution. Declare exact source/instrumentation, finite count, stop condition and cleanup prospectively. A new algorithm or repair needs meaningful negative controls and exact-source reviews. No fresh browser execution is authorized by this review.

Owner and collaborator responsiveness, guest access/content invariants and operator workload/evidence reliability all remain required. Retain the two failures and correction of the receipt-trigger assumption in canonical evidence; cancel and terminally verify unintended active runs separately. Do not use unrelated successful metadata-triggered runs as acceptance credit. Current SPN-142 desktop acceptance is preserved without granting retrospective green status or overall merge approval.
