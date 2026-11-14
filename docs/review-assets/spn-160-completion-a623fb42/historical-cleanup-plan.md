# 🧹 SPN-160 guarded completion plan

This is a read-only inventory, not completed cleanup. Current sole SPN-160 branch is
`codex/spn-160-first-failure`, local head `a33d96672c9cb3b24b6b41de154587406fc8d504`,
clean checkout `/Users/mxbaylee/projects/spinel-spn-160`. No remote implementation,
review, integration or evidence helper ref currently matches SPN-160, and no open
PR currently owns it. `cleanup-inventory.json` retains observation time and exact
heads; all identities must be refreshed after actual publication/merge.

## Preservation and authorized future sequence

1. Verify the actual merged PR, squash SHA and reviewed/tested/merged tree identities.
2. Re-enumerate all SPN-160-created refs and open PR head ownership. Do not infer
   obsolescence solely from a branch name. Recheck clean/dirty worktree state.
3. Publish and independently verify the final immutable validation/evidence archive,
   preserving the complete final candidate ancestry and every unique implementation/
   evidence commit. Current branch has eight commits outside squash-base history,
   including the original registration commit; registration provenance is also
   retained separately. An archive rooted at the final source preserves ancestry,
   but verify each unique commit before deleting refs.
4. Detach the clean SPN-160 worktree at its exact final source; retain all files and
   dependency symlink. Delete only obsolete ticket-owned local refs with exact old-
   head guards. If the remote branch remains, delete with its exact expected-head
   lease after proving no active PR owns it; otherwise record automatic absence.
5. Recheck and remove only obsolete SPN-160 remote-tracking refs with head guards.
   Verify preservation tags and final inventories. Record any blocked deletion and
   access prerequisite; do not claim cleanup complete if a ref remains unexplained.
6. Preserve actual merge and cleanup receipts in the reserved completion archive as
   a child of final validation evidence, and publish only after verification.

**Keep `codex/spn-157-supervisor-handoffs` at `44f9a536` untouched.** Its original
incomplete-L implementation/check/review history and remaining recovery work belong
to SPN-157. No SPN-098, SPN-158/159, registration, shared dependency or other refs are
part of this cleanup. No checkout removal, force reset, public deployment or remote
mutation has been performed by this preparation.
