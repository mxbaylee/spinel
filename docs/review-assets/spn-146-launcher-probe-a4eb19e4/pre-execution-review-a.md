# 🔎 SPN-146 launcher capability — independent pre-execution review A

Reviewed read-only the prospective launcher plan, peer plan review, concrete run.ts, process ownership helper, outer watchdog and installed Playwright CLI. No test, browser, installation, probe or application execution occurred. The run directory does not exist at inspection. This is not a source grade, runtime allowance or merge approval.

Plan SHA256: `4d200bb4b311f5e884dbdfbef38937ce3cd102cd9c7ff6e2897fc5ca083b1713`. Reviewed in-progress runner after the first cleanup repair: `9ee616ace3e98d3b1db88c07b3116b19ef15ce5d244567f027921acce10f9fe6`; intended application source `a4eb19e4c5b95ba589042fe181cbcec2aa848990`.

## 🚦 Disposition

The initial helper required the concrete snapshot/cleanup repairs below. Final readback now closes both findings; the final admission at the end supersedes the initial withholding without erasing it. No repeated timeout test or larger harness is necessary. Once those defects are repaired, this can admit exactly one old→direct no-browser capability comparison under the existing serial 60-second/2-GiB/normal-pressure watchdog. It cannot admit another application run.

## 🛠 Findings and required dispositions

1. **Preserve observed cleanup failure before diagnostic writes.** Initially the final inventory could show surviving descendants, then a stdout/stderr write could reject before the code threw the cleanup failure. The observed primary would be lost. The current intermediate runner now assigns `failure` and `sample.failure` immediately when cleanup is false, before log writes; that precedence defect is resolved. However, descendants first discovered at this final inventory also need the owned termination attempt. The earlier kill branch only runs when failure existed before the final inventory. Keep the failed final snapshot and first failure, then attempt identity-checked reap; do not relabel the original failed sample as a successful cleanup observation.

2. **Check every retained observation against the declared bounds.** Only the polling `state` was checked against 15 seconds and 2 GiB. The distinct first-barrier snapshot and final cleanup snapshot can exceed either limit and still be used in a passing comparison if another poll is lower. Apply the same finite elapsed/RSS and policy check to these actual observations, retain the first violation before release/cleanup and preserve its precedence. Cleanup must still run even when its observation violates the bound. No threshold increase, alternate barrier or favorable-sample selection is warranted.

## 🔐 Inputs, parity and measurement

The actual probe requires the expected clean Git head, Playwright 1.64.1 with its declared cli.js executable, explicit donor resolution, a local .bin symlink to that exact CLI, offline/no-install npm arguments and an identical fixture/config/argument/environment input for both routes. Node/npm versions, executable paths, CLI/program/helper/runner hashes and fixture hashes are recorded. The installed @playwright/test CLI indeed requires playwright/lib/program and parses the same argument vector. This establishes an appropriate small real-CLI comparison rather than a fake process-size subtraction.

One shared fixture selects one named test, one worker and zero retries. It does not request Playwright browser fixtures. It publishes a ready PID/program/module inventory, blocks until one release, records afterEach status, and requires one expected/no unexpected/skipped/flaky result. Both worker inventories must agree on module paths, program, Node, executable, test identity and NODE_OPTIONS. Fixture hashes and symlink are rechecked before each invocation. Observed CommonJS cache entries are hashed afterward, with CLI/program hash stability checks. This is an observed worker module inventory, not an exhaustive temporal proof of all ESM/npm-executor code. Shared installed dependencies must remain read-only throughout. Do not describe literal post-npm environment equality: only environment-key differences and selected fields are compared, and npm naturally injects variables.

The first observed ready barrier is sampled exactly once and persisted before release. Concurrent owned RSS includes the probe parent, all observed descendants and sampling processes under the same PID/start/command ownership rule. Both fixed barrier totals and observed peaks are retained separately. The criterion is at least 65,536 KiB lower **concurrent barrier total**, plus identical result/cleanup and a smaller actual worker ancestor chain with npm executor absent. It does not subtract maxima or discard the executor from accounting. The removed shell can be inspected in the retained chain; do not claim an exact removed shell count solely from the shorter-chain assertion.

Fixed old→direct order, sampled rather than continuous RSS, OS/cache scheduling, retained parent state and different npm-added environment remain limitations. A 64-MiB qualifying observation is a local capability result, not a Linux headroom guarantee, causal attribution of the earlier RSS crossing or a statistical estimate. No forced GC, warmup, alternative window or repeated trial is introduced.

## 🧹 Ownership and persistence

Create-once root creation prevents replacing a prior partial or completed result. Initial incomplete receipt precedes preflight. Each child command and partial sample are recorded; logs are bounded at the monitoring boundary and failures stop the pair. Known descendants retain PID/start/command identities across reparenting. The external watchdog remains necessary for a wedged cleanup/exit wait and validates descendants at completion. An externally killed attempt may lack a terminal inner receipt and requires explicit post-abort inventory; it must never be treated as a completed comparison.

The existing actual intentional-timeout lifecycle control remains distinct supporting evidence. Do not run another timeout fixture here. Final report-write rejection must fail execution; a previous incomplete receipt cannot be interpreted as success. Preserve any first setup/typecheck failure and the final executable hash alongside the prospective decision.

## 🧭 Scope and next boundary

Operator benefits from removing a measured launcher layer without excluding any process from accounting. Owner, Collaborator and Link guest retain all application semantics, access, offline persistence, content/history and latency requirements. No browser/app/native/component/converter or provider invocation is included.

A successful complete pair may support an explicitly new reviewed source/environment decision. It cannot automatically renew the consumed a4eb diagnostic, repair either failed component criterion, prove the fixed trace window fits the hard budget, or establish historical pause causality. A failed/invalid pair closes this allowance; no local fallback or resampling follows. User scope remains SPN-146 and SPN-090, then stop.

## ✅ Final repaired-script admission

Final unexecuted `run.ts` SHA256 **`d97175b753efd12e3a5e7cce937e2190f025beae768bcb62d45ddddffe16dcc2`**. The plan hash above is unchanged. Confirmed the run directory still does not exist. No reviewer workload or implementation edits occurred.

Both concrete findings are resolved. Every snapshot now checks finite elapsed/RSS against the same 15-second/2-GiB policy, records the first violating snapshot and retains a failed disposition; the first barrier stops before release on violation. Cleanup classifies its first failure before logs and performs identity-checked termination with a bounded one-second reap. `firstUnsettled` preserves the initial surviving-process inventory separately from the final reap result, so a successful reap cannot erase the original failed observation. Logging/cleanup failures remain secondary to the primary. Ready publication is atomic; output retention now stops at one MiB per stream and overflow fails the attempt.

**Admit exactly the declared single old→direct no-browser probe on these bytes**, after the corrected helper's feasible scoped typecheck and under the planned serial outer watchdog. No remaining concrete source blocker found. This is pre-execution admission, not evidence that the criterion passes. The Mac shell may replace itself with Node; require the actual npm ancestor in the old chain, its absence in the direct chain and fewer direct ancestors. Record any shell rather than invent a persistent shell or exact removed-process count.

The result must include the outer terminal disposition and known-process cleanup inspection. An externally killed/invalid/partial pair remains failed; the inner receipt alone cannot override the outer guard. No repeat, browser, native/application attempt, budget change or automatic new allowance is authorized by this review. A qualifying measured result only supports the separately documented changed-launcher source/plan review described above.
