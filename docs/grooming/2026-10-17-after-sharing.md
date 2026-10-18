# Grooming after document sharing

Rechecked all 27 open tickets against main `a58f1ff` after SPN-008 and SPN-015
landed. This early grooming records the owner's dependency and queue decisions;
it does not promote collaboration ahead of the normal point order. No ticket
was removed or ID reused. The counter resets after this full backlog review.

[Decision #31](https://github.com/mxbaylee/spinel/issues/31) removes SPN-010 from
SPN-012's dependencies. SPN-015 already landed, so production collaboration is
now eligible at its unchanged score of 7. SPN-021 remains ahead at 8. SPN-010's
more-than-a-day experiment is independent and still incomplete: short tests
cannot establish duration limits or unrestricted use. Its draft PR #26 retains
the evidence and disposable harness provenance.

[Decision #27](https://github.com/mxbaylee/spinel/issues/27) keeps SPN-013 as an
optional queue with low impact and high effort (score 2). Bounded testing found
no capacity rejection, so evidence remains inconclusive. Build it only for a
reproducible reachable limit; do not automatically retire it. This supersedes
that part of the previous grooming and decision #23.

[Decision #30](https://github.com/mxbaylee/spinel/issues/30) records the upcoming
trash design. Snapshots, images and grants survive soft deletion; restoring a
folder must not resurrect earlier independent deletions. The collaborator's
remove-from-view outcome is retained explicitly in SPN-018, where personal
placements are introduced. SPN-021 enforces owner-only trash and blocks ordinary
access to trashed content; it does not need a second placement implementation.

The Operator benefits from bounded storage cleanup and unchanged access controls;
o completed spike is not implied by unblocking production work. The Owner gets
trash before collaboration under the existing scores, with data-preservation
requirements intact. The Collaborator gets authenticated co-editing sooner than
waiting for the experiment, while viewer/revocation checks remain merge gates.
The Link guest remains isolated: neither experiment identities nor future link
tokens may bypass the shared access boundary.

- SPN-005: account/device management remains absent; reuse the auth stores and
  disable accounts without deleting owned documents. Current per-request checks
  already reject disabled users, but administrative controls remain to build.
- SPN-009: Slides remains optional, subject to its public API and licensing gate.
- SPN-010, SPN-012, SPN-013, SPN-014, SPN-017: retain separate experiment,
  production collaboration, conditional queue, owner-selected fallback and
  adversarial live-connection tests. Only the dependency and queue estimates
  change; baseline authorization and reconnect/data integrity remain in SPN-012.
- SPN-016, SPN-018: link access and personal shared placements remain absent.
  Reuse the landed sharing resolver and document-scoped image checks. Removing
  a placement must leave ownership and access unchanged.
- SPN-019, SPN-020, SPN-022: personal tags, pins and metadata search remain needed;
  the dashboard currently lists owned children or an authorized shared folder.
- SPN-021, SPN-023, SPN-024, SPN-025, SPN-026: retain trash and version history.
  The existing stores persist only live native snapshots and image blobs, so
  retention, named versions, restore and timeline/calendar are still real work.
  The owner checkpoint-spacing question remains open before history is built.
- SPN-027, SPN-028, SPN-036: theme, installed mobile app and profile choices remain
  absent. Existing design/icon references apply; default profile identity allows
  presence before configuration. Private API payloads must not enter PWA caches.
- SPN-030: offsite backup and an actual restore drill remain needed. No backup
  destination/key or fresh infrastructure is assumed from the retired test host.
- SPN-031, SPN-033, SPN-035: native exports, permission-aware live embeds and
  optional Office conversion remain absent; image portability/source checks are
  still needed alongside the new shared access resolver.
- SPN-032: operator diagnostics remains needed, including cleanup and backup
  state once implemented; no document content may be exposed to admins.
- SPN-034: external MCP remains optional and awaits the owner asking for it.
- SPN-038: public HTTPS deployment remains separate and awaits redeployment
  timing. The disposable private host and its DNS entries have been removed;
  allocate fresh resources when authorized, without reusing released IPs.

Other estimates and dependencies remain appropriate. No new ticket is needed:
SPN-018 already owns the personal-placement outcome. Next selection follows the
generated index, skipping SPN-010 while its soak is incomplete and SPN-030 while
its required owner storage choice is pending. SPN-021 is the next eligible build.
