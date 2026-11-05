# 🔎 SPN-144 desktop callback first-pair acceptance — review A

**Desktop callback owner accepted for source `7b06d7516c4c386f5a23044e74d0c09b95a5a929`.** Both full first-attempt observations completed inside 420 seconds with retained original/derived evidence and successful owned cleanup. This is owner-specific acceptance; mobile, other selected owners, all seven final gates and final workflow reconciliation are separate requirements. The subsequently retained desktop job record now confirms completed/success, including all19 setup, observation, comparison, upload and post-job steps.

Source base is `1045e729c391c47a9b6a895782a2fa69dc6fa044`; tested merge is `eb91917064bd9d7665683fade860cd82457fbca4`. I independently checked source and tested tree equality at `d451532408b37f1cb5da12511c6fca38520599e2`. CI run41959231289, attempt1, desktop job127021613522, artifact13385296400. The candidate observation names the tested merge; historical observation names immutable `0e1df4725d9eccb77574d25e3eecdf678fe6ff44`. The workspace remained clean at the reviewed source.

## 📦 Complete artifact and provenance

Original ZIP is **196,654,763 bytes**, SHA-256 `2c46913b24c75fe2fb3e3ba6a81c1d2ae9d79c7422e09d0070149748b786d714`, matching artifact metadata. Every one of **93 original members** was streamed and checked against ZIP CRC32 and uncompressed size, with a SHA-256 identity recorded. **81 non-SQLite members** were exclusively extracted and then independently re-read/hash-matched. **12 disposable SQLite members** were streamed/hash-verified and excluded from extraction, with their exact names, sizes, CRCs and hashes recorded. The original ZIP remains unchanged. No trace/source/evidence member was dropped.

`callback-desktop-members-a.json` records all member identities and exclusions. The original ZIP exceeds GitHub's normal individual-blob limit; durable publication should preserve the complete retained member set plus original archive identity and member proof, rather than pretending a small selected JSON package is the whole evidence.

For each observation I checked all 15 harness hashes against the exact reviewed source, every original proto/derived JSON/conversion receipt/source artifact against the retained member hashes, matching runtime/browser/runner/instrumentation, and required first-attempt identities. There are33 baseline and35 candidate source/map artifacts. Chromium156.0.8078.4, Nodev26.12.1 and Playwright1.64.1 match across the pair.

I streamed both entire original gzip traces through the reviewed framing validator, independently matching decoded identity and packet counts: baseline **529,912,814 bytes / 1,924,012 packets**; candidate **549,455,622 bytes / 1,740,716 packets**. Both have zero empty packets. I streamed both complete derived JSON gzips and matched decoded hashes/lengths: **664,571,791** and **670,561,307** bytes. Original stored sizes are37,128,927 and37,370,123 bytes; derived stored sizes51,791,499 and49,941,575 bytes. Exact stored/decoded SHA-256 values are in `desktop-review-a.json` and the original manifests.

## 🧾 Conversion, semantics and cleanup

Both receipts bind the same official v59.1 Linux-x64 authority (15,885,448-byte binary, SHA-256 `2434129a3af4dc9e2034a476f7b76447b490975213e301769310d3bd0d5d6458`) to their instrument declarations, original input identities, framing and derived output identities. Each records exactly one conversion and one CSV statistics command using its same exclusively owned working input. Both commands exit0 without signal, close their child, retain untruncated diagnostics, report null output-close failure, and preserve successful output. Working directories are positively recorded removed; no input/cleanup failure is present. No server/daemon optimization was used.

Statistics stdout is exactly the required header with no nonzero error/data-loss rows. Conversion stderr is empty. Query stderr contains load/query timing and a generic suggestion to reuse a server; it is retained as diagnostics, not an instruction or evidence of a running server. Unlike the local arm64 capability, this pair has no unsupported-arm64-syscall warning. This still is not universal converter fidelity proof.

The hosted strict reader records **1,048,270 / 951,785 source events**, with equal retained-event totals; callback-event totals221,253 /197,653. Its summaries match the complete decoded bytes I verified. All source/maps required by the manifests match retained hashes. Ten unmapped positions per observation are disclosed empty-URL FunctionCalls; no unknown measured timer owner causes an evidence-completeness failure. I inspected actual harness assertions and repeated the current pair comparator against the retained analyses, obtaining the exact hosted comparison object and accepted=true with no failures. I did **not** rerun full event attribution/analysis or conversion locally; those hosted computations are bound to the verified raw bytes and exact harness. Outer framing does not decode opaque inner packets.

The raw native behavior records and source assertions retain all16 paragraphs/2086 keydowns,2086 frame samples, exact authored text/hash, caret selection2086, drained history/collaboration, visible blinking caret, actual1.14 zoom and restoration to1, same restored selection/content, and ordinary route disposal. Both successful observations include the disposal assertions and the full post-disposal observation window. Journals contain all required collection/conversion/parsing/attribution/analysis/detach/cleanup phases; terminal passed, firstFailure=null, persistenceFailure=null, droppedEvents=0, with session and fixture cleanup true.

Historical baseline is correctly **unbounded**, with cursor pending high-water7,841 and zoom-update1,881, plus9 cursor callbacks after disposal. It is retained as the historical contrast, not falsely required to satisfy candidate caps. Candidate high-waters are **4/1/1**, all three families pending0 at trace end, and **0 callbacks / 0 installations after disposal**. Candidate accepted/bounded and both complete flags agree with the hosted comparison.

## ⏱️ Actual timing and limitations

Playwright reports exactly one retry0 passing test per role, timeout420,000 ms. Baseline duration is **178.002 s**, leaving **241.998 s**; candidate duration **158.410 s**, leaving **261.590 s**. These durations include the actual observation work; no timeout cleanup is being credited as a pass.

Baseline/candidate phase evidence respectively:

- Behavior complete: **95.069 / 74.084 s**.
- Waiting after Tracing.end response until stream availability: **11.278 / 12.640 s**.
- Stream read/local gzip/storage: **7.813 / 8.136 s**.
- Framing/materialization: **3.179 / 3.184 s**.
- Conversion child: **41.003 / 40.770 s**; independent statistics child: **7.703 / 7.801 s**.
- Strict JSON parsing: **10.233 / 10.180 s**; source attribution **0.789 / 0.760 s**.
- Fixture cleanup complete: **177.747 / 158.200 s**, before successful terminal completion.

The converter/query cost is substantial and is included, not extrapolated from the millisecond capability fixture. These are two first samples in one hosted desktop job, not an isolated performance experiment. They neither identify the earlier mobile timeout cause nor guarantee future headroom or mobile acceptance. Browser main-thread/heap observations are instrumented diagnostics; heap snapshots have no forced GC and cannot establish retained-object ownership. No hosted converter process-tree peak-RSS measurement is present, so local audit memory figures below must not be described as hosted resource measurements. Independent unprofiled latency/content/history/access owners remain separate.

## 🧪 Independent audit execution and privacy

Archive extraction/integrity verification passed first attempt under serial/watchdog in **2,693 ms /225,856 KiB**. Complete decoded streaming/framing, identities and comparator reconciliation passed first attempt in **5,675 ms /356,816 KiB**, normal pressure. Scripts/logs/watchdogs are `retain-desktop-a.*` and `audit-desktop-a.*`. Slot was released immediately after the bounded work. No browser, application workload, converter, benchmark or full event-analysis rerun occurred.

There are no PNG/video captures in this successful callback artifact; no screenshot claim is made. Retained source, fixture text and localhost evidence describe the synthetic workload. Disposable databases are excluded explicitly; complete trace/source artifacts remain available for the final durable/privacy review. This report accepts the desktop callback owner only and does not authorize merge.

## ✅ Terminal job reconciliation

Independently inspected `callback-desktop-job.json` and the retained log: job127021613522, CI41959231289 attempt1, head7b06d7516c4c386f5a23044e74d0c09b95a5a929 is completed/success, started2026-11-05T03:04:59Z and completed03:12:45Z. All19 steps completed successfully, including post-job cleanup. Exact job JSON/log hashes are in the accompanying review JSON. No audit or runtime work was repeated. Desktop callback owner acceptance is now terminally reconciled; remaining selected owners, all final gates and overall merge readiness remain pending.
