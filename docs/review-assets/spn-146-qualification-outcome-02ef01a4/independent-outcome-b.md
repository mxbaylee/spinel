# 🔎 SPN-146 revised qualification experiment — independent outcome B

Source **02ef01a40fe8369b79477909673c76de6d2a4edf**, base **2f442317dd2e1c188ae4a810ac094fd1162a4a2a**. Component run **42013542610**, job **127198260525**, attempt **1**, artifact **13408561149**. Original ZIP: 2,533,296 bytes, parent-verified SHA256 `449023b40ada3a145e1f8f399fc389b840e194d9ee4ee5574517a7302e820d8d`.

**Disposition: complete, valid, inconclusive experiment; declared positive criterion failed. SPN-146 acceptance remains blocked. This finite allowance is closed. No unchanged rerun, automatic third experiment, threshold revision or merge approval follows.**

## 🧾 What was inspected

Read the current analysis, preparation, progress, transport/conversion and watchdog receipts plus exact-head job log and terminal job metadata under `/tmp/spn146-qualification-hosted`. Independently matched analysis bindings for progress and observation-watchdog bytes. Projected all sixteen comparisons and all 96 reported phase intervals from the existing analysis. Did not load the 60 MB observation, rerun analysis/conversion, execute a browser, reparse trace events or repeat the parent's complete ZIP verification. Cleanup and semantic completion statements below are supported by the existing validated receipts and analyzer, not a new full-observation replay.

Checkout log and preparation source both identify 02ef01a. Preparation binds the new native ES `110890e889ac362b22a4c38bafd1ebb4e7cf82e8107d4524bdb86ff7fe6bd7c3` and CJS `58edceea5e1fb66ff1a83ec0a92707cf6f8d741aab87eb922d9c7e021f99207d`, original-main comparators, previous candidate hashes, frozen body and four retained inputs. Its `hostedSource` field is the older retained-input provenance, not the executed checkout identity.

## 📉 Actual result

`analysis.json` is `complete:true`, `passed:false`, with `analysis.valid:true` and `disposition:"inconclusive"`. The terminal error is **Component result does not satisfy preregistered positive criterion**. Eight comparisons satisfy both fixed thresholds; five improve but fall below 20%; three are slower. Nothing was omitted or retried.

All ES candidate observations improve, but ES544 reverse order, both ES672 orders and ES1440 reverse order miss the required percentage. CJS672 reverse order improves only 7.05%. The three slower comparisons are:

- CJS672, prior then candidate: **25.1 → 28.5 ms** (3.4 ms slower).
- CJS1440, prior then candidate: **21.9 → 27.7 ms** (5.8 ms slower).
- CJS1440, candidate then prior: **21.7 → 27.4 ms** (5.7 ms slower).

The underlying phase records matter. At CJS672 prior-first, history is 11.5 → 12.9 ms and collaboration 13.4 → 15.5 ms. At CJS1440 prior-first, history is 8.5 → 14.9 ms while collaboration is 12.8 → 12.3 ms. In the reverse order, history is 12.8 → 12.2 ms while collaboration is 8.6 → 13.8 ms. Thus the excess at CJS1440 shifts between the two phase boundaries. These are concrete observations, not proof of a particular helper, JIT or scheduling cause.

The three slower whole intervals and their six subintervals report no overlapping known GC spans or duration-unknown GC context points. This cannot establish absence of GC or other runtime pauses. It does prevent honestly attributing these particular differences to a *reported* GC overlap. Conversely, several large positive differences have reported GC-associated context. Neither those records nor nested durations justify pause subtraction, dropping comparisons or calling the remaining time pure algorithm cost.

## ✅ Capability and ownership succeeded

The observation parent completed in **15,327.56 ms**, peak **1,865,668 KiB**, with no resource failure. Its final live inventory contains only the parent; the known worker/browser identities are absent. Progress reached all 32 observations, post-observation GC control, trace collection and fixture cleanup, then terminal `passed` at **14,401.04 ms**, with no primary/persistence failure or dropped events. Analysis completed in 686.63 ms; its parent returned failed at 871.73 ms because of the criterion, with `failure:null` for resource enforcement.

Transport records a complete proto stream, no data loss, no completion failure and 1,155,854 raw bytes. Raw identity `7b22a41767b9ee09109edcad36bf47dc3ecfd5ecdd41ac4bb60011ce3d7f031c` matches converter input and framing: 11,384 packets, no empty packets. Pinned Perfetto v59.1 Linux conversion and statistics children both closed successfully; statistics has no nonzero error/data_loss rows, and the temporary input was removed. The derived decoded identity is `374ec9df05bd4964e972169537fd952114dc6806d0227d3e81c90f09e3dd49c0`. This is no longer the earlier unsupported-representation failure.

Analysis validates 96 intervals with 0.181 ms clock spread, 1,474 GC-associated duration spans and 901 duration-unknown context records. The CPU profile records 10,456 samples, **83 negative deltas** and an **866.2 ms start bracket**; its own receipt excludes exact sample-to-phase causal attribution. These limitations remain material.

## 🧭 Remaining obligation and justified next action

The lower-layer proof of fewer allocations and duplicate qualifications remains valid. It does not prove a robust guard-inclusive native cost benefit under the registered runtime question. This complete run does not support the promised all-comparison reduction, nor a claim that the historical >100 ms application maxima have been causally repaired. Green ordinary CI would establish its separate first-attempt application contract, not erase this outcome. Let already-running CI finish and preserve its results independently.

The next useful step is a **retained-evidence/source checkpoint**, not another execution: retain this complete failed experiment and the preceding one, close the allowance in the maintained record, and decide whether an actual source-level cost hypothesis can be established. Inspect the exact generated candidate versus baseline around qualification, composition and publication using the already available phase pattern. If using CPU samples, first establish which dynamic script corresponds to which exact native bytes; without that binding, named aggregate samples are only clues, and the negative-delta/start-bracket problem still prevents exact phase attribution. Do not assume the full descriptor guard is disposable: it enforces the supported-input boundary and currently runs once per admitted join.

A subsequent production proposal needs a specific avoidable operation with an equivalent, narrower implementation and meaningful semantic/work negative controls. No such new operation is demonstrated by this result alone. If retained evidence cannot identify one or otherwise support a truthful measurement disposition, record the concrete blocker as **guard-inclusive runtime benefit unresolved after two finite mixed experiments**, keeping the original ticket open. A fresh candidate or different investigation would require its own discriminating hypothesis, capability/bounds and independent review; this report authorizes none. Comparing separate runs cannot isolate qualification reuse, and a convenient revised threshold cannot turn this run into acceptance.
