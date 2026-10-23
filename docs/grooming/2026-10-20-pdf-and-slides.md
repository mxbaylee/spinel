# Grooming: one PDF export and Slides before the redesign

At the owner's request in chat on 2026-10-20, rechecked the 39 open ticket specs
against main `157d743`, the maintained docs and relevant implementation entry
points. This was a source and scope review, not runtime validation or an exhaustive
code audit. SPN-056 is being implemented separately; its spec and branch are not
changed here.

## Decisions and ticket disposition

- SPN-074 removes Slides entirely before SPN-047. The dashboard and search
  still use `ITEM_KINDS`, and the store still accepts `slides`; the ticket remains
  S effort with S impact for Owner and Collaborator. The owner clarified that
  Spinel has never been in production: remove the kind, schema support, read paths,
  placeholders and fixtures, with no legacy rows, compatibility or migration work.
  This supersedes the earlier preservation scenario and role-aware placeholder
  proposal. Existing design patterns, stories for changed New/search states,
  light/dark/phone screenshots and owner approval still apply. The sequencing
  exception remains in SPN-047 and the design playbook. Owner correction, chat
  2026-10-20, decision [#104](../implementation/SPN-074.md#legacy-decision-104-remove-unsupported-slides).
- SPN-073 is retired into SPN-075, not completed. SPN-075 becomes **Export Sheets
  and Docs as PDF without Univer Pro**, retaining L effort, its persona impacts
  and SPN-047 dependency. One direct PDF download replaces all app Print actions
  and browser print dialogs, with current read access as the only document-role
  requirement. This includes account viewers and view-only or editing guests.
  Guest privacy and revocation acceptance move with it. Owner, chat 2026-10-20,
  decision [#103](../implementation/SPN-075.md#legacy-decision-103-direct-pdf-for-every-current-reader).
- `FileExports`, `SheetEditor` and `DocEditor` still use Pro print and hide the
  account export panel from guests. `docs/files.md` preserves those current
  limitations and labels the replacement as planned. The editor/guest design
  drops a separate Print entry and makes PDF the explicit guest export exception.
- The PDF ticket now states paper, margins, worksheet selection, hidden-content
  handling, scale and pagination defaults because a printer dialog will no longer
  supply them. A4 portrait with 12.7 mm margins gives a deterministic fallback;
  Sheets shrink to page width and paginate vertically, and Docs preserve stored
  page setup. These agent-chosen defaults remain subject to implementation review;
  no PDF library or extra service is selected. Saved content and rechecked access
  prevent exporting stale edits or newly forbidden content. Agent decision
  [#106](../implementation/SPN-075.md#legacy-decision-106-deterministic-pdf-pagination) records these defaults.
- SPN-035 Office conversion and SPN-067 bulk native backup remain separate. They
  preserve editable data and archive ownership, unlike a readable PDF. SPN-067's
  account-only restriction now explicitly refers to its native archive.
- Independent review now explicitly scores **over-complexity** within the existing
  10 maintainability points: unnecessary abstractions, dependencies and speculative
  flexibility need actionable deductions. The smallest complete implementation
  remains the target; necessary access and integrity safeguards are not complexity
  defects. The threshold stays 95/100 with no blockers. Owner, chat 2026-10-20,
  decision [#105](../implementation/backlog-workflow.md#legacy-decision-105-deduct-unnecessary-complexity).

## Remaining backlog recheck

- Operator: SPN-032 diagnostics, SPN-061 console recovery, SPN-062 patching,
  SPN-063 scheduled restore drills and SPN-064 reactivation/ownership transfer
  still add distinct capabilities. The current setup command only issues first
  setup, AdminUsers disables/removes keys, and BackupStatus shows backup attempts,
  not scheduled restore verification. Their effort and impact estimates stand.
  SPN-038 remains last and owner-dependent; no host or deployment work is implied.
- Owner and Collaborator: SPN-033 live embeds, SPN-034 optional MCP, SPN-035 Office
  conversion and SPN-036 profiles retain their separate scopes and recorded access
  boundaries. Native export, current item routes and the rail/profile UI do not
  fulfill these tickets. SPN-044 generic metadata is distinct from editor design.
- UI: SPN-042/043 connection/save status, SPN-045 rail controls, SPN-047 redesign,
  SPN-048 dashboard, SPN-049 theatre mode, SPN-050 fill picker and SPN-060 design
  checks remain needed. The current rail links to Settings, save state is inline,
  exports are inline details, and dashboard controls retain the described shape.
  Existing dependency chains and estimates stay; Slides is the sole new exception.
- Offline and sync: SPN-051 through SPN-055 retain the create/edit/conflict/storage/
  desktop boundaries. OfflineViewer is still read-only and OfflineStatus says so.
  The installed collaboration packages and browser adapters still use Univer Pro,
  so SPN-056 through SPN-059 retain transform/server/client/migration boundaries.
  Review of the separately running SPN-056 implementation is outside this grooming.
- Daily sharing and files: SPN-065 copy, SPN-066 link expiry/listing, SPN-067 bulk
  archive, SPN-068 Sheet image insertion, SPN-069 shared-folder creation, SPN-070
  self-service device removal and SPN-071 hidden shares/access origins each solve
  a separate journey gap. Current native transfers, sharing routes, owner-only
  create checks and admin key removal are prerequisites, not completed substitutes.
  SPN-072 phone Docs remains separate from PDF layout and offline device checks.

## Persona tradeoffs and bookkeeping

The Operator keeps document isolation, bounded work on the small server and no
new service commitment; a universal read-access PDF action does not grant an admin
content access. The Owner gets complete readable copies and avoids creating an
unsupported deck. The Collaborator, including an account viewer, gets the same
PDF without needing ownership, while editable exports and bulk archives keep
their own scopes. The Link guest gets only the shared document, no injected account
identity, and loses new-export access on revocation. Keeping separate role-specific
PDF tickets would add handoff and permission drift for no different user outcome.
Keeping the Slides dependency would delay removing an unusable choice without
helping the redesign. Maintaining compatibility for a never-production document
type would add unnecessary work for the Operator without serving any persona. Removing review safeguards would save effort at the expense
of every persona, so those remain unchanged.

No new persona gap requiring a ticket was identified in this review. No IDs are
reused and no implementation is claimed complete. The index has 38 tickets before
SPN-074 lands; SPN-075 loses the ranking boost from SPN-073. The grooming date is
2026-10-20 and `completed_since` remains empty. Regenerate the index with
`npm run backlog:index`; select only the explicitly requested SPN-074 next in this
chat, then stop after its PR as the owner requested.
