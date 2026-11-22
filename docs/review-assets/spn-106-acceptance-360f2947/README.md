# 🔕 SPN-106 current acceptance archive

This archive is a direct evidence-only child of reviewed source
`360f2947269309b472cce569f194994c43fa0d95`, base
`aeed459c7828a46d66e0054399eff0f00f1c506e`. It is not a new implementation
candidate. GitHub tested merge `ea02b08dcbd149c5f7eae18e5cc43b9eaa48975e`;
its tree equals the reviewed source tree `ffd0fb4e76a988142c691f8674344e7d47fd7fd9`.
All candidate changes, required local checks, two independent reviews and current
visual approval preceded the validation push. **Agent review only.**

## 🧾 Exact evidence and scope

- `review-a*.md`, `review-b*.md` retain original reviews and final exact-head
  revalidations, with independent test logs. Both final scores are100/100.
  Runtime checks actually ran at6e8d2631; only identical-value JSON spelling
  changed afterward. Their pending-hosted language describes pre-push review
  time, not the final acceptance disposition recorded in this archive.
- `browser-summary.json` and exact compressed Playwright JSON reports retain
  current development/production first attempts. All18 ticket cases pass without
  retry: eight viewer role/viewport cases, four Doc/Sheet guest-link cases,
  four Doc/Sheet PDF cases and two Doc upgrade/downgrade cases. Each viewer case
  covers plain and dated documents with initial/reload warning history and full
  saved content/grant equality. Concurrent owner editing and guest revocation
  belong to the plain branch. Native/mounted controls own actual edit denial.
- `pdf-notices-{development,production}/` contain20 actual records: five roles
  for Docs and Sheets in each build, all startupProtectionNotice=false and no
  Export/download notices. Local PDF/guest-link resource abort remains an abort;
  these successful hosted results supply the previously missing acceptance.
- Existing runtime skips retain their reasons in `browser-summary.json` and
  identify passing environment owners. The100-test sync-production report proves
  the three observer-dependent phone cases. No ticket case is skipped.
- `native-{safari,chrome,firefox}.zip` preserve complete original Actions
  artifacts, with original GitHub digest match. `native-summary.json` binds
  run44988661516 attempt1. Safari27.2/macOS15.7.9 Intel completes46 stages and
  four ordinary same-profile launches, exact retained content/native edits,
  normal reconnect, conflict recovery, actual storage loss and clean teardown.
  Chrome/Firefox each complete44 stages. `native-acceptance-review.md` is the
  independent nonimplementing audit. Safari's bounded prompt-inspection timeout
  is retained setup diagnostics before successful ordinary ephemeral-runner
  consent, not a failed/retried product acceptance journey. The historical b9
  missing-press cause remains unresolved and is not inferred from this success.
- Five `storybook-*.log.gz` files bind all5 current theme/viewport partitions
  of run44988661630 attempt1; each checked1097 states including native viewer
  and genuine denied edit. `storybook-summary.json` preserves exact summaries.
  Current light/dark/390px application and mounted images remain in the reviewed
  candidate at `docs/review-assets/spn-106-current-20261121/` and are embedded in
  PR#246. They are synthetic Chromium/phone-emulation evidence, not physical-phone
  acceptance or a substitute for the separate native Safari run.
- `ci-plan.json`, required-aggregate results, final job records and the hosted
  summary bind every selected worker to the same immutable source/tested IDs.
  The force-updated historical push range was unavailable, so classification
  conservatively selected full coverage. The explicit-request-only mobile editing
  suite remained inapplicable, not passed. No routing or gate was narrowed.

## 📜 Failure and retention limits

Current first local resource aborts and Storybook CLI setup failure remain in the
candidate's maintained implementation receipt; historical snapshots, reviews,
Safari failure and their causal limits remain unchanged. No retry is credited as
an initial product pass. Compressed files preserve exact decoded bytes; the
manifest records both stored and decoded identities where applicable.

This archive preserves essential acceptance and independent-review evidence
without relying on expiring artifacts. Supplementary native full artifacts had
14-day retention, Storybook builds7 days/review captures as configured, browser
and performance artifacts their workflow retention. Large CPU/protobuf traces
and the entire1097-state screenshot catalogue remain supplementary Actions
artifacts; no performance improvement claim is made by this ticket. Required
comparisons and selected workers must be successful in the recorded final run.

The original task branches may be removed after verified squash merge and fresh
head/active-PR checks. Keep this archive tag and the historical archive tags.
The final PR description records actual merge and cleanup identities.
