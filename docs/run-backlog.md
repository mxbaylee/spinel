# Run the Spinel backlog

Say **“Read `docs/run-backlog.md` and start working.”** This invokes the loop below:
build one ticket, independently verify it, repair or split findings, open its PR,
wait for CI, squash-merge, and choose the next ticket. Continue without asking for
permission between those steps. A request to read, review or edit this document
alone does not start a run.

The owner authorized this workflow in chat on 2026-10-17 (SPN-037). Invoking it
authorizes repository changes, decision records, follow-up tickets, PRs and
squash merges that meet these gates. It does not waive actual acceptance evidence, repository protection, or separate permission
needed for deployment, spending, credentials or destructive operations. A narrower
instruction from the owner, such as “one ticket” or “do not merge,” takes precedence.

This is an active-session workflow, not a scheduler. Continue through context
compaction, but do not promise to keep executing after the session or service
stops. Use the checkpoint below before reaching an execution limit when possible.

## 1. Pick from current main

Read [process.md](todo/process.md), [personas](product/personas.md), the generated
[index](todo/readme.md), and the actual code. Fetch `origin/main`; preserve the owner's
uncommitted work and inspect existing branches/PRs before creating duplicates.
Resume a relevant unfinished PR first, rechecking its evidence against its head.
Otherwise branch from current `main`, using `codex/<ticket-and-topic>`.

Aim for two open ticket PRs in this run as a soft target, not a hard limit.
Prefer finishing existing PRs before opening more; exceptions may be useful when
independent work can proceed. Do not automatically close existing PRs to reach
the target. Owner, chat 2026-10-23,
[decision](implementation/backlog-workflow.md#soft-target-for-open-ticket-prs).

Take the highest-ranked eligible ticket in the earliest remaining lifecycle
phase: `pre_launch`, then `launch`, then `post_launch`. If that phase is blocked,
record the blocker and wait; do not advance to a later phase. The generated index
orders phases before scores, making SPN-038 the last launch prerequisite and
keeping optional CSV import (SPN-093) and document-type/converter plugins
(SPN-094) after it. Their explicit launch dependencies record owner sequencing,
not a technical need for public HTTPS. Owner, chat 2026-10-21; fixed lifecycle
phases recorded in [decision #129](implementation/backlog-workflow.md#legacy-decision-129-fixed-lifecycle-phases).
After each merge, fetch main and pick again; do not preselect a fixed queue. An
explicit owner-requested ticket takes priority for that run. Seven completed
tickets trigger only a reminder for the next requested grooming.
Continue eligible work; never force grooming or block landing because of the
count. Owner, chat 2026-10-22.

Agents make decisions using all four personas and record their rationale. No human
product/design/screenshot sign-off is required. Use `visual-review` for affected
screens and embed all proposed designs and actual current light/dark/phone images
on the PR. An independent nonimplementing subagent reviews those images against
the playbook/theme and personas, records findings and approval at the reviewed SHA,
and discloses **agent review only**. A grading reviewer may do this review too.
The label alone does not grant approval; unrelated PRs retain rendering/interaction
checks without routine captures. See the [standing policy](implementation/grooming-2026-10-26.md#agent-decisions-and-visual-review).
Publishing useful PR images is already authorized, including attachments and
durable repository-hosted images on public PRs. Choose representative images
covering the proposed designs, changed states and required light/dark/phone views;
omit redundant captures and retain complete CI artifacts as supplementary evidence.
Do not pause for separate image-publication permission. See the owner's
[standing image permission](implementation/grooming-2026-10-26.md#standing-permission-to-publish-pr-images).
If real-device evidence, upstream compatibility or authorized external access is
unavailable, finish all independent work and save the concrete prerequisite,
evidence and next action in the ticket Rules and PR checkpoint. Work the next
eligible ticket while that capability is unavailable; never invent a test pass.
Keep a run-local list of blocked tickets and reasons so picking does not repeatedly
select the same blocked item. Do not change product dependencies merely to hide
an external blocker. Reconsider it when new input or evidence arrives.

## 2. Implement one ticket

Check the original ticket against the code and preserve its acceptance criteria
for review. Weigh the Operator, Owner, Collaborator and Link guest in every
decision; record decisions as process.md requires. Build the smallest complete
change that satisfies the ticket, including meaningful tests and maintained docs.

Reassess effort when implementation reveals more complexity. Use **XL** for
sustained algorithmic or architectural investigation and verification, including
work with a small diff; elapsed time alone does not assign a size. Record the
reason in the ticket and regenerate the index. XL retains the normal split and
review gates below. Owner, chat 2026-10-21.

Validate typecheck, lint, backlog, unit tests and the verification required by the
ticket, including browser tests for changed user flows. CI may be the default:
draft pushes do not require successful local checks first. Use the pinned Node
version. Fix failures; never weaken checks to obtain a pass. Do not repeat
unaffected checks without a reason.

Protect the owner's computer while doing this work. On the 8 GiB development
Mac, run only one local test, build, browser, or soak workload at a time across
all agents. Stop unused task-owned preview servers first. Check system memory
pressure before launching and monitor the workload's process tree while it runs;
defer if pressure is elevated, and terminate only that workload if pressure rises
or its combined resident memory exceeds 2 GiB. On macOS,
`sysctl -n kern.memorystatus_vm_pressure_level` must report `1` (normal). Never
terminate the owner's apps or count a resource-aborted check as passing. Save a
checkpoint before long work, and record any aborted verification and the next
safe step. Owner, chat
2026-10-18, after a memory-induced forced pause stalled the backlog run.
`node scripts/serial.ts <command>` serializes commands using its shared lock,
checks macOS memory pressure once before startup, and kills the command's
process group after 8 minutes, for example
`node scripts/serial.ts npx vitest run lib/sync-transform/tests/cells.test.ts`.
The runtime pressure and combined process-tree resident-memory monitoring
required above remain the agent's responsibility; the runner does not poll
either or enforce the 2 GiB limit.

The owner permits and prefers CI when convenient, including for typecheck, lint
and backlog checks. This is always available, not conditional on a watchdog abort.
Keep the PR draft until verified and record deferred or resource-aborted local
checks honestly. All seven required CI gates, two independent scores each above
95 on the same current commit with no blockers, and the other merge gates still
apply. This changes where validation runs, not acceptance, and does not authorize
paid test hosts. Owner, chat
2026-10-23, [decision](implementation/backlog-workflow.md#ci-as-the-default-validation-environment),
superseding the local prerequisite in the earlier
[decision #52](implementation/backlog-workflow.md#legacy-decision-52-memory-watchdog-ci-first-exception).

Prepare the landing changes in the same PR: preserve Rules in maintained docs,
delete only this completed ticket, remove its ID from dependents' `depends_on`,
append its ID to `grooming.completed_since`, and run `npm run backlog:index`.
Run the PR checker against `origin/main` with the ticket's exact heading as title.
Do not call the ticket landed until GitHub confirms the merge.

## 3. Get two independent grades

Use two subagents that did not implement the change, preferably with fresh context.
Give each the original ticket from the base branch, the full diff, relevant docs,
all four personas, and reproducible test/CI evidence. Ask each to inspect the code
and independently verify important outcomes; passing checks alone are not review.
Give neither a prior grade, the other reviewer's score, or a desired result.
Reviewers may share concrete findings and evidence, but each assesses the full
rubric and issues their own grade. Review is read-only; the implementing agent
owns fixes. If either independent review is unavailable, keep the PR unmerged.

Ask each reviewer for a score out of 100 using this rubric:

- **35:** ticket scope and acceptance criteria.
- **25:** correctness, data integrity and access boundaries.
- **20:** meaningful regression protection and verification evidence.
- **10:** CI and operational usability appropriate to the ticket.
- **10:** maintainability, documentation, backlog/process consistency and
  **over-complexity**: unnecessary abstractions, dependencies or speculative
  flexibility. Prefer the smallest complete implementation that meets the ticket;
  deduct for avoidable complexity with an actionable simplification, not for
  necessary safeguards. Owner, chat 2026-10-20, decision
  [#105](implementation/backlog-workflow.md#legacy-decision-105-deduct-unnecessary-complexity).

Apply the rubric proportionally: for documentation work, verify instructions and
scenarios rather than inventing runtime features. Require concrete deductions,
file/line references where relevant, reproduction evidence, severity, and a
recommended fix or follow-up scope. Do not deduct for a feature the ticket
explicitly defers, but do deduct if the delivered slice is unsafe or incomplete.

The merge gate is **two independent scores each above 95/100 on the same current
commit AND no unresolved blocking findings in either review**. Exactly 95 does
not pass. An average, an older commit's grade, or a single review does not satisfy
it. Record both reviewers, their individual scores and rubrics, the shared reviewed
commit SHA, deductions and each finding's disposition in the PR. Review uncommitted
work only provisionally; tie both final assessments to the committed diff.
Owner, chat 2026-10-26; [decision](implementation/backlog-workflow.md#two-independent-grades-on-the-same-commit).

## 4. Fix here or file separately

Before substantial implementation, assess the whole accepted outcome and its
integration/verification boundaries. Record the first capability or architecture
checkpoint and revise effort immediately when evidence changes it. A split must
show the completed slice and every remaining obligation/estimate, distinguishing
retained acceptance, new approved scope, independent defects and future
maintenance. Closing the parent is not completion of those follow-ups; do not
add ordinal sizes or count a shared migration repeatedly. See the
[scope-growth decision](implementation/grooming-2026-10-29.md#scope-growth-and-outcome-accounting).

Use overlap with the ticket first, then changed-line count and reviewability.
Count additions plus deletions relative to the current base, applying the
exclusions and limits in base-branch `backlog.json`; do not use raw lockfile size.
The PR checker applies those rules. Estimate the repair's additional lines before
choosing a split, and record actual counts in the PR after the repair.

- **Fix here:** a missing acceptance criterion, regression introduced by this PR,
  unsafe data/access behavior, or test/documentation gap needed to prove the
  ticket. These findings overlap directly, even when the repair is substantial.
- **File separately:** a distinct capability, unrelated cleanup, or independently
  useful improvement that the current ticket can safely ship without. Reuse an
  existing ticket if it already covers the same observable outcome; otherwise
  allocate an ID with `npm run backlog:new`. Include the evidence, acceptance
  scenario, verification, affected personas and originating ticket/PR.
- **Split a large related change:** above the configured soft limit (currently
  10,000 changed lines), or roughly three days of work, reassess the boundary.
  Keep a coherent, fully verified slice and move a separable outcome to its own
  ticket. The hard limit is currently 100,000 lines. Effort-S exemptions are read
  from the base ticket; do not relabel a ticket merely to evade a limit. Small
  unrelated work still belongs elsewhere; a large inseparable fix is not safely
  deferred just because it is large.

If a required fix cannot fit a safe slice, keep the current PR unmerged and split
or sequence the work. Do not delete an acceptance requirement merely to improve
the grade. Make any genuine scope revision explicit, retain the original spec in
the review evidence, and record why each remainder can ship separately. A dependent
follow-up may name the current ticket only while that ticket is still open; remove
completed dependency IDs when landing, keeping provenance in the ticket body.

If either score is 95 or below, implement the appropriate repairs or scoped split
and send the revised change and finding dispositions back to both independent
reviewers. Repeat until the gate is met or an actual blocker/limit requires a
checkpoint. Filing a ticket
alone does not resolve an in-scope blocker or erase a deduction. Both reviewers must
assess the resulting slice. Do not shop for a more generous reviewer or round up.

Even when both scores are above 95, fix or ticket any remaining actionable finding
according to the same scope rules; a non-actionable observation may be explicitly accepted with
its reason. All blockers still prevent merging, regardless of the numerical score.

New tickets must exist on `main` before their implementation PRs can land. File
follow-ups with the current ticket PR whenever possible. If there is no such PR,
register them in a backlog maintenance PR with the grooming title, then implement
them on new branches after it merges. Preserve the counter/date unless a full
requested grooming is complete. Never bypass
the checker or reuse an ID to avoid this prerequisite.

## 5. Publish, wait for CI, and merge

Open one PR with the exact ticket heading, both review grades, final behavior, evidence,
changed-line count and finding dispositions. A draft is appropriate while blocked;
mark it ready only when its acceptance criteria and both independent reviews are complete.
Publish early if helpful, but do not treat opening the PR as completing the ticket.

Keep necessary final evidence in the PR description or maintained repository
files: exact source/tested identities, current-head checks and attempts, both
reviews, measurements, useful images, failure/retry dispositions and any retained
limits. Link immutable evidence and preserve essential machine-readable results
before helper-branch cleanup or artifact expiry. Comments are supplementary;
an earlier pending checkpoint must not be the final merged summary. Clearly name
any expiring supplementary raw artifacts instead of calling summaries full traces.

Wait for all required checks on the current head to finish successfully. The
current set is **Backlog**, **Pull request**, **Lint**, **Typecheck**, **Unit tests**,
**Lib tests** and **Playwright smoke**, plus any added repository-required checks. Missing,
pending, cancelled, skipped or failed required checks do not count as a pass.
The required Lib tests aggregate must succeed: either every required library
partition passes, or successful classification explicitly finds no relevant
library change. A skipped partition is not itself a passing required check.
For an allowlisted documentation-only change, successful required jobs may
explicitly report application tests as not applicable; Backlog, Pull request
and Lint still validate the change. See the narrow path policy in
[process.md](todo/process.md#pull-requests-and-main) and decision [#121](implementation/backlog-workflow.md#legacy-decision-121-documentation-only-ci-applicability). Changes
to CI itself always require full validation.
Inspect failures, fix their causes, run the affected checks and the pre-push checks,
and push again. Retry a transient infrastructure failure only with evidence.

Fetch main before merging. If it advanced, update the branch and resolve conflicts,
then recheck the combined change and wait for fresh CI. Have both reviewers assess
material source, acceptance, test or workflow changes, including conflict fixes;
record both reviewers' revalidation of the new SHA even for a mechanically unchanged
rebase. Check both final grades and CI against the same head. Do not merge while required acceptance evidence, independent visual review,
a blocking review, or repository protection is unresolved.

Squash-merge using the verified head SHA as a guard (for example,
`gh pr merge <number> --squash --match-head-commit <reviewed-sha>`). Never use admin
bypass, force-push main, relax protection or dismiss a blocking review just to
continue. Where branch rules are not configured yet, still enforce this named
check list yourself and report the setup gap; no missing check is waived.

Confirm GitHub reports the PR merged and record its squash identity. Enumerate
all ticket-created implementation, review, integration and evidence branches;
recheck current heads, active PR ownership and unique work. Preserve necessary
code/evidence durably, then delete obsolete refs with a head guard. Automatic
deletion of only the PR head is insufficient. Preserve unrelated active branches;
record blocked deletions with exact refs and their access prerequisite rather
than claiming cleanup completed. The [cleanup decision](implementation/grooming-2026-10-29.md#evidence-and-branch-completion)
is part of completing a merged ticket.

Fetch and fast-forward local main when safe, then start again at step 1.
Keep progress updates brief: what landed, review score,
verification, what comes next, and any real execution prerequisite. Do not end the run just
because one ticket finished.

## 6. Stop with a useful checkpoint

Stop when the backlog is empty; every remaining ticket is blocked on input or an
external prerequisite; the owner asks to stop; or the available token, time or
execution budget cannot safely finish another step. A failing test or low grade
by itself is work to do, not a reason to stop. Do not claim that blocked tickets
are completed, and do not fabricate owner sign-off or long-running test evidence.

Before a foreseeable limit, save work on its ticket branch and, where possible,
push a draft PR after the required pre-push checks pass. If checks cannot pass,
preserve the local work and record that it has not been pushed. Never mark unfinished
work complete or merge it just to reach a stopping point. Keep useful worktrees.

Put a **Run checkpoint** in the current PR body when one exists, and in the chat's
final response. Include merged ticket IDs/PRs; current branch, head SHA and local
path; dirty/unpushed work; last review scores and unresolved findings; exact checks
passed/failed/pending; blocked tickets with decision links; and the next concrete
action. No secrets. Update the checkpoint after each merged ticket in the PR body
so an abrupt interruption still leaves a useful trail.

Resume with **“Read `docs/run-backlog.md` and continue from the checkpoint.”** Verify
repository/PR state afresh before trusting saved status, then re-enter the loop.
The workflow continues within available execution capacity; it cannot guarantee
an entire backlog will finish in one chat or survive an abrupt limit automatically.

## Why these gates

The owner chose independent review, the original 95% threshold, CI-gated merges and
continued backlog execution on 2026-10-17 (SPN-037), then required two independent
scores each above 95 on the same commit on 2026-10-26 after a second SPN-057 review
found a missed blocker. The [current review gate](implementation/backlog-workflow.md#two-independent-grades-on-the-same-commit)
supersedes the earlier single-review threshold. Scope-first repair/splitting
and the rubric were recorded in [decision #6](implementation/backlog-workflow.md#legacy-decision-6-independent-review-and-coherent-scope).
They favour predictable operations for the Operator, complete work and preserved
documents for the Owner, safe edits and permissions for the Collaborator, and
access boundaries that cannot be deferred for the Link guest. The two ticket
rules remain here after SPN-037 is retired; the examples in its Verify section
are review cases for this runbook, not additional runtime features.
