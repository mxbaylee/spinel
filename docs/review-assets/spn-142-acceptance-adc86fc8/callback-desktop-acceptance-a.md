# ✅ SPN-142 current desktop callback acceptance — reviewer A

**Accepted for this exact source's selected desktop callback gate. No actionable finding.** This is an unchanged regression gate, not a new callback-performance improvement or overall merge approval. Mobile and other selected gates remain independently required; the separately retained SPN-143 collection-reliability obligation is not erased.

Source `adc86fc835e93f1960b1b1133864fb43b0aa69e7`, base `7679351822caaa9535d73d656191f2a6597a3380`, tested `a0cb7906f06c986411cda24b790c3b2dadac6252`; source/tested tree `fabcde8b11ee851d31ebe3e6a3a3b80f699b7dc3` independently matched in the desktop audit. CI `41928232046`, attempt 1; job `126919181340`; artifact `13371706976`.

## 🔍 Identity, attempts and retention

Independently inspected all seven selected JSON records: two evidence records, two durable progress records, two Playwright reports and paired comparison; also inspected the full job log and relevant executed assertion/analysis source. Original ZIP SHA-256 matches `5c66412be921e16bcd23f94c8ea253c9afcf72efc8be4a517571e1501a832a1c`, including the upload-log digest. Streamed every declared source/map/runtime artifact and compressed trace from the ZIP: **36 candidate and 34 baseline members** have exact declared lengths and SHA-256. Inner gzip traces were never decompressed/reparsed; no test/browser workload was executed. Packaging slot was released after streaming inspection.

Each report has exactly one expected passing test, one result with retry 0, no skipped/flaky/unexpected test or error. Evidence attempts are zero. Candidate source is the exact tested merge and its checkout is clean. Historical baseline is `0e1df4725d9eccb77574d25e3eecdf678fe6ff44` with the explicitly copied current harness/lock compatibility overlay. All 12 harness hashes on each side match current source files. Both execute on runner `1000041544`, Chromium `156.0.8078.4`, Node `26.12.1`, Playwright `1.64.1`, desktop 1440×1000, throttle 1, one mounted editor. Paired comparison accepts with no failures.

## 🧪 Native behavior and lifetime bounds

Both sides complete the full protocol: 16 paragraphs, 2,071 typed characters plus 15 Enters, 2,086 keydowns; exact 2,088-character stream hash `6c714aa1049090072c1b3c4acb27bf6e12c9e56426c8df01cf069a23c6529b44`. Native selection is 2,086/2,086, pending queues 0/0, high-water 32/32, and history 66/0. Both retain `behaviorPassed: true`, no application errors, and complete drain/content phases.

Both have 133 visible caret observations including transparent and primary-color strokes. Ordinary zoom changes 1→1.14→1, retaining input focus, current unit and selection. Route-disposal assertions and phase markers complete before the post-disposal observation. The executed spec requires editor/evidence/selection removal without changing page time origin; its final assertion cannot bypass trace/cleanup failures.

Candidate pending high-water is cursor **4**, zoom-init **1**, zoom-update **1**, exactly within caps 4/1/1. All three have zero pending at disposal/end/trace-end, zero post-disposal callbacks and zero post-disposal installations. Analysis is complete, bounded and accepted, with empty evidence failures, candidate violations and orphans. Post-disposal marker interval is **1,203.037 ms**, exceeding one full 1,000 ms cursor period.

The historical baseline is correctly retained as complete but unbounded: cursor high-water 8,000, eight pending at disposal and eight post-disposal firings; zoom-update high-water 1,953. Those visible violations are expected baseline observations, not production acceptance or failed candidate evidence.

## 📦 Trace completeness and owned cleanup

Candidate compressed trace: **33,382,887 bytes**, SHA `2653981a0d4cf8dc252fc7002400b7b6703f3b26d131f3ac90e715b25efdbb11`; baseline: **35,124,960 bytes**, SHA `14cdecc313ee1227ba47a489ace8f7723813db2cfcb0db0a51eb43aeb810b5a4`. Both completion records explicitly report JSON/gzip and `dataLossOccurred: false`. Retained source/retained event counts agree: candidate 907,804/907,804 and baseline 1,015,103/1,015,103. Maximum reported trace-buffer fractions are approximately 0.5043/0.4863. The declared categories, 1 GiB record-until-full buffer and stream configuration are unchanged.

Both journals proceed through behavior, trace end/completion, stream open/read/close, parse, attribution, analysis, CDP detach and owned fixture cleanup. Expected page/context closure and fixture-cleanup-complete precede terminal passed. First failure and persistence failure are null, dropped progress events zero. Cleanup takes approximately 48.3 ms candidate and 47.8 ms baseline. Test durations are about 156.0/171.9 seconds, within the unchanged overall budget.

The trace-completion waits are approximately **84.819 seconds candidate / 78.617 seconds baseline**. These successful current observations do not diagnose why the separately preserved earlier baseline timed out awaiting completion, nor do they establish guaranteed future collection reliability. SPN-143 retains that separate obligation.

Each attribution record retains ten unmapped empty-URL FunctionCall positions; this is not universal source coverage. No unresolved required timer ownership/evidence failure or orphan remains. Exact retained source/maps support the analyzer's ownership classification. Traced typing durations and callback costs are descriptive; no latency budget is enforced by this callback workload. Heap snapshots without forced GC do not establish retained-object ownership. Unprofiled responsiveness acceptance remains separate.

## 🧾 Additional selected local-contract corroboration

Read the current hosted unit-remaining log: both ES/CJS actual-manager fixed-list reuse controls, both exact prior/current patch guards, and the installer package/both-build validation control executed and passed. This corroborates their hosted execution on the candidate; it is not a substitute for the rest of the selected matrix.
