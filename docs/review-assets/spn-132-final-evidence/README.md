# SPN-132 native typing acceptance

Source `a107a2be1aa4c01653edea15f99dc1f7ffa867ce`; base
`f5cc10fad474fdf178172f79b3a0dde431cea6ad`; tested merge
`3be0a2e5d0a5d8f6af0adc825fdb84a361e1494d`. Source and merge tree are
`b26068c862642498b0fc55f01fbef99549f0b566`.

Original full CI and the metadata-run recovery both passed all required gates
on this source and tested tree. Independent final review records accompany
this evidence. The eventual squash identity is recorded in PR #233.

## Application acceptance

Original full code CI run 41418146689 attempt 1 passed all 33 jobs, including
the seven required gates. The digest-bound plan selected full validation,
historical responsiveness/callback comparisons and phone compatibility. The
native dependency correction changed neither workflow routing nor budgets.

All six unprofiled sustained-typing samples were complete, budget-enforced,
attempt 0. Desktop maximum flushes: 12.5 / 12.1 / 14.5 ms (50 ms limit).
Mobile maximum flushes: 53 / 26.6 / 96.7 ms (100 ms limit). Preserve the 96.7 ms
near-limit observation. Desktop capacity p95: 8.6 / 9.6 / 10.3 ms; mobile:
18.5 / 17.3 / 21.3 ms. Browser-local drains: desktop 335 / 302.4 / 302.5 ms,
mobile 306.9 / 342.3 / 310.6 ms. History/collaboration high-water marks were
32/32. Exact saved/live-peer content, sender/peer selection, Undo/Redo and
Online checks passed with no errors or reloads. Both comparison records passed
without failed or unavailable evidence. Separate profiles are diagnostic, not
timing acceptance. An unobserved idle p95 remains inapplicable, not an observed
pass. The original SPN-071 165.8 ms stall's cause is still unproven.

Desktop and mobile callback candidates were complete, bounded, accepted and
behavior-passing on attempt 0, with no violations or post-disposal work. The
historical callback baseline was intentionally unbounded with four violations;
its observations remain distinct from the passing candidate. Complete raw JSON
ledgers are gzip-compressed losslessly; source byte hashes are retained. Large
artifact ZIPs containing disposable fixture databases and source maps are not
published here. Their hashes identify the supplementary expiring artifacts.

Sized restore passed in 297502 ms with exact native/rich/authority evidence,
zero errors and private-volume/supervisor cleanup. This is disposable Linux HTTPS
with the Admin CDP passkey fixture, not physical-device or remote-provider proof.
Unit remaining passed 177 Vitest files / 1975 tests plus dependency-patch tests.
Other selected ordinary, sync, soak, retained-transition, offline-upgrade,
container and supervised-restore jobs all passed in the original full run.

## Failures, resources and recovery

Private npm ci applied all five patches: 7.070 s / 1036.5 MiB watchdog peak.
Final 130 focused tests passed in 1.446 s / 460.6 MiB. That final local test was
at ad6633dabd17f9c8e6e77ce995af9d95ed156565; the amend to a107a2be restored only
literal emoji spelling in backlog JSON, preserving parsed values and all
production/test bytes. Local typecheck was resource-aborted at pressure 2,
2.305 s / 1301.94 MiB, not passed; hosted Typecheck passed. The first lint run
caught a useless spread, fixed with a typed body variable. Full lint/dependency
boundary/format then passed in 15.115 s / 568.3 MiB. Logs retain both outcomes.

Storybook 41418146813 attempt 1 failed only in mobile/light job125187402475's
strict Ubuntu APT mirror-profile check before browser installation or story
execution. Actual mirror contents were unavailable; cloud provider is not a
proven cause. Four other variants passed. Original evidence is immutable at
ef5bab2b324f2d1f94d942826e1a8a4e3b1c8a96, path
docs/review-assets/spn-132-storybook-setup. A predeclared single targeted retry
passed: job125195203847, 1025 states, 9 additional interactions, zero failures
or routine captures. Attempt 2 aggregate passed. Original and carried-forward
desktop-dark jobs have identical timestamps; unchanged variants were not fresh
executions. SPN-131 retains the separate runner-profile repair.

A body wording correction triggered full metadata validation 41418346271.
The implementing agent canceled it to avoid duplicating the active code run;
classification cancellation correctly produced fail-closed downstream statuses.
Attempt-1 run/jobs and the Typecheck log preserve that outcome. Classifier and
PR-job log endpoints returned BlobNotFound; those errors are retained, not
invented logs. One failed/canceled-job recovery was requested. Run 41418346271
attempt 2 passed all 33 jobs, including all seven required gates. Its own
digest-bound full plan and selected evidence are retained under
metadata-recovery-attempt2; no previous-run results were substituted. The
recovered desktop samples passed at
13.4 / 32.9 / 18 ms maximum flush, 8.4 / 10 / 8.8 ms capacity p95 and
303.8 / 303.1 / 305.7 ms browser-local drain. All were complete, budget-enforced
attempt 0 with exact correctness, 32/32 high-water marks and no errors/reloads.
Both recovered callback candidates passed complete/bounded/accepted checks,
caps 4/1/1, and zero callbacks or installations after disposal. Recovered sized
restore passed in 229195 ms with zero page errors, native/rich/authority checks
and complete cleanup. Recovered mobile plain samples passed at 50.7 / 47.3 /
49.2 ms maximum flush, 30.6 / 32.6 / 31.4 ms capacity p95 and 351.9 / 546.4 /
535.7 ms browser-local drain. All three were complete, budget-enforced attempt 0
with exact correctness, 32/32 high-water marks and no errors/reloads. The
separate diagnostic mobile profile observed a 144.4 ms maximum flush. Its
budgetEnforced flag is false under the unchanged protocol; retain this
observation without treating it as unprofiled timing acceptance or suppressing
it. The corresponding desktop profile maximum was 28 ms. No failed
application assertion was retried, no
limit weakened and no previous-run result substituted for a selected new job.

The first read-only desktop evidence parser incorrectly required an unobserved
idle-p95 result to be true. Its source/failure are retained. The corrected parser
accepts null only with the matching unobserved idle-flush summary; it changes no
application acceptance rule. Both final desktop/mobile inspections passed.

## Provenance and remaining scope

The canonical decision and all four personas are in docs/implementation/SPN-132.md
at the source SHA. Historical first failure, bounded diagnostic, abandoned
prototype, real native-cache capture and mixed-marker/inverse proof remain in
the immutable archives linked there. This final record supersedes that source
file's pre-CI pending checkpoint without rewriting history.

The hosted responsiveness comparison uses historical uncapped source
`2c84a18449c7dae09e2817989fac6236be96ef98`; callback comparison uses
`0e1df4725d9eccb77574d25e3eecdf678fe6ff44`. These historical browser comparisons
are distinct from the exact immediately previous patch used as the focused
primitive-work negative control. Do not attribute the entire historical timing
difference to this marker correction.

No visible UI change is proposed; required rendering and interaction checks
remain, without routine screenshots. Independent review is agent review only.
SPN-071 retains its entire Hide/Show, private access-provenance and live-upgrade
outcome and requires fresh integrated acceptance. SPN-122 owns eventual patch
removal after upstream suitability verification. Completing SPN-132 completes
neither ticket.

`hashes.json` covers archived bytes. `source-files.json` records original bytes
and SHA-256 before lossless gzip. Raw Actions artifacts are supplementary and
expire under workflow retention; the necessary selected evidence is retained
here independently of that expiry.

## Final independent review

Two independent nonimplementing agents, `/root/spn071_review_a` and
`/root/spn071_review_b`, each graded source a107a2be **100/100** after independently
checking the final recovery evidence: 35 scope, 25 correctness/access, 20
verification, 10 CI/operations and 10 maintainability/complexity. Neither has
unresolved findings or blockers. Their approval covers SPN-132 only. See
independent-reviews.json for exact identities and retained diagnostic limits.
