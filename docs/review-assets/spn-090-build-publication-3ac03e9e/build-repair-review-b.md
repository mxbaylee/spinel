# 🔎 SPN-090 build inspection repair — independent review B

Exact source **3ac03e9ecf48798aa4942aba1f1ab0fb4650c09b**; base **2f442317dd2e1c188ae4a810ac094fd1162a4a2a**; owned diagnostic predecessor **5bb97d17484ca7df151114ad2f6e28a03b4630c2**. PR224's previously tested phone/application source remains separately identified as **6f9a92e41996f8fca7b8e90ede61bbbb3242ce4b**.

**Independent grade: 97/100. B1 resolved; no unresolved source blocker. Supports publication for the declared single build-only inspection after the other qualifying exact-head review. No phone execution, product acceptance or merge approval.**

I verified clean exact HEAD, inspected the complete repair, original-ticket/full-scope obligations and unchanged checkpoint implementation, and reused the detailed full-base source assessment preserved in my prior reports. The aaee734b 94/100 report remains unchanged at `build-review-b.md`. No source edits, tests, build, browser, converter or provider workload were performed by this reviewer. Whitespace check passed.

## 📊 Rubric

- **35/35 scope/acceptance.** The build graph addresses a concrete missing evidence question without reclassifying the failed Safari session or claiming historical byte identity. Complete physical-device/offline/product acceptance remains open.
- **25/25 correctness/integrity/access.** The invalid HTML-to-file assumption is repaired while missing emitted runtime files and changed installation aliases still fail. No new provider credential or product authority path exists.
- **18/20 verification.** The production-shaped fixture and negative controls now cover the demonstrated defect. Two points remain for unexecuted complete hosted hook/output/descriptor applicability and missing actual startup phase evidence: these are explicit next owners, not inferred from four local tests. No local full build or phone rerun is required merely to remove this deduction.
- **9/10 CI/operations.** The exact one-time push route and attempt guard are sound; no hosted run on this candidate has yet demonstrated the complete build/artifact path. One point remains for that operational evidence gap.
- **10/10 maintainability/process/over-complexity.** The repair uses existing installation-path/digest semantics, a small fixed server-route classification and the existing inspector. It avoids broad missing-file exemptions or a new asset framework. The full PR's size and remaining scope are explicitly assessed below.

## ✅ B1 disposition

The original implementation required every HTML link/script URL to be a literal emitted file, incorrectly rejecting manifest/icon server routes and query-bearing favicon URLs.

The repaired inspector retains each original URL plus its normalized pathname and ownership. Same-origin emitted scripts, modulepreloads and stylesheets require an existing final emitted file. Public installation aliases must resolve through `descriptor.installation`; the target bytes must match `installationAssetDigest`. Only the three fixed favicon paths with icon relationship are labeled `server-pwa-route` with no fabricated emitted bytes. Unsupported/external URLs and unclassified references fail rather than being silently ignored.

The fixture now reads the actual `web/index.html`, replaces only the application entry and injects a realistic descriptor with all installation aliases. It verifies `/favicon.ico?v=2` remains explicit server-owned metadata and `/manifest.webmanifest` resolves to its hashed retained asset. Added negatives reject a missing query-bearing runtime script and altered installation target bytes. Existing missing-member, descriptor mismatch and symlink controls remain. This directly addresses the real application shape missed previously.

The former P2 is therefore **resolved on this exact commit**. No other concrete blocker was found. Classification proves ownership and emitted-byte consistency; it does not claim that a server route was requested or responded during this build-only observation.

## 🧪 Evidence and pending capability

The repaired four-control run passed, retained watchdog **292 ms/90,192 KiB**. The initial nullable-flatMap TypeScript inference failure is retained; the explicit result-type repair passed scoped typing (**233 ms/89,936 KiB**). Lint/format and the previously applicable actionlint/event-routing checks are recorded. Source review confirms no workflow/provider/application behavioral change in this repair. A fresh full local installation/build remains deliberately absent; donor tooling is not application acceptance.

The inspector still runs one normal production Vite build with the declared phone flag and a metadata-only post-write hook. It validates final settled bytes against hook hashes, static/dynamic dependencies, cyclic/shared closure, final shell inventory, descriptor entry and pre-render CSS, copied files and contained paths. Actual compressed sizes are Node-default estimates, and rendered module lengths do not measure CPU cost. The full dist and source/tool/config identities are intended for retention. Failed or ambiguous output remains a failed observation with primary failure preserved.

The prospective graph cannot recover the old Safari execution. Even matching filenames are insufficient to assert old byte identity. HAR transfer durations do not prove import/evaluation ordering, and the true bootstrap still has no ten-second application-import timeout. The graph may justify a narrower dependency hypothesis; pending/rejected bootstrap behavior controls and any future UI/loading state remain separate work. No new phone allowance is created.

## 👥 Full ticket, size and split assessment

I retain the original full XL outcome: installed-context and same-profile phone lifecycle, real network/termination controls, complete downloaded documents/images, offline edits and new creation, exact reconnection/conflict behavior, download-versus-shortcut truth, storage/account boundaries, guest exclusion and provider lifetime-budget accounting. The current blank Safari startup, other platform limitations, current visual evidence and complete physical acceptance remain unresolved. Earlier repaired operation identity and primary-error retention remain intact.

Owner and Collaborator require usable startup and reliable offline data; Link guest requires isolated entry and no account authority; Operator needs bounded diagnostic work with useful retained evidence and no unnecessary provider spend. This build-only checkpoint is appropriate for those tradeoffs, not a substitute for the ticket outcome.

The exact full PR carries the reported **28,312 changed-line soft warning**. The final checkpoint is **639 inserted lines across six files** from5bb97d17 (the original543-line slice plus its repair), not a small whole-ticket change. It includes one coherent observation: build metadata capture, final-byte/descriptor validation, controls, workflow and maintained decision. No independent product feature is added, so splitting the integrity checks away would reduce completeness. Nonetheless, the accumulated product/provider branch must be reconciled again before landing, including diagnostic machinery, UI/stories/current independent visual approval, remaining platform outcomes and every selected gate. Preserve the warning and delivered-versus-pending accounting in final evidence.

## 🚦 Publication disposition

After both independent grades qualify on **3ac03e9e**, the explicit one transition from **5bb97d17** on `codex/spn-090-production-integration`, attempt one, may run the bounded build-only inspection. The reviewed workflow has no provider secrets, tunnel, device allocation or browser execution. This review admits no additional session, alternate build settings, automatic rerun or inferred passing application check. Actual hosted build/artifact applicability remains pending until observed.

A useful graph result can guide a concrete startup repair; failure or ambiguity stays recorded and does not renew paid execution. Full current-source ordinary acceptance, current visual evidence and the original phone/product outcome remain required before merging. The user's scope is SPN-146 plus SPN-090, then stop; other backlog work remains parked.
