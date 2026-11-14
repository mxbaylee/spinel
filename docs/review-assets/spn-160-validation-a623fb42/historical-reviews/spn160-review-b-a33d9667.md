# 🧯 SPN-160 independent review B

**Reviewed head:** `a33d96672c9cb3b24b6b41de154587406fc8d504`  
**Actual base:** `ecef3c6d6ea5093bdd9fcf7c0a69c5e5218b4a6f`  
**Worktree:** `/Users/mxbaylee/projects/spinel-spn-160`  
**Role:** Independent, nonimplementing reviewer; read-only source review. No candidate edits, mutations, installation, push or merge. Report written 2026-11-14 UTC.

## Assessment

**100/100. No actionable findings or point deductions.** Scope 35/35; correctness and data/access safety 25/25; regression protection 20/20; workflow and operations 10/10; maintainability and complexity 10/10. This assesses the complete registered SPN-160 candidate, not the older incomplete SPN-157 proposal. There are no code or documentation repairs to list to reach 100 on this head. CI results were not used for any deduction or represented as acceptance.

The candidate is suitable for the review-before-validation stage. This is **not merge approval or a native Linux acceptance pass**. Current-head selected native checks and all required gates remain merge conditions. Subsequent source/base integration requires exact-new-head revalidation.

## Scope and independent judgment

Reviewed the original SPN-160 and SPN-157 contracts, the complete 36-file diff against actual base, canonical implementation and landing records, applicable process/runbook/testing guidance and all four personas. The registered M outcome has independent value: it fixes a source-demonstrated swallowed pre-barrier error and preserves bounded first-failure context without waiting for either historical incident to recur. This is a legitimate complete diagnostic contract, not evidence that the separate L recovery outcome is implemented.

SPN-157 remains open L with both original causal investigations, demonstrated repairs if required, original-row/selected-candidate/authority guarantees, crash cuts, orphan cleanup and actual Linux acceptance. SPN-098 still depends on SPN-157. SPN-123 production telemetry and SPN-128 recovery commands are unchanged. The landing candidate removes only SPN-160 and its now-satisfied prerequisite edge from SPN-157, preserves next ID161 and the November12 grooming date, and appends160 after148/145/149. Earlier pending checkpoints are retained as history and superseded by the explicit integration checkpoint.

Operator gets attributable bounded private evidence with no new service. Owner and Collaborator retain data and recovery guarantees; diagnostics do not claim to fulfill recovery acceptance. Link guest gains neither authority nor diagnostic visibility. No product UI changes require screenshots or visual approval.

## Code and regression assessment

- `src/server/maintenance/ownership.ts`: sender and receiver snapshots copy only fixed counts/booleans and are frozen at first rejection. Late callbacks cannot revise the retained failure. Observation adds no awaited work, protocol callback or deadline. Authority, transfer/nonce validation, handle ownership, receiver cleanup and parent listener ownership remain intact. The internal Error retains the original cause/message; existing public maintenance errors remain generic.
- The receipt extractor supports the actual single `WitnessedRestoreTrialFailure` Error.cause wrapper in `supervisor.ts`, inspecting own data descriptors. It does not invoke arbitrary getters or traverse unbounded/cyclic causes. Missing receipt data remains missing rather than manufactured evidence.
- `supervisor-test-control.ts`: the barrier listener and unchanged ten-second deadline are installed before control runs. Synchronous/asynchronous rejection before the observed barrier preserves the original contextual cause immediately and clears timer/listener. Rejection after the observed barrier is tolerated for the intended SIGKILL. Timeout and late rejection settle without an unhandled promise. Stage/action/journal diagnostics are fixed and bounded; an unreadable journal cannot replace the first control error.
- `supervisor.test.ts` and `ownership-fixture.ts`: durable controls retain setup/transition/reconcile context before cleanup. Readiness context retains bounded phase/job/controller information, including unavailable job state and polling errors. Interrupted receiver receipts add evidence to the existing no-SQLite-open/original-bytes/closed-late-handles assertions. Original recovery assertions, budgets, selected scenarios and native process containment remain present.
- The six ownership controls exercise real sender handles, both offer/request orders, wrong/duplicate acknowledgements, partial callback failure, missing-held deadline, immutable late callbacks, retained parent resources, and bounded receipt extraction. The four coordination controls cover both immediate failure forms, observed-barrier crash rejection, and deadline/late rejection with cleanup. Their assertions test the regression contract rather than only helper output shape.
- Inspected the retained actual swallowed-error counterfactual and restoration identities. Both early-failure cases fail their direct cause assertion after zero fake-clock advance, rather than merely timing out. No reviewer mutation was needed. The mutation is a detector proof, not reproduction of either historical Linux failure.

Existing CI recovery selection includes the portable maintenance controls; supervisor selection retains the real native fixture suite and Linux PID namespace wrapper. No workflow selection narrowing or new runner is introduced.

## Independent local verification

Under the manager-granted exclusive Mac slot, pinned Node26.13.0, shared serial runner and runtime watchdog (normal-pressure prerequisite, 2GiB process-tree budget, eight-minute ceiling), independently ran:

```text
node /tmp/spinel-dependabot-2026-11-11/watch.ts spn160-review-b-a33-controls node node_modules/.bin/vitest run src/server/maintenance/ownership.test.ts src/server/maintenance/supervisor-test-control.test.ts --cache=false --fsModuleCachePath=/tmp/spinel-dependabot-2026-11-11/spn160-review-b-a33-module-cache
```

Pinned Node bin was prepended to PATH. **10/10 tests passed**, exit0, **575ms**, peak **307,120KiB**, no guard abort or product assertion failure. Receipts: `/tmp/spinel-dependabot-2026-11-11/spn160-review-b-a33-controls.json` and `.log`.

Verified all six runtime/test files against the maintained SHA-256 identities and checked source `d2a0ae20c8e62fe526a42815d9e8ef8fa0cc9c2a`. Verified all **17 current evidence payloads** and **4 integration payloads** against manifest byte counts and SHA-256 hashes. Thus the retained typecheck, lint, format, dependency and negative-control evidence applies to unchanged runtime; it was not claimed as my own execution. Inspected current exact-head PR evidence and preserved earlier setup/compiler/resource outcomes. A resource abort is not a pass; unsampled short-run RSS is not zero memory consumption.

Independently verified the borrowed dependency boundary: **241 source/manifest/postinstall/workspace hashes** match both candidate and donor, **53 installed direct versions** match the audit, and all **7 workspace targets** resolve to the stated donor. The donor is clean tracked source at `2204b8c40ce6feb8ad03c65720c976510535ad00`; manifest/lock/patch/lib and dependency script diffs are empty. Private Vitest module cache and disabled result cache avoid shared install writes. `git diff --check` passed and the candidate remained clean at the exact reviewed head.

Explicit post-run process command and cwd audits found **no owned test/browser/app/server/compiler survivors** and killed no processes. Cleanup receipt `/tmp/spinel-dependabot-2026-11-11/spn160-review-b-a33-cleanup.json` binds exact head and observation `2026-11-14T06:01:16.569842+00:00`, with empty command/cwd/owned-process inventories. The exclusive local slot was released after this audit. No broader compiler, browser, Linux-on-Mac or repeated matrix workload was run.

## Remaining external acceptance, without grade deductions

The existing Linux Node/Tini/private-PID-namespace/kernel-lease/IPC/SQLite runs must establish current-head native diagnostic and recovery-scenario acceptance before merge. Preserve the first instrumented result and its diagnostics before cleanup; do not retry unchanged until green. A passing diagnostic run cannot identify or repair the historical failures by inference. The failed43544143900 evidence and successful comparator remain distinct; pre-crash setup failure is still possible and the observed handoff timeout is not causally attributed. SPN-157 must independently resolve its full L obligations.

These are recorded native/hosted merge conditions, not missing locally repairable SPN-160 implementation or deductions for CI status. No exception, waiver, completed historical repair, launch readiness or production recovery acceptance is asserted by this review.
