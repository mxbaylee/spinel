# ⬆️ Consolidate the remaining compatible dependency updates

## 🧭 Decision and complete scope

2026-11-11, agent decision under the owner's request to aggregate open Dependabot
PRs repeatedly until only updates requiring individual handling remain. Resume
[#273](https://github.com/mxbaylee/spinel/pull/273), preserving its history and
failure evidence. Its previous description was stale: source `9d7acbdd` already
excluded Canvas. The new request authorizes extending that cohort with Node's
same-version image refresh; it supersedes the earlier same-PR recovery's narrower
three-update scope, without changing any acceptance guard.

Complete estimated outcome: **M**, including current-main integration, lock and
historical-source consistency, local regression checks, two independent reviews,
hosted native/container/provider acceptance and guarded squash/branch cleanup.
The early checkpoint found no dependency conflict: merge main
`8511f944518787eb82aa3dca282c33c5e59ed16a`, retain the three compatible npm
updates, and include #274's two identical Dockerfile digest changes. No new
product behavior, test policy, permission or CI selection rule is introduced.
The existing `⬆️ Bump` title exception applies; this is not backlog grooming.

- #269, source `971f3269193282767963c3b7c9ef44573c59dd5f`:
  `@storybook/react-vite` 10.6.2 → 10.6.5, matching core already on main.
- #270, source `bf718aa9ef0d71e4afda501e637207df830ebcc7`:
  `@types/node` 26.6.5 → 26.6.6, retaining runtime 26.13.0.
- #272, source `3d1b01701a017df39ae655b5fd7228b905ad4c2b`:
  `@aws-sdk/client-s3` 3.1160.0 → 3.1161.0 and its exact transitive update.
- #274, source `21b6fa6fa96389664b0d83f85ac5f309ad3cf327`:
  Node 26.13.0 bookworm-slim index `bc0a2af…` →
  `add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68`.
  Registry inspection resolves the pinned official image index, including amd64
  `51d24d08800f352afae68628d883e63db3f2c4dd807b7ddb6f805dc6b9ef8c0e`
  and arm64 `067b2d425f1204b5a898ae3d3145f7524c1425a4096a62b0f67dd4344a494440`.
  Both stages remain on the same immutable image. Local Docker daemon is absent;
  registry inspection is not an image build or container execution.

The 32 changed installed-package lock records exactly match the three bot source
updates; all other installed records stay unchanged. The complete lock hash is
`268591be235eb52d14b907112c548d9a71b2c274bba0d756c8e8decae3ac94a6`.
The preserved comparison sources `e4d361f0ce3c08d4a1e80b000e29f2c2f28f6670`
and `f609961e4a2460bae0feedb62cedd722af270e86` have byte-identical locks and
matching dependency maps in all eight manifests. Their active `ci-baseline/`
retention branches remain necessary. Main's new harness overlays are preserved.

## 🧪 Regression contracts and evidence

Preparation source `b77d14480d223b26f05fb6c4f7fe65e16391f75a` contains the
complete application/dependency change. Subsequent edits retain this record and
receipts only. Use verified Node 26.13.0, the shared serial runner and a polling
process-tree watchdog: normal macOS pressure, at most 2 GiB RSS and eight minutes.
No new test or duplicate browser environment is needed for this update.

- Clean `npm ci`: passed with all five guarded Univer patchers, 10.495 s,
  peak 1,088,096 KiB. Existing npm install-script notices remain visible.
- Native Sheet/Doc/PDF suites (`native`, `doc-native`, `pdf-geometry`,
  `doc-multiple-images`, `doc-story-geometry`): **38/38 passed**, 36.437 s,
  peak 971,056 KiB. Existing isolated font/output fixtures own complete content,
  geometry, resource-failure and cleanup assertions. Canvas stays at 1.0.11.
- Callback comparison, responsiveness, immutable CI plan, fail-closed result,
  desktop storage, Safari identity and dependency-boundary controls:
  **196/196 passed**, 2.728 s, peak 791,312 KiB. These include selected missing/
  failed-result rejection; source/shared dependency routing stays unchanged.
- Independent lock/baseline/manifest/Dockerfile-source audit: passed. Its first
  attempt lacked two local Git objects; fetching the source PR refs resolved
  that inspection prerequisite without changing the candidate.
- Typecheck's first attempt was **resource-aborted** at 5.779 s, peak
  1,649,168 KiB, when macOS pressure became elevated. Lint then refused startup
  under the same pressure. Neither is a passing check. Later results and review
  identities belong in the final PR evidence.

Hosted CI owns Linux image construction, all selected application/native browser
workers, Storybook interactions, first-attempt historical comparisons, and real
Spaces backup/catalog/restore cleanup. Local fixtures reuse their established
readiness/cleanup; the container and provider workflows exercise distinct
packaging/remote-service boundaries. All seven current-head gates and every
selected ancillary workflow remain required. No pending or earlier-source pass
qualifies the current head.

## 🔎 First failures and remaining individual updates

The previous no-Canvas source `9d7acbdd` passed core CI 42417327016, Storybook
42417326897 and Spaces 42417326963. Native workflow 42417327013 failed:
Firefox job128538139549 exhausted the IndexedDB deletion deadline; Safari
job128538139351 could not make the owned tab frontmost. Chrome passed. Preserve
these as failures, not retries or accepted results. Main now includes SPN-141's
quiescent storage/client-release work and SPN-140's Safari automation work.
Fresh native acceptance is required; integration alone does not prove either
specific historical failure is resolved.

- **Print #275** (`226c883791adfcfc52cf7b1d9ddcf9096fb729ae`) combines Canvas
  1.1.0 and PDF.js 6.5.438. Canvas's original #271 was superseded by the bot.
  The two strict image-boundary failures and retained original outputs remain
  in [the recovery record](dependabot-2026-11-07.md#-same-pr-recovery-exclude-canvas).
  This grouped update needs its own compatibility repair and visual review;
  passing macOS fixtures did not override the Linux failures.
- **Univer #240** remains an explicit peer/guarded-patch migration. Core 1.3.1
  conflicts with the exact 1.1.0 presence-UI peer; existing patches and their
  regression contracts must be assessed together. Do not weaken peers or
  patch guards merely to install it. SPN-099/119/122/147 retain their own scope.
- **Caddy #238** retains a failed supervised-restore bootstrap whose original
  exception was not captured. The changed Caddy image was not used in that
  localhost fixture, so image causation is unproved. Its next step remains
  bounded first-failure startup diagnostics and a negative control, as recorded
  in its PR. Combining it here would conceal that unresolved acceptance work.

Recheck each included bot head against landed main before closing it. Do not
close the three excluded updates as if installed. After the compatible aggregate
lands, inspect the remaining set again; no second compatible aggregate is
identified at this checkpoint. Required compatibility repairs remain visible.

## 👥 Persona tradeoffs

Operator gains fewer review queues, patched storage tooling and a pinned image
without losing recovery/provider proof. Owner keeps the established PDF renderer
and document preservation. Collaborator keeps concurrent-editing and permission
contracts. Link guest keeps scoped access and immediate revocation. All four
favor keeping incompatible updates visible over hiding an acceptance failure.
This changes no product design; reviews are agent-only. Existing rendering and
interaction checks remain required without redundant routine UI captures.

### 🧾 Local completion checkpoint

After pressure returned to normal, full lint/dependency/format checks passed in
17.804 s at 651,696 KiB. Backlog and exact-title PR-shape validation passed;
only the existing nonblocking ticket-length/grooming notices remain. The bounded
compiler attempt (`NODE_OPTIONS=--max-old-space-size=768`, `GOMEMLIMIT=512MiB`,
`GOGC=50`) was also resource-aborted, at 10.188 s and 1,766,336 KiB; no TypeScript
diagnostic was emitted. Full typecheck remains explicitly deferred to hosted CI.
The guards and compiler configuration in the repository are unchanged. The
[local receipts](evidence/dependabot-2026-11-11/) retain commands, elapsed time,
peak observed RSS and both aborts; successful install/control/PDF logs are
compressed beside them. No local typecheck pass is claimed.
