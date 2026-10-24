# Grooming before extracting offline dependencies

Rechecked all 11 open tickets against main `2640c42` after SPN-028 and SPN-026.
Draft SPN-039 / PR #86 has about 8,400 counted changed lines and substantial
application, storage and device work still ahead. The early grooming registers
reviewable implementation dependencies before extraction; it does not complete
SPN-039, change production priority or waive a failed test. Decision [#91](../implementation/SPN-039.md#legacy-decision-91-offline-prerequisites-without-partial-completion).

- SPN-040 adds existing Sheet-image support. Main explicitly refuses these
  imports and has no drawing preset; the draft implements a separable shared
  import/render/export/history/access slice. Medium effort/impact, optional.
- SPN-041 acquires exact authorized replay bases after SPN-040 supplies shared
  image handling. Main's materialized native read is not a complete replay
  bundle. Medium effort, large impact for recovery integrity, optional. A bundle
  does not include downloaded image bytes or establish offline readiness.
- SPN-039 now depends on both, retaining L/L and its complete offline contract.
  Draft recovery/transport experiments and unwired local adapters remain here.
  Guarded replay has not yet passed, and separate fixtures do not prove a combined
  recovery boundary. No internal slice is treated as a finished offline feature.
- SPN-010 uses the settled future `https://spinel.baylee.dev` endpoint from [#76](../implementation/SPN-010.md#legacy-decision-76-cancel-the-duration-soak).
  Deployment and an uninterrupted browser runner/window remain unavailable.
  Retain the 25-hour continuity requirement, memory guard and independent review;
  adapt authenticated disposable-account tests without exposing the permissive
  experimental harness on the public host.
- SPN-013 stays optional, low impact/high effort and inconclusive. The app's
  64-connection guard is not evidence of an SDK licensing limit.
- SPN-014 remains L/M, owner-blocked by [#42](../implementation/SPN-014.md#legacy-decision-42-replacement-of-pro-collaboration) and dependent on SPN-010. Preserve
  landed guest/revocation, checkpoint, restore-generation and purge behavior
  when considering a replacement, rather than only the earlier SPN-012 baseline.
- SPN-033 remains L/M; no live embed exists. Record stable source item identity
  across restored SDK generations and require revoked-source checks in rendered,
  cached, previewed and exported content. Source isolation remains mandatory.
- SPN-034 remains optional M/S, awaiting [#41](../implementation/SPN-034.md#legacy-decision-41-initial-mcp-deferral). Any future token interface must use
  current grants and the live commit/restore boundary; it cannot replace a live
  document through a new whole-snapshot write path. Decision [#92](../implementation/integration-boundaries.md#legacy-decision-92-stable-integration-boundaries)
  records these integration constraints together with SPN-014/SPN-033.
- SPN-032 remains M/S: backup status, pruning and purge infrastructure exist,
  while aggregate health is absent. Keep the existing integration requirements.
- SPN-038 remains M/L, timing-blocked by [#40](../implementation/SPN-038.md#legacy-decision-40-public-launch-timing). Hostname, private management,
  enrollment, TLS/proxy, guest isolation, dual-stack verification and rollback
  are still accurate. [#76](../implementation/SPN-010.md#legacy-decision-76-cancel-the-duration-soak) authorizes neither provisioning nor a soak.
- SPN-036 remains M/M: the 16-color palette exists, but profile controls do not;
  presence still uses initials, six derived colors and empty avatars. Preserve
  generic identity in guest-enabled rooms and the icon reference migration.
- SPN-035 stays post-production L/S. Native files do not establish Office
  conversion fidelity; new image support alone is not a mandatory dependency.
- SPN-009 stays last, optional L/S. Slides is a placeholder with no editor
  package; public SDK/licensing and theme review remain required.

All four personas retain coverage: the Owner keeps the entire requested offline
experience; Collaborators retain rights and durability; the Operator gets bounded,
reviewable integrations without another service; Link guests gain no private
replay/offline privilege and retain source/identity isolation. Neither new ticket
is must-ship: existing unsupported Sheet imports are refused explicitly, and
SPN-039 remains optional for production.

The two completed tickets reset the grooming counter. Select by regenerated
points, skipping unresolved external/owner blockers. Keep draft #86 and its
original evidence until extracted changes pass their own exact-head review and
CI. No IDs were reused, no open ticket was removed and no acceptance was dropped.
