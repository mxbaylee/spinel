# 🔎 SPN-146 exact-source review B — fixed-window diagnostic

Reviewed commit: `9a7dfbf268c1ef8caca815e00389ae15fe0ad2c6`.
Base: `2f442317dd2e1c188ae4a810ac094fd1162a4a2a`.
Published predecessor: `02ef01a40fe8369b79477909673c76de6d2a4edf`.
Independent, nonimplementing review. Project files were read only. No browser, converter, test replay or heavyweight validation was run. Working-tree repairs begun after this review finding are excluded from this assessment.

**Score: 94/100. This commit is not qualified for validation publication or diagnostic execution. No merge approval.**

## 📊 Rubric

- Scope and acceptance accounting: **35/35**. The original XL ticket, complete base-to-candidate scope and focused predecessor delta were considered. This diagnostic is explicitly an unfinished investigation checkpoint. The original native latency contract, causal-disposition requirement, all semantic/access obligations and prior failed experiments remain open. The new observation is distinct from the two failed component comparisons and is not represented as their acceptance.
- Correctness, integrity and access boundaries: **21/25**. Deduct four for B1: the terminal analysis does not verify the source artifacts it promises to retain. Otherwise the new fixed input cuts, scalar native boundary witnesses, phase/clock checks, shared strict trace/converter ownership and cleanup logic are coherent.
- Meaningful regression protection and verification: **18/20**. Deduct two for B1's missing retained-file counterexamples: current tests validate source content in isolation but do not show that absent/substituted retained source evidence makes final analysis fail. The real inline browser integration remains unexecuted and must not be inferred from pure fixtures or prior-source CI.
- CI and operational usability: **10/10**. The same-repository exact-before synchronize route, attempt-one guard, checkout identity, original test-body deadline and closed resource modes are explicit. Deliberate cancellation of unrelated acceptance workflows is correctly a pending operational requirement, not a pass.
- Maintainability, documentation, process and over-complexity: **10/10**. The roughly 1,200-line increment exceeds the initial estimate, but the record acknowledges the increase and ties it to one complete observation. It reuses the existing fixture, collector, converter, journal and watchdog; it does not introduce a generic recorder or adjustable experiment framework. No separate avoidable-abstraction deduction is justified. The necessary source-retention repair should remain a shared validator rather than another collector.

## 🚫 B1 — terminal analysis trusts a source-success flag without retained-file verification (P2, blocking)

At `scripts/ci/doc-native-runtime/window-convert.ts:30–67`, the converter reads metrics, progress, watchdog, trace and capture evidence. It never loads `spn146-loaded-sources/binding.json`, the retained JavaScript/maps, or the preparation receipt that supplies the expected prior-native/Core identities. `window-analysis.ts` checks `metrics.nativeLoadedSources.complete === true`, which is an observation-time assertion, not integrity verification of the retained artifacts.

Consequently, after a successful collection, deleting a retained map or replacing a retained JavaScript file leaves this converter's inputs and verdict unchanged. The analysis can reach `complete: true` and claim exact loaded sources are retained without establishing that claim. This is a direct mismatch with the declared source-binding contract, including future retained-only attribution; it does not require assuming malicious inputs or a general security threat.

Required repair: independently reload and bind the preparation/observed receipt to reviewed source, event-before and expected native/Core source identities; validate contained retained paths, each file's declared byte length/SHA, actual source-map embedded identities, and a complete nonduplicate target closure. Final analysis must reject missing, truncated or substituted artifacts and inconsistent binding/preparation receipts. Add meaningful filesystem-level or collector-to-validator controls showing these failures; do not merely restate the `complete` flag.

Disposition: parent agreed and is preparing an uncommitted repair. **Unresolved on reviewed 9a7.** This report does not credit that repair or its future controls.

## 🧭 Source and lifecycle assessment

The fixed event plan preserves the original sixteen paragraphs, fifteen Enter events and 2,086 inputs, splitting only at 384/448. Boundary validation checks actual native completed counts, stable epoch/unit/generation/time origin, empty queues, composition state, history count and completed nonempty phase ownership. The measured window contains the complete 416 and 448 pairs; 384 precedes attribution.

The source collector compares CDP loaded bytes to emitted JavaScript and validates embedded source-map text against expected native/Core hashes. This is materially stronger than naming a minified asset. A separately retained prior-483 production-map inventory supports the anticipated source-path/full-source shape: 17 maps, Core once at `../../node_modules/@univerjs/core/lib/es/index.js`, and Docs once at its analogous ES path. Its Docs content is intentionally the old candidate, not the proposed prior-native substitution. That inventory establishes prior-build feasibility only, not current-build or runtime acceptance.

The outer owned execution starts before partial fixture/CDP setup. Failure teardown aborts and joins that execution, while shared idempotent session/fixture cleanup and the shared collector preserve late-handle settlement. Profiler/source-observer partial failures remain failures; afterEach terminal outcome and persistence failures prevent a timeout from becoming a passed diagnostic. I found no additional concrete ownership blocker in these committed paths. Some collector/spec integration paths are exercised only by the prospective hosted run; reused lifecycle controls do not constitute execution of this exact application path.

Conversion binds original transport and derived decoded/stored identities, uses the pinned converter and strict trace importer, retains primary errors and rejects incomplete journals/watchdog failures. The GC analysis retains unknown-duration context rather than asserting absence of pauses, requires an identifiable control interval inside its bracket, and reports overlapping work without pause subtraction. B1 is the missing source-artifact side of this integrity chain.

The forced GC occurs after the measured 448 boundary. Later input continues with intentionally perturbed scheduling; its metrics are neither performance acceptance nor evidence about the uninstrumented failure. Full later text, saved/peer convergence, selection and the profile case's one Undo/Redo group remain mandatory. Ordinary plain-1 owns all 66 history groups; access/composition/revocation keep separate owners. Neither a successful diagnostic nor a comparable new event reconstructs historical 131.2 ms/129.1 ms/114.4 ms executions.

## 👥 Personas and sustainable verification

Owner and Collaborator retain content, native history and peer convergence requirements despite diagnostic pauses. Link guest access/revocation requirements are not weakened or substituted by this editor-only observation. Operator receives a single bounded process tree, fixed resource limits, explicit evidence retention and terminal failure/inconclusive outcomes. B1 matters especially to Operator: retained evidence must support later interpretation without another expensive execution.

I inspected the original base ticket, process/runbook rubric, persona and sustainable-test requirements, maintained scope/history, new workflow and source/analysis paths, and local evidence declarations. The retained final control log reports 99/99 passed with watchdog 1,045 ms and 660,992 KiB; the record separately identifies the final 21-control follow-up, scoped typing/lint/actionlint/backlog/title checks and first failures. No full clean-install/typecheck/application capability is inferred from donor tools or these local checks. The first missing-GC-return failures, partial-install CLI import failure and initial type/title errors remain disclosed. I did not repeat an archive-wide scan or runtime checks.

## 🚦 Pending disposition

After B1 is repaired, both reviewers must review the new complete committed head. Only qualifying exact-head reviews can support the declared single diagnostic publication from 02ef. Preserve and verify terminal cancellation of ordinary CI/Storybook/native runs caused by that diagnostic-only publication; their cancellation supplies no gate credit.

The fresh hosted build, actual loaded-source capture, strict trace completion/import, current window/GC/clock witnesses, complete content/history continuation, owned cleanup and resource receipts are all pending. A failed or incomparable observation closes this allowance without a changed window, threshold relaxation, re-anchoring or unchanged retry.

The production candidate's fixed component criterion remains failed/inconclusive. Historical application/native failures remain preserved. A later justified production repair or supported measurement disposition still needs its own fresh source review and all selected current-head acceptance. This review neither resolves SPN-146 nor completes the original SPN-120 merge objective.
