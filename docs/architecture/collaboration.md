# Collaboration experiment — SPN-010 (in progress)

This is an evidence checkpoint, not a completed collaboration design or a claim
that unlicensed use has no limits. SPN-010 remains open. Production collaboration
(SPN-012), queue behavior (SPN-013), and replacement sync (SPN-014) are unchanged.
No license was requested and no license enforcement was altered.

## Reproduce the disposable experiment

The separate `codex/spn-010-spike-harness` branch contains the TypeScript harness
at `data/spn-010-spike`, including its exact package lock and README commands.
The initial reviewed method is commit `8b9b708` (full SHA recorded in the PR).
The restart-check supplement is commit `7639c6239d3957b1b26c98fe98931cfe92f54a61`.
That branch is never merged into the application. Only these findings and
appropriate ticket updates may land. See [decision #25](https://github.com/mxbaylee/spinel/issues/25).

Run with Node 24.19.0. All directly used Univer packages are pinned to 1.1.0:
core, protocol, presets, Sheets/Docs core presets, Pro collaboration, client,
client UI, license, Node transport, endpoint, service and SQLite database adapter.
Playwright is 1.64.1; the observed Chromium build is 156.0.8078.4.
Each matrix and soak run copies its source/config/lockfile into `evidence/<UTC>/source` before
opening browsers and writes observations plus screenshots in that directory.

The server binds **only 127.0.0.1:3110**. Its permissive authorization and synthetic
`spike-user=user-N` cookies are unsuitable for deployment. It pre-creates **24
units** (12 Sheets, 12 Docs) in a local SQLite database; distinguish this from
how many units are actively open. Each independent Chromium browser context
uses a different user identity. These are separate contexts in one Chromium
process, not different browser engines or physical computers.

All writes use the actual name-box and keyboard/text-input UI. A public snapshot
facade is exposed only for read assertions. The license plugin receives empty
configuration. No Pro implementation is inspected, patched or decompiled.
The experiment uses the public [quick start](https://docs.univer.ai/server/collaboration/quick-start),
[SQLite adapter](https://docs.univer.ai/server/collaboration/database-adapters), and
[identity middleware](https://docs.univer.ai/server/collaboration/identity-and-authorization)
contracts, rather than assuming the obsolete 5-document/3-editor claims.

## Workloads and acceptance bounds

- **Short matrix:** 2, 3, 4 and 6 editor identities each open one Sheet and one
  Doc. Then two identities open six units (three of each). Each scenario has
  three rounds of serial edits and an overlapping burst. Every peer must retain
  expected edits and converge; a reload must preserve normalized content.
- **25-hour soak:** two identities retain one Sheet and one Doc, sending
  overlapping bursts roughly once per minute. Previous document tokens and
  current sheet values are checked after each burst. Sheet rows deliberately
  wrap at 1,000; overwriting those cells is part of the workload. Hourly and final
  reloads check persistence. Higher editor counts do **not** receive 25 hours
  of exposure in this experiment.
- A final burst must begin after the target duration. Wall/monotonic intervals
  are checked before and after verification; gaps over two minutes or clock
  drift invalidate completion. A stopped computer/session is not a successful
  soak. A short pilot emits `pilot-complete`, never acceptance evidence.
- Both workloads capture failure screenshots; the soak also records visible text
  before closing pages. Unexpected
  matrix failures produce a nonzero exit status. Retain failures as evidence;
  do not describe a harness assertion error as a product license limit.

## Observations so far

On 2026-10-17 Pacific time, the first unlicensed Sheet already displayed repeated
“Univer Office” watermarks and the bottom-right “Univer Office License Required”
notice. Editing remained possible. This is a visible restriction from the first
session, not a limit first triggered by opening more editors or documents.

The exploratory run beginning `2026-10-18T00:24:48.505Z` successfully propagated
UI edits at its tested counts, but its reload assertion compared raw style IDs.
IDs changed after reload while values and resolved styles remained equivalent.
Those failures are harness failures; that run is not the acceptance matrix.
The revised matrix resolves style references before comparing, adds overlapping
bursts and verifies all earlier expected edits. It ran from
`2026-10-18T00:30:07.212Z` to `2026-10-18T00:35:43.291Z`: all five scenarios
passed (exit 0), with 126 serial and 42 burst UI edits. The server logged 168
successful submissions during that interval. There were no page errors or
console warnings/errors in the recorded run. No edit-capacity rejection appeared
at these tested bounds; this does not establish unlimited capacity or duration.
See [matrix observations](collaboration-evidence/matrix.jsonl) and
[server events](collaboration-evidence/matrix-server.jsonl).

The repeated watermark and license-required notice were present in both the
[Sheet](collaboration-evidence/6editors-2units-sheet-1.png) and
[Doc](collaboration-evidence/6editors-2units-doc-1.png) with six editors. The
screenshots show the unmodified UI.

A separate `restart-check.ts before` read at `2026-10-18T00:35:53.488Z` saved
normalized Sheet values/styles and the full Doc body. The local Node server was
stopped and restarted against the same SQLite file. `restart-check.ts after`
passed at `2026-10-18T00:36:20.194Z` with equivalent contents. The restart took
place before the soak; it is not evidence of uninterrupted duration.

Independent method reviewer `review_spn_010_method` identified six gaps in the
first harness: duration continuity, retained-content checks, failure screenshots,
overlapping edits, exit status, and frozen method provenance. All were repaired;
the reviewer cleared the soak method for a pilot, not ticket acceptance. The
additional matrix retention check was implemented before the revised run.

## Remaining evidence and decisions

The one-minute pilot passed at `2026-10-18T00:37:39.365Z` after two bursts,
69,389 ms of observed wall time and 69,388 ms monotonic time. It emitted
`pilot-complete`; this validates the harness path, not the duration requirement.
The full soak and final independent ticket grade remain to be completed/reviewed. The corrected matrix and restart results above are bounded
short-run evidence, not ticket completion. Preserve
raw logs and screenshots with the final observations and exact run timestamps.
Do not retire SPN-013 or conclude that two-person daily use is unrestricted yet.
If the final limits make collaboration unusable, flag SPN-014 to the owner.
Any retirement of SPN-013 must be a subsequent grooming PR.

The method favors disposable local operation for the Operator, retained documents
for the Owner, realistic overlapping edits for the Collaborator, and keeping
permissive test authorization away from the Link guest. Watermark acceptability
is not silently assumed by the experiment.
