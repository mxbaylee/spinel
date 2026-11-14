# 🧹 Proposed exact cleanup — not executed

Run each step only after root's independent verification. Stop if any identity or active ownership differs. Commands target only SPN-159 refs; ignored worktree content remains untouched.

```sh
# Fresh ownership: must return true for an empty active-PR list.
gh api 'repos/mxbaylee/spinel/pulls?state=open&head=mxbaylee:codex/spn-159-native-resize' --jq 'length == 0'
# Must show validation tag ed5b4919 and no implementation branch.
git -C /Users/mxbaylee/projects/spinel ls-remote origin refs/heads/codex/spn-159-native-resize refs/tags/archive/spn-159-validation-88b24d96-20261114
# Recheck detached88 and clean tracked state before ref removal.
git -C /Users/mxbaylee/projects/spinel-spn159 status --short
git -C /Users/mxbaylee/projects/spinel-spn159 rev-parse HEAD
git -C /Users/mxbaylee/projects/spinel worktree list --porcelain
# Compare-and-delete only if each ref still has the reviewed exact value.
git -C /Users/mxbaylee/projects/spinel update-ref -d refs/heads/codex/spn-159-native-resize 88b24d96a65cdb92712c94674399a86b129c57b3
git -C /Users/mxbaylee/projects/spinel update-ref -d refs/remotes/origin/codex/spn-159-native-resize 88b24d96a65cdb92712c94674399a86b129c57b3
# Optional published validation helper cleanup: recheck clean/detacheded5b.
git -C /Users/mxbaylee/projects/spinel-spn159-validation-archive status --short --ignored
git -C /Users/mxbaylee/projects/spinel-spn159-validation-archive rev-parse HEAD
git -C /Users/mxbaylee/projects/spinel worktree remove /Users/mxbaylee/projects/spinel-spn159-validation-archive
# Capture post-cleanup exact refs and preserved worktrees for final completion.
git -C /Users/mxbaylee/projects/spinel for-each-ref --format='%(refname) %(objectname)' refs/heads/codex/spn-159-native-resize refs/remotes/origin/codex/spn-159-native-resize
git -C /Users/mxbaylee/projects/spinel worktree list --porcelain
```

No remote deletion: the remote implementation branch was already absent in the fresh post-merge inventory. Do not delete archive tags, remove the implementation/registration worktrees, modify their ignored content, run `git clean`, or prune unrelated worktrees. After root publishes and verifies the final completion tag, its clean detached helper can also be removed with ordinary `git worktree remove` using its exact path; that later action is not claimed here.
