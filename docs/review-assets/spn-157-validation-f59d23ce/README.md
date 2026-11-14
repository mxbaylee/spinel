# 🛟 SPN-157 exact-head validation archive

This archive records the **original first-attempt** acceptance of source
`f59d23ceae976ee0abdd25eb13f370e18d7d6495` against actual base
`87c34e30ed810e6789d876e55b23dcbb349fa506`. Tested merge
`92959827e4dee1c3bf9d186fbe51b8b447c26198` has the same tree as the reviewed source:
`5d8c93740959386dce7d85858f1ce85cdcc9c6fd`. The full L method, original specification
and 19-obligation/A1–A9 audit remain in the parent commit's maintained records.

## ✅ Terminal observations

- CI 43579169044 attempt 1: **33/33 jobs successful**, including all seven required
  gates. The immutable full plan selects all 15 suites; canonical digest
  `d889d71299d918f4cd6fc031b375bdb3c10998c3f4ec8ecf642e20025b3b6621` matches all
  three original aggregate reports and exact tested source.
- Supervisor 132400210873: **131/131**, 400.38 s; durable running 972 ms,
  ownership-first 11,740 ms and readiness-first 11,739 ms. Recovery 132400210884:
  **619/619 across 49 files**, 304.61 s, including 11 actual restore-crash cases,
  six ownership controls and four pre-barrier controls.
- Mobile 132400210929: four baseline tests pass in 25.4 min; seven candidate tests
  pass in 13.1 min; paired comparison succeeds. Required browser aggregate 132411397070
  succeeds. CI terminal update is 2026-11-14T09:57:40Z.
- Storybook 43579169103 attempt 1: eight successful jobs including all five review
  variants and the stable gate; only two publication/deployment jobs are skipped.
- No failed current-head job, requested retry, changed budget or collector mutation
  of candidate/PR metadata. Nineteen original structured Playwright reports have
  zero unexpected, flaky or top-level errors. Unrelated optional SPN-146 benchmark
  skips retain their original remaining-partition log context.

These current-head results are distinct from the retained actual-feedback-source
5e72 results. They do **not** establish the historical cause or claim a causal repair.
Both original 43544143900 failures stay failed; comparator 43540593013 remains a
separate observation. Bounded non-recurrence rests on the explicit four-persona
method and complete contract audit, not replacement of a failed verdict by green.

## 📦 Original bytes and verification

`receipt.json` binds source/base/tested/tree, native results, exact reviewers, all
jobs and seven gates. `ci-plan.zip`, the three complete aggregate ZIPs, original API
pages, `tested-commit.json`, `aggregate-bindings.json` and `native-results.json`
retain the source/selection/result chain. `logs/` contains all 41 executed-job logs
as gzip; `retained-log-map.json` records original byte lengths and stored/decoded
SHA-256s. Raw ANSI output is preserved; display stripping was only used to inspect
reported lines.

All 30 original artifact ZIPs (494,851,592 bytes) were downloaded and verified
against the live artifact API SHA-256/size and every outer ZIP member CRC. Every
one of their 289 JSON members is retained byte-identically through gzip under
`original-json/`; `downloaded-artifacts.json` maps each original member, artifact,
run/source, decoded hash and stored hash. Twelve complete acceptance/report ZIPs
are also included. Larger successful trace, screenshot, PDF and Storybook-build
ZIPs remain local and in expiring Actions artifacts; this archive does not claim
their entire binary payloads are published. No new UI review/capture is implied.

`referenced-evidence/` contains 13 byte-identical copies from the published 5e1b
original-failure and d34 feedback-source archives; the map records exact original
commits/paths/hashes. Those older receipts/README references retain their original
archive context, not this directory. `reviews/` and `local/` preserve all available
original review iterations and check/cleanup receipts. The earlier review provenance
note explicitly identifies unavailable standalone B narrative files without
fabricating their wording. The final exact-f59 A and B reports each score 100/100;
they are not grades of this later evidence-only commit.

`root/` retains unchanged root prepublication, native, resumed-gate and old-history
verification receipts. The root native audit records its initial ANSI comparison
correction without changing raw bytes. `collection-notes.json` records a local
artifact-directory redirection failure before download; it was not a hosted/test
retry. A usage-cap interruption paused collection; the same original run completed
without intervention, and its terminal evidence was collected on resumption.

## 🔒 Publication and completion boundary

Reserved tag: `archive/spn-157-validation-f59d23ce-20261114`; reserved repository
path: `docs/review-assets/spn-157-validation-f59d23ce/`. The collector prepares only
a local archive commit, directly parented by f59; root independent archive
verification and publication are still required. This archive does not authorize
merge or claim completion/branch cleanup.

Root has already verified and published `archive/spn-157-local-44f9a536-20261114`
at exact 44f9a536, preserving its unique 93257f23 parent/history. Both implementation
branches still exist. After confirmed squash merge, recheck all ticket-created refs,
active PR ownership and worktree heads before guarded deletion; retain actual
cleanup and merge/source/archive bindings in the reserved completion archive.
No source, main, PR metadata, tag publication or branch deletion was performed by
this collector. `files.json` inventories every archive payload except itself.
