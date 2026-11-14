# 🧾 SPN-098 terminal metadata validation and checkpoint cancellation

This evidence-only child of published failure archive `5e1b7a9fac17c69ff9174caa9da9f8d13713737d` preserves its original first-failure logs and adds terminal records. Implementation remains `2204b8c40ce6feb8ad03c65720c976510535ad00`, base `ebf0842f51b60d54649cf8a03065914bec0944bf`, tested merge `62bc0229c5675ff519b733cfc8f3c9a7e6e918d8`. No PR implementation or worktree change, retry, budget adjustment or merge occurred.

## 🛑 Original validation failed

CI43544143900 attempt1 completed failure at2026-11-14T02:33:08Z. All33 jobs terminal:30 success; supervisor132291548937 failed2/131 tests, required Unit tests132293846852 failed, and Playwright smoke132299767160 failed closed because required Unit tests failed. All selected browser/native workers succeeded; the final aggregate is not a new browser failure. All seven required gates are explicitly enumerated with exact IDs in receipt.json. The earlier successful CI/Desktop/Storybook acceptance remains separately preserved and cannot override this failure. SPN-157 owns separate supervisor diagnosis/repair.

Mobile responsiveness132291548985 succeeded:7 candidate tests expected, zero unexpected/flaky/skipped, comparison accepted and integrity valid. Plain1/2/3 input p95 56.0/54.4/52.1 ms, capacity maximum22.9/23.2/23.8 ms, verified browser-local drain374.0/372.7/373.5 ms. Unchanged100 ms capacity limit; profile maximum28.3 ms. Complete original artifact14094292758 is retained and digest-verified. These are hosted emulated presets, not physical-device measurements.

## ⏹️ Checkpoint-only cancellation

Publishing the failure-checkpoint body triggered CI43545634784 attempt1. The manager intentionally cancelled only that new run; it completed cancelled at2026-11-14T02:20:30Z. All16 jobs are terminal, none active. Backlog/Lint succeeded; Typecheck/Lib/Unit/Playwright aggregates failed closed after classifier cancellation; remaining jobs cancelled. No classifier plan artifact exists. Retained aggregate artifacts explicitly reject missing plan or cancelled dependencies. This deliberate draft-checkpoint cancellation is not acceptance and did not cancel the original failed run.

## 🔐 Exact digest semantics

The original43540593013 canonical plan digest is `7f3f130bf8684f274220b739e4b20536890acf2a4c91a6fe5dbdb250d6078b7e`, matching its unit/lib/browser aggregate evidence and the PR body. Its original file including trailing newline has SHA-256 `4e8efa1fc9c7702c105f497e0ef5552db94b3a5d05b3a6538603b5fc0871a181`.

For metadata43544143900, canonical plan digest is `50ddf45c449484b550e25feb6d0c0e8f82ec9fdeda2d494a03ce190c91b0be69`, matching all three new aggregates. Raw-file SHA-256 is `d915e21eecc19926dfe89e9f8f97087f2f4b6a53138b8e606e6866f774d105b7`. The preceding failure checkpoint's planSha256 field was the raw-file digest, not the canonical aggregate digest; this receipt clarifies both. The only semantic plan difference from first acceptance is action synchronize→edited; base/head/tested and all15 selected suites remain identical.

## 📦 Retention and publication

Original API snapshots, all small aggregate ZIPs, both plan byte streams and the complete second mobile archive are retained here. artifact-receipts.json binds ZIP IDs/sizes/digests and files.json covers all stored bytes. Other successful second-run traces/captures are expiring supplements and are not claimed as retained. Original first-success archive32a4694 and first-failure archive5e1b7a9 remain immutable. Intended publication is one explicit archive tag only; workflows have no tag/create trigger. No PR-body edit is part of this proposal.
