# 🔎 SPN-090 startup build checkpoint — independent review B

Exact reviewed source: **aaee734b987f69d176aa8d0a1a639bb218ca2184**.
Original-ticket base: **2f442317dd2e1c188ae4a810ac094fd1162a4a2a**.
Diagnostic predecessor: **5bb97d17484ca7df151114ad2f6e28a03b4630c2**.
PR224 phone source remains **6f9a92e41996f8fca7b8e90ede61bbbb3242ce4b**.

**94/100. One blocking P2 applicability finding; do not publish this head for the declared build observation. No phone or merge approval.**

This is an independent nonimplementing review of the complete ticket/candidate, reusing my preserved full-scope product/provider reviews for unchanged code and examining all six changed files in the 543-line checkpoint. The checkout was clean on the reviewed SHA. No build, browser, provider request, tests or heavyweight workload was run. Whitespace check passed. I inspected current source, local test output, workflow, maintained plan and relevant actual application/server URL behavior.

## 📊 Rubric

- **35/35 scope and acceptance:** The new observation asks a relevant missing dependency-graph question, keeps a new emitted build distinct from historical Safari bytes, and preserves the complete XL device/offline/product outcome. It does not enlarge the phone allowance or assert HAR timing causality.
- **22/25 correctness/data integrity/access:** Deduct three for B1. Final-build validation conflates emitted files with server-owned HTML references, so the actual application cannot satisfy the checker as written. Other graph identity/closure checks and zero-provider routing are appropriately constrained.
- **18/20 meaningful verification:** Deduct two because the final-HTML fixture omits the real application's manifest/icon/query references and therefore misses B1. The four tests meaningfully cover byte binding, static/dynamic/cyclic closure, mutation/missing files, symlinks and event isolation, but do not establish actual build applicability.
- **9/10 CI/operations:** One-point remaining integration limitation: no complete current hosted build has exercised the hook, final output reconciliation and artifact path. This is explicitly pending rather than a reason to repeat a resource-blocked local build. B1 must be repaired before consuming the one hosted observation.
- **10/10 maintainability/process/over-complexity:** A read-only Vite hook plus one bounded graph/final-file inspector is a proportionate way to answer this question. No new provider/fixture/runtime framework or production feature was added. The URL classification repair should reuse established route/descriptor identities rather than add broad exemptions or another asset service.

## 🚫 B1 — real HTML server URLs are rejected as missing emitted assets (P2, blocking)

`scripts/ci/browserstack-build-graph.ts:146–151` extracts every script/link `src` or `href` and requires `bytes.has(path.slice(1))`. That assumption does not match this application:

- `web/index.html` references `/manifest.webmanifest`, `/app-icon-180.png`, `/favicon.svg`, `/favicon.ico?v=2` and `/favicon-32.png?v=2`.
- `src/server/pwa.ts` serves these stable public routes. They are not all literal files in dist; there is no `web/public` directory supplying them.
- `vite.config.ts` emits immutable hashed installation assets and declares their mapping in `descriptor.installation`, while HTML retains the stable public URLs. Favicon query strings additionally cannot be used as filesystem names.

Therefore a valid normal production build will fail `Missing HTML entry asset` even when the actual browser URLs are correctly served. This is a build-inspector defect, not a missing product asset. The tiny final-file fixture includes only one module script and an inert descriptor, masking the mismatch. Static inspection of Vite's installed HTML/public-file handling also confirms URLs and filesystem paths are separate concepts; its own public-file existence lookup strips queries before filesystem checking.

Required repair: classify actual HTML references by role. Keep emitted module scripts, modulepreloads and stylesheet references strictly bound to contained emitted files. Preserve original URLs in evidence but resolve normalized pathnames safely. Validate declared installation aliases through the actual descriptor's hashed installation members and relevant existing digest rules. Identify fixed server-owned favicon/manifest metadata references explicitly; do not fabricate retained response bytes or silently waive arbitrary missing JS/CSS. Include a production-shaped HTML fixture with the real icon/manifest/query URLs, plus missing emitted module/style and invalid alias/unknown-reference negatives. No browser or full build is necessary to demonstrate this classification regression.

Disposition: reported to parent; unresolved on **aaee734b**. Reviewer A independently reported the same concrete issue after I sent it to parent. This score does not use A's grade.

## 🧭 Other source and evidence findings

The workflow runs only on the owned integration branch's push, checks the declared before SHA, requires attempt one, checks out the event source and uses no provider credentials, tunnel, browser or allocation path. The inspector verifies actual HEAD against GITHUB_SHA and records tree, source hashes, tool versions, flags and run identity. Clean installation and the single Vite production build are distinct from the current PR's ordinary application acceptance.

The post-write hook does not mutate chunks or change minification/chunk options. It records bundle metadata and declared output hashes, then after build settlement enumerates final output, rejects symlinks/non-files and size/file-count overflow, hashes actual bytes and rejects changed/missing declared members. Static traversal handles shared/cyclic imports and excludes dynamic-only edges from the initial JavaScript closure. Dynamic edge existence is checked without claiming all dynamic chunks load before sign-in. Final CSS is separately listed because bootstrap awaits every descriptor stylesheet. Gzip values are explicitly independent estimates, not the Safari transfer encoding; module rendered lengths are not evaluation cost.

Failure persistence retains the primary error if writing the failure result also fails. A failed build/validation cannot leave a completed success result from this fresh attempt. Complete emitted files may exist after a failure, but must remain labeled incomplete evidence. Missing graph metadata or unsupported output should fail rather than lead to a second build or adjusted chunking.

No additional concrete source blocker was found. The new build still cannot establish historical Safari import-settlement/evaluation times. Even a correct static graph demonstrates dependencies, not why that particular phone screen remained blank.

## 👥 Complete outcome, personas and size boundary

The original ticket remains physical installed-context offline verification: actual download/termination/relaunch/network controls, complete images/content, committed offline edits, reconnection/conflict preservation, offline new creation, shortcuts versus downloads, account/guest isolation, and truthful platform limits/budget ledger. Current Safari blank anonymous entry, other platform investigations and current visual/phone evidence remain separate unresolved obligations. Earlier operation-identity and first-cause persistence repairs remain intact; this checkpoint changes no application behavior.

Owner and Collaborator need usable entry and trustworthy offline documents; Link guest must not inherit account authority through a future split; Operator needs finite useful evidence without unplanned provider spend. The graph preserves all these requirements and cannot substitute for device results.

The **28,216 changed-line soft warning** is material. Most scope is inherited product/provider work and extensive retained history; the 543-line increment answers one inseparable startup investigation question. It is not a new independently shippable product feature. Splitting graph checks from their output identity/routing controls would make the observation incomplete. However, a build-only checkpoint is not permission to merge the entire accumulated branch: final landing must reconcile diagnostic machinery, UI/stories/visual evidence, full device contract and all selected current-head gates. Keep the warning and delivered-versus-remaining scope visible instead of deleting provenance to reduce line count.

## 🚦 Pending disposition

Repair B1 and obtain two new qualifying reviews on the complete committed head before validation publication. The scoped type/lint/actionlint/format/backlog/PR checks and four local tests are useful, but they do not override the applicability defect. The retained final test log reports four passes, watchdog288 ms/90,336 KiB; no runtime or build execution occurred in this review.

After a qualifying repair, the proposed single build-only observation is a reasonable lowest-layer next step, with failure/ambiguity preserved and no automatic retry. It cannot authorize a new phone session, increase readiness bounds, prove network causality or replace pending deterministic bootstrap behavior controls. Full hosted build applicability and complete SPN-090 product/device/visual acceptance remain pending. User scope remains SPN-146 plus SPN-090, then stop.
