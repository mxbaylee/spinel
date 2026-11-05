# 📱 SPN-141 current mobile callback pair — independent reviewer B

Accepted this first mobile callback pair on source `4e593fbaf9ea89585920053b9415f9a8eac0944f`, base `2f442317dd2e1c188ae4a810ac094fd1162a4a2a`, tested merge `f0e74d52629923737985ce03e4f32ff218dcf76d`. Source and tested tree both equal `a2b37aa82336224ac40e92f7364e52ccebfb6d74`. CI `41970163093`, attempt 1, job `127056548269` completed successfully at 2026-11-05 05:04:20Z; all 19 steps succeeded. This accepts this owner only, not overall merge readiness.

## 🔎 First attempts and integrity

Artifact `13389454269`, original ZIP 174,312,312 bytes, SHA-256 `0760921faa5ae5eaa04b6faf0f8fa41806df4cc12f05617a48e3b7461662ef7c`, matches the metadata. All 93 members were streamed with CRC32, size and SHA-256 verification. All 81 non-SQLite members were exclusively extracted under `callback-mobile/` and re-read against their original bytes; the 12 omitted disposable SQLite identities remain in `callback-mobile-members-b.json` and their original bytes remain in the unchanged ZIP.

Historical baseline source is `0e1df4725d9eccb77574d25e3eecdf678fe6ff44`; candidate is the exact tested merge above. Both use the current 15 hash-bound harness files, Chromium 156.0.8078.4, Playwright 1.64.1 and Node v26.12.1. The job log records the exact two checkouts, current harness copy and prepared converter. Retained reports each contain exactly one test/result, retry 0, unchanged 420,000 ms timeout and no errors. Baseline duration is 327,681 ms (92,319 ms headroom); candidate is 237,555 ms (182,445 ms headroom).

The serialized audit succeeded on its first execution: ZIP extraction 1,807 ms / sampled peak 256,144 KiB; framing, decoded hashes, semantic assertions and paired comparison 3,312 ms / 349,648 KiB; terminal job binding 121 ms / 90,480 KiB. All ran at normal memory pressure. No browser, application, converter or native observation was rerun.

## ✅ Complete native behavior and bounded lifetimes

Both observations cover all 16 paragraphs, 2,071 typed characters and 15 native Enter keys, with all 2,086 observed keydowns, full 2,088-character native document text and SHA-256 `6c714aa1049090072c1b3c4acb27bf6e12c9e56426c8df01cf069a23c6529b44`. History and collaboration queues drain to zero; selection is collapsed at 2086. The focused visible 390×844 coarse-pointer/touch context is retained. Caret samples remain visible with both expected blink states. Ordinary Ctrl-wheel commands reach 1.14 then 1.0, preserve the actual mobile equal-scale behavior, restore selection, and retain exact saved text. This is the source's mobile assertion, not an invented desktop scale-change requirement.

The inspected current source asserts ordinary route disposal removes the editor and selection/instrumentation while retaining the same document time origin, then observes an explicit 1,200 ms post-disposal window. Candidate pending high-water marks are cursor 4, zoom-init 1 and zoom-update 1; all have zero callbacks/installations after disposal and zero pending work at trace end. The historical baseline remains the intended positive diagnostic control: cursor high-water 8,352 and eight callbacks after disposal; zoom-update high-water 2,085. Its `bounded=false` is preserved rather than incorrectly treated as the candidate contract.

## 🧾 Original transport, conversion and analysis provenance

Both original `proto` ReturnAsStream captures explicitly report no data loss and uncompressed Chromium transport, followed by Node zlib level-1 gzip storage. I streamed the complete gzip data through the current independent outer Trace/TracePacket framing guard and recomputed raw hashes; packet payloads were not decoded or rewritten.

- Baseline raw proto: 476,377,622 bytes, SHA-256 `bac6b30defab7fcb4b39253174fcecd1761bccbeb2318d547bd2683837f2ecf9`, 1,787,356 complete packets, zero empty packets. Stored proto: 33,636,282 bytes, SHA-256 `17f0505e3cd2df81ffbda9d337bd8cc2e4f3442b7c9187f687ea33897411fe88`.
- Candidate raw proto: 464,744,890 bytes, SHA-256 `3645b1239ee306f06cf0617f923610717f42d6e84b027fdf2108eab0d933cc2d`, 1,504,112 complete packets, zero empty packets. Stored proto: 31,445,515 bytes, SHA-256 `23696d2f51cc6c3bba1dab689042d47c964683755b82ef00a0659591d4bc0ca6`.
- Baseline decoded derived JSON: 595,341,962 bytes, SHA-256 `68dcdd9bb0624a089e7c6f38c9063b9abe0a76cadef84249dd89dfb199fa58d7`. Stored derived gzip: 46,751,611 bytes, SHA-256 `c41922daca086bc28ff66cf0fe07b7d0d7260ff7578b0d57268d74386b7a7c29`.
- Candidate decoded derived JSON: 566,421,553 bytes, SHA-256 `204ce04aa079188d782c546105649707b61964b809c0e21bf08cc6c63fe56adb`. Stored derived gzip: 42,368,781 bytes, SHA-256 `74e0fdb606f6652dce3b5de86f911d41d5d7e68b007078e1ab85b03bf7d86f06`.

Both receipts bind input/framing and derived output to the same pinned official Perfetto v59.1 Linux x64 authority: source `1e9c61e9844affd7dccd3d42d9ea9f3a3d10cf6d`, 15,885,448-byte executable SHA-256 `2434129a3af4dc9e2034a476f7b76447b490975213e301769310d3bd0d5d6458`. Authority also matches pair-compared instrumentation. Conversion and exact error/data-loss SQL query use the same uniquely owned temporary input, exit 0, no signal, witnessed child closure, no output-close failure and no truncated diagnostics. CSV is exactly the clean required result; temporary files are removed with no input-close/cleanup failure. Conversion stderr is empty; statistics stderr contains bounded parse timing and generic Perfetto usage hints, not a hidden error.

All 33 baseline and 35 candidate retained runtime/source-map/docs-ui-source artifacts match their manifest sizes/hashes. The retained complete reader summaries show 960,768/813,785 source events and the same retained counts, respectively. Both have ten explicitly recorded unmapped anonymous/empty-URL positions; no claim of universal source attribution is made. Required lifetime analysis reports no evidence failures; candidate violations are empty. Re-running the current paired comparator against retained manifests/analysis reproduces the complete stored comparison exactly, accepted with no failures. The hosted comparison itself performed full source/trace loading and analysis; this audit did not reparse the whole event trace or rerun Perfetto.

## ⏱️ Deadline and cleanup observations

Baseline behavior completes at 251,577.939 ms; candidate at 164,706.432 ms. Trace completion waits are 13,739.976 / 12,617.369 ms after 6.889 / 6.536 ms end responses. Stream/storage takes 7,038.413 / 6,767.935 ms; framing/materialization 2,602.255 / 2,703.642 ms; conversion 34,720.730 / 33,617.570 ms; statistics 6,695.303 / 6,769.475 ms. All remain inside the unchanged test budget.

Owned fixture cleanup completes at 327,379.489 / 237,407.988 ms. Both manifests confirm session detachment and fixture closure, and both journals terminate passed at 327,677.754 / 237,550.106 ms with no first failure, persistence failure or dropped events. Successful final writes and terminal Playwright results occur before 420 seconds. This proves the owned path completed here; it is not a system-wide process-absence claim.

## ⚖️ Scope and preserved limitations

The earlier 403bd8c1 baseline timeout remains a genuine recorded failure: behavior consumed about 357 seconds and collection awaited completion until the original deadline. The accepted SPN-144 implementation and this current first pair now exercise the complete protobuf/conversion/cleanup path successfully; this observation does not identify Chromium's historical cause, prove gzip caused a speedup, or retrospectively turn that failed run into acceptance.

Traced wall times are descriptive and do not replace current unprofiled responsiveness budgets. Heap snapshots lack forced GC and cannot establish retained-object ownership. This mobile emulation is native Chromium keyboard/wheel input, not physical phone/IME validation. Full packet payload semantic equivalence and whole-event lifetime analysis were not independently recomputed here; the pinned converter authority, retained source artifacts, complete byte/framing bindings and hosted fail-closed analysis supply that evidence. No useful failure screenshot exists for these successful observations; source maps, traces and receipts are retained without substituting old visuals.

No new blocker found for this current mobile callback owner. Current responsiveness, native owners, all seven gates, immutable publication and fresh merge guards remain separately accountable.
