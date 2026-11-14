# 📨 SPN-098 current acceptance archive

This is an evidence-only child of reviewed source `2204b8c40ce6feb8ad03c65720c976510535ad00`; it is not a new implementation candidate. Base `ebf0842f51b60d54649cf8a03065914bec0944bf`, tested merge `62bc0229c5675ff519b733cfc8f3c9a7e6e918d8`, identical source/tested tree `d6bb81924f90aab2d2f2172927f847e412366816`. Exact runs, all jobs and artifacts are in the original API responses and receipt.json.

## ✅ First current-head attempts

CI 43540593013 attempt 1: all 33 jobs succeeded, including all seven required named gates. Full immutable plan hash `7f3f130bf8684f274220b739e4b20536890acf2a4c91a6fe5dbdb250d6078b7e`; all 15 suites selected and successful. Unit/lib/browser aggregate artifacts agree on plan/base/head/tested identities. Desktop 43540593025 attempt 1: actual Chrome/Firefox/Safari acceptance and cleanup succeeded. Storybook 43540593085 attempt 1: all five variants succeeded, 1,076 states each / 5,380 total, no failures. Inapplicable preview/deployment jobs were skipped.

Mobile responsiveness: baseline four and candidate seven expected tests, zero unexpected/flaky/skipped. Candidate plain-1/2/3 input p95 60.4/55.1/55.3 ms, capacity paired-flush max 23.2/24.3/24.2 ms against unchanged 100 ms maximum, browser-local drain 313.6/394.4/371.9 ms. Desktop corresponding values: input p95 29.0/29.2/29.2 ms, paired max 4.9/4.6/5.0 ms, drain 347.5/349.9/344.1 ms. Both comparisons and boundaries passed. These are hosted emulated presets, not physical phones.

Callback lifetime desktop/mobile comparisons accepted: pending high-water cursor/zoom-init/zoom-update 4/1/1, pending at end zero, post-disposal callbacks and installations zero. Progress terminal passed, no first/persistence failure or dropped events. All four diagnostics production/development browser cases passed retry 0 with actual isolated apps and downloaded SQLite files. Browser fixture proves exact user2/system3 feedback membership in one frozen inclusive receipt window; mixed observation/unattributed rows are covered by the separate real-SQLite unit contract.

## 🔬 Original evidence and retention

`download-receipt.json` binds every downloaded original ZIP to its GitHub artifact ID, size and SHA-256. Small complete native, responsiveness, restore and aggregate archives are retained here. `retained-member-map.json` maps each retained original JSON byte stream to its original ZIP member, decoded size/digest and compressed stored digest. The derived `*-audit.json` files aid inspection; original evidence is authoritative. `files.json` covers every archive file except itself.

All original callback numerical/frame-summary/progress/comparison JSON and full Storybook manifests are retained. Large successful raw callback traces, complete ordinary Playwright traces and all 5,380 full-catalog screenshots remain supplementary expiring Actions artifacts; they are not represented as fully preserved here. Useful reviewed current light/dark/phone screenshots remain committed in the reviewed source. No screenshot was regenerated for this archive.

## 🧾 Failure disposition and publication

The original source94c6968e mobile plain-3 retry0 failure remains 131.2 ms >100 ms in its immutable prior archive (receipt.json). Main repairs and dependency changes explain the new source; current first-attempt acceptance does not erase the old failure, prove causality or close SPN-089's remaining tail gate. Local pre-workload CLI setup failures and repaired evidence-manifest mismatch remain documented in the maintained source and PR body.

Only an archive tag is intended for publication. All six workflow files were checked at reviewed source: CI/Storybook push triggers restrict branches to main; other triggers are pull_request/workflow_dispatch. No tag or create trigger exists. This evidence-only archive does not alter the reviewed PR head or its two 100/100 independent reviews and visual approvals (agent review only).
