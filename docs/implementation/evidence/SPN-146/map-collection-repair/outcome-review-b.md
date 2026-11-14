# 🔎 SPN-146 fixed-window attempt — outcome review B

**Terminal outcome: failed capability, before workload input. No latency/causal result; allowance closed.**

Reviewed source `ab8966044fdc9c7645d5768956d84852ff308df3`, tree `62cd405485511a8ee13f0cbc4945731acaa11fd7`, prior native reference `2f442317dd2e1c188ae4a810ac094fd1162a4a2a`, event-before `02ef01a40fe8369b79477909673c76de6d2a4edf`. Native diagnostic run **42039152201**, attempt **1**, job **127285045113**, artifact **13420466792**.

Read-only review; no browser, converter, native workload or application rerun. One bounded serial/watchdog artifact verification passed in 196 ms, peak 93,216 KiB, normal pressure. Original ZIP is 516,974 bytes, SHA-256 `53c103fee6f5a6ab5363e66d7f79e70bddd98514eda3ee18a6c55a3b69ef33c3`. All 16 members passed ZIP CRC and have individual byte lengths/SHA-256 in `outcome-integrity-b.json`. Helper, log and watchdog are retained alongside this report; JSON and selected images are extracted under `inspection-b/`.

## 🛑 First failure and capability boundary

The exact failure is `ENOENT` opening `dist/assets/module-preload-BLdHbfdN.js.map` inside `observeNativeWindowSources().retain()`. The source collector reads `path + '.map'` unconditionally for each same-origin emitted JavaScript asset. The build log lists that 1.51 kB JavaScript asset without a map size, while neighboring mapped assets explicitly include map sizes. The CDP inventory contains the asset as script ID 7. This supports a concrete collector assumption mismatch: successful hidden-map builds do not establish that every emitted JavaScript asset has a map.

Clean dependency installation, Chromium setup, prior-native preparation and application build all succeeded. This was not a capacity, timeout, GC, trace-buffer or resource failure. The application watchdog failed because the test failed: elapsed 10,673 ms, observed peak 1,860,824 KiB, `failure: null` for its resource checks. It remained below the declared 2 GiB ceiling. The conversion step was skipped; no converter, trace-completion or attribution result exists.

The prior source-map inventory covered maps actually present in a different emitted build. It never proved that all executed chunks would have maps. This failed first attempt establishes that omitted capability boundary without invalidating the earlier inventory's narrower findings.

## ⌨️ No workload observation and exact cleanup disposition

In the reviewed source, `loadedSources.retain()` precedes native capture start, input arming, input observation and the first workload typing. Metrics retain the original ENOENT as `primaryFailure`; native observer and cache evidence both say **“Native diagnostic never started.”** Final native queues and high-water counts are zero, flushes are empty, history is 0/0, and no drain witness exists. The failure image shows the empty editor. These independent source/record/image observations support **no diagnostic workload input**, rather than claiming no setup clicks or focus operations occurred.

There are no 384/448 boundary witnesses, native phase captures, complete loaded-source binding, CPU profile or original trace. The fixed-window question was not reached. Full content/peer/Undo/Redo assertions after the workload did not execute. Declared fixture size and profiler configuration in metrics are configuration, not completed behavior or a started profiler.

CDP is recorded `detached`, fixture `closed`, both page/context close sequences are recorded as expected, and the progress journal reaches fixture-cleanup-complete before terminal `failed`. The final watchdog live inventory contains only its own process, not application descendants. This supports successful owned resource release, not a universal system-process absence claim.

Do not relabel `nativeDiagnosticCleanup.complete` as true: it is **false** and `completed` is false because the diagnostic failed. Distinguish successful resource release from accepted diagnostic completeness. The journal's `firstFailure.phase` is `fixture-cleanup-complete` because the outer owner records the operation rejection after the inner finally; that label does not locate the initiating fault. The retained primary failure and stack/log chronology locate it at source collection. No cleanup failure is shown, and the primary ENOENT survived cleanup.

## 🔗 Source and artifact evidence limits

Preparation matches source/tree and the fixed event predecessor. It records the expected prior-native Docs hashes (ES `57ec2ee1…`, CJS `94111008…`) and Core hashes, distinct from the installed candidate hashes. This proves preparation and current source identity, not a complete live native-source binding.

The artifact contains the initial inventory and three already-retained emitted JavaScript/map pairs. It has no final binding receipt. In particular, the failing asset's bytes were read before the map read but were not retained or CDP-compared before that failure. Its name/inventory entry cannot be treated as a verified executed-source digest. The original archive remains useful failure evidence; it does not satisfy the source-closure contract.

The inspected failure screenshot contains the empty synthetic typing fixture and collaborator label; it supports the no-workload state. It is not product visual acceptance or a physical-phone result.

## 🛠️ Smallest sound repair direction — implementation only

The proposed change is sound if it distinguishes **exact emitted/executed JavaScript identity** from **source-map availability**, while leaving required native identities strict:

1. For every in-scope same-origin emitted JavaScript script, retain its bytes and verify them against `Debugger.getScriptSource` regardless of map presence. Preserve the current bounded inventory, paths, byte ceiling and exact script IDs. Eval/non-build entries remain explicitly inventoried/unbound; do not promise they are mapped emitted assets.
2. Treat only an actual missing adjacent map (`ENOENT` for that map) as an explicit unmapped status. Permission/read errors, malformed maps, wrong embedded hashes or failed source reads stay fatal. Do not convert all map errors into “optional.” An unmapped row must contain no invented mapping, native binding or false map digest.
3. A map present at collection remains required during final retention validation: missing, truncated or substituted declared maps still fail. The terminal validator must distinguish collected-unmapped rows from originally mapped rows whose evidence later disappeared. It must still verify every retained JavaScript file's size/hash and observed receipt identity.
4. Require the complete unique mapped prior Docs/Core target closure with exact embedded hashes. If either target is only present in an unmapped asset, closure remains incomplete and the diagnostic fails. Unmapped asset frames cannot support original-source attribution; report that limit explicitly rather than infer source names from filenames.
5. Exercise real temporary-file/collector controls for a successfully retained unmapped non-target plus mapped target closure; missing target map; wrong executed bytes; malformed or unreadable existing map; mapped-file deletion after collection; and forged/conflicting receipt status. Preserve setup/abort cleanup and the original failed attempt.

This is smaller and more faithful than generating artificial maps, globally relaxing binding requirements, changing the build solely to satisfy the collector, or replacing the capture system. It repairs a demonstrated capability assumption; it does not change workload, window, limits or causal criteria. A useful improvement within that repair is persisting already-verified code before an optional map operation so a later map failure leaves more faithful partial evidence.

## 🚦 Remaining disposition

The one ab896604 observation is exhausted and remains failed. This report admits bounded implementation of the collector/validator repair only. It does **not** admit another runtime execution, automatic trigger re-anchoring, threshold change, moved window or unchanged retry. Any proposed changed-source observation requires its own explicit finite plan and both exact-head reviews before publication; the original failure must remain immutable and visible.

There are zero useful latency samples from this attempt, so no new synchronous-cost, GC, observer-overhead or historical-cause conclusion follows. Both prior component failures, all existing native/application failures and the complete SPN-146 production acceptance obligations remain unchanged. Work should stay within the SPN-120 prerequisite chain under the user's latest stopping instruction.
