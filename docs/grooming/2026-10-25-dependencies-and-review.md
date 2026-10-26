# Grooming: current feature handoffs, dependency updates and optional captures

At the owner's request on 2026-10-25, reviewed all **31 open tickets** against
main `607924d71fe60917eeff643c8a5ad8f43c811d72`, maintained decisions and actual
application/library entry points. Two independent read-only assessments covered
the complete backlog: sync/offline/launch (13 tickets) and product/export/design
(18 tickets). All four personas were considered. This is a source-and-scope
audit; it does not claim that pending features passed runtime acceptance.

The owner requested Dependabot PRs one at a time and approved CI improvements
inside this grooming PR, with **no new ticket**. All 31 existing outcomes remain
needed. No ticket is deleted, renumbered or added; existing efforts, phases and
dependency edges remain. The next ID stays SPN-105.

## What changed since the previous grooming

The previous full grooming was 2026-10-21. Its 24 subsequent completions were
SPN-042, SPN-078, SPN-091, SPN-064, SPN-092, SPN-079, SPN-043, SPN-061,
SPN-050, SPN-096, SPN-097, SPN-045, SPN-100, SPN-048, SPN-082, SPN-083,
SPN-032, SPN-081, SPN-103, SPN-104, SPN-049, SPN-101, SPN-085 and SPN-084.
This record preserves that history while the full-grooming metadata resets the
reminder counter and date.

Spaces and File admin delegation are now live. Profile/editor/history/guest
screen migrations and the standalone Sheet PDF renderer have landed. The
transform library's first pass is delivered, while SPN-056 deliberately remains
the independent integrated server/client review before activation. Those changes
make several older ticket handoffs inaccurate without completing their remaining
outcomes.

## Corrections to existing tickets

| Tickets | Correction and evidence |
| --- | --- |
| SPN-051 | A folder is in the prepared account's cached catalog; only native items are downloaded. Scope offline creation to signed-in ordinary documents and permitted outer folders. Preserve existing online Edit-guest Space-child creation. `Dashboard.canCreate` still excludes local creation. |
| SPN-053/054/055/090 | Carry landed exact root/child identity through future offline replay/recovery and stable links. `OfflineAccess`, stored bundles and `spaceNavigation.ts` already distinguish Space children. Preserve per-child preparation and account-only recovery; no bulk Space download or guest outbox is introduced. |
| SPN-057 | Clarify the already-authorized metrics-only default. The optional redacted-shape proposal remains needs-owner and does not block metrics-only server implementation. Add the existing guest-denial effect to persona metadata without changing its score. |
| SPN-058/099 | Remove conditional waiting language for landed profile data and SPN-104's library. SPN-099 still needs stock-upstream compatibility and patch removal; its future work must recheck dated upstream status. Keep the latent both-COVER reproducer concern without contradicting its no-new-local-patch policy. |
| SPN-065/066/067 | Distinguish content-blind server Operators from everyday File admins. Preserve read-based copy eligibility and the owned-items archive boundary. `GrantRole` and `is_admin` are separate authorities. |
| SPN-065 | Reuse native-import creation/validation primitives while preserving the accepted copy-specific Formula bindings. `PortableFiles.import` deliberately detaches source bindings, so the whole import policy cannot be reused unchanged. Default copy placement stays separate from SPN-069's explicit shared-folder destination. |
| SPN-066 | Link expiry must reuse SPN-084 immediate hiding, including dirty guest input and truthful generic warnings. Replace the obsolete retained read-only guest-editor acceptance. Network failure remains distinct; account recovery is unchanged. |
| SPN-070 | Use the landed Your profile → Passkeys section, preserving OAuth/assistant-connection flows. Self-service removal is still missing; Operator removal is already present. |
| SPN-071 | Rename “Leave shares” to “Hide shares” to match the ticket's already-accepted personal-only hiding behavior without revoking grants. Keep live role-upgrade acceptance: current collaboration still requires reload on role changes. |
| SPN-072 | Keep its actual phone Doc reading/editing, keyboard and IME evidence. SPN-090 owns offline launch/storage/reconnect device evidence, not every physical-phone check. No dependency between the two is needed. |
| SPN-075 | Reuse SPN-101's landed `@spinel/print`, selected backend and Docker/workspace integration. Retain XL for remaining application authorization, isolated work/cancellation, source preparation and complete account/guest acceptance; do not rebuild renderer scaffolding. |
| SPN-089 | The migration prerequisites are complete. Keep the residual inventory, starting with the native Insert/Edit formula dialog in `DocFormulas.tsx`, whose heading still lacks its semantic icon. No product dialog is changed in this grooming. |

The maintained [offline handoff](../offline.md#space-child-editing-and-recovery-handoff)
collects the Space requirements. Existing ticket scenarios and decisions remain
authoritative; this grooming adds compatibility clarifications rather than new
product capabilities.

## Complete backlog disposition

Every row remains open. Effort and sequencing were checked against what is still
missing, not against line counts or the existence of a related fixture.

| Ticket | Remaining outcome | Disposition |
| --- | --- | --- |
| SPN-051 | Durable offline creation, stable identities, idempotent upload and forbidden-folder recovery. | L; after SPN-053. Clarify cached folders and guest boundary. |
| SPN-052 | Editable desktop-tab restart/reconnect and actual macOS browser persistence evidence. | M; after SPN-055, independent of SPN-090. |
| SPN-053 | Durable outbox, local-save transaction boundary and exactly-once acknowledged replay. | L; after SPN-059. Current offline viewer is read-only. |
| SPN-054 | Separate recovery copy/export when the live base or access changed. | M; after SPN-053. Include exact Space-child scope. |
| SPN-055 | Persistence reporting, usage, pending-edit-safe cleanup/migrations and account exit. | M; after SPN-053. Preserve actual pending-sign-out/store-probe leftovers. |
| SPN-056 | Fresh independent integrated server/client/native/convergence review before activation. | XL; after SPN-058. Preserve the deliberate second pass. |
| SPN-057 | Durable ordering, authorization/commit atomicity, retry identity and divergence handling. | L; no ticket dependency. `lib/sync-server` is not implemented. |
| SPN-058 | Optimistic client queues, rebasing/reconnect, no-echo application and native presence. | XL; after SPN-057. `lib/sync-client` is not implemented. |
| SPN-059 | Actual cutover, retained-data handling and removal of Pro collaboration. | L; after SPN-058 and SPN-056. Include current Space/history regressions. |
| SPN-065 | Copy with fresh identity, independent images and deliberate Formula bindings. | M; existing native import/export is a foundation only. |
| SPN-066 | Central owner-only guest-link inventory, enabled dates and link expiry. | M; per-file enable/replace/off already exists. |
| SPN-067 | Streaming owned-workspace archive and atomic import, including Space trees. | L; single native-file transfer does not complete it. |
| SPN-068 | New Sheet image upload/paste/drop with sync, reload and history proof. | M; current guard deliberately rejects insertion. |
| SPN-069 | Creation in shared folders, folder-owner attribution and account creator metadata. | M; ordinary parent validation remains owner-only. |
| SPN-070 | Self-service passkey removal and other-session sign-out with fresh verification. | M; preserve last-passkey and credential-specific race protections. |
| SPN-071 | Personal hiding, authorized granting-ancestor provenance and in-place role upgrades. | M; discovery/placement and reload-based role handling do not complete it. |
| SPN-072 | Readable phone Docs, touch selection, keyboard/IME evidence and supported fallback. | L; theatre/panning evidence does not establish device editing usability. |
| SPN-075 | Production PDF preparation, access, isolation, cancellation, downloads and Pro removal. | XL; after SPN-102. Reuse landed Sheet/backend work. |
| SPN-076 | Explicit opt-in Formula-source sharing with fresh authority and partial-failure honesty. | M; its prerequisite sharing-pattern design remains required. |
| SPN-086 | Persistent icons/colors/covers/accents, assets lifecycle and refined artwork. | L; current appearance examples are local fixtures. |
| SPN-087 | Remove real obsolete fixture CSS and localize screen examples where useful. | M; separate from this PR's CI execution changes. |
| SPN-089 | Residual semantic modal-title inventory and actual omissions. | S; no migration dependencies remain. |
| SPN-090 | Actual Android/iPhone offline install, storage-context, restart and reconnect evidence. | M; after SPN-054 and SPN-055. Virtual viewports do not complete it. |
| SPN-095 | Automatic 30-day Space recovery expiry with identity-safe bounded cleanup. | M; current batches deliberately retain `expiresAt: null`. |
| SPN-098 | Durable acknowledged feedback, idempotent retry and Operator flags. | M; diagnostics ingestion/export is a foundation, not feedback acceptance. |
| SPN-099 | Run stock upstream core, adapt regressions and remove guarded local patches. | M; SPN-104 is delivered. Recheck upstream status when work starts. |
| SPN-102 | Complete standalone Doc/Formula pagination, tables/images and every-page proof. | L; current print public entry exports Sheet rendering. |
| SPN-063 | Repeated isolated application restore verification against the selected backend. | Launch, M; backup production/tooling exists, recurring proof does not. |
| SPN-038 | Owner-coordinated public deployment, DNS/certificates and credential cutover. | Launch, L; after SPN-063. Preserve the owner's explicit S-impact decision. |
| SPN-093 | Bounded literal CSV import with established UTF-8/field preservation. | Post-launch, M; after SPN-038. Existing import accepts native JSON only. |
| SPN-094 | Trusted document-type/converter plugin foundation and reference examples. | Post-launch, XL; after SPN-038. Extraction discussion is not additional acceptance. |

## Decisions and persona coverage

The existing dependency chains remain coherent: SPN-057 → SPN-058 → SPN-056; SPN-058 + SPN-056 → SPN-059;
SPN-059 → SPN-053 → SPN-054/SPN-055; SPN-055 → SPN-052;
SPN-054 + SPN-055 → SPN-090; SPN-102 → SPN-075; and
SPN-063 → SPN-038 → SPN-093/SPN-094.
These arrows describe prerequisite-to-dependent order, not ticket frontmatter
syntax. No dependency is added simply to hide an external decision or device gate.

- **Operator:** retain content-blind administration, bounded sync/storage,
  actual backup recovery proof and explicit public-deployment authority. The
  main ruleset now requires all seven documented checks, including the plain
  **Lib tests** aggregate; the owner changed it and the saved API state was verified.
- **Owner:** preserve complete content/history/recovery and the selected guest
  privacy policy. Screenshots are requested when visual review needs them.
- **Collaborator:** preserve durable shared edits, personal organization and
  transparent access, without confusing File admin grants with Operator accounts.
- **Link guest:** preserve online scoped Edit capabilities and immediate denial;
  offline persistence remains excluded, while planned PDF uses current read access.

Still-pending owner input is explicit: public launch timing/resources in SPN-038 and
optional redacted sync shapes in SPN-057. The latter's accepted metrics-only default
allows implementation to proceed without approving collection. Specific future
artwork/design approvals in SPN-086/SPN-076 remain; this session's delegated visual review
does not preapprove unbuilt screens. Actual device acceptance in SPN-052/SPN-072/SPN-090 remains
physical evidence, independent of the screenshot scheduling policy.

## Dependabot review and sequencing

Eight open PRs were inspected for their proposed files, current-head CI and
compatibility. They remain separate existing PRs. The owner authorized handling
them one at a time after this grooming/CI change, with fresh main and passing
current-head checks before each merge. This inventory is a disposition, not a
claim that stale runs validate future rebases.

| PR | Observed evidence | Required disposition |
| --- | --- | --- |
| [172](https://github.com/mxbaylee/spinel/pull/172) Storybook 10.6.2 | Prior CI and Storybook passed. The [official release](https://github.com/storybookjs/storybook/releases/tag/v10.6.2) lists two security fixes. | Review and revalidate first in this package pair; it supplies #168's peer prerequisite. |
| [168](https://github.com/mxbaylee/spinel/pull/168) React/Vite Storybook 10.6.2 | [Install failed](https://github.com/mxbaylee/spinel/actions/runs/40246889304/job/121330663161): it requires Storybook ^10.6.2 while core remained 10.3.5. | Rebase after #172 and verify the compatible package set; do not bypass peer checks. |
| [164](https://github.com/mxbaylee/spinel/pull/164) download-artifact 8.0.2 | Storybook passed; [production tags journey timed out](https://github.com/mxbaylee/spinel/actions/runs/40246802979/job/121331381763). | Review the action's major-version contract and revalidate current main; no dependency-causation claim from that timeout. |
| [167](https://github.com/mxbaylee/spinel/pull/167) upload-artifact 7.0.2 | Prior CI/Storybook passed; [official release](https://github.com/actions/upload-artifact/releases/tag/v7.0.2) updates artifact transport/retries. | Verify pinned action identity, compatibility and actual build/evidence upload behavior after grooming. |
| [170](https://github.com/mxbaylee/spinel/pull/170) Lucide 1.59.0 | [Unit failure](https://github.com/mxbaylee/spinel/actions/runs/40247108609/job/121331729075) identifies mismatch between the local icon catalog and new pack. | Repair/review the catalog update and visual impact in that PR; preserve the exhaustive catalog assertion. |
| [165](https://github.com/mxbaylee/spinel/pull/165) Docker Node 26 | Prior checks passed, but only Docker changed while CI/local baseline remains 24.19.0. | A Node-major decision needs coherent runtime/CI evidence; an old green Node 24 run does not establish Node 26 application acceptance. |
| [171](https://github.com/mxbaylee/spinel/pull/171) Node 26 types | [Typecheck failed](https://github.com/mxbaylee/spinel/actions/runs/40247252960/job/121336052308) at the native PDF fixture's optional function call; a browser job also failed. | Review with runtime alignment, repair actual typing safely and revalidate; do not silently type against unsupported runtime APIs. |
| [169](https://github.com/mxbaylee/spinel/pull/169) React DOM 19/types | [Install failed](https://github.com/mxbaylee/spinel/actions/runs/40247025677/job/121331556278): React/React types remain 18 while DOM packages require 19. | Preserve the existing coherent React baseline until the complete runtime/types cohort is reviewed; keep the existing PR visible for that work. |

Storybook and React package families need coherent version sets. Node container,
CI/runtime pin and Node types also need coordinated review. No force install,
alternate registry, automatic merge, new Pro dependency or new ticket is introduced
by this inventory. Detailed repair/merge outcomes belong to the individual PRs.

## Storybook policy and verification

The [accepted capture decision](../implementation/backlog-workflow.md#on-demand-storybook-captures)
keeps full rendering/play/error assertions and existing native/control journeys,
while ordinary PRs and main pushes omit routine PNGs. `visual-review` or manual
`capture_screenshots=true` requests the galleries; failure evidence remains.
Desktop themes are separate jobs, with once-only work assigned to light. All
five variants and the strict aggregate remain.

The source baseline was 18m15s desktop, 7m43s tablet and 9m24s phone light in
[SPN-084's successful run](https://github.com/mxbaylee/spinel/actions/runs/40255440330).
The main desktop loop produced 2,142 captures; its timing includes assertions and
rendering, not only image encoding. The grooming PR records exact-head CI for
both modes, artifact/count inspection and comparable wall/runner time. All
executable validation is in CI; no local test, build, preview or rendering pass
is claimed by this source record.
