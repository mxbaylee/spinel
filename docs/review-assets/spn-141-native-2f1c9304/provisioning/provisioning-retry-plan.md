# 🛠️ SPN-141 Firefox runner provisioning checkpoint

2026-11-04, prospective agent decision under the owner's instruction to continue
resolving CI and merge SPN-120. This records a new finite infrastructure allowance;
the original one-workflow plan did not authorize an unchanged scenario rerun.

Source `2f1c9304b15adfef833e53f12c4facff9ce14821`, base
`5d8676ec280ac6d5cc9dcedb7e9cc09527b24806`, tested merge
`a554c611c96556176bcc6b2ba006ea421ee00943`, identical tree
`faac771987098438ff4f9269ef27d20a1a2bb7e2`. Native run `41885019409`, attempt 1,
Firefox job `126767083588` ended cancelled at 18:31:04 UTC. GitHub reports runner
ID 0, empty runner name and no steps. Its failure annotation says the job was not
acquired by a hosted runner after multiple attempts; three notices identify macOS
ARM64 capacity constraints. No checkout, install, browser or test executed.

Chrome job `126767084103` and Safari job `126767084191` passed and their exact
artifacts are independently reviewed. Do not repeat those owners. Preserve this
unstarted job and all annotations; no failed product or fixture assertion is
converted into a pass.

Allow **one targeted re-provisioning of Firefox job 126767083588**, using GitHub's
single-job rerun endpoint at this unchanged source. Keep macos-26, vendor stable
Firefox, all application assertions and operation/job budgets. Its GitHub attempt
number will increase; distinguish that from the first actual Firefox execution.
No source repair is indicated by a runner never being acquired. The existing
99/98 exact-source reviews remain source reviews, not proof that this check passed.

Before dispatch, preserve this plan and raw GitHub job/annotation records in an
immutable repository evidence commit and obtain independent review of this narrow
disposition. Observe the new job to completion. Any further provisioning failure
or actual test failure requires a new concrete diagnosis; no automatic renewal,
whole-workflow rerun, runner substitution or check waiver is part of this plan.

All seven current-head gates and every selected native owner remain mandatory.
Operator gains an attributable infrastructure disposition with finite compute;
Owner and Collaborator retain exact offline/content/recovery proof; Link guest
authority is unchanged. No user sign-off is needed for this routine in-scope CI
recovery, and no acceptance is claimed before observation.
