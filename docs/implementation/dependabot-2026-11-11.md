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

## 🔧 Second aggregate: retained patches and the three remaining updates

2026-11-11, owner direction in chat: finish the three Dependabot PRs before
SPN-147; Univer patches may be reapplied after precise source comparison.
This supersedes the earlier stock-only upgrade checkpoint and the preceding
separate-PR plan. Resume #240 with #275 and #238, preserving their failure
history. Close the superseded PRs only after the aggregate actually lands.
Complete outcome is **XL**, including five guarded OSS patch migrations,
SDK/peer/lock consistency, retained offline runtimes, native PDF geometry,
first-failure startup diagnosis, historical comparison sources, visual review,
two independent reviews, all selected CI and guarded branch cleanup. This is
an aggregate dependency exception, not completion of the unpatch tickets.

Sources and intended versions:

- Univer #240: bot source `24e1f3394a6a59799b9a6a0be3f29f1e005210b6` and checkpoint
  `243151b94c16da82e918acd52d9e31cf61f560b5`; every SDK package/peer is 1.3.1.
  The [precise source comparison](SPN-099.md#-retain-reviewed-patches-while-updating-dependencies)
  records unchanged patch targets and the drawing controller adaptation.
- Print #275: `5c29dad4b38193c3bf140d0f2202bf9d9fc7b68f`, Canvas 1.1.0
  and PDF.js 6.5.438. Its manifest/lock changes were integrated while preserving
  the Univer dependency updates. No text-renderer override or relaxed image
  boundary assertion is included. Prior Linux geometry failures remain open
  pending the combined candidate's native output and a supported repair.
- Caddy #238: `ff0872497ad8a83856e77b4d404333f85a020117`, only its pinned
  Compose digest changes to
  `e70b164da81ef698b3ad19af799ea6086ce6d9e48ed4079eb9fe26f6fbf14ee5`.
  The earlier localhost bootstrap failure remains unexplained, not attributed
  to Caddy. Bootstrap now emits only a bounded stage and error-name identity;
  private exception text/stack are excluded. A deliberate rejected-import unit
  control exercises the actual catch. Manually created restore browser contexts
  observe startup diagnostics before the first page and retain first-failure
  traces; their journey, timing limits and fail-on-flaky policy stay intact.

### 💾 Actual SDK identity and retained offline evidence

The current client/build and newly created Sheet metadata now identify 1.3.1.
The legacy compatibility constant remains 1.1.0. A no-host unit contract accepts
only the current SDK. Active positive UI/offline/Storybook fixtures follow the
new identity; historical fixtures remain historical.

The existing sequential offline-upgrade environment still builds three real
applications. Its eager legacy054 client comes from
`c2e8cac0fcdec36d992d6ebf3f377c9b579a8002`; host A and its initial backend
come from the last genuine 1.1.0 source
`3a0e2238fb5be3907d04120eabda2aafd6565d63`; host/backend B are the candidate
with SDK 1.3.1 and fixture format 2. CI installs each immutable source's exact
lock/postinstall patches. Archive workspace links stay within the archive.
No archived bytes are relabeled and no worker compatibility guard is weakened.
The retained journey proves legacy adoption and old-runtime reopening/auth
admission after deployment while preserving pending data. It deliberately holds
sync; it does not claim old pending mutations drained into the new backend.

Historical performance descendants retain their previous application and
pre-fix behavior while matching the candidate's eight manifests and complete
lock. They keep exactly the historical three postinstall patchers; no current
Doc optimization, Doc UI repair or core channel pooling is copied into them.

- Responsiveness: `ae2885ede75a168711a712a837245bc7d61b0abc`, parent
  `e4d361f0ce3c08d4a1e80b000e29f2c2f28f6670`.
- Callback: `2a49413a1d4d8841289412e311ddd237f522afa5`, parent
  `f609961e4a2460bae0feedb62cedd722af270e86`.

### 🔕 Quieter routine dependency checks

Owner explicitly selected **“Apply the quieter configuration”** in chat on
2026-11-11. npm, root Docker, deployment Compose (Caddy only), and GitHub Actions
now check monthly at 09:00 America/Los_Angeles, with at most two open routine
PRs per ecosystem. Monthly means the first day of the month, not every 30 days.
The seven-day npm cooldown stays. Ordinary npm minor/patch updates share one
group; Univer and print-rendering retain separate groups. Major updates remain
eligible and separate. Existing security grouping remains unchanged; routine
schedule/cooldown/PR caps do not delay security advisory-triggered updates.
See GitHub's [options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)
and [security trigger behavior](https://docs.github.com/en/enterprise-cloud%40latest/code-security/concepts/supply-chain-security/dependabot-pull-requests).
This reduces routine interruption without promising exactly two total PRs.

All four personas favor this tradeoff: Operator has a smaller routine review
queue and timely security remediation; Owner keeps document and print fidelity;
Collaborator keeps synchronization and retained edits; Link guest keeps scoped
access and revocation. Broader npm groups may take longer to qualify, so SDK and
rendering groups stay isolated and majors remain explicit.

### 🧪 Current validation checkpoint

The first precise source inspection verified pristine 1.1.0 and 1.3.1 package
bytes against their lockfile integrity, compared affected upstream regions, and
refreshed whole-bundle ES/CJS guards and all 22 Doc A/B variant identities.
Patch algorithms outside the reviewed drawing adaptation are unchanged.
Existing upstream #7938 and #7969 remain open, unmerged and mergeable on
`5a06a7842c8e13fa0646d0733dc3662cf4b330b9`; their repair semantics are unchanged,
so no unnecessary upstream rebase or new submission is claimed.

Local test/build/browser execution is deferred while macOS memory pressure
reports `2`; no current candidate install or runtime check has passed yet.
Formatting edits and source inspection do not substitute for execution. The
previous stock-only failures are preserved in SPN-099's record and are not
results for this patched candidate. Required next evidence includes a fresh
install, all five patch/negative-control suites, native semantic/fuzz checks,
offline admission/retention, Linux PDF geometry, first-attempt supervised restore,
matching historical comparisons and selected desktop/container/provider work.
All seven current-head CI gates and every selected ancillary result, both exact
commit grades and independent light/dark/phone visual review remain required.

### 🔎 First hosted candidate and focused fixture repairs — 2026-11-12

The owner approved publication of `7d545cb4dcf5382c86fc6bd94cff2f8904e981b8`
and then directed “no need to ask questions, do whatever to get these merged.”
This authorizes necessary repair/review/validation cycles without repeated push
permission requests. Preserve actual acceptance and independent reviews; missing
or failed checks remain failures. Initial exact-head reviews were 98/100 and
95/100, both deducting only resource-blocked local execution. Original source
findings (diagnostic collection masking the first error and stale SDK commentary)
were repaired before that publication. No product/ticket merge gate is waived.

[CI 43204077899](https://github.com/mxbaylee/spinel/actions/runs/43204077899)
ran the full immutable plan. Fresh installation, typecheck, lint, backlog, PR
shape, container smoke, retained sync transition, sized restore, offline SDK
upgrade and both Sheet/Doc soak projects passed on that head. This is first-head
provenance, not evidence for a later repair. Local pressure still reports `2`.

- Cells job `131135102830`: **105 passed, 1 failed**, 156.29 s. The failure
  is the final old numeric/string expectation at `cells.test.ts:845`; the
  preceding two-way convergence and real native loser-then-winner assertions
  passed. Comparing upstream `set-range-values.mutation.ts` identifies 1.3.1's
  new `canPreserveValue` / `numberFormatChanged` logic: a style-only write
  preserves the previous value/type unless the number format changes. The
  existing boolean therefore remains `{v: 1, t: 3}` on both sides. Update this
  exact version-specific expectation/comment while retaining all convergence,
  native-order and other cell-format cases. No transform algorithm changes.
- Unit remaining job `131135102883`: Node suites **806 passed, 5 failed,
  2 skipped**; the following Vitest phase did not run. Four failures are the
  callback source verifier's stale complete-package allowlist. Recompute the
  four pristine/patched ES/CJS hashes from guarded 1.3.1 sources and replace the
  old allowlist; retain rejection of unrecognized source bytes. The fifth is
  the complete ES module fixture resolving `@univerjs/rpc` from its temporary
  location instead of Docs' real nested dependencies. Link the fixture's local
  dependency directory to the installed Docs dependency directory and resolve
  CJS requires from the actual Docs module location. Preserve full-module
  execution and the missing-ActionIterator negative control.

All five patch families' direct suites completed in that Node phase, including
both drawing formats, hidden-cell offsets, skipped invalid drawings, whole-file
rejection, Doc folds, callback lifetime controls and detached resize. A failing
unit job remains a failure despite those passing subcontracts. Broader native
PDF, callback comparisons, supervised restore and visual results remain pending
at this checkpoint; collect their original attempts before the next push.

### 🧪 Remaining first-head findings and acceptance repair

The same first head's lib remaining job `131135102706` finished with **949
passed, 17 failed, 3 skipped** (86 files, 618.56 s). Ten rule-based final-cell
pins and the F5 schema wire pin reflected 1.1.0 retyping. Update only the exact
1.3.1 value/type results identified by upstream's value-preservation change;
retain native intent, all replica equality, refusal/resync and complete wire
claims. Four drawing queue cases expected the old structural deletion to create
width 0/-20. The upstream structural refresh now preserves positive Position
extents, observed as exactly 88/68. Retain both acceptance orders, real native
commands, queued delivery, subsequent row/column edits and persisted reopen.
The separate saved zero/signed-extent cases remain unchanged and passed.

Mixed fuzz job `131135102708` completed all **100,000 mutations** and its
convergence/intent/family assertions in 415.20 s, then failed the collapsed-drawing
capture coverage assertion. The original seeds no longer create collapsed
extents through the new native structural implementation. Keep every original
seed, workload and acceptance threshold; prepend explicit saved width 0/-20
fixtures through the same resource-copy/native capture path, require both
captures and preserve their saved geometry after a real row-height command.
Log these separately as retained captures, without claiming random creation.

The other two lib failures were PDF assertions deriving glyph top by subtracting
PDF.js `TextItem.height` from its baseline. PDF.js defines that height from the
transformed font/em size, not actual glyph ascent. Independent nonimplementing
inspection of artifact `13937851096` found:

- `mixed-image-paragraph-18-1.png`: image bottom **170**, sentinel ink **174–183**;
  SHA-256 `bca0ac4656e85ee763633144d1017ad910075a48d49dba3619fbfba058081f49`.
- `header-image-section-geometry-0-2.png`: image bottom **82**, header sentinel ink
  **86–95**, body starts **103**; SHA-256
  `f7d489c4b453fbf2b3165265ad572b6148db0a6c52451bc46c5240fd1608138e`.

The fixture's Atkinson font has units/em 1000, cap height 668 and ascent 950.
Measure actual black sentinel pixels above their baseline in a conservative
upright em window, fail on missing ink, and keep strict separation. These fixed
uppercase sentinels have no descenders. Independent review caught that scanning
below the baseline could mistake a following paragraph for missing sentinel ink;
exclude that line and retain an explicit negative control for it. Synthetic
touching, overlapping and missing-ink controls guard the oracle. All image areas, origins, text uniqueness,
independently authored reference comparisons and snapshot immutability remain.
No renderer override or overlap tolerance is introduced. Later reference checks
were not reached after those original failures and still require fresh execution.

Native fills failed in both browser modes (`131135103336`, `131135103303`);
production otherwise passed **83 tests**. Development stopped after **22 passed,
1 skipped**, leaving 52 unrun. The retained trace shows the menu open with named
`#F05252` and `#0DA471` buttons; the old CSS/data-attribute selector was obsolete.
Use those actual accessible swatch names, keeping persistence, both themes,
viewer rejection and canvas-color assertions. Teardown now always cleans database
rows and cannot replace the interaction error with navigation on a closed page.

Storybook run `43204078093` built successfully; desktop light passed. Dark,
phone light/dark and tablet failed exact Doc canvas restoration (761 → 721 px).
The desktop dark path never shrinks its viewport, and its failure artifact
`13937218574` shows a 40 px footer. Independent inspection found that the
rootUnitType$-mounted Doc footer implementation is unchanged from 1.1.0. This
supports a prematurely sampled baseline; absent initial geometry, event ordering
is an inference. Await actual Start toolbar, statistics and Zoom controls before
matching canvas CSS/backing dimensions to the live mount. Keep exact phone
shrink/full-size restoration checks, and retain initial/failure geometry for a
fresh attempt. No hardcoded final height, delay or relaxed equality.

The first head also passed desktop responsiveness, all three real desktop
offline browser checks (Chrome/Firefox macOS 26 and Safari macOS 15), supervised
restore, both sync projects, and Spaces provider backup/restore acceptance.
Mobile responsiveness remained running at this checkpoint. These are historical
first-attempt results only; the repaired head needs its own selected gates and
independent visual review. Local execution remains blocked by pressure level 2.

### 🔎 Second hosted candidate and current-runtime admission fixture

Candidate `e3471dc322cc4f45ab5b3f2e1d42590db3f82950` received **98/100 from
both independent nonimplementing reviewers** before publication. The following-line
ink finding was fixed on that exact head. Its
[CI run 43209110912](https://github.com/mxbaylee/spinel/actions/runs/43209110912)
uses merge source `670ca5405150be91e0db598183ed7e1c7bb198cb` over unchanged base
`3a0e2238fb5be3907d04120eabda2aafd6565d63`.

The first head's mobile responsiveness ultimately passed before the repair push;
all four candidate samples retained content and undo/redo. Original PR metadata
run `43209088242` was deliberately cancelled after the repair publication. Its
fail-closed aggregate jobs did not turn missing classification into acceptance;
normal cancellation left an always-run aggregate queued, so forced cancellation
was requested and the terminal **cancelled** state verified.

Local memory briefly permitted guarded checks on the second candidate:

- Pure ink oracle: **1 passed**, 567 ms, peak 204,912 KiB.
- Fresh normal `npm ci`, including all five postinstall patchers: **passed**,
  8,365 ms, peak 1,008,560 KiB. An earlier attempt was blocked at preflight.
- Seven-file print/native attempt with `FUZZ_SEED=1`: resource-aborted after
  3,078 ms, peak 927,232 KiB when memory pressure rose. No completed test results;
  do not count this as a pass or as the complete fuzz matrix.

The second hosted mixed-fuzz job `131152168290` passed the complete original
100-seed workload in **351.75 s**, including exactly two retained collapsed-image
captures. No random capture created a new collapsed extent. Independent content
checks covered 2,783 Doc cases, 1,521 Sheet insertions and 495 removals. All cell
tests and the desktop callback lifetime comparison also passed.

Unit remaining job `131152168589` passed the previously blocked Node phase and
reached application Vitest: **2,040 passed, 8 failed**, 255.38 s, all eight in
`offlineClaim.test.ts`. Its shared supposedly compatible fixture still declared
SDK 1.1.0, so current-runtime admission correctly rejected it before the awaited
catalog boundary. Use `CURRENT_SDK_VERSION` for compatible data. The test's
“legacy prepared catalog” refers to an old account pointer without a cancellation
nonce, not permission to expose a different SDK's data. Preserve that legacy
pointer test and explicitly exercise both old SDK 1.1.0 and future SDK 2.0.0:
neither can claim data, expose catalog titles or cancel its compatible old tab.
No runtime admission policy or timeout is loosened.

The repaired admission file passed **all 26 tests** in a guarded local run
(1,073 ms total, peak 504,928 KiB); the file is the only new executable change at
this checkpoint. Other second-head jobs continue; their original attempts and
required visual approval remain part of acceptance.
