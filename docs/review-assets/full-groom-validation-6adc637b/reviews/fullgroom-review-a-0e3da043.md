# Independent full-groom review A — 2026-11-14

Reviewed candidate **0e3da0431e4c28e5525e2e968dc5fd78c8d83e57**, actual base **78fc73bbb05ee5cab9d5a6731ae42227d2c0aaef**, in `/Users/mxbaylee/projects/spinel-groom-prelaunch-20261114`. Read-only, nonimplementing, independent review. No other reviewer report or historical numerical assessment was consulted. The assessment is of the complete requested grooming, not merely formatting. Actual source and retained immutable provenance govern the conclusions.

**Score: 97/100.** Scope/acceptance 35/35; correctness, data/access 25/25; meaningful regression/verification 17/20; delivered workflow/operations 10/10; maintenance/docs/complexity 10/10. No points were deducted for CI results, pending hosted acceptance or unavailable physical devices. Two locally repairable Verify-plan omissions remain; repair and independently revalidate the new commit before validation publication under the standing review loop. These are documentation findings, not demonstrated runtime failures or newly imposed product requirements.

## Findings and every step to 100

1. **P2, 2 points: SPN-153's promised third test is outside its selected suite.** `docs/todo/SPN-153.md:40` says the named tests pass using `node --test scripts/ci/*.test.ts`; line42 lists only `scripts/ci/offline-upgrade-dependencies.test.ts`. The third failure explicitly retained at lines31–32 is actually `scripts/dependencies/patch-univer-core.test.ts:393`, “the shipped, patched @univerjs/core has one pooled helper and shows the same behaviour”. The CI glob never includes it. Direct source inspection confirms that this test checks both installed ES/CJS bytes and scheduler behavior, distinct from the two temp-path tests at `scripts/ci/offline-upgrade-dependencies.test.ts:72,137`. Fix the Verify plan to name that dependency test/owner and its patch/installed-byte inputs, retain meaningful negative detection and separate bounded diagnosis, and use a full relevant-script command or explicit additional focused command that actually includes it. Retain existing budgets/watchdog and reassessment before substantive repair. **Local documentation repair; no new hosted or owner prerequisite.** Do not run the application/dependency suites merely to repair this grooming prose.

2. **P3, 1 point: SPN-151's evidence stops before the external key requirement.** `docs/todo/SPN-151.md:33` explicitly requires revoking the BrowserStack account access key. Verify at lines41–44 names only Git branch/secret/label listings and GitHub repository settings. All three listings can be empty while the BrowserStack key remains active, so they do not verify the retained complete cleanup outcome. Add redacted account-side confirmation that the named key is revoked/inactive (or explicitly record unavailable account access and the remaining action). Retain source/live-consumer checks and per-deletion authorization. No key value, paid session, provider reintroduction or credential disclosure is needed. **The Verify-plan repair is local; eventual execution requires the already recorded authorized BrowserStack account access.** This does not ask the absent owner a new question or perform cleanup now.

These are the only deductions. No additional hidden one-point items or impossible steps are reserved. Correcting both plans and their full-groom summary, with relevant docs/backlog checks and exact-head revalidation, addresses all three points.

## Full outcome, persona and evidence review

Read AGENTS, process, run-backlog, all four personas, sustainable testing and implementation-record convention; read all27 live specs, their base identities, all18 changed paths, retained SPN-090 method/phone findings, SPN-157 requirement ledger, current source locations and inventory/receipts. The changed ticket frontmatter and original stories/scenarios are preserved. The result is proportionate: one dated cross-ticket record and canonical ticket decisions, no runtime framework, duplicate test system or speculative abstraction.

The phone reconciliation matches retained source67111d9c's accepted method: targeted owner Pixel10/Chrome/Home Screen observations plus current deterministic/shared native owners, explicitly lower integrated confidence. The unknown versions/build and unobserved final offline sign-in shortcut/permutation coverage remain unknown; today's SHA is not attached to those observations. Prior provider failures retain unknown cause. Main's old workflow is not described as removed or authorized for execution. SPN-090 remains XL/open; SPN-154 and156 remain full pre-launch outcomes; SPN-152 remains owner-deferred post-launch. SPN-156's repaired-build installed reconnect/foreground observation is separately required, not satisfied by older Pixel observations or viewport checks.

All four journeys are materially covered. Operator retains management without content access, truthful diagnostics/export/retention and actual-host recovery. Owner retains durable Doc/Sheet edits, images/history/offline/replay and recovery. Collaborator retains authorized shared convergence, pending/refusal clarity and protected saved work through access changes. Link guest remains document-link scoped, without private offline stores, dashboard/account access or diagnostic authority, and retains immediate revocation. No uncovered new journey justifies another ticket on this evidence.

The seven reset entries are genuine main-history completions: SPN-148 at977de3a3,145 atebf0842f,149 ata3dfc6f3,158 atb1b18165,160 at754e6531,159 at87c34e30,157 at78fc73bb. Interleaved focused grooming commits do not count as completions. The counter/date-only edit is correct; next ID161 and27 open tickets remain. SPN-157's original19 obligations map to A1–A9 without manufacturing a causal repair. Its reviewed f59d23ce, tested92959827 and squash78fc73bb tree identities independently resolve to5d8c93740959386dce7d85858f1ce85cdcc9c6fd. The published validation result is source-bound evidence, not another consumer's acceptance. Its full L investigation and unknown historical cause are correctly distinguished from SPN-160 diagnostics and pending SPN-098 validation.

The supplied post-merge connector snapshot accounts for12 open PRs, matching the dated record's numbers/heads, no open Dependabot update and both upstream PRs7938/7969 open/unmerged at their recorded heads. That snapshot is historical evidence; prerequisites must be rechecked at selection. No stale PR source is silently treated as actual main, and no unmerged SPN-090 history JSON/findings file is claimed present locally. No approval/merge or CI pass was inferred from a draft PR. SPN-150's actual empty HTML root and App Loading text were independently confirmed; SPN-099's producer exists in `lib/sync-transform/src/docs.ts` and invokes compose. Existing core/Docs/UI/drawing patch owners remain distinct. The main recovery store still has MAX_JOBS64; pruning and cold original recovery are not declared shipped.

## All27 ticket dispositions

- SPN-156 L pre-launch: full headless/native replay, writer/account/item authority, durable acknowledgement/conflict/interruption and installed observation remain necessary; no concealed follow-up.
- SPN-090 XL pre-launch: accumulated installed/startup/storage/native/integration acceptance remains correctly sized despite provider retirement; original product scenarios survive.
- SPN-098 L pre-launch: durable idempotent feedback and complete paired bounded exports retain snapshot/TTL/truncate/session and actual download checks; no inbox or guest scope expansion.
- SPN-120 L pre-launch: finite historical24-case audit, observable readiness and fatal setup/process controls remain; landed prerequisites do not pass its current source.
- SPN-123 L pre-launch: finite emitter/timing/admission/privacy/overhead inventory remains separate from diagnostic-control work and feedback UI.
- SPN-128 L pre-launch: actual crash/custody/fingerprint/new-generation/fresh-authority recovery and runbook remain; source primitives and open PR are insufficient completion.
- SPN-106 M pre-launch: supported viewer initialization seam, warning-history observation and real denial/revocation/content controls remain distinct from blanket suppression.
- SPN-110 M pre-launch: bounded trusted-receipt TTL, byte accounting, restart/failure and paired-export/feedback coordination retain meaningful direct-store owners.
- SPN-154 M pre-launch: predeclared known current clipboard reproduction and meaningful mounted-page/content/refusal/native/phone outcome remain; missing original metadata is not an impossible reconstruction obligation or assumed401 cause.
- SPN-068 L pre-launch: floating/in-cell native images with limits, saved/peer/history/move/cut/paste/duplicate behavior remain; existing asset store is useful reuse, not completion.
- SPN-087 M pre-launch: finite CSS/module cleanup with stable production/native stories and all five viewports remains; no retired mocks/framework restored.
- SPN-089 M pre-launch: complete title/accessibility inventory and explicitly inherited hosted latency gate/diagnostic removal remain; no new deduction for that pending gate.
- SPN-150 S pre-launch: bounded matching HTML/app branded reduced-motion state remains valid; current baseline correction avoids assuming an unmerged feature.
- SPN-038 XL launch: public origin/passkeys/DNS/TLS/WSS/dual-stack/private management and actual provider/host/resource/recovery acceptance remain complete, with access/spend limits explicit.
- SPN-147 L post-launch: four current-upstream contribution/qualification outcomes, meaningful baseline-fail/proposed-pass or existing-fix evidence and removal ownership remain; not a header-only estimate.
- SPN-099 XL post-launch: aligned stock-release/transform/native/history/access qualification and upstream dependencies remain; release suitability is not inferred from status.
- SPN-114 L post-launch: one authorized actual AWS private transport/rotation/retention profile with bounded cleanup remains, no new account/provisioning requirement.
- SPN-119 L post-launch: stock Docs UI byte and callback/native/content/latency/access ownership remains with upstream7969.
- SPN-122 L post-launch: complete evolved composition patch,16-state/200-group history,2086-input/native/semantic workload remain; SPN-147 dependency appropriate.
- SPN-125 M post-launch: journaled resolved-evidence pruning with actual crash cuts, ambiguity refusal and65th restore remains separate from backup retention.
- SPN-127 M post-launch: authenticated compatibility hints, forged/missing negatives and accessible catalog retain full verification as authority.
- SPN-094 XL post-launch: versioned trusted type/converter/persistence/schema/access/native reference outcome is architectural; speculative marketplace/full format work remains excluded.
- SPN-093 M post-launch: bounded literal CSV, atomic authorized native creation and actual edit/reload remain; no formula execution or plugin dependency.
- SPN-151 S post-launch: narrow hosted resources/key cleanup remains appropriate; repair verification omission above.
- SPN-152 S post-launch: bounded actual installed iPhone exercise and honest failures remain distinct from Android/viewport evidence.
- SPN-153 S post-launch: known path controls plus bounded separate pooled-helper assessment remain defensible with early reassessment; repair suite omission above.
- SPN-155 S post-launch: observed transient connection reporting remains bounded, preserving genuine authenticated-server rather than navigator-online semantics.

## Independent feasible checks and operational limits

All workload checks used pinned Node26.13.0 and supplied watch.ts with shared serial runner, normal pressure preflight,2GiB process-tree/eight-minute guards. Sole slot released to root immediately after checks. No install/shared-cache write or persistent task-owned subprocess was created. Worktree remained clean. Source/link helper was copied outside the repository with only its output destination changed to avoid overwriting manager evidence.

- `fullgroom-a-backlog-0e3da043`: passed,27 open tickets;146ms, peak0KiB means unsampled short duration, not zero memory. Existing length warnings are advisory and substantive acceptance justifies retaining necessary detail.
- `fullgroom-a-pr-0e3da043`: passed exact base/title;379ms,178672KiB sampled peak.
- `fullgroom-a-docs-0e3da043`: passed18 changed docs/27 tickets/32 changed or introduced link targets, zero errors;401ms,113728KiB sampled peak. Verified local/pinned targets, preserved frontmatter/stories, allowed config-only reset and docs-only scope.
- `git diff --check <base> <candidate>` passed; `git status --short` empty.

Raw guarded receipts/logs: `/tmp/spinel-dependabot-2026-11-11/fullgroom-a-{backlog,pr,docs}-0e3da043.{json,log}`. Detailed helper result: `/tmp/spinel-dependabot-2026-11-11/fullgroom-a-docs-inspection-0e3da043.json`.

No browser/application suite was justified by this docs-only change. A read-only source search initially used a nonexistent shell glob and was corrected; it was not a validation pass or application failure. Current-head hosted applicability gates remain pending and independently required for merge. Neither this score nor earlier native evidence passes those gates. Phone/account/provider execution belongs to the retained product tickets; this review executes none of it. No branch, PR, source, credential or external setting was mutated.
