# 📚 SPN-141 Storybook provisioning failure — reviewer B

Eligible for exactly one evidence-backed infrastructure-only retry of the failed desktop-light job and its failed dependent aggregate, on unchanged source `4e593fbaf9ea89585920053b9415f9a8eac0944f`. This assessment authorizes no execution by this reviewer and does not convert attempt 1 into passing acceptance. The original failures and missing desktop-light application evidence remain authoritative until a new successful result is independently checked.

## 🔎 First cause and consequences

I independently fetched the full terminal attempt-1 run/jobs and the raw failed desktop-light and aggregate logs for Storybook run `41970163084`. Source matches the current reviewed candidate; the tested merge recorded by the workflow is `f0e74d52629923737985ce03e4f32ff218dcf76d` (equal source tree `a2b37aa82336224ac40e92f7364e52ccebfb6d74`).

Desktop-light job `127056809749` successfully checked out, installed locked application dependencies and downloaded the Storybook build. At 04:53:01Z it entered `Install Chromium`: the repository mirror preflight succeeded, and Playwright's `install --with-deps chromium` invoked apt. At 04:53:02.231Z the external `https://packages.microsoft.com/ubuntu/24.04/prod` noble InRelease endpoint returned HTTP 403 (13.107.213.71). Ubuntu archive metadata requests succeeded. At 04:53:11Z apt rejected the unavailable repository metadata with exit 100; Playwright then exited 1.

The subsequent `repository ... is no longer signed` text follows the failed InRelease retrieval. This evidence does not establish a changed signing key, malicious repository, expired credential or a signature bypass requirement. No repository-authentication or package-trust relaxation is justified.

Both `Check icon and integration stories` and `Review stories and verify shared controls` were skipped. Their always-run uploads failed because no evidence directories existed. These are consequences of provisioning failure, not independent failed story assertions. Aggregate job `127060009081` then correctly rejected `DESKTOP_RESULT=failure` with `Storybook desktop review: expected success, received failure.` This fail-closed outcome must be retained.

Attempt 1 has six successful jobs (classification, build, desktop dark, tablet and both mobile themes), two failed jobs (desktop light and aggregate), and two inapplicable skipped Pages jobs. It is terminal failure, not an otherwise-green workflow to ignore.

## 🧭 Attribution and finite next action

The current workflow, mirror preference helper and aggregate source were inspected and preserved. They are byte-unchanged from accepted base `2f442317dd2e1c188ae4a810ac094fd1162a4a2a`. The mirror helper only changes supported Ubuntu mirror priority and retains unrelated entries; it completed successfully. SPN-141's storage implementation is not involved in this apt request.

As corroboration, I fetched the same-run desktop-dark job `127056809598` and log: it fetched the same Microsoft noble InRelease successfully at 04:52:13.205Z, then completed its applicable work successfully. **The sibling reports image 20261101.360.1. The failed job setup banner reports 20261025.353.1, but its mirror helper records environment ImageVersion 20261026.354.1. These inconsistent failed-job image identifiers are preserved; neither is silently substituted for the other.** Thus the evidence supports an external provisioning inconsistency, not a controlled identical-runner experiment or a proven transient service root cause. HTTP 403 alone would not prove transience; the pre-assertion boundary, unchanged source and successful contemporary endpoint use jointly justify one bounded retry.

`docs/run-backlog.md` says: “Retry a transient infrastructure failure only with evidence; retain the original failure.” `docs/testing.md` also requires the reason, run attempts and every failure/retry disposition to be preserved. A **single failed-jobs-only retry** fits this exception, with these prospective limits:

- Retain attempt-1 raw run/jobs/logs, the exact source/tested identities, this disposition and the retry decision before dispatch; publish them immutably with final evidence.
- Keep source, dependencies, all assertions, complete catalog selection, theme, runner labels, trust checks and the 15-minute desktop job budget unchanged. No broader workflow dispatch, successful sibling rerun, alternate mirror/auth bypass or timeout increase is justified here.
- Retry the failed desktop-light worker and the dependent fail-closed aggregate. The framework will re-run that worker's setup before its first actual icon/story assertions; call it workflow attempt 2, not a first overall job attempt. Previously successful siblings remain identified by their attempt-1 jobs.
- Stop on any new failed assertion or repeated provisioning failure. This permission does not renew itself, and a failure requires a new diagnosis and explicit bounded decision rather than retries until green.
- Verify the actual retry job set and terminal status, complete icon/story evidence and successful aggregate. Preserve both attempts; all unrelated current CI/native requirements remain mandatory.

No implementation change or native/browser/converter execution was performed for this assessment. The first local log fetch was refused by gh's ANSI-output guard; fetching the same logs with `--allow-escape-sequences` preserved the raw bytes without executing them. This was evidence retrieval, not a CI retry. Full raw metadata/log/source file identities are bound in `storybook-provisioning-b.json`. No source grade or overall merge approval changes as a result of this provisioning classification.
