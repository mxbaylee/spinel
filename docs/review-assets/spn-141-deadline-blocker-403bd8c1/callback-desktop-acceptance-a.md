# ✅ SPN-141 desktop callback acceptance — reviewer A

Accepted for the current desktop callback owner. No blocker found. This is acceptance of the selected unchanged callback contract after integration; it is not a claim that SPN-141 improves callback performance, nor overall merge approval.

## 🔎 Source, pair and complete bytes

Source `403bd8c1dfdf0b266ca93c0354abef0ef37cea64`, base `5c565b61e11ce29780581f33410749436ecef42f`, tested `28897ac1e143492bae980abf29f73c0e3daa8717`, matching source/tested tree `4893ed46f3c483d1da1d9e753b106af22d6cb65a`. CI `41945378505`, attempt 1, job `126977563694`. Artifact `13379342274`, original ZIP 124,419,209 bytes, SHA256 `95d6ff52c1a8511c058fec287cd518a84b0bc1048331d28debf5a2f4aaa63fcd`, matches API digest and current run/source metadata.

Independently streamed the original ZIP and all 77 retained non-SQLite members. Every byte count/hash matches both the extracted file and package proof. The original member inventory has 89 files: exactly 12 disposable SQLite/database sidecars are omitted from the extracted package; all seven JSON records, 68 built source/map artifacts and both compressed traces remain. Original ZIP identity is retained; archive publication must preserve all 77 members because this ZIP exceeds GitHub's ordinary blob limit.

The baseline is immutable `0e1df4725d9eccb77574d25e3eecdf678fe6ff44` with the explicitly copied current harness/observation files and lockfile; its dirty-path list matches that workflow. Candidate is the tested merge commit and clean. Both manifests' twelve harness hashes match the current source's actual Git blobs. Browser/runtime/Playwright, fixture, capture settings and preset agree. Each runs one 420,000-ms test with exactly one successful retry-0 result, no skips/flakes/errors: baseline **211.949 s**, candidate **194.190 s**.

## 📦 Trace provenance and analysis

Both completion records state JSON, uncompressed CDP transport and no data loss; local storage is Node zlib gzip level 1. I streamed gzip decode to independently verify complete transport bytes and SHA256, without buffering or reparsing the whole event trace:

- Baseline: stored 52,288,482 bytes, SHA256 `09a028e1e16833b3739f1ca1b414fb16f533116aab4b4ee681f34c6f7f699411`; decoded **666,964,294** bytes, SHA256 `3ab1b3cd58af8fa27cec94784c8eb6d15128c23a0e150e76cd935ac2eed1adc9`.
- Candidate: stored 50,391,998 bytes, SHA256 `248e9efe86ef1bf2e7031dcdaac48f9fa8077a2a094fa5212cacbbdcd14dbe12`; decoded **673,434,064** bytes, SHA256 `bcbd0a01d7976b081c38cc7e2e1bc89f1f8139fd945fca6718001f6ce1bf594a`.

The hosted reader retained all 1,058,649 baseline and 966,244 candidate source events, including 221,454/197,626 callback events; decoded hashes agree with the reader summaries. I independently hashed all 33 baseline and 35 candidate attribution source/map artifacts and checked current source assertions. The retained-analysis comparator recomputation exactly matches the published paired comparison, accepted with no failures. Both analyses are complete and have no evidence failures; candidate is bounded with no candidate violations. Ten unrelated unmapped source positions per role remain explicitly disclosed; completeness would reject unknown measured timer ownership. This audit verifies source/byte identity and retained analysis, not a second full raw-event analysis.

Candidate pending high-water is **cursor 4 / zoom-init 1 / zoom-update 1**. All three families have zero pending at disposal/end and zero callbacks or installations after disposal. Baseline remains descriptive: cursor high-water 7,711 and nine post-disposal callbacks, zoom-update high-water 1,843. Its unbounded result is expected baseline evidence, not a waived candidate failure.

## 🧪 Native behavior, terminal ownership and limits

The full native fixture remains 16 paragraphs, 2,071 typed characters plus 15 Enter keys, 2,086 observed keydowns, and exact 2,088-character native/saved-server text. Both retained manifests have exact text hash and final selection 2086:2086, with history/collaboration pending both zero. Current executed assertions verify server persistence. Both roles retain 133 live-caret observations, all visible with the two expected blink strokes. Ordinary Control-wheel zoom goes 1→1.14→1 and preserves text/selection. Ordinary route disposal removes the editor/evidence while preserving page time origin, followed by the unchanged 1,200-ms observation interval.

Progress is terminal passed for both, with no first/persistence failure or dropped progress events. The records include trace end, completion, stream open/read/close, parse, attribution, analysis, session detach and fixture cleanup completion. Both manifest cleanup flags are true and error lists empty; source awaits the owned CDP detach and fixture closure, fails on cleanup failures and only then persists terminal acceptance. Cleanup completes at **211.617 s baseline / 193.986 s candidate** in the progress clock, within each test's 420-second budget.

Recorded completion-event waits are **91.688 / 98.748 s**; read/compress/store takes **10.068 / 9.866 s**, parse **10.183 / 10.053 s**. These are current diagnostic phase intervals, not causal attribution of the older timeout or a speed claim. Tracing is enabled, latency budgets are deliberately not evaluated here, and the separate unprofiled responsiveness gates remain required. Renderer heap snapshots use no forced GC and do not establish retained-object ownership. This selected callback check is Playwright Chromium on its registered desktop preset, distinct from the three ordinary macOS native browser owners.

Independent audit receipts: `audit-callback-desktop-a.ts`, `callback-desktop-audit-a.json`, `audit-callback-desktop-semantic-a.ts`, `callback-desktop-semantic-a.json` and their logs/watchdogs. Both first executions passed: streaming 5,319 ms / sampled 348,992 KiB; retained semantics 377 ms / sampled 308,928 KiB, normal pressure. No browser rerun or whole-event reparse. These local samples describe the reviewer verifier, not hosted application memory. Current mobile callback/responsiveness and remaining CI/merge obligations are separate.
