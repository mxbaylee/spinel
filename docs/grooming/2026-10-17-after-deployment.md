# Grooming after private deployment

Reviewed all 29 open tickets against main `e21b8c7` after SPN-037, SPN-002,
SPN-003, SPN-004, SPN-006, SPN-007 and SPN-029 landed. All remain needed;
existing effort, impact and must-ship estimates remain appropriate. No IDs were
removed or reused. [Decision #23](https://github.com/mxbaylee/spinel/issues/23)
records the integration and sequencing choices.

The Operator has verified private deployment tooling and authentication, but still needs
account management, offsite recovery and diagnostics. The Owner has folders and
sheets; trash, history and portable exports remain essential data-preservation
work. The Collaborator still needs shared access before live editing. The Link
guest still needs a document-scoped grant across snapshots, images and live
connections, without dashboard or unrelated data access.

- SPN-005: retain account/device management; reuse auth stores and disable users
  without triggering ownership deletion cascades.
- SPN-008: retain until PR #22 lands. Its reviewed native JSON/image contract is
  recorded by #21; this grooming does not claim document editing is on main.
- SPN-009: retain optional Slides with the existing terms/owner-acceptance gate.
- SPN-010, SPN-012, SPN-013, SPN-014, SPN-017: retain the UI collaboration spike,
  production integration, conditional queue, owner-approved fallback and live
  access tests. Require SPN-015 before production collaboration. Any unnecessary
  queue is retired through grooming, not by deleting a second ticket in SPN-010.
  The more-than-a-day spike and public-API-only constraints remain unchanged.
- SPN-015, SPN-016, SPN-018: retain sharing and personal placement; extend the
  existing ownership boundary consistently to images and per-user references.
- SPN-019, SPN-020, SPN-022: retain personal tags/pins and metadata-only search;
  none exists in the current dashboard, and shared-item visibility remains part
  of each acceptance scenario.
- SPN-021, SPN-023, SPN-024, SPN-025, SPN-026: retain trash and history outcomes;
  preserve image references and revision safety through retention and restore.
  Named versions and the timeline/calendar UI remain separate focused tickets.
- SPN-027, SPN-028, SPN-036: retain theme, PWA and profile work; the existing design
  and icon references still apply. PWA caching must not retain private payloads.
- SPN-030: retain the owner-selected offsite destination/key and actual restore
  drill. The deployment archive listing is not evidence of a successful restore.
- SPN-031, SPN-033, SPN-035: retain native export, live embeds and optional Office
  conversion; image portability and source access also apply to saved/exported
  payloads. Office fidelity and license choices remain future implementation work.
- SPN-032: retain operational metrics, grounded in deployment measurements;
  nonexistent jobs must not look healthy and metrics must not expose documents.
- SPN-034: retain the optional external MCP interface behind explicit owner input;
  Spinel itself still has no AI features.
- SPN-038: retain the separate public-domain cutover and credential continuity
  work. The owner's SPN-029 external IPv6 scan waiver is not recreated as a todo;
  it does not establish the future public deployment's dual-stack behavior.

Pending owner choices remain backup destination/key (SPN-030), history checkpoint
spacing (SPN-023), whether to build custom sync (SPN-014 after the spike), and
whether MCP is wanted (SPN-034). Slides licensing may also require a decision.
No new owner approval is needed for these routine grooming clarifications.

During grooming, the owner chose to destroy the disposable test host and data,
then redeploy for SPN-038 when ready for public HTTPS. Deployment evidence stays
historical; docs/deployment.md records teardown and any remaining DNS cleanup.
SPN-038 now carries the explicit redeployment-timing input. No new infrastructure
is authorized merely by reaching that ticket. Owner, chat 2026-10-17.
