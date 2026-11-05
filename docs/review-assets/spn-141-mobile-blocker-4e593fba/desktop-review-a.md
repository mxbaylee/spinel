# 📡 SPN-141 current desktop callback acceptance — reviewer A

**Accepted for the current-source desktop callback first pair.** No blocker found for this owner. This is independent nonimplementing evidence review, not overall merge approval or reuse of SPN-144's prior passing pair.

## 🔎 Execution and integrity

Source `4e593fbaf9ea89585920053b9415f9a8eac0944f`, base `2f442317dd2e1c188ae4a810ac094fd1162a4a2a`, tested merge `f0e74d52629923737985ce03e4f32ff218dcf76d`; both trees independently equal `a2b37aa82336224ac40e92f7364e52ccebfb6d74`. CI41970163093 attempt1, job127056548236, terminal success with all19 steps successful, 2026-11-05T04:52:53Z–05:00:28Z. Immutable baseline `0e1df4725d9eccb77574d25e3eecdf678fe6ff44` uses the declared current observation harness. Both observations use Chromium156.0.8078.4, Nodev26.12.1 and Playwright1.64.1.

Artifact13390015877 is196894731bytes, SHA256 `e8558dceee084a117eec1a35d54912b4b228610c2cf8b46f1b7be6d8e040cc7c`; the API digest/source/run match. Independently streamed all93 original ZIP members, verifying every length/CRC32/SHA256. All81 non-SQLite members were extracted exclusively and reread. Twelve disposable synthetic SQLite members were omitted from extraction only, with exact names/lengths/CRCs/hashes preserved and the original ZIP unchanged. No trace, source, map, receipt, diagnostic or report was omitted. No screenshot/video is present in this passing callback artifact.

All15 current harness hashes per observation and all33 baseline/35 candidate source/map artifact hashes match. The current comparison function independently reproduces the retained pair comparison exactly and accepts without failures. Complete details are in `callback-desktop-members-a.json` and `desktop-review-a.json`.

## 📦 Complete traces and converter provenance

Both original gzip streams passed EOF/CRC, decoded identity and strict outer Trace/TracePacket framing verification. Derived gzip stored and decoded identities were separately verified. No original payload was rewritten.

- baselineObservation: original protobuf 530133051 decoded bytes, SHA256 `56b454a8647775122237fa6ab4733f8243ef99c45d8dee6f9585fd8bdb8cf964`; stored 37207738 bytes, SHA256 `66a7ac7a4f7a52f1915a142db7514251d0cb8f7a0d7c1a7710f7e5fdd44886c9`. 1923412 packets, 0 empty. Derived JSON 665146115 decoded bytes, SHA256 `e08692cd89f49a742932c05f3f4a5ea624d051c3309d8cc72eb712ce0a96f66e`; stored 51775798 bytes, SHA256 `216f1f8f6acd7c0c498e20526d0d9f084df2e9111c4007c351c54394b9010d9c`.
- candidate: original protobuf 549737160 decoded bytes, SHA256 `c5569fb60b8f3e40fe5882b20a5cc1842dde36ccaf9ee161d762038ebb875ec7`; stored 37337906 bytes, SHA256 `07f272147f3af098cf947a6c2a756a62978094cb709ce0359867df0459d401f4`. 1749081 packets, 0 empty. Derived JSON 671984459 decoded bytes, SHA256 `6fed5c8f3bbafcbbd07bb8806bcaa1085207f5cfc9bc21c84009de2d0c1a4479`; stored 50190478 bytes, SHA256 `83b53a4b28cbcac78a202934d9df4e5137c8d1627ed135645d36b6abf9720a83`.

Hosted strict-reader summaries retain all1048630/958712 source events, including221340/197508 callback events. No event was dropped by that reader. I did not repeat whole-event analysis or decode inner protobuf fields locally: envelope integrity is not an arbitrary inner-schema fidelity proof. Complete source/maps, hosted attribution and strict reader/lifetime analysis provide the semantic evidence. Ten baseline/nine candidate unrelated unmapped FunctionCall positions remain disclosed; the target timer ownership is complete.

Each observation binds the exact official Linux x64 Perfetto v59.1 authority (15885448bytes; SHA256 `2434129a3af4dc9e2034a476f7b76447b490975213e301769310d3bd0d5d6458`) in both paired instrumentation and receipt. Input transport, independent framing and derived output agree. Exactly one conversion and one statistics query use the same owned materialized input. Both commands return0/no signal with closed children, no output-close failure or truncated diagnostics; query stdout has exactly the clean statistics header, with no error/data-loss rows. Temporary directories are recorded removed. Conversion stderr is empty; statistics stderr contains load timing and informational CLI suggestions, not executed additional commands. No arm64 warning appears on these Linux owners.

## ⏱️ Actual first attempts and full behavior

Both Playwright results have retry0, one result each, passed/no errors and the unchanged420000ms timeout. Baseline177.405s and candidate156.412s leave242.595s and263.588s headroom. This is measured contract satisfaction, not a claim of improvement, future timing guarantees or historical root cause.

Observed phases, baseline/candidate:

- Full behavior completes94.531s /73.359s.
- Trace-end response4.874ms /4.184ms; completion wait11.551s /12.221s.
- Original read/store7.736s /7.912s; validation/materialization3.179s /3.081s.
- Conversion40.882s /40.412s; statistics7.666s /7.795s.
- Strict JSON parse10.118s /10.025s; source attribution0.734s /0.746s.
- Owned cleanup completes177.133s /156.205s. Terminal progress is passed, with no first/persistence failure or dropped progress events. Session detach and fixture close are positively witnessed.

Independently reconstructed the exact16-paragraph fixture and checked full native text (2088bytes; SHA256 `6c714aa1049090072c1b3c4acb27bf6e12c9e56426c8df01cf069a23c6529b44`), all2086 observed keydowns/input timestamps, selection2086/2086 and zero pending history/collaboration. Current executed source asserts saved server content equality, exact text after zoom, and ordinary-route disposal removes the document, selection and responsiveness state without changing document time origin. Caret samples are visible and alternate two stroke states. Desktop zoom changes to1.14, returns to1 and restores selection. Separate full-history, peer and access responsiveness owners remain required.

Candidate pending high-water is4/1/1 for cursor/zoom-init/zoom-update, with zero pending at trace end, zero post-disposal callbacks and zero post-disposal installations. Baseline remains an observation:7687/1/1878 high-water and nine cursor callbacks after disposal; candidate caps are not imposed on it. Both analyses have no evidence-completeness failures. Completion reports no data loss; maximum sampled buffer fill is0.4876624643802643/0.5067846775054932, below capacity.

## 🧪 Audit record and limits

Fresh extraction passed first execution under serial/watchdog in1916ms/234464KiB; streamed framing/hash/source/receipt/comparator audit passed first execution in3824ms/355008KiB; terminal/native reconciliation passed184ms/91552KiB. Pressure remained normal1. Helpers/logs/watchdogs are retained as `retain-desktop-a.*`, `audit-desktop-a.*` and `finalize-desktop-a.*`. No helper failure, browser/converter/application rerun, or benchmark rerun occurred.

Traced durations are descriptive and cannot replace unprofiled latency acceptance. Renderer heap samples have no forced GC and do not establish retained-object ownership; the local sampled watchdog peak is not hosted application memory. This audit establishes this current pair only. Mobile callback, independent responsiveness owners, all current CI gates and final publication/merge guards remain separate obligations.
