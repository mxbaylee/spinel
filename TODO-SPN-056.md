# SPN-056 handoff (temporary; delete before the PR merges)

_Written 2026-10-25 by the agent working SPN-056. Not part of the PR._

Branch `codex/spn-056-sync-transform`, HEAD `32f9676` (the user's merge of
`origin/main`). Everything below is **uncommitted** on top of it; the owner runs
git (agents: read-only git, no commit/push/PR; hand over commands instead).

## The loop

The owner's gate: an independent subagent review must score **greater than 95**
(95 is not enough) with no blockers, over-complexity counted, before the PR body
is updated. Each round:

1. **Review.** Launch a fresh general-purpose subagent pointed at the brief
   `SCRATCH/review-brief-24.md`. Before launching, append a
   `## Round N notes (round N-1 scored X, no blockers; grade fresh…)` section:
   what changed since the last round, the coordinator's test results, and what
   to check especially. Keep the line saying owner-accepted rules (refusals,
   decisions 32 and 35) are deducted only if the rule or its code is wrong.
2. **Fix.** Fix the findings yourself, or brief a fixer subagent the way
   `SCRATCH/fix-brief-25.md` does (allowed files, findings, checks, report).
   For each new test, plant the fault it guards in a scratch copy and confirm a
   test fails (see "Planted faults" below).
3. **Check:** the touched test files one at a time, then typecheck, oxlint,
   format:check, backlog:check (commands below). Then go to 1.

`SCRATCH` = `/private/tmp/claude-501/-Users-bschmeisser-projects/6492e93c-aefc-4be7-8764-5fcddafe4d2b/scratchpad`
(the session scratchpad; a new session should copy what it needs out of it).

## Where it stands: round 27 scored 95; round 28 fixes half done

Round 27's findings, and their state:

- [x] **F1, F4, F5 (`lib/sync-transform/src/cells.ts` `isTailOf`).** It now
      compares each tail cell key for key with a new exported `same()` in
      `src/state.ts` (which replaced three identical local `same` helpers there).
      Dead checks removed: `isOverrideStyle` (`check` already rejects claims
      without it), `isAbsolute`, `sameClaims`. `claimKey` import dropped.
      `tests/transform.test.ts` adds rejection cases "a tail of another fd",
      "a tail with an extra f: null", "the tail in another workbook", and a test
      that the rebuilt tail carries its write's `trigger`. Transform: 50/50.
      Planted faults in `SCRATCH/r27fix/` (unitId check removed, compare `ft`
      only, `sameCell` instead of `same`, no `trigger`, no size check) each fail
      a test.
- [~] **F2 (`scripts/serial.ts` `stale()`).** Edited, **not yet tested**: a lock
      older than `expired` is now stale outright and nothing is killed (its group
      id may be reused); the kill only happens between `limit` and `expired` with
      the runner dead. Test on a copy with short limits (lock path, `limit` 6000,
      `expired` limit + 2000): six waiters on a dead owner's lock never overlap; an
      expired lock whose group is alive is broken without killing it; a lock past
      `limit` but not `expired`, dead runner, live group, gets the group killed.
      **The owner interrupted the last attempt at this test; ask before running
      background processes that kill process groups.**
- [ ] **F3 (`docs/implementation/SPN-032.md`, bullet "Placeholders must keep
      the merge's inputs").** Rich-text numerals (`10^(L-1)+n`) and plain
      numerals (`2, 3, …`) share one space and can collide; allocate rich-text
      ones first and skip them for plain values. Keep verbatim every numeral whose
      value is 0 or 1 (spelling matters: `' 1'`, `'1e0'` retype differently). A JS
      number above `MAX_SAFE_INTEGER` stays a number, not quoted text. A short
      rich text that loses precision (`'1e20'`) keeps exponent form (`'2e20'`).
- [ ] **F6 (`docs/implementation/SPN-056.md` decision 36, ~line 830).** Cite the
      tests rather than `scratchpad/r24fix/`; list the new rejection cases
      (extra cell, other sheet, other workbook, other fd, extra `f: null`) and the
      `trigger` test.
- [ ] Run every `lib/sync-transform/tests/*.test.ts` one at a time (last good
      counts: transform 50, state 28, schema 29+2 skipped, cells 110, names 72,
      rule-based 68+1 skipped, axis 35, docs 21, merges 18, properties 18,
      drawings 9, settings 9, structure 3, fuzz 1, ids 1), then the checks.
- [ ] Append "Round 28 notes" to the brief and launch review round 28.

## After a review scores > 95

1. Update the PR body: draft is
   `~/projects/claude-desktop/notes/spn-056/kit/pr-body.md`; move it into the
   scratchpad first. Fill the schema test count and the review score; mention
   decision 36, the merge of main, and `next_id` 104; drop the "next_id is 100"
   line. End with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`,
   no Co-Authored-By trailer.
2. Hand the owner the commit, push and `gh pr edit --body-file` commands, one per
   code block.
3. Cleanup: remove worktrees `spinel-stateless` and `spinel-opt6` and their
   branches (`proto/spn-056-stateless`, `proto/spn-056-stateful-cells`); delete
   `~/projects/claude-desktop/notes/spn-056/` and `notes/spn-056-notes.md`
   (keep `skills/repo-backlog`); hand over the claude-desktop commit command.
   Delete this file.
4. After merge: remind the owner to add "Lib tests" to main's ruleset.

## Rules that bite

- Tests one file at a time, never the full suite, never Playwright:
  `cd ~/projects/spinel && export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH && node scripts/serial.ts npx vitest run <file>`
  (the shell's default node is 20; always export the Node 24 PATH).
- Checks: `npm run -s typecheck`, `npx oxlint --deny-warnings lib`,
  `npm run -s format:check`, `npm run -s backlog:check`. Run
  `npx prettier --write` on edited files first.
- Never read `node_modules/@univerjs-pro/*`; open-source `@univerjs/*` is fine.
  No new npm dependencies. TypeScript only. `lib/` imports nothing from
  `src/`, `web/`, `server/`.
- Planted faults: copy `lib/sync-transform/{src,tests,index.ts,package.json}`
  into a scratch dir beside `SCRATCH/r26review/vitest.config.ts` and a
  `node_modules` symlink to the repo's, edit the copy, then from that dir:
  `PROBE=<copy>/tests/transform.test.ts node ~/projects/spinel/scripts/serial.ts npx vitest run --config vitest.config.ts`.
- Probes and scratch copies never go in the repo.
