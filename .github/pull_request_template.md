<!--
Title: "<ticket emoji> SPN-NNN <ticket title>", e.g. "🪞 SPN-012 Restore a document from yesterday's checkpoint".
Grooming PRs start "🧹 Groom backlog"; dependency bumps start "⬆️ Bump". CI checks all of this.
-->

## What landed

## How it was verified

Checks and evidence for the current head; disclose any missing real-device or external evidence.

## Designs and screenshots

For a UI change, add `visual-review` and embed all proposed designs and actual
current light/dark/phone screenshots of each affected screen here or in the PR
conversation. Use sample data and commit-pinned embeds or attachments; CI artifact
links supplement the visible evidence. Name the source commit and affected states.
An independent nonimplementing subagent must inspect the images against
`docs/design/`, theme tokens and all four personas. Record the reviewer, findings,
repairs and visual approval at the reviewed SHA; disclose **agent review only**.
No human sign-off is required. A grading reviewer can also perform visual review.
For a nonvisual change, explain "No UI change".

## Independent review

Two independent nonimplementing subagents, each scoring above 95/100 on the same
current commit. Record each reviewer, individual score, reviewed SHA and
rubric/deductions; do not average scores. Neither review may have unresolved
blockers. List each finding as fixed, linked to a follow-up ticket with the scope
reason, or accepted as non-actionable with why. Record both reviewers' revalidation
after changes; do not replace an acceptance gap with a follow-up.

## Split out and decided

Changed-line count using backlog exclusions; scope/size reason for any split.
New or existing tickets for separate work. Persona decisions and their canonical implementation records.

## Run checkpoint

For an ongoing backlog run: merged tickets/PRs; branch, SHA and local path;
unpushed work; review/check status; execution prerequisites and decision links; next action.
No secrets. Update before an interruption and after merging.
