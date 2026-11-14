# 🧹 Guarded SPN-157 cleanup plan for root

Observed after PR291 squash merge `78fc73bbb05ee5cab9d5a6731ae42227d2c0aaef`.
This file is a plan; none of these commands was executed by the collector.

Before execution, refresh live remote refs and open PRs, matching both HEAD and BASE
ownership. Require the two published archive tags to retain exact old44 and
validation25c3a8f0 (whose direct parent is f59). Require no active PR to own either
implementation branch, no new worktree attachment, clean tracked source, current
worktree HEAD exactly f59 and the three local refs at the expected heads below.
There is no local branch configuration to remove; a newly appearing configuration
or changed head requires reinspection.

Preserve the implementation worktree and every ignored file by detaching at its
current commit. The only current ignored entry is the `node_modules` symlink to
`/Users/mxbaylee/projects/spinel-spn-098-production/node_modules`; retain it and its
shared target. No archive helper worktree was created.

```text
git -C /Users/mxbaylee/projects/spinel-spn-157 switch --detach f59d23ceae976ee0abdd25eb13f370e18d7d6495
```

Recheck that this worktree is detached at f59 and no worktree owns either branch.
Then use atomic compare-and-delete for exactly these refs:

```text
git -C /Users/mxbaylee/projects/spinel update-ref -d refs/heads/codex/spn-157-current-investigation f59d23ceae976ee0abdd25eb13f370e18d7d6495
git -C /Users/mxbaylee/projects/spinel update-ref -d refs/heads/codex/spn-157-supervisor-handoffs 44f9a5365fe290236b882606933e63b8ef317363
git -C /Users/mxbaylee/projects/spinel update-ref -d refs/remotes/origin/codex/spn-157-current-investigation f59d23ceae976ee0abdd25eb13f370e18d7d6495
```

The remote implementation branch is already absent; no remote deletion is needed.
The origin-tracking ref above is stale local state. Preserve the two published
archive tags and record their exact live targets. Keep the detached worktree;
record post-cleanup refs, ownership, configuration, clean tracked state and unchanged
ignored symlink in the completion receipt. No tests, builds or PR metadata change
are part of this cleanup.
