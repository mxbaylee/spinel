# PR text edits and code validation

The `Pull request` check has one owner: `.github/workflows/pr-policy.yml`.
The other six required checks remain in `ci.yml`. Exact title/body edits run
policy without starting, cancelling, replacing, or copying code validation.
The trusted `pr-revalidate.yml` router inspects edited events separately and
requests full validation for base changes and ambiguous edit payloads. A later
exact text edit remains policy-only even when the PR already owes full validation.

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
5. Verify effective Actions policy allows the pinned actions and that
   `pull_request_target:edited` is actually delivered to the trusted workflow.
   Observe the App's label addition creating the intended `pull_request:labeled`
   code run. Credential creation alone does not establish either capability.

The pinned `actions/create-github-app-token` action mints a short-lived token for
this repository with only Pull requests: write, and revokes it at job completion.
Rotate the key by adding a replacement App key, updating the secret, verifying
one guarded routing trial, and then revoking the old key. Uninstalling the App
or removing the secret disables routing and leaves affected policy checks blocked.

The App's Pull requests: write permission is broader than one label; GitHub does
not provide a label-only permission. The installed repository and short token
lifetime limit its scope, and the maintained API client permits only reserved-label
mutation. Treat the private key accordingly.

The privileged workflow checks out only `pull_request_target`'s immutable main
SHA, installs no PR dependencies, and never executes the PR's code with the App
credential. Exact text edits never request an App token or mutate a label.
The ordinary token removes an existing label without triggering CI; the App
adds it to create a genuine `pull_request:labeled` event. The label remains
present to make the requirement visible, but retaining the requirement does not
depend on the label still being present.

## Persistent full-validation requirements

An independent edited-event classification job records a successful
`Edit classification: text` or `Edit classification: full` step in Actions
metadata. Later text edits may supersede the policy job but do not cancel this
classification job. A successful text marker survives later policy cancellation;
unknown, failed, or cancelled work without that marker cannot establish a text edit.

The PR timeline's `base_ref_changed` events, historical additions or removals of
`ci-revalidate`, and ambiguous/full edit classifications establish a full-validation
requirement for that PR's remaining lifetime. It survives missing credentials,
a failed label addition, manual label removal, and later source pushes. Future
code classifiers consult that history and select full coverage. Incomplete or
unavailable history also requires full coverage; a still-pending classification
is kept explicit. These histories use GitHub's existing
[issue event types](https://docs.github.com/en/rest/using-the-rest-api/issue-event-types).

Policy reads the requirement before admission and again before success. Once it
observes a full requirement, it retains it for that invocation. During code waits,
only a pending history classification needs repeated history reads; code admission
is polled separately. A later valid title cannot erase a prior base obligation.

## Evidence and failure behavior

The CI run name records the immutable PR number, base, head, tested merge, and
explicit full-validation request. It is event identity, not a test result.
The classifier verifies the checked-out merge and both parents, and the code
jobs retain the digest-bound coverage plan and actual results. When full validation
is required, admission requires the classifier's successful
`Coverage selected: full` step. The static run-name flag cannot prove actual full
selection, especially when persistent history supplied the requirement.

The policy job validates the current title, ticket, IDs, and size, then requires
the latest eligible CI attempt and all six genuine code-check identities from
that run's own suite. It never falls back to an older pass. Missing, skipped,
neutral, foreign, or mismatched gates cannot establish admission. Failed code
stays failed; pending code stays pending. The
[jobs API](https://docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run)
is read with `filter=all`, then the newest execution of each required job name is
selected. A native failed-job retry may retain genuine earlier successes from
that same run and suite; it cannot substitute an older execution of a job that
has since rerun. Every required code job finishes with a live source/base guard,
including an individual or failed-job retry that reuses an earlier classifier.

If GitHub has not yet created dependent checks, policy waits for their observable
admission at sixty-second intervals, for at most ninety minutes. The workflow
allows ninety-five minutes for setup and that bounded wait; excess queueing or
missing evidence still leaves the check blocking. Policy does not require code
success and cannot publish or modify a code result. Source, base, merge, and text
are checked again before policy succeeds.
An old-base pass cannot satisfy a subsequent valid title edit.

Text edits use three small runner allocations after activation: the independent
classification job, policy job, and trusted routing inspection, without dependency
installation. While code is pending, policy may wait on that original run; this
wait is real runner time and must be included in measurements. Actual code events,
including labels, share one per-PR concurrency group so older source/base plans cannot outlive the current
plan. Label removal still preserves path-required coverage and cannot clear the
persistent full-validation requirement.

## Validate before activation

Keep all seven required names and existing protections. Do not merge the draft
until two independent reviews and current-source CI are complete, and the
following actual protected-PR transitions have been demonstrated:

| Transition | Required observation |
| --- | --- |
| Passed code → text edit | Only classification, policy, and routing inspection run; code identity and protected readiness remain valid. |
| Pending or failed code → text edit | Original code remains pending or failed; no copied or substituted results. |
| Rapid exact text edits | Each edit's classification survives policy supersession; no code run is requested. |
| Invalid title → corrected title | Policy fails and recovers independently of code. |
| Base or ambiguous edit | The router creates an eligible PR event and full validation of the exact new source/base. |
| Failed new-base code → text edit | New-base failure stays blocking; old-base success is not selected. |
| Base → source update → text | Full-validation obligation survives the source-update race. |
| Base edit with missing key → source push | The recorded obligation forces the new code run full even though routing could not add a label. |
| Label removal → failed label addition → source push | Historical intent still forces full coverage without a present label. |
| Policy already green → old-base individual/failed-job retry | Each rerun code gate rejects the stale live base, even when its classifier was not rerun. |
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

Primary platform contracts: [eligible protected-check events](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks),
[workflow triggering and token behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow),
[trusted target-event execution](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request_target),
[label permissions](https://docs.github.com/en/rest/issues/labels#add-labels-to-an-issue),
and [App tokens in Actions](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/making-authenticated-api-requests-with-a-github-app-in-a-github-actions-workflow).
