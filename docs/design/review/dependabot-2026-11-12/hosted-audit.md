# 🔎 Reviewer B hosted audit — PR #277

Reviewed application: 0d6e1ffae53fe5432fa2bb581bdf52ba7d9a2166; base f2e36db45a4cd10f3ff2e1358c5a3c457344856a; tested merge 00c196fd661a5cf4d0a5f7d7d832c0811547358c. Merge parents verified; application and merge tree both 836bf9867748dccee0812083ea0cbe648fa6f557.

Audit snapshot: CI has 31 successful jobs and mobile responsiveness 131249116537 in progress. Final Playwright aggregate is not yet present. No other blocker identified. Previous grades unchanged (application 98, historical descendants 99 each). No local runtime workloads or remote mutations.

## Attempt and selection audit

All four runs and all listed jobs are attempt 1; no failed job steps. Downloaded completed runtime job logs contain no Playwright retry headings or flaky/failure summaries. Native browser logs report passed status, including Safari. This does not erase #278's distinct original Safari failure. Storybook's two skipped jobs are optional PR preview and main-only deployment; all five review variants and states/interactions gate passed.

Existing skips are explicit: Node's two optional SPN146_BENCH_STATES ES/CJS measurements; library's three opt-in diagnostic harnesses; three Doc tests requiring VITE_SYNC_EVIDENCE skipped in development 1/2, production 1/2 and mobile-https, while both native sync owners pass; production-only supervised maintenance skipped in development 2/2 and exercised by production. No selected missing worker was counted as a pass. Mobile responsiveness and the dependent final smoke gate remain pending.

## Meaningful execution evidence

- Unit remaining 131249115875: Node 811 passed, 0 failed, 2 skipped, 47.493 s. Vitest 2,117 passed in 185 files, 194.37 s.
- Supervisor 131249115882: 131 passed, 337.49 s. Recovery 131249116006: 607 passed in 47 files, 284.11 s.
- Library remaining 131249115796: 967 passed, 3 skipped, 87 files, 597.99 s. Cells 131249115970: 106 passed, 199.88 s. Dense cells 131249116141: 5 passed, 450.57 s.
- Full fuzz 131249115919: 100 seeds, 100,042 original mutations, 330.70 s; content checks Doc 2,783, Sheet insertion 1,521, removal 495. Two retained collapsed-image captures; zero newly collapsed random captures.
- Browser development shards: 74 passed/3 skipped (14.3 min), 75 passed/1 skipped (15.4 min). Production: 81 passed/3 skipped (11.2 min), 84 passed (11.0 min).
- Native sync development 21 passed (3.5 min), production 98 passed (13.3 min); Sheet/Doc soaks one each (57.7/35.6 s); mobile HTTPS 10 passed/3 skipped (59.4 s); SDK upgrade two passed (38.8 s); supervised restore two passed (6.2 min).
- Desktop responsiveness 131249116385: baseline four samples passed (8.1 min), candidate seven tests passed (6.0 min). Retained full comparison passed, no failures: all four candidate samples preserve integrity/redo; p95 input 27.8–28.8 ms, first verified browser-local empty 342.9–357.8 ms; longest task 0/0/0/64 ms (zero means below observation threshold). Conservative plain-sample whole-browser longest-task reduction 99.2842764482%. Source baseline 96ae9e0a07d113c5de771f6e4e0f4ae83fae812d, candidate tested merge above.
- Callback comparison desktop/mobile 131249116945/131249116300: both accepted, no failures, candidate bounded. Candidate cursor/zoom-init/zoom-update pending high-water 4/1/1; all three families have zero callbacks after disposal and zero pending at trace end. Baseline cursor high-water 7,686/8,346 and after-disposal callbacks 8/8; zoom-update high-water 1,829/2,086. Baseline b75e3797a11ac2f53e3833b5615f68b6c0091727, candidate tested merge above. Full comparison JSON read directly from existing archives without extracting large traces. Timings descriptive; unprofiled comparison gates remain separate.
- Native Firefox/Chrome macOS 26 and Safari macOS 15 Intel passed their complete jobs; Spaces logs report acceptance passed. This audit does not claim physical-phone evidence.

## Exact run/job ledger

Run 43237407934: 0d6e1ffae53fe5432fa2bb581bdf52ba7d9a2166; attempt 1; in_progress/pending.
- 131248350669: Classify changes (43237407934) — success, attempt 1.
- 131248351209: Pull request — success, attempt 1.
- 131249115599: Sized restore acceptance — success, attempt 1.
- 131249115775: Backlog — success, attempt 1.
- 131249115796: Lib tests (remaining) — success, attempt 1.
- 131249115863: Lint — success, attempt 1.
- 131249115875: Unit tests (remaining) — success, attempt 1.
- 131249115882: Unit tests (supervisor) — success, attempt 1.
- 131249115919: Lib tests (mixed-fuzz) — success, attempt 1.
- 131249115967: Typecheck — success, attempt 1.
- 131249115970: Lib tests (cells) — success, attempt 1.
- 131249116006: Unit tests (recovery) — success, attempt 1.
- 131249116103: Retained sync transition — success, attempt 1.
- 131249116141: Lib tests (dense-cells) — success, attempt 1.
- 131249116147: Container smoke — success, attempt 1.
- 131249116300: Doc callback lifetimes (mobile) — success, attempt 1.
- 131249116385: Doc responsiveness (desktop) — success, attempt 1.
- 131249116537: Doc responsiveness (mobile) — in_progress, attempt 1.
- 131249116945: Doc callback lifetimes (desktop) — success, attempt 1.
- 131249117304: Playwright smoke (development 1/2) — success, attempt 1.
- 131249117347: Playwright smoke (production 1/2) — success, attempt 1.
- 131249117351: Playwright smoke (sync-soak-sheet) — success, attempt 1.
- 131249117362: Playwright smoke (mobile-https) — success, attempt 1.
- 131249117409: Playwright smoke (development 2/2) — success, attempt 1.
- 131249117413: Playwright smoke (production 2/2) — success, attempt 1.
- 131249117425: Playwright smoke (sync-development) — success, attempt 1.
- 131249117428: Playwright smoke (sync-production) — success, attempt 1.
- 131249117515: Playwright smoke (supervised-restore) — success, attempt 1.
- 131249117560: Playwright smoke (offline-upgrade) — success, attempt 1.
- 131249117586: Playwright smoke (sync-soak-doc) — success, attempt 1.
- 131253078504: Unit tests — success, attempt 1.
- 131257981676: Lib tests — success, attempt 1.

Run 43237408378: 0d6e1ffae53fe5432fa2bb581bdf52ba7d9a2166; attempt 1; completed/success.
- 131248563646: Classify changes — success, attempt 1.
- 131249013781: Build Storybook — success, attempt 1.
- 131249434040: Review Storybook desktop (light) — success, attempt 1.
- 131249434152: Review Storybook mobile (dark) — success, attempt 1.
- 131249434162: Review Storybook desktop (dark) — success, attempt 1.
- 131249434207: Review Storybook mobile (light) — success, attempt 1.
- 131249434539: Review Storybook tablet — success, attempt 1.
- 131249437076: Publish PR preview to GitHub Pages — skipped, attempt 1.
- 131258131215: Review Storybook states and interactions — success, attempt 1.
- 131258667414: Deploy to GitHub Pages — skipped, attempt 1.

Run 43237407933: 0d6e1ffae53fe5432fa2bb581bdf52ba7d9a2166; attempt 1; completed/success.
- 131248347940: Native desktop offline (firefox, macos-26) — success, attempt 1.
- 131248348318: Native desktop offline (safari, macos-15-intel) — success, attempt 1.
- 131248348844: Native desktop offline (chrome, macos-26) — success, attempt 1.

Run 43237407947: 0d6e1ffae53fe5432fa2bb581bdf52ba7d9a2166; attempt 1; completed/success.
- 131248346623: 🦈 DigitalOcean Spaces — success, attempt 1.

Final evidence publication and independently reviewed visuals remain separate obligations. Refresh the inventory after mobile responsiveness and the final aggregate terminate; do not infer completion from this snapshot.


## ✅ Final snapshot supplement

The earlier pending snapshot above is retained as written. Subsequently mobile responsiveness job 131249116537 passed and the final Playwright smoke gate 131272729907 passed; CI43237407934 terminated success with all33jobs successful on attempt1. The complete final inventory is in run-ledger.json and mobile measurements in measurements/responsiveness-mobile.json.
