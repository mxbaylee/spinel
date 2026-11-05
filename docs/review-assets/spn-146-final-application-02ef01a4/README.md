# ⚠️ SPN-146 final application outcome

Source 02ef01a40fe8369b79477909673c76de6d2a4edf; base 2f442317dd2e1c188ae4a810ac094fd1162a4a2a. Tested pull-request merge 6fdb243eb5728b91f935a4bea258fa3882458ccb has the same tree as source: 95df0cb77e8d509f3150ea7a1a48342cbb4c37e1.

CI 42013542535 attempt 1 completed: 31 successful jobs, development 1/2 and the Playwright aggregate failed. Development job 127198645126 measured both-peer observations at 1,005 ms on the first attempt and 1,071 ms on built-in retry 1 against the unchanged strict <1,000 ms budget. Built-in retry 2 passed; fail-on-flaky correctly failed the job. No workflow rerun occurred. Its complete original 35,545,524-byte artifact is retained; the trace is retry 1, not the first failure.

Mobile job 127198645024 passed. Plain 1/2/3 capacity-flush p95: 19.9/21.1/24.8 ms; maxima 34.3/29.8/29.9 ms; idle maxima 5.1/3.3/2.3 ms. Plain 1 retains all 66 undo/redo groups. Desktop plain maxima 28.0/9.9/7.5 ms. Full original desktop/mobile artifacts retain all baseline/candidate metrics, profiles, boundaries and comparison records. These application checks neither establish a component speedup nor reconstruct historical maximum failures.

Storybook 42013542559 attempt 1 passed (8 successful jobs, 2 inapplicable Pages skips). Component 42013542610 and native 42013542571 failures remain unresolved in archive 6977e3a1b9a488772efd1ad1f019b99316fae248. No third component experiment or native action replay follows. The two independent checkpoint reviews predate final application completion and are retained with their original scope, not promoted to final acceptance.

Metadata-only CI 42019359838 was deliberately cancelled, with every job terminal. It supplies no acceptance. The archived prior PR body is a dated checkpoint with mobile pending; this README supersedes that status only. Other successful-job raw traces/screenshots remain supplementary Actions artifacts, with identities/digests/expiry in ci-artifacts-final.json; this archive does not claim to retain every CI artifact. Current PR remains draft, unmerged.
