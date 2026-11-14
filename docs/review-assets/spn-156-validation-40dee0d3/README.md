# 🔁 SPN-156 original validation — terminal failure

Application `40dee0d32cd3cce4bd9c1cbea74aeccdd1d83b47`, base
`754e65317744e5ce97ede501935c6586e4875f2a`, PR 289. Tested merge
`eaaf75f393ab91d9fd1120cbff63c034b481bada` has the identical application tree
`e5a4a18403609e80332137266365993a32abc93e`. All records are workflow attempt 1.
This evidence-only archive starts directly from that application. It does not
validate the later unpublished actionability repair or any future lifecycle repair.

## ✅ Established outcomes

Six required gates passed: Backlog, Pull request, Lint, Typecheck, Unit tests and
Lib tests. The actual native Doc/Sheet checkpoint tests ran and both passed in
Lib remaining. Both new sync-production cases passed once with retry 0: actual
queued Doc and Sheet content/revision/persisted acknowledgement plus independent
peer checks from the file list; revoked authority retained pending data without
submission or a recovery copy. See source-bound reporter, diagnostics, raw logs,
plan and manager's independent `root-browser-audit.json` verification.

Desktop Firefox and Safari passed. Storybook passed. Local source/check/review
identities and all six local browser first-failure/resource dispositions are
preserved in the parent application's canonical evidence and the inherited hash
inventory. Original exact-head reviews and the real root PR-check JSON are retained.
There is no fabricated separate root log.

## ❌ Required failures retained

Playwright smoke failed because production 2/2 had three unexpected cases,
each failing on all three configured attempts. Full reporter, raw job log,
all nine diagnostic payloads/error contexts/screenshots and configured retry-1
traces are retained under `production2-first/`.

- Quota atomicity: line 522 expected an unchanged pending checkpoint after the
  fixture put the context online on the file list during its long quota probe.
  Every attempt actually submitted value 552 once and received the matching
  nonduplicate revision-2 acknowledgement; the durable snapshot contains 552,
  with empty buffer/inflight/sent. This is an independently committed replay,
  not evidence that the failed new download partially changed the old copy.
- Cross-tab removal: line 883 failed after explicit discard. Both pages have no
  editor, both retain value 556 at revision 1, and there are no submits or acks.
  The fixture deliberately holds native resume after reconnect. The dialog
  reports “Close this document in every tab before changing its device copy.”
  A file-list replay owns the item writer in the other tab; same-tab stop-map
  coordination cannot hand it to the management tab. This is a product handoff
  gap, and remains in SPN-156 for repair.
- Account exit: line 230 expected Recover Offline doc only after the original
  account was restored online. Earlier exit barrier, exact preserved checkpoint,
  next-account isolation and compatibility-hold assertions passed. Every attempt
  has one authored “Kept through account exit 5581” submission and matching
  nonduplicate revision-2 acknowledgement, then the exact text in its durable
  snapshot with empty outbox. The recovery-pending fixture must explicitly hold
  replay while preserving the original no-loss/authority assertions.

First-attempt frame arrays preserve ordering but contain no per-frame timestamps;
only the configured retry-1 traces record individual API-call timings. No separate
server-database snapshot was retained at these failure points. Matching real-server
acknowledgements and persisted content are the available evidence; do not invent
more precise first-attempt timing or an unperformed final server assertion.

Desktop Chrome also failed: an existing protected-content warning covered the
Save details target at its native click. The original screenshot, action timeline,
versions, raw log and exited browser/driver records are preserved. Later bounded
hit-target readiness repair is separate and does not claim to fix the warning's
product cause. All original failures remain authoritative.

## 🔒 Acceptance and cleanup limits

This is a terminal **failed validation**, not completion, merge permission, or a
phone pass. Installed-phone execution remains unavailable and separately required.
The Playwright fixtures' finally blocks collected diagnostics and closed their
contexts/database; raw runner logs are retained. They emitted no separate empty
process audit. Desktop acceptance records do explicitly record browser/driver exit.
No hosted rerun, test deadline increase, forced input, suppressed warning or local
browser retry was used to produce this record.

`binding.json` identifies every required gate; `ci-plan.json` is the immutable
selected plan. `manifest.json` hashes every other retained file. A published,
verified tag supersedes only the original pending statuses it actually resolves;
an absent archive is never a pass. Repair candidate acceptance remains pending.
