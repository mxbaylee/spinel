# 🔎 SPN-146 repaired exact-source review A

**Reviewed commit: `ab8966044fdc9c7645d5768956d84852ff308df3`, base `2f442317dd2e1c188ae4a810ac094fd1162a4a2a`. Independent score: 98/100. No unresolved source blocker found for the declared one-time diagnostic publication. This is not acceptance of the failed production candidate, authorization for an additional experiment, or merge approval.**

Independent nonimplementing review, 2026-11-05. Project source remained read-only. No tests, browser, native application, converter or trace-analysis workload was run by this reviewer. Exact committed evidence was verified under the coordinated serial watchdog. Prior94/100 review of `9a7dfbf268c1ef8caca815e00389ae15fe0ad2c6` remains preserved separately; this report does not overwrite or retroactively approve that head.

## ✅ P2 disposition and repair assessment

The previous final-analysis source-retention blocker is **resolved on this commit**.

`validateRetainedNativeSources` now reloads the saved binding receipt and requires equality with the observed receipt. It bounds receipt size, script count and total retained bytes; rejects duplicate script IDs/paths and path escape; resolves actual paths; checks actual size and SHA-256 for every declared JavaScript/map member; rechecks embedded prior-native/Core source contents; and reconciles the resulting complete native-module bindings with both expected identities and the receipt. A missing or altered map/code member can no longer rely on a stale `complete:true` flag.

Before native-window conversion/completeness, `window-convert.ts` now binds preparation and metrics to actual Git HEAD and tree, the reviewed-head environment, fixed prior-native reference and exact `02ef01a4…` event predecessor. It rehashes prepared sources, checks the installed prior Docs bytes against the fixed accepted hash, obtains the Core identity from the reconciled preparation and invokes retained-source validation. The validated receipt is retained in the final analysis record. It still uses the shared first-failure-preserving persistence helper. No new browser operation or automatic converter retry was added by the repair.

The new controls exercise the real collector and filesystem retention through a fake CDP transport, including actual emitted/retained files, command ordering, listener release, changed same-size code, deleted/changed map, conflicting expected native identity, altered/missing binding receipt and failed setup with original error identity. These directly address the missing contract; they do not merely assert a `complete` flag. They are synthetic protocol controls, not evidence of real Chromium startup or current production map content.

The retained17-map inspection from source483bf8ae supports the expected emitted package-path/full-content shape. Its Docs hash deliberately differs from this prior-native substitution. It is correctly limited to historical format feasibility and receives no current-source runtime credit.

## 📊 Independent rubric

- **Scope and acceptance:35/35.** Original XL causal/semantic/performance outcome remains intact; one fixed-window observation is an explicitly bounded investigative step. Original failed component criteria and application/native failures remain blockers. The one-group profile history owner and separate full66/access/composition owners are accurately distinguished.
- **Correctness, data integrity and access:25/25.** The concrete retained-source P2 is closed. The fixed input/boundary sequence, scalar ongoing observer, exact native substitution, trace/GC clocks and owned fixture/session paths remain unchanged from the reviewed controller. Product access and the100ms acceptance limit are unchanged.
- **Meaningful verification:18/20.** Two points remain withheld for the unperformed real-hosted integration boundary: current loaded-script/map capture, partial protocol lifecycle and strict trace/GC/native continuation have only deterministic/local evidence at this head. These are explicitly pending obligations of the one declared hosted diagnostic, not a claim of a known source defect or a request for duplicate local browser runs. No local clean install/full application/full-project typecheck is credited.
- **CI and operations:10/10.** Exact-before synchronize/owning branch/same-repository/main routing and first-attempt admission are unchanged. Explicit cancellation of ordinary runs is honest finite diagnostic publication, with cancellation receipts still required. Resource limits, original body/drain deadlines and mandatory normal acceptance owners are retained.
- **Maintainability/process/over-complexity:10/10.** The repair extends the existing source collector with one bounded persisted-evidence validator and real filesystem controls. It does not add a new recorder or generalized execution system. The roughly1,200-line investigative scope checkpoint and subsequent necessary retention repair remain coherent within the XL outcome. No actionable unnecessary abstraction or speculative flexibility was found.

**Total98/100.** This qualifies A's source review for the declared diagnostic-only publication after the other independent exact-head review qualifies and publication guards are checked. The score does not convert prior failed production evidence into pending-only success or imply ticket completion.

## 🔬 Evidence and exact-source verification

Inspected the complete `9a7→ab896` delta, updated canonical record, source-retention collector/converter/tests, unchanged publication plan and original base-ticket obligations. Earlier full-candidate source review remains applicable to unchanged files, with the present exact diff assessed independently. The production algorithm, exhausted component workflow and fixed-window lifecycle logic were not changed by this repair.

Read the retained9/9 focused-control log:187ms, peak90,192KiB, normal pressure. The scoped-type and final-tree type receipts, lint and formatting receipts are present; prior99-control/21-control evidence retains its actual original source/check scope. These suites overlap and are not summed into an invented distinct test count. The original extraction/type/partial-private-install failures remain documented. Full hosted capability has not run.

One independent bounded verification read **all41 retained payloads and16 source bindings directly from exact `ab896604…` Git blobs**. All57 size/SHA-256 assertions passed on first execution in480ms, peak182,768KiB, pressure1. External proof artifacts:
- `/tmp/spn146-investigation/window-repaired-evidence-check-a.ts`
- `/tmp/spn146-investigation/window-repaired-evidence-check-a.log`
- `/tmp/spn146-investigation/window-repaired-evidence-watchdog-a.json`
- `/tmp/spn146-investigation/window-repaired-evidence-proof-a.json`

This verification proves retained development-file integrity and source binding, not future runtime measurements. No current artifact was substituted with an older passing artifact.

## 🚦 Publication and remaining obligations

The admissible next publication is solely the prospective one same-repository PR267 transition from `02ef01a40fe8369b79477909673c76de6d2a4edf` to the final reviewed head, attempt1. Recheck remote predecessor and exact candidate before pushing; do not re-anchor the allowance if reality differs. Cancel the ordinary CI/Storybook/native runs triggered by this diagnostic checkpoint and retain terminal cancellation identities, including follow-on jobs. Let only the declared new window diagnostic execute once. No approval here applies to another component trial, a window move/expansion, relaxed capture contract or unchanged rerun.

The prospective diagnostic must retain complete original transport/derived hashes, source/preparation identity, actual384/448 witnesses, original2,086-input continuation and selected semantic history/content checks, resource records and terminal owned cleanup. A valid comparable event is evidence only about that new instrumented execution. No event remains inconclusive, even if a later outside-window maximum is large. Incomplete or invalid capture/semantics/resources fails. Neither terminal result creates a renewed allowance or proves the historical131.2ms cause.

Operator gets integrity-checked bounded evidence; Owner and Collaborator retain data/history guarantees and unchanged responsiveness limits; Link guest access/revocation retains its separate acceptance owner. The complete production repair or supported measurement disposition, causal reasoning, main integration, full current-source required CI/native/browser acceptance and final cleanup remain outstanding. Prepared ticket/dependency/completion bookkeeping is conditional until those requirements and the guarded merge actually complete.

## 📐 Soft-limit scope reassessment

The exact committed-head PR checker passed on `ab896604…` with a **13,083 changed-line soft-limit warning**; the receipt is `/tmp/spn146-investigation/window-final-committed-pr-watchdog.json`. This is above the10,000-line checkpoint and must be recorded in the PR, not described as a size exemption. The current increment is approximately1.4k source/test lines plus41 durable evidence payloads; neither these figures nor XL sizing waive the hard limit or review obligations.

I reassessed the split boundary. The native composition proposal, negative controls, failed diagnostic/component outcomes and this source-bound fixed-window collector all serve the same still-open native mobile flush outcome. There is no safely accepted production slice to land independently at this checkpoint, and extracting a nominally completed parent would hide the remaining causal and acceptance requirements. The small shared collector/clock/resource adaptations have concrete callers and are necessary to this investigation; a separate general-purpose diagnostics platform is not being proposed. Keeping the current investigative checkpoint within SPN-146 is justified, with all original failures retained and no production merge approval. A later expansion beyond this declared window requires another complete-outcome reassessment rather than treating the soft warning as unlimited scope. This disposition does not change the98/100 source-readiness score or the pending runtime/merge requirements.
