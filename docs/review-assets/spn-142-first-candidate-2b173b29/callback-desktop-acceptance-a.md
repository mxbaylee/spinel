# ✅ SPN-142 desktop callback acceptance — independent reviewer A

Reviewed source `2b173b29b3c0894a45b8d48d92073c3645110673`, base `7679351822caaa9535d73d656191f2a6597a3380`, tested merge `3b11e1e7469b2d3fc59ac95195bf4da6333c16c4` (source-equivalent tree `eac584b6bb8e9a377e69ae58551df67df5b7bcde`). CI run `41916623281`, attempt 1, desktop callback job `126878184357`, artifact `13366167514`.

Disposition: this selected desktop callback gate is accepted on the current source. No actionable acceptance finding. This is an unchanged regression gate, not evidence of a new callback improvement from SPN-142. Mobile and remaining CI are separate requirements; this note is not overall merge approval.

## 🔍 Identity and integrity

Independently checked the paired comparison, both evidence/progress records, both Playwright JSON reports, full job log, and executed assertion/analysis source. The original ZIP SHA-256 is `42d3a6c524db65bad1ac165f4db7c964eaa3d90b2cd9bb06431c24bb38abe9db`, also recorded by the upload log. Seven selected JSON records are present: two evidence, two progress, two Playwright reports, and one paired comparison. The optional manifest glob has no matches; that extraction status does not indicate a missing required record.

Both reports contain exactly one passing test, retry 0, with no skipped/flaky/unexpected tests or errors. Evidence attempt is 0 on both sides, runner `1000041319`; paired comparison accepts with no failures. Baseline source `0e1df4725d9eccb77574d25e3eecdf678fe6ff44` explicitly uses the current harness overlay and current lockfile; candidate checkout is clean. All 12 harness hashes match current files. Both run Chromium `156.0.8078.4`, Playwright `1.64.1`, Node `26.12.1`, 1440×1000 desktop, throttle 1, one mounted editor.

Independently streamed and hashed every declared retained source/map/runtime member and each still-compressed trace from the ZIP: 36 candidate members and 34 baseline members match their declared byte counts and SHA-256. No large trace was decompressed or reparsed and no browser/test workload was run. Candidate gzip trace: 35,049,112 bytes, `ea1ae3b37e4ead40632b33a9c8814b5f9d56997d10844f5bcf379a14ffe41d8a`; baseline: 36,573,148 bytes, `24b3997fc838feec8ed3336f7cd1bf0835c65c50c2deb439ef8df11d5334d544`.

## 🧪 Behavior and callback bounds

Both sides execute the same 16-paragraph native-input protocol: 2,071 characters plus 15 Enters, 2,086 keydowns, exact 2,088-character native stream SHA `6c714aa1049090072c1b3c4acb27bf6e12c9e56426c8df01cf069a23c6529b44`, selection 2,086/2,086, pending history/collaboration 0/0, high water 32/32, and 66 history groups. Executed assertions require exact content, drain, selection, visible blinking caret, zoom restoration/focus, and disposal; retained values and `behaviorPassed` agree. Candidate zoom moves from 1 to 1.14 and restores to 1 with selection and focus preserved. Disposal removes the editor/evidence/selection while retaining the same page time origin.

Candidate callback pending high-water is cursor 4, zoom-init 1, zoom-update 1, exactly within caps 4/1/1. All three have zero pending at disposal, end marker, and trace end; zero callbacks and installations after disposal. Candidate cursor has 16,493 installations, 16,488 removals, eight firings, no duplicate removals. Analysis is complete, bounded and accepted, with no evidence failures, candidate violations or orphans. Post-disposal observation is 1,203.416 ms, exceeding the required one-second cursor period.

The historical baseline is correctly accepted as a complete observation, not as bounded production behavior: cursor high-water 7,603, nine pending at disposal and nine post-disposal callbacks; zoom-update high-water 1,804. These expected baseline violations remain visible. They are not compared as a pre-SPN-142 performance baseline.

## 📦 Completion and limits

Both trace completion records report JSON/gzip with `dataLossOccurred: false`. Retained analysis reports source/retained event equality: baseline 1,048,801 and candidate 950,019; maximum reported buffer fractions are approximately 0.4874/0.5053. Both progress records reach fixture-cleanup-complete and terminal passed, with no first failure, persistence failure or dropped progress events. Detach, fixture cleanup and expected page/context closure are retained. The source propagates collection, detach, cleanup or persistence failures rather than allowing the final acceptance assertion to hide them.

Each attribution record retains ten unmapped empty-URL FunctionCall positions. This is not universal source coverage; it does not produce unresolved target timer ownership or analysis orphans. The analyzer rejects unknown required timer ownership, and the retained source maps and target callsites remain available for audit.

Trace completion waits were approximately 91.176 seconds for baseline and 98.300 seconds for candidate. These are observations from successful current runs; they do not establish which operation caused any historical timeout. Traced typing times (84.926/62.855 seconds), callback wall time, heap snapshots and trace collection durations are descriptive. Tracing does not enforce the unprofiled responsiveness budgets, heap snapshots are not ownership/leak proof, and this review does not substitute for mobile or unprofiled timing acceptance.
