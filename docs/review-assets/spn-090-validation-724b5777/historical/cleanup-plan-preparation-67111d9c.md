# SPN-090 post-merge preservation and branch cleanup proposal

## 🔒 Status and boundary

Prepared read-only against candidate `67111d9c106c6518b813c6f1cf332068526c254c`,
remote main `ebf0842f51b60d54649cf8a03065914bec0944bf`. Local archive commit object `bc92bbc5948a1e57bb9955bf9887484466929547` has now been
prepared with parent `67111d9c…`; its manifest is `/tmp/spn090-cleanup-archive-commit.json`.
No archive tag or branch was created. Nothing has been published, detached, reset,
deleted or force-pushed. Existing dirty files were not
modified. Recheck all identities, active PR ownership and archive availability after
the verified squash merge and before each mutation; changed heads stop that step.

Only PR #224 currently owns an SPN-090 branch: `codex/spn-090-real-devices` at
`67111d9c106c6518b813c6f1cf332068526c254c`. Full open-PR inventory had 12 PRs;
none owns the production/current integration branches. Unrelated worktrees/refs,
including SPN-157 and SPN-098, are outside this cleanup.

## 📦 Unique work and preservation

1. Original local branch `codex/spn-090-real-devices` is actually at
   `7ffab5330689abc0f79c2285b37f374bbc5483d5`, not the remote PR head. It has one
   unique committed provider-ledger change, 4 modified tracked files and 6 untracked
   capability/ledger helpers/validation records. No current remote archive tag contains
   this commit. Preserve exact history with proposed tag
   `archive/spn-090-original-local-7ffab533` at that exact commit.
2. Local `codex/spn-090-production-integration` is at
   `9608f78348ab014295cd7b604da4299e3a1ac230` with three unique commits:
   `c5f0c1d05844d8c60568883a048c691020e01ba4`,
   `c43a328a6a68d8ad515b205b0d4dd019b3bf7b88`, and `9608f783…`.
   These are the explicitly superseded stale-head integration, review/test evidence
   and reduced-provider experiment; they must not be restored as current acceptance.
   Preserve exact history with proposed tag
   `archive/spn-090-superseded-integration-9608f783` at `9608f783…`.
   Three untracked build identity/graph/result JSONs also need the snapshot below.
3. Current `codex/spn-090-current-integration` is at `67111d9c…`, identical to the
   published PR head. It has one untracked capture helper. Preserve that helper and
   the exact candidate identity in the snapshot before deleting the branch after merge.
4. Remote `codex/spn-090-production-integration` is at
   `5265ab8d26c7c607bef189a1fd720f8bd28d6584`, an ancestor of the candidate and of
   multiple verified durable archive tags, including
   `archive/spn-090-renderer-publication-5265ab8d` (`c28ac406…`) and
   `archive/spn-090-renderer-outcome-5265ab8d` (`69ca02bb…`). No new snapshot of its
   committed source is required; reverify those remote tags before deletion.

Private original-byte backups already exist at
`/Users/mxbaylee/.codex/archives/spn-090-preservation-67111d9c/` (directory mode700).
`manifest.json` records paths, exact heads, modes, sizes and SHA256 values. It contains
10 original dirty/untracked files, the 3 stale build JSONs, current capture helper,
full-index binary tracked/index patches, and a separate **private-only** snapshot of
current synthetic SQLite/session fixtures. Hash comparison and before/after git status
confirmed that preservation did not alter the worktrees. Generated node_modules/dist/
Storybook outputs are reproducible; relevant output identity/graph/capture evidence is
preserved separately. Do not publish the SQLite fixtures or private absolute-path manifest.

The curated publication proposal is `/tmp/spn090-cleanup-publication/`: 11 files,
513,663 bytes before its manifest, comprising the original tracked patch, six untracked
helpers/validation files, three build JSONs and current capture helper. Its relative-path
manifest binds their bytes. No database, cookie store or unrelated data is included.
A manual review of credential-bearing lines found runtime parameters/header construction
or explicit synthetic negative-test strings (`private-token`, `SECRET`, etc.); scans found
no live credential literal, private key, recognizable GitHub token, real document content
or unnecessary personal absolute path in this curated set. Historical source scans also
found no private-key/GitHub-token/personal-path match in the inspected differing source
blobs. This is an audit of this proposal, not a guarantee about unrelated repo history.

After manager review, publish this curated snapshot on an immutable archive commit/tag,
for example `archive/spn-090-preservation-67111d9c`, with parent `67111d9c…` and a
clearly historical-only README. Do not merge the obsolete provider helpers into main.
Link that immutable record and the two unique-head archive tags in maintained final PR
completion evidence. Check remote tag targets and file hashes before any branch deletion.
Existing 16 `archive/spn-090-*` tags were verified on the remote and must remain: they
are immutable historical evidence, not obsolete implementation branches.

## 🧹 Exact guarded branch completion

After the verified squash merge, current acceptance and archive publication:

- Recheck the PR is merged at the intended source and none of the candidate refs is
  owned by another active PR/chat. Recheck each worktree HEAD and dirty-file hashes.
- Detach the three SPN-090 worktrees at their own current exact commits before local
  branch deletion. For the original dirty checkout, detaching at the **same** commit
  preserves all files; verify its status and hashes remain identical. Keep that detached
  checkout intact rather than force-removing the user's preserved dirty work. Current
  and superseded worktrees may likewise remain detached until their owning tasks end.
- Delete local refs with `git update-ref -d <ref> <expected-sha>` only after detachment:
  `refs/heads/codex/spn-090-real-devices` → `7ffab5330689abc0f79c2285b37f374bbc5483d5`;
  `refs/heads/codex/spn-090-production-integration` → `9608f78348ab014295cd7b604da4299e3a1ac230`;
  `refs/heads/codex/spn-090-current-integration` → `67111d9c106c6518b813c6f1cf332068526c254c`.
- Delete the two remote implementation refs with exact leases, after fresh ls-remote:
  `refs/heads/codex/spn-090-real-devices` → `67111d9c106c6518b813c6f1cf332068526c254c`
  (or record already deleted by merge), and
  `refs/heads/codex/spn-090-production-integration` → `5265ab8d26c7c607bef189a1fd720f8bd28d6584`.
  Use `git push --force-with-lease=<ref>:<expected> origin :<ref>`; this is a guarded
  deletion, not permission to overwrite a changed branch. Remove matching local
  remote-tracking refs with their own expected-SHA guards after remote verification.
- Re-enumerate refs and active PRs, record each deleted/already-absent/preserved/access-blocked
  result and exact archive targets. Do not claim cleanup complete if any intended ref
  remains because of changed ownership, changed head or access failure.

**Explicit exclusion:** `ci/browserstack-accounting` currently points to
`48954214ebeb9183a64a2276a7e8095313c5d0cc`. It is an operational hosted resource governed
by SPN-151 and its per-deletion owner approval rule. Preserve it; this branch cleanup
is not that approval. The historical proposed `codex/browserstack-lifetime-ledger`
branch was not present in the remote inventory. No provider resources or credentials
are deleted or used by this plan.
