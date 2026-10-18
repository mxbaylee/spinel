# Grooming after collaboration, history and account administration

Rechecked all 20 open tickets against main `24e3919` after SPN-021, SPN-030, SPN-012, SPN-017,
SPN-023, SPN-024 and SPN-005 landed. No open outcome is complete, no ticket is
removed and no ID is reused. The code now supplies current-session access checks,
authenticated collaboration, compressed native checkpoints, named versions,
consistent encrypted offsite backups and account/passkey revocation. These are
integration foundations, not substitutes for the remaining acceptance scenarios.

The Operator has credential revocation and recovery evidence, but diagnostics and
public deployment remain. The Owner has retained history but still cannot preview
or restore it; tags, pins, shared placements and search remain absent. The Collaborator's disabled
owner retains documents and grants; new personal references must preserve that
boundary. The Link guest still has no scoped anonymous identity, so sharing a URL
cannot bypass account, image or live-connection checks.

- SPN-009: Slides is still an empty dashboard item. Retain optional status and
  public API/licensing review before selecting its editor; no paid license is
  authorized by this review.
- SPN-010: draft PR #26 records the bounded UI matrix and failed-run summary;
  raw duration-failure logs/screenshots remain at the local path in its checkpoint.
  The 25-hour run stopped after about 4h38m at a continuity gap above two minutes.
  That is not a demonstrated SDK limit or a passing soak. The task-owned local
  server and soak were stopped after memory pressure. Retain the original
  more-than-a-day requirement; use a resource-safe uninterrupted window and do
  not run it alongside other local test/build/browser workloads (decision #52).
- SPN-013: retain low impact, high effort and optional status. No reproducible
  capacity rejection was found at the tested bounds. The queue needs positive
  evidence before implementation; do not infer unlimited capacity or retire it.
- SPN-014: the live service/transport boundary exists for a possible replacement,
  but replacement remains an owner choice in #42 and depends on SPN-010.
- SPN-016: no guest token route exists. Extend document-scoped authorization
  across HTTP, images, socket admission and final commits, including disabled
  links. Do not let guests list accounts, personal metadata or history merely
  because authenticated viewers can read those document endpoints.
- SPN-018: the dashboard lists owned items and authorized shared folder children,
  but has no shared drawer or personal placements. Store per-user references;
  removing one cannot alter the owner's parent, item, grant or history. Existing
  grants have no creation timestamp; the newest-first drawer needs a documented
  ordering/migration policy rather than pretending item modification is share time.
- SPN-019, SPN-020, SPN-022: tags, pins and metadata search remain absent.
  Reuse the current access resolver for reads and personal mutations, including
  viewers, revoked shares and trash. Personal tags/pins do not grant document
  edit permission or reveal another person's organization. Retain current sizes.
- SPN-025: raise effort M to L and expose decision #55. The public
  RevertRevisionMutation probe restored a Sheet to an earlier collaboration
  revision by creating a newer revision, but it does not replace arbitrary native
  checkpoints. Native and collaboration revision numbers are separate. The
  complete slice still needs a supported replacement path, exact pre-restore
  capture, image validation, stale-write fencing and two-editor verification.
  Draft PR #54 remains a probe, not a completed restore feature.
- SPN-026: reuse the landed metadata/naming API and SPN-025 preview; timeline and
  calendar controls are still absent. Retain its restore dependency.
- SPN-027: current styling is not the gem-rail theme. Preserve the original design
  sources, contrast checks, theme-aware cell presets and source-cleanup criteria.
- SPN-028: no manifest/service worker or mobile install flow exists. Add SPN-027
  as the dependency already implied by using its logo; keep private payloads out
  of caches and retain touch/offline verification. Public hosting remains a
  separate ticket, not a dependency invented for the existing Tailscale scenario.
- SPN-031: snapshot stores are not portable import/export. Include image bytes,
  remap URLs and capture materialized current collaboration state; old native
  snapshots can be migration baselines rather than today's content. Retain
  format/size/PDF decisions and round-trip verification.
- SPN-032: reuse backup status, the history prune scheduler and the collaboration
  purge queue; do not claim all jobs are absent. Aggregate health remains missing.
  Report missing configuration/failures honestly without exposing document names
  or giving the app host-control privileges.
- SPN-033: no live embedding exists. Source authorization must hold in rendered,
  cached and exported payloads, not only the insert dialog. Slides remains out
  of scope until SPN-009.
- SPN-034: optional MCP still awaits owner decision #41; no built-in AI feature
  is authorized. Existing passkey sessions are not scoped assistant tokens.
- SPN-035: retain post-production conversion and SPN-031 dependency. Native
  snapshots and existing backup archives do not establish Office fidelity.
- SPN-036: current presence uses deterministic colors and initials; profile
  controls do not exist. Add SPN-027 as the dependency for its specified 16
  theme presets. Keep icon reference migration and cross-editor presence checks;
  wiring saved profile fields into existing presence belongs here, while rebuilding
  collaboration transport does not. The current transport supplies names and empty
  avatars, and the view still derives six colors from user IDs.
- SPN-038: no public host is deployed. Retain owner timing decision #40, guided
  fresh A/AAAA setup, new-origin enrollment, public security/TLS checks and
  rollback. Historical private-host verification and its IPv6 waiver do not
  establish public dual-stack behavior or authorize new resources.

Decision #60 records the persona tradeoffs. Existing resolved choices
remain in maintained docs: #30 trash, #34/#36 Spaces recovery, #37/#43–#49
collaboration, #39/#51 history capture, #52 resource-safe verification, #56 named
versions and #58 administration. Decisions #40, #41, #42 and #55 remain open.
Other effort/impact/must-ship estimates remain appropriate; no new ticket is
needed because the observed integration work belongs to existing acceptance
criteria. Reset the seven-ticket counter and select again by generated points,
skipping unresolved external and owner blockers without changing their criteria.
