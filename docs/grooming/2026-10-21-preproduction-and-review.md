# Grooming: pre-production scope, focused reviews and visible effort

At the owner's request on 2026-10-21, reviewed all 44 open tickets against main
`a79d981bcbe07c45c25f04275ccbffa7e912dd5d`, maintained docs and relevant application
entry points. This is a source/scope review, not a claim that pending features
passed runtime acceptance. The owner also requested Storybook CI parallelization
and first-class XL effort in this grooming PR. SPN-056's separately ongoing
implementation is not changed; its effort estimate is corrected.

## The four questioned UI tickets remain open

SPN-047 delivered an approved proposal and shared controls. A proposal fixture
does not establish that its behavior is wired into the application.

| Ticket | Verified remaining work | Grooming change |
| --- | --- | --- |
| SPN-045 | `web/Rail.tsx` still leads to Settings and `web/App.tsx` still uses that route; browser theme/profile infrastructure already exists. | Adopt approved profile/appearance navigation, reusing the existing settings and preserving connection/OAuth flows. |
| SPN-048 | `web/Dashboard.tsx` still has the shared-items drawer and many row actions; `web/SearchPanel.tsx` retains separate filter controls. | Implement the approved dashboard/search composition without rebuilding its APIs or losing parser edge cases. |
| SPN-042 | `src/ui/redesign/Mockups.tsx` uses an `offline` fixture flag; `web/collaboration.ts` and `web/OfflineStatus.tsx` do not establish the requested real connection lifecycle. | Keep connectivity separate from durable save, integrate the approved network icon and test unreachable/reconnecting/resubscribing states. |
| SPN-043 | `web/SheetEditor.tsx` and `web/DocEditor.tsx` render status and Retry in normal flow; `.save-status` has a minimum height rather than a fixed geometry guarantee. | Keep existing saved/error semantics and implement the fixed slot plus detail/Retry popover, with editor-bound tests. |

SPN-049 depends on SPN-042/SPN-043 and composes their shared connection/save controls
into the compact editor and theatre mode. Independent review caught the missing
sequencing dependency; it must not duplicate those controls before they land.

## Remove overlap and narrow the work

- **SPN-060 is retired into a delivered [design review runbook](../design/review-runbook.md).**
  This does not claim its old general token lint, axe gate or stored screenshot
  baselines were implemented. Keep current deterministic checks; use focused
  independent human/AI questions about necessity, interaction and honest evidence
  when designs change. The runbook includes this review's SPN-042 example and
  retains existing owner screenshot approval and independent-review rules.
- **SPN-050** only removes the extra fill toolbar and preserves sixteen legacy
  fill/profile mappings. **SPN-088** alone investigates eight logical native
  picker colors, with a supported-API fallback. Native dark canvas behavior
  already exists; do not recreate it or conduct two palette investigations.
  **Later update, 2026-10-23:** [SPN-088 was retired](../implementation/SPN-088.md#retain-native-colors-and-retire-the-extra-palette-proposal), superseding the eight-choice follow-up without claiming it was implemented.
- Screen migrations **SPN-045/048/049/081–085** apply the shared modal title-icon
  pattern where they work. **SPN-089** follows them as a residual inventory/audit,
  including standalone dialogs; new features continue to own their own dialogs.
- **SPN-070** no longer waits for SPN-045's navigation move. Existing Settings is
  a usable home for self-service passkey removal while preserving the later
  profile composition and pending OAuth consent.
- **SPN-087** is renamed to explain its actual purpose: remove obsolete layout
  CSS in Storybook examples. It remains optional internal cleanup, with no new
  feature or dependency on its completion before screen migrations. Reassess
  obsolete remnants instead of performing a speculative large refactor.

## Pre-production and data protection

The owner clarified that production starts at **SPN-038's `spinel.baylee.dev`
launch**, not at a local production build or the retired private test host. It is
the last launch prerequisite. The owner subsequently **retired SPN-035 built-in
Office import/export**. New **SPN-093 CSV import** and **SPN-094 optional document-type
and conversion plugins** are both post-launch backlog work, explicitly dependent on SPN-038.
Native Univer JSON backup/import stays available. Office conversion may be an
installer's plugin choice; no core Office converter is promised.

The backlog now sorts fixed lifecycle phases before its existing priority score:
`pre_launch` (the default), `launch`, then `post_launch`. The generated index
shows Before launch, Launch and After launch groups. It rejects dependencies on
a later phase, and the runbook completes a phase before advancing. This prevents
optional work's inherited score from moving SPN-038 into the middle of launch
work. Ordinary untagged backlogs retain their previous display. The routine
implementation and all four persona tradeoffs are recorded in closed
[decision #129](../implementation/backlog-workflow.md#legacy-decision-129-fixed-lifecycle-phases).

SPN-093 preserves literal CSV fields, the first row as data and leading zeros,
without automatic formula/date/number/header inference. Closed
[decision #130](../implementation/SPN-093.md#legacy-decision-130-literal-bounded-csv-import) records the
rationale, alternatives and persona tradeoffs; the rule is maintained in
[import guidance](../files.md). These decisions complete the preparation's
external decision log without implementing the backlog features.

SQLite is today's implementation, not a permanent requirement. SPN-057 may select
one coherent backend before launch while preserving atomic authorization,
durable commits, bounded resources and retry identity. SPN-059 need not assume a
live dataset or zero-downtime migration: distinguish disposable fixtures from
work selected for retention and verify the chosen transition. No database swap
or cloud provisioning is implemented or implied by this PR.

**SPN-055 concerns browser storage and pending edits.** It cannot be completed by
changing the server database. Its scope now explicitly protects against
application-controlled cleanup and reports browser persistence/eviction limits.
**SPN-063 concerns server recovery** and is generalized to the selected database,
assets and required configuration. Provider redundancy or successful backup
creation is not a demonstrated restore. Current SQLite/Spaces tooling remains
the active implementation; [backup docs](../backups.md#recovery-requirements-and-hosting-options)
explain the different DigitalOcean protection options with official sources.

## Split acceptance without losing it

| Original scope | Delivery ownership |
| --- | --- |
| SPN-055 storage and real-phone behavior | SPN-055 owns storage/account lifecycle and pending-edit protection; new **SPN-090** owns actual installed Android/iPhone evidence, icons/manifest and reconnect outcomes. |
| SPN-052 desktop offline | Uses SPN-055's shared core without waiting for physical-phone verification in SPN-090. |
| SPN-078 combined Space feature | SPN-078 owns the durable model, stable IDs/order/bindings, inherited permissions and recovery metadata; new **SPN-091** owns authenticated tree/navigation/editing and persistent recovery; new **SPN-092** owns guests and integrated access/recovery acceptance. |
| SPN-079 delegated file Admin | Follows SPN-092's complete Space boundary; server Operator remains content-blind and there remains exactly one Owner. |

The [Space delivery contract](../design/spaces.md#delivery-slices) preserves
the original nested Docs/Sheets/folders, uniform current/future-child access,
revocation, same-Space/external formula semantics, images, HTTP/socket/MCP/export
boundaries, guest privacy and social cards, deep links, keyboard/touch controls,
subtree trash/recovery, backups and owner transfer. Unsupported capabilities
remain unavailable; ordinary Space exposure waits for SPN-092. That ticket also
depends on SPN-064 because ownership transfer is still planned, not implemented.

The [offline contract](../offline.md#how-offline-editing-works) now describes
SPN-057/058's durable acknowledgments and stable retry identities without
prescribing obsolete Pro `flush()`/replay APIs. It retains the conservative
advanced-base conflict-copy behavior in SPN-053/054 and removes personal-pin
fallback prose. Device deletion/eviction cannot be promised to preserve the
only local copy of an edit that never reached the server.

## XL effort and other estimates

XL is a visible effort size for sustained algorithmic, design or verification
work, independent of changed-line count. Effort points are S=3, M=2, L=1, XL=0;
impact remains S/M/L and dependency inheritance still puts prerequisites first.
XL does not waive splitting, review or size limits. The checker and generated
index support it, including rejection of XL as an impact value.

| Ticket | XL rationale |
| --- | --- |
| SPN-056 | Owner-observed sustained transform/convergence work despite a bounded diff. |
| SPN-058 | Optimistic queues, rebasing, reconnect/acknowledgment races and native Sheet/Doc presence integration. |
| SPN-075 | Sheet and Doc pagination/layout, complete content/image fidelity, and rendered/access-boundary verification. |
| SPN-094 | New document-type/editor/persistence extension points plus conversion capabilities, compatibility and access/recovery proof. |

The original SPN-035 scope would also have qualified as XL, but the owner's later
direction retires it. CSV import is a narrower M. The owner then expanded plugins
beyond conversion to new document kinds such as slides or kanban, making SPN-094
XL. Its foundation/reference-plugin scope does not include full Slides, kanban or
Office implementations. Both tickets remain below the production-launch ticket.
SPN-094's design notes also discuss eventual extraction of existing Sheets, Docs
and pages into libraries/plugins, as the owner requested. That extraction remains
follow-up work within the discussion; it has no new ticket or implementation
commitment in this grooming.

SPN-053 and SPN-057 remain L because they consume these foundations, and divergent
offline work deliberately uses conflict recovery. SPN-059 remains L with its
pre-production transition. Each Space slice and SPN-079 remain L after splitting.
SPN-072's public-API investigation/read-only fallback bounds that ticket. No
remaining S/M ticket clearly needs XL on current acceptance; re-estimate when
implementation supplies better evidence.

## Remaining backlog and persona coverage

- **Operator:** SPN-032 health, SPN-061 console recovery, SPN-062 patching,
  SPN-063 recurring restore and SPN-064 reactivation/ownership transfer still add
  distinct missing capabilities. SPN-038 remains owner-coordinated; database
  flexibility does not grant the Operator document access or new services.
- **Owner and Collaborator:** SPN-051 creation, SPN-053 edits, SPN-054 recovery,
  SPN-052/055 device lifecycle and SPN-056–059 sync remain distinct. SPN-065 copy,
  SPN-066 link management, SPN-067 bulk native export, SPN-068 Sheet images,
  SPN-069 shared-folder creation, SPN-070 self-service revocation, SPN-071 access
  origins and SPN-072 phone Docs still solve real gaps. Existing related code is
  a foundation, not proof those outcomes are finished.
- **Link guest:** SPN-075 readable PDF, SPN-076 explicit formula-source sharing,
  SPN-084 guest screens and SPN-092 Spaces retain privacy/revocation acceptance.
  Current formula authorization does not implement the new sharing opt-in.
- **All applicable personas:** SPN-081–085 runtime screen migrations and
  SPN-086 persistent icon/color selection remain needed after approved mockups.
  SPN-087/088/089 retain the narrower ownership described above. No other ticket
  is retired as completed without application evidence.

## Storybook CI and verification

The owner-linked [review job](https://github.com/mxbaylee/spinel/actions/runs/39646822256/job/119385079135)
took 18m 6s, with its main capture step about 17m 13s. Its 643 stories produced
3,215 captures and 118 interaction passes. The new workflow builds once and runs
desktop (light/dark), tablet (light) and mobile (light/dark) in parallel, each
with a 15-minute timeout. Desktop owns native editor proofs and the once-only
icon suite; tablet retains the 613 px mouse path. All five variants and extra
interaction paths remain covered. The stable aggregate check requires all
three results before Pages deployment; failed/cancelled/missing results cannot
pass as skipped work. Documentation-only and focused-manual behavior remain.

Partition/gate tests prove full and focused selection, complete nonduplicated
coverage ownership, invalid-option rejection and failure/cancellation/missing
result handling. XL/phase tests cover schema, rendering, dependency priorities,
launch ordering and unchanged PR-size safeguards. Local verification and the
independent review are recorded with the grooming PR. The earlier HTTP 403
publication blocker was resolved on 2026-10-21: the current connection accepted
a repository write and both decision issues. Fresh main still matched the patch
base, and the attached patch reproduced reviewed tree
`70753cca647592b0dc4b7f8db91e9a91da43781a` exactly, with no rebase or ticket-ID
collision. Current-head GitHub validation and measured full-catalog viewport
durations are recorded in the PR's validation section and linked Actions runs;
focused preparation timings alone do not establish the 15-minute job target.
Publication is a draft review checkpoint, not authorization to merge or launch.

Retiring SPN-035/SPN-060 and adding SPN-090–094 leaves **47 open tickets**, next ID
SPN-095. Grooming resets the counter and date to 2026-10-21. Generate the index
with `npm run backlog:index`; historical grooming notes retain their dated
decisions and are superseded by this record where explicitly changed.
