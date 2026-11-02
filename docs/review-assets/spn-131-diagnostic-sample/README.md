# SPN-131 bounded diagnostic sample

Source `7a168ca63a37d39c368fe4c747a2e3c7bc4b00a6`, base
`1fca8a98c315d2f715e8051537e50f2efbbe580b`, tested merge
`b6a7175569d976ece73372f3e2d02fb647750c00`. The exact immutable-range
plan is retained as JSON and its downloaded ZIP (SHA-256
`5f071eceb47b7d1f6509cbaa530428dea3946bbcb0c90ace7f13e86575fae434`).

Declared one ordinary first-attempt CI event 41463712789 and its ordinary
Storybook event 41463712935; neither was retried. CI completed with 31 successful
jobs and two failures: the expected unfinished-ticket Pull request policy check,
and Playwright smoke's aggregate refusal to accept that failed prerequisite.
All selected workload workers passed. Storybook completed successfully; its two
inapplicable publishing jobs were skipped. Complete job lists include steps and
installation/workload/cleanup outcomes, with page count verified against total.

All 24 helper invocations (19 CI, five Storybook) captured the same original
144-byte public configuration with SHA-256
`e0d6b0af979e4662d16357a27ae456cc6f21e26da031540f4df8706ebed1d583`.
Every helper transformed the known pair and its installation step succeeded.
`mirror-observations.json` reconstructs the original bytes and verifies their
hash against each log. The validator is retained. No rejected profile was seen.

Raw runner headers report Azure Ubuntu 24.04.5 image `20261025.353.1`; the
separate environment fields report `ImageOS=ubuntu24`, `ImageVersion=20261026.354.1`.
Both observations are retained without choosing an invented reconciliation.
The earlier PR236 rejected job 125336656796 reported AWS image `20261018.96.1`;
its complete original failure log is included, but its mirror file was not
captured. Provider/image correlation does not establish the rejected contents
or cause. Attempts to read the two header-linked image refs from
actions/runner-images returned 404, so no version-specific source claim is made.

The two privacy/fidelity controls passed on diagnostic source; 11 further actual
CLI controls (13 total with those two) passed locally before their next commit.
The latter were not part of this hosted sample. Logs retain every executed local
attempt. The CLI controls use an OS-boundary stub, never sudo or the host file.

Log excerpts preserve raw runner headers and the complete helper input/output;
one representative job has its full log. Job metadata proves the downstream
steps' outcomes. This is setup evidence, not a complete archive of browser traces
or all workload reports. Supplementary Actions artifacts retain their own expiry.
The original ticket is preserved verbatim. The sample validates the known profile
and safe logging; it neither explains nor repairs prior rejections. The separately
registered SPN-136 retains the complete unresolved diagnosis/repair/proof outcome.
