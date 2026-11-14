# Native drawing registration validation

## ✅ Exact documentation outcome

PR #286 source **fa39c086e8df8a542c2703ffcc614dfc17afd030**, base
**a3dfc6f3373babecf979d5b851bbbf46c6dbb3b9**, passed all seven required gates
in CI **43561012171 attempt 1**. Actual tested merge
**551add784e77a6e5e2b88e4370e1fdf81d5706b4** and source share tree
**df98d78a59838e8e1a969feaa1a0deb2921e7bde**. Raw run, job, commit, required-check
and PR API payloads, plan and aggregate logs, original artifact ZIPs and decoded
result JSON are retained. Gzip files decode to the exact hosted payload bytes.

CI is terminal: **16 jobs, 8 success and 8 explicitly inapplicable workers skipped**.
Storybook **43561012177 attempt 1** is terminal: **8 jobs, 3 success and 5 skipped**.
`validation-summary.json` identifies every required gate/job and the observations.
No retry, rerun, cancellation or source change occurred during this validation.

The complete opened-event plan contains the exact seven documentation/backlog
paths and selects only **backlog, pull-request and lint**. The twelve other suite
entries are explicitly inapplicable. Unit, Lib and browser result artifacts each
report `passed: true`, embed the identical plan and bind its canonical digest.
Their results demonstrate applicability and selected gate completion; they do not
claim application suites ran. Typecheck's compiler/install steps and Storybook's
actual build are skipped; their documentation-only steps pass. Storybook's viewport
aggregate accepts the explicit skipped variants. There are no Storybook artifacts
for this documentation-only run. This is registration acceptance, not SPN-158/159
runtime acceptance; both product outcomes and SPN-120 remain open.

## 🧾 Artifact and review identity

The canonical plan digest is
`53b073fb6201b195a8722e7a17af230282ac1381a4bb5cc5d638e91115fdde17`.
The raw retained plan file digest, including serialization/newline, is
`625b1caacadb9b2a840f7b66e361085276a401217d835e905b850cfb372b2958`.
The plan artifact14100435624 and result artifacts14099778660/14099563811/14099054869
have independently computed ZIP hashes matching their GitHub API digest fields;
full hashes, byte counts and names are in `validation-summary.json`. `manifest.json`
binds stored payload bytes and separately decoded gzip/ZIP contents.

Independent nonimplementing reviewers A and B each graded the complete exact
fa39 candidate **100/100**, rubric **35/25/20/10/10**, with no unresolved findings.
Their actual final reports are in `local/`. Earlier A dfd7 review/finding, original
B report and check receipts are retained. The finding concerned wording that could
imply the full original failure ZIP was committed: fa39 explicitly distinguishes
local/expiring hosted ZIP from durable extracted evidence plus digest. The original
SPN-120 failure archive is commit4bd84e3be7645a3b18c794c966e0007e6770cc9c;
its unknown failed assertion/phase and cause remain unknown. No historical grade
was used as this candidate's review evidence. Agent review only; no UI design change.

CLI allocation159, initial and integrated index/backlog checks, implementer and
reviewer PR checks, and link-verification evidence are retained. The initial wrong
`scripts/backlog.ts` invocation failed before backlog work; the corrected
`scripts/backlog/cli.ts index` passed. No failed invocation is labeled a pass.
Integrated index/backlog completed in172/149ms, below the first memory sample;
zero recorded peak means unmeasured. Exact fa39 PR check passed399ms/186960KiB.
Existing ticket-length warnings remain guidance. Checks used pinned Node26.13.0,
shared serial/watchdog and normal pressure; no resource abort is reported.

This focused registration preserves SPN149's main removal/completion, full-groom
date2026-11-12, completion list148/145/149 and next ID160. It does not append a
completed product ticket or reset the grooming counter. The full diff and allocation
provenance are retained. The open-PR audit found no Dependabot PRs.

## 🔒 Archive and completion boundary

This is an evidence-only direct child of fa39, adding only files beneath
`docs/review-assets/native-drawing-registration-fa39c086/`. It does not move the
reviewed PR branch. Local report checkout prefixes are normalized; original and
stored hashes are retained in `local/original-hashes.json`. Hosted payloads are
unchanged after decompression. The content audit checked stored/decoded text for
credential/private-key patterns and unnecessary personal checkout prefixes; no
matches were found. No user document, database, profile or cookie store is included.

The original published PR body is retained with its conditional archive links.
Pending language in that body/reviewer preparation packet describes the earlier
checkpoint; terminal facts are in this README and validation-summary.json.
**Merge and cleanup are not performed or claimed here.** The manager verifies and
publishes this archive before the final merge guard. Completion evidence belongs
in the separate reserved archive only after actual squash and guarded cleanup.
