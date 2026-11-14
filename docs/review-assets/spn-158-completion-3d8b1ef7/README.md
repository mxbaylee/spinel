# SPN-158 completion and guarded cleanup

## ✅ Verified squash and acceptance

[PR #285](https://github.com/mxbaylee/spinel/pull/285) merged at **2026-11-14
06:27:12 UTC** as `b1b18165543ed800c0847a63201504c90c46272c`.
Reviewed/published source was `3d8b1ef775b0a71ec4e1512a0cca3b033f2c41bb`,
actual base `ecef3c6d6ea5093bdd9fcf7c0a69c5e5218b4a6f`, tested merge
`6506eeebf195a4f53e15212584892fa9f9bbb818`. Source, tested merge and actual squash
have the same tree: `43f29c59840828ab89b62840a2537707a7901c1d`.
The retained merged API, squash commit and main ref verify this outcome.

[Immutable validation](https://github.com/mxbaylee/spinel/tree/3309b88a08f3a4bb29020cb7f0a803c8e0f61e65/docs/review-assets/spn-158-validation-3d8b1ef7)
was independently verified and published before the guarded merge. All seven gates
and selected executed owners passed:47 terminal jobs,45 success and two expected
draft Storybook publication/deployment skips. Fresh Linux recovery passed609/609,
including the complete postcommit SIGKILL case; the integrated revocation case
passed first attempt. Both exact-head reviews and their own controls are retained.
This completion archive is directly parented by that validation commit.

The manager's retained audit verified115 stored and104 decoded payloads, all three
coverage bindings, source/tested identities and actual Linux evidence. Its initial
read-only audit lacked the local tested-merge object; fetching the unchanged PR
merge ref supplied it, then verification completed before publication. That setup
correction was neither a runtime failure nor an unverified publication.

## 🧹 Guarded ticket-only branch cleanup

Fresh post-merge inventory verified exact local source head3d8, a clean worktree,
remote validation tags, and no active PR using the implementation branch as either
head or base. Complete branch enumeration corrected an initial glob that omitted
slash-nested refs before any mutation. Only these obsolete refs were removed:

- `refs/heads/codex/spn-158-restore-admission`, using expected old SHA3d8.
- `refs/remotes/origin/codex/spn-158-restore-admission`, using the same expected-SHA guard.

The remote implementation branch was already absent in the first post-merge
inventory. No remote deletion push was performed and its deletion actor is not
inferred. The clean implementation worktree was first detached at3d8; the worktree,
source files and linked dependencies remain intact. No unrelated ref or file was
removed. Final inventory found no remaining SPN-158 implementation/tracking branch
or remote ticket branch; there was no access-blocked cleanup.

Unique source history remains reachable through published validation3309b88,
whose direct parent is3d8. The earlier failed validation0cadd remains published
under its original tag. Both tags were rechecked after cleanup and retained
unchanged. The separate completion tag is published by the manager after verifying
this sealed object; its existence is the durable completion entry point.

## 🔎 Preserved limits

The original authentication-options503 cause remains unproved, and prior bfeb's
failed revocation gate remains failed historical evidence. Current combined-source
acceptance does not rewrite those results. SPN-090 and SPN-120 retain their own
integrated acceptance; SPN-120 retains159, while SPN-157 retains its complete L and
SPN-160 prerequisite. Next-ticket selection belongs to a fresh current-main read.

No source or PR-body mutation, local test/build workload, deployment or worktree
removal occurred during this cleanup. `manifest.json` hashes the exact retained
API, inventory, actions and independent-manager audit files.
