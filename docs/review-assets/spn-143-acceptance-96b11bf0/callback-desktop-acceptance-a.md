# 📡 SPN-143 desktop callback acceptance — reviewer A

**Disposition: current-source desktop paired callback acceptance is complete. No new blocker found for this owner.** This is not mobile acceptance, overall CI readiness or merge approval. No browser/test rerun or whole raw-trace event parse was performed by this review.

## 🔐 Exact identities and retained bytes

- Reviewed source `96b11bf0374540d28e5537d4a9cddb1280403e21`, base `eb32117f5d09c28cd411063256db6d645335ae8a`; tested merge `159aa2ab36bdb7313d6a2c7770b685512bf19216`. I independently verified source/tested tree equality at `9920742df8645f3d963ba5de1b5819efa9d1de7a`.
- CI **41937955289**, attempt **1**, desktop callback job **126951454527**, artifact **13375670977**. Job log confirms the exact merge checkout and immutable historical baseline `0e1df4725d9eccb77574d25e3eecdf678fe6ff44`, both browser outcomes successful, and paired comparator acceptance with no failures. The opened-event plan records the exact identities and conservatively selects full coverage because an immutable path range was unavailable; this does not skip any selected owner.
- Original ZIP: **123,988,279 bytes**, SHA256 `824b949ebaf5ad6a4fbbb06194670ec585133e1035a0076fddbd08be933784ec`, independently verified. Streamed **all 77 non-SQLite members**, checking unzip/CRC success, member byte lengths and SHA256. These comprise 68 attributed source/map artifacts, two raw gzip traces and seven JSON evidence/report files. Every source/map/trace matches its manifest. All seven extracted JSON files also match their ZIP member bytes/hashes.
- Both manifests' complete harness hashes match the committed reviewed files, including the shared fixture, progress/trace/source helpers, analyzer, observations, configuration and lockfile. Baseline dirty paths are the declared harness overlay; candidate is clean. Browser **156.0.8078.4**, Node **v26.12.1**, Playwright **1.64.1** agree across the pair.

Baseline raw transport is **665,463,063 bytes**, SHA256 `0495bb0cab91143bd47a2986c9f5cda7e697589214c6cb3f032527530c15739d`; retained gzip is **52,013,367 bytes**, SHA256 `88e5cc4e56c6602fc8ed928e39ff3afc43ef0c6c992af1f54177c395ea4fdcb0`. Candidate raw transport is **671,730,542 bytes**, SHA256 `96523455d30926706e6fb02997c393e83bc2f90a433a9f38ac1da9b324040ffb`; retained gzip is **50,153,480 bytes**, SHA256 `d6cabd0c5c7e34e497511f14583668d5c5dce7c4a196a844290ae584ebc243b4`.

I stream-decoded both gzip members and independently reproduced their complete raw counts/hashes without buffering or parsing entire traces. Both completion records confirm JSON, **uncompressed protocol transport**, and `dataLossOccurred: false`. Storage explicitly identifies **node:zlib gzip level 1**. This local container is not described as browser-produced gzip. Stored parser summaries agree with transport identities and retain all **1,050,677 / 956,647** source events respectively.

## ✅ Native behavior, callback contract and ownership

Each report contains exactly one retry-0 desktop test, expected/passed, no errors, skipped cases or flakiness. Baseline duration is **211.749 s**; candidate **195.147 s**, both below the unchanged **420 s** test deadline. Success did not consume the failure-only teardown allowance.

Both manifests retain all 16 paragraphs, 2,071 typed characters, 15 Enter keys and **2,086 native keydowns/frame observations**. Authored/native text matches the exact 2,088-character fixture and expected hash; caret is 2086/2086 in the empty segment, and pending history/collaboration are zero. Current source assertions and retained observations cover saved native content, live caret blinking (133/134 visible samples with both stroke states), ordinary zoom 1 → 1.14 → 1 with selection/content retained, and ordinary route disposal in the same document time origin. No category, one-GiB non-overwriting buffer, viewport/throttle or full workload contract was reduced.

Candidate pending high-water values are **cursor 4, zoom-init 1, zoom-update 1**. All three have **zero callbacks/installations after disposal and zero pending at trace end**. Candidate analysis is complete, accepted and bounded, with no evidence failures or candidate violations. The historical baseline remains an accepted observation of its old behavior, **not bounded**: cursor high-water 5,964 and zoom-update 1,447; nine cursor callbacks after disposal are retained. Ten unmapped source positions per side are disclosed, not erased; the unchanged source/ownership analyzer accepts them as outside the measured blocking timer-ownership contract.

I compared the retained comparison to a fresh invocation of the current pure comparator over the retained manifest analyses: the complete result matches exactly and remains accepted with no failures. This is separate from the hosted comparator's full raw parse/recomputation; I did not duplicate that expensive event analysis. Integrity, source wiring and raw-byte checks support using the hosted analysis here.

Both terminal journals are **passed**, have no first/persistence failure and **zero dropped events**, and retain stream close, parse, attribution, analysis, CDP detach and fixture-cleanup-complete phases. Both manifests positively witness session detachment and fixture closure. Cleanup completes at **211.455 s / 194.939 s** in their respective journals. These are owned-resource witnesses, not claims of system-wide process absence.

## ⏱️ Useful measurements and limits

Baseline/candidate behavior finishes at **94.764 / 74.059 s**. The interval after Tracing.end returns until stream-open is **95.288 / 99.803 s**. Receiving, compressing and storing the stream takes **9.849 / 9.874 s**; parser intervals are **10.145 / 9.920 s**, attribution **0.778 / 0.727 s**, and analysis **0.555 / 0.477 s**. These are observed phase intervals with surrounding scheduling/bookkeeping, not isolated Chromium subphase timings.

Completion still takes roughly 95–100 seconds with uncompressed transport. This pass establishes current desktop end-to-end feasibility under the original budget; it does **not** show gzip was the cause of the historical timeout, that completion got faster, or that future/mobile observations will pass. The old failed pair remains failed. Traced callback timings are descriptive and do not replace unprofiled responsiveness gates. Renderer heap snapshots lack forced GC and cannot prove retained-object ownership; no hosted process-tree RSS peak was measured here.

Independent streaming audit used the serial watchdog: **5.038 s**, sampled combined peak **349,184 KiB**, normal pressure. The final JSON/semantic check used **383 ms**, **308,496 KiB**, normal pressure. Those are reviewer verification costs, not native runtime resource measurements. The first reviewer script stopped before member streaming because its expected selection omitted the valid `segmentId: ''` field; its log/watchdog are preserved, the verifier was corrected, and no application rerun occurred.

## 📦 Publication and remaining acceptance

Keep the original ZIP identity and the complete member proof in `callback-desktop-audit-a.json`, plus the semantic receipt and watchdog/logs. The 123 MB original ZIP cannot be a single GitHub blob under its 100 MB limit; publish the verified individual non-SQLite members durably, preserving both full raw gzip traces and every attributed runtime/source/map file. Excluding disposable synthetic SQLite files must remain explicit. Current success requires no routine screenshot capture for this nonvisual change; full native behavior evidence and failure diagnostics remain authoritative.

The selected mobile pair, remaining current-head gates/owners, final immutable archive publication and fresh merge guards remain separate requirements. This desktop acceptance supplies no credit for those pending outcomes.
