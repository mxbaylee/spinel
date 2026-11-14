# SPN-090 — Startup story readiness repair

## 🔎 First hosted failure and diagnosis

Published source `27b87ff8767551fae03c163d2457744b31865ce3`, base
`ebf0842f51b60d54649cf8a03065914bec0944bf`, tested merge
`9a0537f7618f76bc64aa8b1addb41305daea202a` failed the
[Storybook phone/light job 132299208406](https://github.com/mxbaylee/spinel/actions/runs/43546428640/job/132299208406)
on attempt 1. The full catalog's only recorded failure was
`current-production-startup-status--slow-start`: its synchronous `getByRole('status')`
ran before the component's passive effect appended the production status line.
The later failure screenshot already shows the correct status. The failed verdict
is retained, not converted into a pass because the eventual image looked right.

The original manifest, diagnostic and full job log are retained here (large text is
gzipped). Artifact 14094840518's original ZIP SHA256 is
`a33f5064ddd948903387ab38da48654506f961b0f55102077bb91509faf70514`.
Its 14-day hosted retention supplements these maintained failure records.

## 🔧 Bounded repair and verification

The play function now awaits `findByRole('status')` with the existing default budget
before asserting the same exact text. No production render, effect, timeout, theme
or app startup behavior changes. Scope is one readiness query plus its evidence;
no new ticket or broad fixture workaround is needed.

Under the shared serial runner and unchanged normal-pressure, 2 GiB process-tree,
eight-minute watchdog, the focused production Storybook build passed in **3.532 s /
1,091,824 KiB** peak. The unchanged production `scripts/screenshots.ts` then reviewed
only this story in light/dark desktop, light/dark phone and tablet: **five states,
five captures, no failures**, **2.266 s / 637,136 KiB**. This is focused local evidence,
not a new full hosted catalog pass. The build retained the original main/preview
configuration and the same two-entry local catalog used earlier.

`receipts.json` binds the actual source hashes and guarded attempts; `local-visual/`
contains the production review manifest and five refreshed screenshots. The three
previously embedded startup light/dark/phone PNGs are **byte-identical** to the new
captures. Other original gallery sources/images are unchanged. The play-only source
change still requires both fresh exact-head reviews and visual applicability approval.
All hosted acceptance must run on the repaired candidate; previous-head successes
remain observations of that previous head, not its CI results.

After normal completion an explicit process scan found no remaining owned Storybook,
screenshot runner, port 6007 or current-worktree task processes. The changed story also passes the repository’s actual oxlint command. An initial
ESLint-path invocation failed before any lint ran; its MODULE_NOT_FOUND log and
receipt are retained. The package manifest supplied the corrected oxlint entry.
No failure rerun,
sleep-based assertion, broader timeout, retry or increased memory budget was used.

## 🧹 Earlier reviewer abort cleanup

Reviewer B's separate browser attempt on repaired source `34e512fb` was resource-aborted
at **6.897 s / 1,982,176 KiB**, yielding no browser verdict. A subsequent owned-process
audit found eight orphaned server/npm processes: five server PIDs occurred in that
attempt's log, all eight matched its start times and worktree, and parent/group records
identified the wrappers. B stopped those exact owned PIDs with SIGTERM and verified
no relevant processes remained. `review-b-prior-abort-cleanup.json` preserves the
chronology and ownership evidence. No browser rerun or unrelated kill occurred.

Shared runner process-group termination had missed detached descendants; future
aborts require an explicit owned-process audit. This record does not establish the
cause of later machine memory pressure. The original abort remains no verdict.
