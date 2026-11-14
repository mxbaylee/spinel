# Independent full-groom review A — repaired candidate

**Reviewed head:** `6adc637b937cf07856104a247cb834bef08b8a6f`.
**Actual base:** `78fc73bbb05ee5cab9d5a6731ae42227d2c0aaef`.
**Tree:** `8e88d5a503006f5a2afae984d065d9e720d06fda`.
**Date:** 2026-11-14. Read-only, nonimplementing, independent review; no other reviewer report or numerical assessment consulted.

**Score: 100/100 — 35/35 scope, 25/25 correctness/data/access, 20/20 meaningful regression evidence, 10/10 delivered workflow/operations, 10/10 maintenance/docs/complexity.** No unresolved findings or additional steps to100. Both concrete original findings are repaired. No points depend on CI results or treating external execution as performed. Current-head hosted applicability gates remain pending and required for merge; this grade is not a CI pass or merge authorization.

## Repair verification

**SPN-153, resolved:** `docs/todo/SPN-153.md:40–44` now selects both actual owners, including `scripts/dependencies/patch-univer-core.test.ts`, distinguishes a focused diagnosis from complete Node-script acceptance, and preserves unknown historical cause, detecting negatives, installed-byte inputs, cleanup and resource constraints. I checked actual source: the shipped-package test at line393 copies `node_modules/@univerjs/core`, validates ES and CJS using `patchCore`/`pooledMacroTask`, exercises the scheduler, and removes its temporary copy in finally. The other test imports `e2e/offline-upgrade-dependencies.ts` and cleans its isolated fixture. The complete command in the repaired plan exactly matches the Node-script portion of `package.json:10`. Canonical SPN-153 notes and the full-groom record agree. This is a correct verification plan, not a claim that the third failure has been diagnosed or that runtime suites have just passed.

**SPN-151, resolved:** `docs/todo/SPN-151.md:41–45` now requires authoritative redacted account-side revoked/inactive-key confirmation, distinguishing it from GitHub branch/secret/label absence. Active or unverified keys leave acceptance incomplete. Timestamp, non-secret identifying context and method make the eventual result reviewable. Unavailable authorized account access remains an explicit prerequisite, with no invented provider endpoint or paid allocation. Consumer/source checks, retained history and individual deletion authority remain. Canonical SPN-151 notes and the full-groom record agree. The correction creates no claim of account access or completed cleanup.

The five-file repair contains no other changed source, scope, policy, ticket frontmatter or product scenarios. I independently matched both full-index packet diffs to actual Git diffs and checked all six policy files remain byte-identical to the first reviewed candidate.

## Complete grooming assessment retained on this head

This is the complete base-to-head grooming outcome, not a repair-only grade. My prior full inspection of all27 specs, all18 changed paths, retained source and all four personas remains applicable except the five explicitly inspected repair documents. Original inspection and runtime evidence keep their original identities; they are not relabelled as new execution on6adc637b. The original review remains unchanged at `/tmp/spinel-dependabot-2026-11-11/fullgroom-review-a-0e3da043.md`; its detailed27-ticket assessments are retained with both findings now resolved above.

The complete ticket inventory remains necessary and correctly phased/sized on the available source:

- Pre-launch: SPN-156 L native/editor-independent replay, authority and installed observation;090 XL integrated phone/offline/startup outcome;098 L durable feedback/paired exports;120 L finite fixture investigation;123 L production diagnostics;128 L interrupted original recovery;106 M truthful viewer startup;110 M trusted-receipt expiry;154 M bounded paste reproduction plus full native/page/content/refusal/phone outcome;068 L native Sheet images;087 M finite production/native-story CSS cleanup;089 M title/accessibility inventory plus retained performance gate/removal;150 S coherent branded/reduced-motion loading.
- Launch: SPN-038 XL exact public origin/security/cutover and actual provider/host/resource/cold-recovery acceptance. No deployment, spend or old-host availability is invented.
- Post-launch: SPN-147 L four upstream contributions/qualification outcomes;099 XL stock-core/transform/native acceptance;114 L one real authorized AWS profile;119 L stock Docs UI callback acceptance;122 L complete current composition/history/native acceptance;125 M journaled restore-evidence pruning;127 M authenticated compatibility guidance;094 XL trusted type/converter architecture;093 M literal bounded CSV;151 S hosted resources/key cleanup;152 S actual iPhone exercise;153 S bounded Mac-path and separate helper assessment;155 S truthful transient connection reporting.

Dependencies still reflect lifecycle and upstream constraints without disguising unavailable execution as product dependency. SPN-147's retained contribution ownership and open upstream7938/7969 remain; CSV/plugins follow launch. No accepted outcome is silently dropped, estimated solely by diff size or falsely passed by a prerequisite. SPN-089's inherited hosted performance requirement remains explicit, with no score deduction for its current result.

The accepted SPN-090 method matches retained67111d9c: targeted owner Pixel10/Chrome/Home Screen observations plus current deterministic/shared native owners, explicitly lower integrated phone confidence. Exact original device versions/build, final offline-sign-in shortcut and unobserved permutations remain unknown. Current source is not attached to old manual observations; old provider failures keep unknown cause. SPN-090 stays XL/open; SPN-154 and156 retain full pre-launch acceptance; SPN-152 remains owner-deferred post-launch. SPN-156 still requires its repaired-build installed reconnect/foreground observation, independent of older Pixel or emulated results.

All four persona journeys remain covered: Operator truthful diagnostics, management isolation and real recovery; Owner durable editing/images/history/offline/replay; Collaborator authorized convergence and recoverable pending/refused work; Link guest one-link scope, immediate revocation and no private account/offline/diagnostic authority. No concrete uncovered journey requires another ticket.

The genuine completion reset remains correct:148/145/149/158/160/159/157 are actual main-history completions, not focused grooming registrations. Next ID161 remains unchanged and no ticket is removed by this grooming. SPN-157's full L19-obligation audit remains bounded non-recurrence with historical cause unknown, separate from160 diagnostics and098's own current-head acceptance. Its reviewed/tested/squash tree identity was independently checked during the first review and none of those inputs changed.

Source provenance remains honest: SPN-150 targets actual `web/index.html` empty-root and App Loading baseline; SPN-099 targets the current transform producer;151/152 distinguish unmerged67111d9c history/findings from main. The supplied dated connector snapshot still accounts for12 open PRs, no open Dependabot update and both unresolved upstream PRs; it is a snapshot requiring recheck at selection, not a live promise. Neither this review nor the grooming turns remote/draft/local preparation into runtime completion.

No unnecessary runtime abstraction, new framework, dependency or duplicate application test is introduced. The canonical ticket records and one dated cross-ticket record are proportionate to the requested full grooming. Existing application/phone/account evidence is not required to be rerun for these prose corrections.

## Independent local checks and receipts

Sole-slot checks used pinned Node26.13.0 and supplied watch.ts/shared serial runner with normal pressure preflight,2GiB tree RSS and eight-minute limits. All completed successfully; slot released immediately. No installs/shared-cache writes, persistent subprocesses or source mutations occurred. Clean worktree and `git diff --check` were independently confirmed.

- `fullgroom-a-backlog-6adc637b`: exit0,27 tickets,157ms; peak0KiB is unsampled short duration, not zero memory. Advisory existing ticket-length warnings are not failures.
- `fullgroom-a-pr-6adc637b`: exit0, exact base/title;382ms,178848KiB sampled peak.
- `fullgroom-a-docs-6adc637b`: exit0,18 changed docs/27 tickets/34 changed or new local/immutable link targets, zero errors;421ms,106288KiB sampled peak. It checks preserved frontmatter/stories, exact inventory and only permitted config reset. Reviewer helper wrote only its separate temporary report.
- Independent read-only source receipt confirms exact head/tree, five-file repair, unchanged six policies, packet/full/repair diff equality and Node-script command equality with package.json.

Raw logs/receipts: `/tmp/spinel-dependabot-2026-11-11/fullgroom-a-{backlog,pr,docs}-6adc637b.{log,json}`. Detailed link/bookkeeping report: `fullgroom-a-docs-inspection-6adc637b.json`. Independent diff/source receipt: `fullgroom-a-source-revalidation-6adc637b.json`, in the same directory.

No browser/application suite was run: it would not verify a documentation-only correction. No account action, provider operation, phone run, publication or branch mutation occurred. Future product-ticket acceptance and all required current-head hosted gates remain exactly as documented, with no point deductions or fabricated passes.
