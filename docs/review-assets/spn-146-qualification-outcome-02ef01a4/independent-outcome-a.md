# 🔎 SPN-146 changed-candidate component outcome — reviewer A

**The declared changed-candidate experiment failed its positive criterion and is inconclusive. This is an acceptance blocker, not a trace-format or provisioning failure. The allowance is exhausted; no unchanged rerun, third experiment, threshold adjustment or merge follows from this result.**

Reviewed retained evidence for source **02ef01a40fe8369b79477909673c76de6d2a4edf**, base **2f442317dd2e1c188ae4a810ac094fd1162a4a2a**, component run **42013542610**, job **127198260525**, attempt 1. Artifact **13408561149** metadata records 2,533,296 bytes and SHA-256 **449023b40ada3a145e1f8f399fc389b840e194d9ee4ee5574517a7302e820d8d**. The parent performed download/member verification; A did not duplicate that workload.

A independently read the complete 2.4-MiB analysis result, small preparation/conversion/trace/progress/watchdog receipts, terminal job metadata and the observation header/tail. A did not parse the 60-MiB observation, reparse trace events, run a converter/browser, or execute another measurement. Analysis SHA-256 is **e7653d9f883229cdc778290da8a0ed039776e6471e3406b658269138315ca2a7**.

## ❌ Actual fixed-criterion result

`analysis.json` records `complete:true`, `passed:false`, valid analysis, disposition `inconclusive`, and the explicit failure **Component result does not satisfy preregistered positive criterion**. All 16 paired comparisons remain present: **8 meet both thresholds, 5 improve by less than 20%, and 3 are slower**. All five insufficient positives exceed the 1-ms threshold; none reaches the required 20% reduction.

Every pair, expressed as prior → candidate milliseconds in fixed order:

- ES 544: prior-first **91.1 → 37.9**, pass; candidate-first **38.7 → 32.5**, insufficient 16.02%.
- ES 672: prior-first **28.9 → 23.7**, insufficient 17.99%; candidate-first **27.4 → 22.3**, insufficient 18.61%.
- ES 1440: prior-first **57.5 → 19.1**, pass; candidate-first **22.2 → 18.6**, insufficient 16.22%.
- ES 1984: prior-first **33.5 → 15.0**, pass; candidate-first **22.6 → 11.4**, pass.
- CJS 544: prior-first **37.4 → 26.7**, pass; candidate-first **23.2 → 17.6**, pass.
- CJS 672: prior-first **25.1 → 28.5**, slower 13.55%; candidate-first **24.1 → 22.4**, insufficient 7.05%.
- CJS 1440: prior-first **21.9 → 27.7**, slower 26.48%; candidate-first **21.7 → 27.4**, slower 26.27%.
- CJS 1984: prior-first **25.4 → 15.1**, pass; candidate-first **24.4 → 15.2**, pass.

These displayed decimals are summaries; the retained full-precision values and original comparator own the decision. Neither an average, rounding, choosing ES only, nor reducing the required fraction can turn this run positive. Comparison with the previous run cannot isolate the incremental effect of qualification reuse.

## ✅ Collection, identity and cleanup succeeded

Preparation identifies the exact current source and the previously reviewed native builds: new ES **110890e8…**, CJS **58edceea…**; original-main prior ES **57ec2ee1…**, CJS **94111008…**; prior candidate remains separately named. Frozen body SHA **8950279e…** and input SHA **e7768818…** are unchanged. The observation header binds the preparation SHA **3389031a51c96b0aca4289c79963f5b0939e3a3c640bbd9447ac630934a07731**, reports Linux x64 and verified dependency closure, and records the executing browser/bundle identities.

The progress journal has no first failure, persistence failure or dropped events and ends in `passed` after fixture cleanup. Its hash and the observation-watchdog hash independently match their links in analysis. Observation tail explicitly records collection complete, fulfilled CDP/context/browser cleanup and no failure; its duration is **14,394.402 ms**. Parent observation watchdog passed in **15,327.560 ms**, observed peak **1,865,668 KiB**, with only its own process remaining. This is under the declared limit, without claiming unsampled peak memory or system-wide absence.

Strict trace transport reports no data loss, uncompressed protobuf, 1,155,854 raw bytes, raw SHA **7b22a41767b9ee09109edcad36bf47dc3ecfd5ecdd41ac4bb60011ce3d7f031c**, and completed collection in 64.128 ms. The pinned v59.1 Linux converter receipt agrees with that input/framing identity, records 11,384 packets/no empty packets, successful conversion and statistics commands, closed children, no output-close failures and removed temporary storage. Statistics contain no nonzero error/data-loss rows. Derived JSON identity remains distinct from original protobuf.

Analysis itself took **686.628 ms**. Its watchdog reports `failed`, with no resource failure, elapsed **871.726 ms**, peak **354,352 KiB**, and no remaining child. That is consistent with the deliberate nonzero criterion failure. Successful collection/cleanup is not a successful experiment.

## 📏 What the complete analysis does and does not explain

All 96 whole/history/collaboration intervals are retained. Clock mapping identifies renderer 3407/3407 and **0.181-ms** offset spread. The reader preserves 2,375 GC-associated events: 1,474 duration spans and 901 duration-unknown context events. The positive GC control includes 437 spans, which can nest and must not be summed as independent pauses.

For **all three slower pairs**, both prior and candidate whole/history/collaboration intervals have **zero recognized main-thread GC-duration overlaps and zero context points**. This defeats an explanation that those slowdowns are simply the duration-bearing GC events already identified by this analysis. It does not prove absence of runtime pauses, other-thread effects, JIT/compiler work, or a particular qualifier cost. The phase values are also not a consistent single-phase cause: the two CJS 1440 orders place different proportions of their slowdown in history versus collaboration.

Some insufficient ES pairs do overlap recognized GC; other insufficient pairs have no such overlap. No pause subtraction is permitted. The CPU profile records **10,456 samples, 83 negative deltas and an 866.2-ms start bracket**. It cannot silently supply an exact per-window CPU timeline or allocation attribution. No exact dynamic-source attribution was established by this read-only review.

## 🧭 Remaining obligation and defensible next action

The deterministic evidence still proves fewer duplicate qualifier operations with preserved semantics. This runtime result proves that this alone did **not** establish the required consistent net benefit over the original baseline. It does not prove the optimization has no useful effect, but useful cases are insufficient for the declared positive disposition. Current application CI should continue: preserve its first-attempt result separately; green application checks cannot waive this failed causal-evidence requirement or explain historical 129.1/114.4/116.5/122.3-ms maxima.

Immediate action is to preserve the complete failed artifact, close this allowance explicitly and keep SPN-146 unaccepted. No collection-capability repair is indicated by these receipts. Do not spend a third browser run merely to see whether the ratios improve.

A further production hypothesis requires a discriminating prerequisite. The specific remaining source question is whether the **complete whole-graph descriptor qualification**, which this repair intentionally leaves intact, performs avoidable work beyond the fields required for sound admission and equivalent native composition. A bounded static/retained-input assessment could inventory exactly what that walk visits versus what the admitted operation consumes, and identify a proof-preserving alternative, if one exists. It must retain the admission domain or explicitly prove equivalent output/fallback/ownership behavior for every newly admitted shape; removing the guard because it is expensive is not supported. Existing counts can motivate this question but cannot establish its runtime contribution.

Alternatively, any claim based on CPU profiles needs an exact source-identity/attribution method within the retained evidence before proposing a causal optimization; anonymous script labels and aggregate samples do not supply it. If neither a concrete source argument nor usable retained attribution identifies a distinct repair, the honest state is **blocked on an evidence-supported runtime repair or measurement disposition**, not ready to renew testing. Any substantive new question would require its own finite prospective plan, review and unchanged original product budgets. This report does not admit one.

The original runtime experiment remains separately failed/inconclusive; the changed-reader regression remains verification only; this second, capability-complete result remains inconclusive. No prior source grade is a substitute for these outcomes.
