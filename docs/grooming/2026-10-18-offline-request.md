# Grooming after the offline request

The Owner supplied an offline ticket and acceptance contract on 2026-10-18.
This grooming registers SPN-039 through `backlog:new`, preserves its complete
outcome, and records the boundary with SPN-028 in decision [#83](../implementation/SPN-039.md#legacy-decision-83-complete-opted-in-offline-product). Large effort and
impact, not must-ship, and the SPN-028 dependency match the supplied draft. Its
required real-device evidence is not claimed by filing the ticket.

All open tickets were rechecked against main `a3cbd32` and current branch/PR
state. Only SPN-022 landed since the previous grooming: search is now implemented
and verified in PR #80, including current-access metadata filtering and retention
of unfinished edits. The catalog contract reuses its personal-path/privacy rules.

- **SPN-010/013/014:** the more-than-a-day experiment still lacks an approved
  uninterrupted host/window ([#76](../implementation/SPN-010.md#legacy-decision-76-cancel-the-duration-soak), draft PR #26). Bounded runs do not prove no
  capacity limit; the queue stays optional and conditional. Engine replacement
  still requires the owner's decision ([#42](../implementation/SPN-014.md#legacy-decision-42-replacement-of-pro-collaboration)). Offline work does not waive it.
- **SPN-026:** timeline/calendar work is prepared on its own branch, with no PR
  yet. It still needs integration with current main and full browser/final review
  evidence. Keep its scope and score; prepared work is not landed work.
- **SPN-028:** installation/touch work is separately prepared, with pending full
  HTTPS/mobile evidence. Retain its network-only initial behavior, and clarify
  that SPN-039 owns durable offline launch/edit/restart/sync. Public deployment
  evidence remains part of the later approved cutover.
- **SPN-032:** aggregate diagnostics remain absent. Existing backup, prune,
  purge and restore-cleanup instrumentation are still the intended sources;
  counts/sizes must not expose document names or content to the Operator.
- **SPN-033:** Pro embed/range support and source-access-safe rendering still
  need investigation and the specified decision. Offline selected documents do
  not authorize copying inaccessible embedded sources.
- **SPN-034/035:** optional MCP still waits for owner timing ([#41](../implementation/SPN-034.md#legacy-decision-41-initial-mcp-deferral)); Office
  conversion remains post-production. Existing native transfers are implemented.
- **SPN-036:** saved profile choices are absent; current generic guest-room
  identities and the supplied icon catalog remain its boundaries.
- **SPN-038:** public deployment timing is still pending ([#40](../implementation/SPN-038.md#legacy-decision-40-public-launch-timing)), with the earlier
  test host retired. Offline development does not need a new paid host.
- **SPN-009:** Slides remains last and subject to current package-specific terms.
  The new ticket deliberately covers Sheets and Docs only.
- **SPN-039:** the app currently needs a session request and both editors await
  `prepareCollaboration`; `enableOfflineEditing` does not prove cold startup.
  Require a reproducible public-API probe followed by the full durable outcome,
  preserving unmet criteria on open tickets if split. No new runtime behavior or
  feasibility evidence is asserted in this grooming.

Persona review: the Owner and Collaborator gain an explicit durability contract;
the Operator retains document isolation, bounded storage and no assumed paid
service; the Link guest retains online document-only access without private
offline storage. This changes planned scope, not current authorization behavior.

The counter resets to zero and the generated index follows the existing points
and sequencing rules. SPN-028 now wins the four-point tie because it unblocks
SPN-039. No score is manually changed and no ticket is retired or bypassed.
