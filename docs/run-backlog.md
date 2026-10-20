# Run the Spinel backlog

Say **“Read `docs/run-backlog.md` and start working.”** This invokes the loop below:
build one ticket, independently verify it, repair or split findings, open its PR,
wait for CI, squash-merge, and choose the next ticket. Continue without asking for
permission between those steps. A request to read, review or edit this document
alone does not start a run.

The owner authorized this workflow in chat on 2026-10-17 (SPN-037). Invoking it
authorizes repository changes, decision issues, follow-up tickets, PRs and
squash merges that meet these gates. It does not waive an explicit owner decision,
a required manual acceptance check, repository protection, or separate permission
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

Take the highest-ranked eligible ticket, honoring explicit owner sequencing in its
Rules: SPN-038 comes last, even when a score tie would place it earlier. These are scope/timing constraints, not new product dependencies.
After each merge, fetch main and pick again; do not preselect a fixed queue. An
explicit owner-requested ticket takes priority for that run. If seven tickets
have landed since grooming, do the required grooming PR first, with the same
review and CI gates.

When a ticket needs owner input or verification, prepare everything independent
of that input, ask once with the decision issue or exact verification steps, and
save a draft PR/checkpoint. Continue with the next eligible ticket while waiting.
A UI PR waits on the owner's approval of its light, dark and phone-width
screenshots ([process](todo/process.md#picking-the-next-ticket)); treat it the
same way.
Keep a run-local list of blocked tickets and reasons so picking does not repeatedly
select the same blocked item. Do not change product dependencies merely to hide
an external blocker. Reconsider it when new input or evidence arrives.

## 2. Implement one ticket

Check the original ticket against the code and preserve its acceptance criteria
for review. Weigh the Operator, Owner, Collaborator and Link guest in every
decision; record decisions as process.md requires. Build the smallest complete
change that satisfies the ticket, including meaningful tests and maintained docs.

Before each push, run `npm run typecheck`, `npm test` and `npm run backlog:check`.
Also run lint and the verification required by the ticket, including browser tests
for changed user flows. Use the pinned Node version. Fix failures; never weaken
checks to obtain a pass. Do not repeat unaffected checks without a reason.

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

When the watchdog prevents safe local tests, the owner permits a draft push after
local typecheck, lint and backlog checks pass. Run the full unit and browser suites
in GitHub CI instead; keep the PR draft until verified. Record the resource abort
and deferred checks in the PR. All six required CI gates, independent review of
at least 95 with no blockers, and the other merge gates still apply. This changes
verification order only; it does not waive tests or authorize paid test hosts.
Owner approval, chat 2026-10-18, [decision #52](https://github.com/mxbaylee/spinel/issues/52).

Prepare the landing changes in the same PR: preserve Rules in maintained docs,
delete only this completed ticket, remove its ID from dependents' `depends_on`,
append its ID to `grooming.completed_since`, and run `npm run backlog:index`.
Run the PR checker against `origin/main` with the ticket's exact heading as title.
Do not call the ticket landed until GitHub confirms the merge.

## 3. Get an independent grade

Use a subagent that did not implement the change, preferably with fresh context.
Give it the original ticket from the base branch, the full diff, relevant docs,
all four personas, and reproducible test/CI evidence. Ask it to inspect the code
and independently verify important outcomes; passing checks alone are not review.
Give it no prior grade or desired result. Review is read-only; the implementing
agent owns fixes. If independent review is unavailable, keep the PR unmerged.

Ask for a score out of 100 using this rubric:

- **35:** ticket scope and acceptance criteria.
- **25:** correctness, data integrity and access boundaries.
- **20:** meaningful regression protection and verification evidence.
- **10:** CI and operational usability appropriate to the ticket.
- **10:** maintainability, documentation and backlog/process consistency.

Apply the rubric proportionally: for documentation work, verify instructions and
scenarios rather than inventing runtime features. Require concrete deductions,
file/line references where relevant, reproduction evidence, severity, and a
recommended fix or follow-up scope. Do not deduct for a feature the ticket
explicitly defers, but do deduct if the delivered slice is unsafe or incomplete.

The merge gate is **at least 95/100 AND no unresolved blocking findings**.
An average of several scores does not satisfy it. Record the reviewer, reviewed
commit SHA, rubric, deductions and each finding's disposition in the PR. Review
uncommitted work only provisionally; tie the final assessment to the committed diff.

## 4. Fix here or file separately

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

Below 95, implement the appropriate repairs or scoped split and send the revised
change and finding dispositions back to the independent reviewer. Repeat until
the gate is met or an actual blocker/limit requires a checkpoint. Filing a ticket
alone does not resolve an in-scope blocker or erase a deduction. The reviewer must
assess the resulting slice. Do not shop for a more generous reviewer or round up.

At 95 or above, fix or ticket any remaining actionable finding according to the
same scope rules; a non-actionable observation may be explicitly accepted with
its reason. All blockers still prevent merging, regardless of the numerical score.

New tickets must exist on `main` before their implementation PRs can land. File
follow-ups with the current ticket PR whenever possible. If there is no such PR,
register them in a grooming PR (recheck the backlog and reset its counter as
required), then implement them on new branches after that PR merges. Never bypass
the checker or reuse an ID to avoid this prerequisite.

## 5. Publish, wait for CI, and merge

Open one PR with the exact ticket heading, review grade, final behavior, evidence,
changed-line count and finding dispositions. A draft is appropriate while blocked;
mark it ready only when its acceptance criteria and independent review are complete.
Publish early if helpful, but do not treat opening the PR as completing the ticket.

Wait for all required checks on the current head to finish successfully. The
current set is **Backlog**, **Pull request**, **Lint**, **Typecheck**, **Unit tests**
and **Playwright smoke**, plus any added repository-required checks. Missing,
pending, cancelled, skipped or failed required checks do not count as a pass.
Inspect failures, fix their causes, run the affected checks and the pre-push checks,
and push again. Retry a transient infrastructure failure only with evidence.

Fetch main before merging. If it advanced, update the branch and resolve conflicts,
then recheck the combined change and wait for fresh CI. Have the reviewer assess
material source, acceptance, test or workflow changes, including conflict fixes;
record a revalidation of the new SHA even for a mechanically unchanged rebase.
Check the final grade and CI against the same head. Do not merge while a required
owner decision/manual check, blocking review, or repository protection is unresolved.

Squash-merge using the verified head SHA as a guard (for example,
`gh pr merge <number> --squash --match-head-commit <reviewed-sha>`). Never use admin
bypass, force-push main, relax protection or dismiss a blocking review just to
continue. Where branch rules are not configured yet, still enforce this named
check list yourself and report the setup gap; no missing check is waived.

Confirm GitHub reports the PR merged. Fetch and fast-forward local main when safe,
then start again at step 1. Keep progress updates brief: what landed, review score,
verification, what comes next, and any owner input needed. Do not end the run just
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
path; dirty/unpushed work; last review score and unresolved findings; exact checks
passed/failed/pending; blocked tickets with decision links; and the next concrete
action. No secrets. Update the checkpoint after each merged ticket in the PR body
so an abrupt interruption still leaves a useful trail.

Resume with **“Read `docs/run-backlog.md` and continue from the checkpoint.”** Verify
repository/PR state afresh before trusting saved status, then re-enter the loop.
The workflow continues within available execution capacity; it cannot guarantee
an entire backlog will finish in one chat or survive an abrupt limit automatically.

## Why these gates

The owner chose independent review, the 95% threshold, CI-gated merges and
continued backlog execution on 2026-10-17 (SPN-037). Scope-first repair/splitting
and the rubric were recorded in [decision #6](https://github.com/mxbaylee/spinel/issues/6).
They favour predictable operations for the Operator, complete work and preserved
documents for the Owner, safe edits and permissions for the Collaborator, and
access boundaries that cannot be deferred for the Link guest. The two ticket
rules remain here after SPN-037 is retired; the examples in its Verify section
are review cases for this runbook, not additional runtime features.
