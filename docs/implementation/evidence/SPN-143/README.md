# 🔎 SPN-143 local evidence

`local.json` pins the base, nine changed executable/test source hashes, Chromium
authority hashes, one prospective probe and completed local checks. Gzip files
retain exact scripts, admission/early reviews, first failures, logs and watchdog
records; they are evidence, not scripts executed by CI.

- One complete retained baseline trace roundtrip passed: 596,624,241 raw bytes
  with identical SHA256, 47,129,287 stored bytes, 2.786 s. Watchdog: 3.043 s,
  256,160 KiB sampled combined peak, normal pressure. Local feasibility only.
- Current controls: **107/107**, 2.889 s and 834,976 KiB sampled peak. They include
  trace/progress/comparison, source attribution/lifetimes and CI plan/aggregate
  failure contracts. The production settlement helper is exercised by a real,
  browserless Playwright timeout; fixture controls use real SQLite and fake contexts.
- Focused nine-root/import-graph types: 444 ms, sampled peak 292,688 KiB; full
  project types remain hosted acceptance. Short sampling is not a true peak bound.
- Full lint/dependencies/format: 17.752 s, 756,064 KiB sampled peak, normal pressure.
  Backlog, CLI-generated index, exact PR title and whitespace checks passed.

## 🧪 First failures and review dispositions

`tests-second` retains the test's unsafe post-close database query and native
libsql panic. The control now uses the public `isOpen` property; its orphaned
synthetic fixture directory was removed only after process termination.
`tests-final` is the first expanded 107-control attempt: four source-map assertions
failed on macOS `/var` versus canonical `/private/var`. `tests-complete` is the
passing result after comparing the same fixture map's canonical realpath. No
production attribution/security behavior changed. Intermediate passing results
remain identified separately; they do not validate later code.

Early reviews found late-handle ownership after a rejected end command and stale
passing publication during timeout. Both have explicit negative controls. Added
controls cover native text transport, pending read/close release after output
failure, lost/truncated/mismatched evidence, partial setup, shared cleanup, first
cause preservation and terminal-progress rejection. Admission and early reviews
are not the two final exact-commit grades. Native transfer cost and complete paired
acceptance under 420 s remain pending until a reviewed candidate is validated.

## 📦 Provenance and previous prerequisite completion

The input trace remains in the immutable SPN-142 first-candidate archive linked
from [the maintained decision](../../SPN-143.md); no input/output trace is duplicated
here. Chromium sources are immutable tag URLs with SHA256 identities in `local.json`
and the decision. All source/category/buffer/workload/callback contracts remain
unchanged except explicit lossless transport/storage and lifecycle ownership.

`spn142-receipt-*` preserves the final PR262 readback and its description-triggered
CI **41934467037**, deliberately cancelled and verified completed/cancelled. This
is not an acceptance run. Publication verification independently checked the
remote immutable archive tag and all 93 manifest entries before squash merge;
the two small verification receipts are retained here. No further PR262 body edit
was made to report cancellation. Its source, tested merge and squash share the
same verified tree; obsolete implementation/helper refs were cleaned with guards.
