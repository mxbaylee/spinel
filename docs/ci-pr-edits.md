# PR text edits and code validation

The `Pull request` check has one owner: `.github/workflows/pr-policy.yml`.
The other six required checks remain in `ci.yml`. Exact title/body edits run
policy without starting, cancelling, replacing, or copying code validation.
The trusted `pr-revalidate.yml` router inspects edited events separately and
requests full validation for base changes and ambiguous edit payloads.

## Required setup

SPN-129 is a draft until this configuration and its hosted acceptance are
verified. The existing connected GitHub integration does not provide its private
key to Actions. Do not weaken repository protection to work around missing setup.

1. Create a dedicated GitHub App, for example **Spinel CI router**, installed only
   on `mxbaylee/spinel`. Webhooks and user authorization are unnecessary.
2. Give it repository **Pull requests: read and write**. GitHub includes
   **Metadata: read** automatically. No code, Actions, checks, secrets, or
   administration write permission is needed.
3. Add repository Actions variable **`SPINEL_CI_ROUTER_APP_ID`** with its numeric
   App ID, and Actions secret **`SPINEL_CI_ROUTER_PRIVATE_KEY`** with its private
   key. Enter the key in GitHub's secret settings, not a PR, commit, or chat.
4. Ensure the reserved repository label **`ci-revalidate`** exists. It requests
   full validation; keep it on a retargeted PR for the remainder of that PR.

The pinned `actions/create-github-app-token` action mints a short-lived token for
this repository with only Pull requests: write, and revokes it at job completion.
Rotate the key by adding a replacement App key, updating the secret, verifying
one guarded routing trial, and then revoking the old key. Uninstalling the App
or removing the secret disables routing and leaves affected policy checks blocked.

The privileged workflow checks out only `pull_request_target`'s immutable main
SHA, installs no PR dependencies, and never executes the PR's code with the App
credential. Its API client can mutate only the reserved label in this repository.
The ordinary token removes an existing label without triggering CI; the App
adds it to create a genuine `pull_request:labeled` event. The label remains
present so a concurrent source update also selects full coverage.

## Evidence and failure behavior

The CI run name records the immutable PR number, base, head, tested merge, and
explicit full-validation request. It is event identity, not a test result.
The classifier verifies the checked-out merge and both parents, and the code
jobs retain the digest-bound coverage plan and actual results.

The policy job validates the current title, ticket, IDs, and size, then requires
the latest eligible CI attempt and all six genuine code-check identities from
that run's own suite. It never falls back to an older pass. Missing, skipped,
neutral, foreign, or mismatched gates cannot establish admission. Failed code
stays failed; pending code stays pending. A native failed-job retry may retain
its genuine earlier successful jobs from the same run and suite.

If GitHub has not yet created dependent checks, policy waits for their observable
admission with a forty-minute limit; timeout stays blocking and explains the next
action. Policy does not require code success and cannot publish or modify a code
result. Source, base, merge, and text are checked again before policy succeeds.
An old-base pass cannot satisfy a subsequent valid title edit.

Text edits use two small runner allocations after activation: one policy job and
one trusted routing inspection, without dependency installation. While code is
pending, policy may wait on that original run; this wait is real runner time and
must be included in measurements. Actual code events, including labels, share
one per-PR concurrency group so older source/base plans cannot outlive the current
plan. Label removal still preserves path-required coverage; adding or removing
the reserved revalidation label selects full coverage.

## Validate before activation

Keep all seven required names and existing protections. Do not merge the draft
until two independent reviews and current-source CI are complete, and the
following actual protected-PR transitions have been demonstrated:

| Transition | Required observation |
| --- | --- |
| Passed code → text edit | Only policy/routing inspection run; code identity and protected readiness remain valid. |
| Pending or failed code → text edit | Original code remains pending or failed; no copied or substituted results. |
| Invalid title → corrected title | Policy fails and recovers independently of code. |
| Base or ambiguous edit | The router creates an eligible PR event and full validation of the exact new source/base. |
| Failed new-base code → text edit | New-base failure stays blocking; old-base success is not selected. |
| Base → source update → text | Full-validation obligation survives the source-update race. |
| Stale routing, missing key, or denied label write | No false admission; the current policy remains blocked. |

Record source/base/merge SHAs, run/attempt/job/check IDs, actual protected readiness,
first failures, runner allocations and time. Local mocks prove protocol logic,
not GitHub's protected-check selection. The target router executes main's workflow,
so an unmerged candidate does not prove automatic target-trigger delivery. Keep
that deployment/activation boundary explicit; do not merge merely to manufacture
acceptance. A separately authorized trusted staging installation can exercise
delivery before adoption, with the actual repository's protection checks still
required for acceptance.

See [the SPN-129 record](implementation/SPN-129.md) for current evidence and
[sustainable testing](testing.md) for regression ownership.
