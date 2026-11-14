# 🔎 SPN-146 exact-source pre-publication review A

**Reviewed commit: `9a7dfbf268c1ef8caca815e00389ae15fe0ad2c6`. Base: `2f442317dd2e1c188ae4a810ac094fd1162a4a2a`. Score: 94/100. Not qualified for the diagnostic validation push: one unresolved P2 evidence-integrity finding. No merge or runtime acceptance approval.**

Independent nonimplementing review, 2026-11-05. The reviewer did not edit project source or run tests, a browser, native workload, converter or trace parser. The parent may be repairing the working tree; this report and the independent hash proof are pinned to Git blobs at the reviewed commit, not subsequent edits.

## Findings and required disposition

### P2 — Final analysis can certify complete source evidence without reading the retained source set

Locations: `scripts/ci/doc-native-runtime/window-convert.ts:30` through its `record.complete = true` at line86; `scripts/ci/doc-native-runtime/window-analysis.ts:24`.

The runtime source collector initially compares executed JavaScript to emitted bytes, checks embedded native/Core hashes and writes its retained JS/maps and binding receipt. However, the final converter reads only metrics, journal, watchdog, trace, capture and CPU profile. It never reloads `spn146-loaded-sources/binding.json`, the retained JavaScript/maps or the prior-native preparation identities. The analyzer only checks `metrics.nativeLoadedSources.complete === true`.

Consequently, removing, truncating or substituting a retained source/map member after collection leaves the final analysis path able to declare `complete:true`. Its report still says exact loaded sources are retained, even though the very material needed for the proposed retained-only frame investigation may be missing. This is an actual missing guard in the source; no native execution is necessary to establish it. Reviewer B identified the gap, and A independently inspected and confirmed the relevant paths. It is not a claim that existing local artifacts were corrupted.

**Required repair:** before final completeness, reload the binding and preparation receipts; reconcile their exact reviewed source/tree/native reference, expected Core/docs identities and metrics; validate a bounded exact retained member set with paths, sizes and hashes; parse/revalidate each retained map's embedded expected source content. Retain the verification result and original failure on any write/cleanup error. Add meaningful missing/corrupt/rehashed-wrong-source/receipt-conflict negatives against that final validation path. Do not solve this by weakening the prerequisite or treating a historical capability pass as current-source evidence. Status on this exact commit: open; parent notified and preparing repair.

## Rubric

- **Ticket scope and acceptance — 35/35:** the complete XL obligation is retained. This publication is one explicitly declared new diagnostic, not another attempted qualification of the failed production candidate. Original limits, full workload, one selected profile-case history group, distinct ordinary full-66/access/composition owners and prior failed/inconclusive attempts remain explicit. Conditional landing bookkeeping is prepared but is not accepted completion.
- **Correctness, data integrity and access — 21/25:** deduct four for the final source-evidence completeness gap above. Boundary/input semantics, fixed native substitution, first-failure ownership and unchanged product access boundaries otherwise appear coherent from inspected source. No historical-cause or missing-GC inference is accepted.
- **Meaningful verification — 18/20:** deduct two because existing source tests prove the collection-time string/map validator, not the final persisted-set completeness contract that can currently pass without its files. The retained local controls are useful and their first failures are preserved; pending hosted capability is not precredited.
- **CI and operational usability — 10/10:** the new route binds the same-repository owning branch/main target to the exact `02ef01a4…` synchronize-before event, checks first attempt before setup, checks out the event head and retains identities. Finite diagnostic-only publication and deliberate ordinary-run cancellation are explicit. Current CI selection and required aggregates are not weakened.
- **Maintainability/process/over-complexity — 10/10:** the approximately1,200 changed source/test-line scope is explicitly reassessed beyond the original estimate. Input validation, scalar observer, source binding, analysis and closed resource mode are coherent safeguards for one experiment; shared GC interpretation reuses the existing contract. No generic framework, new product dependency or speculative configurable recorder was introduced. No independent avoidable-complexity deduction is justified at this head.

**Total: 94/100.** The P2 must be repaired and the new exact commit re-reviewed before the declared diagnostic publication. This score is for source/evidence readiness of the complete in-progress ticket at this checkpoint; it does not assert that the original ticket's failed runtime outcome has been delivered.

## Source and integration assessment

Read the original base ticket, current runbook/testing/personas, complete changed-path scope and maintained record, the focused `02ef01a4→9a7dfbf2` source/workflow/plan delta, and relevant full current controller/source/analyzer/validator/ownership code. Unchanged production-tail composition and its earlier exact-source evidence were considered with their original identities, not rerun or silently credited as current runtime acceptance. The production patch and exhausted component workflow have no delta from `02ef01a4`.

The event plan preserves the2,086 ASCII characters/Enter events with exactly two cuts in the original batched typing spans. It validates actual384/448 completed-state witnesses, epoch/unit/generation/timeOrigin, empty queues, expected12/14 history entries,24/28 native phases, unchanged method ownership and all cumulative capacity pairs. Nonterminal `snapshot()` does not restore wrappers or copy full caches. Native capture and composition observation continue through the remaining workload. The diagnostic keeps its one-group actual Undo/Redo; ordinary plain-1 remains the full66-group owner.

Trace/profiler startup occurs only at the validated empty384 boundary; the window ends after returned448. Profile stop precedes the one forced-GC control and trace drain. The GC control must be a known-duration interval wholly within clock uncertainty bounds. Later runtime is explicitly perturbed. The analyzer keeps native pair duration, encoding duration, inclusive native method time, compose-span union, unexplained remainder and GC overlap distinct; it does not subtract pauses or call a residual publication cost. Missing/invalid traces or semantic boundaries fail; no comparable≥80ms event is inconclusive even if an outside pair is large. Raw CPU stacks are retained without automatic fine causal attribution.

Partial fixture/session setup is owned before collection through `runOwnedObservation` and failed-test afterEach abort/join. The shared trace collector owns late completion handles and pending operations; no new action retry was introduced. The surrounding failure path retains the first primary while attempting session and fixture closure. The new source observer and composition handle are bounded by that owned fixture/session lifetime. A successful unit fixture is not proof that all real protocol/source-map formats will satisfy the new predicates; the single hosted diagnostic still owns that capability question.

The closed application-window watchdog preserves the300s body and30s failure settlement under450s whole CLI ownership,2GiB combined RSS and1GiB available memory; existing component mode remains60s. Final resource disposition uses the already-checked snapshot. The20min workflow and30s trace drain remain hard limits. Baseline responsiveness harness copying uses `e2e/doc-responsiveness*.ts`, so the two new imported helpers are included; diagnostic observer source was already added to both baseline source paths. New helper hashes are in responsiveness evidence/comparison expectations. Ordinary instrumentation paths remain inactive unless explicitly selected.

## Evidence independently verified

Inspected the retained final99-control log and final21 window/CI-control log:99/99 and21/21 passed. Their watchdog records report1045ms/660,992KiB and1297ms/320,704KiB respectively. These are separate recorded suites with overlap, not120 distinct tests. Scoped types/lint/format/actionlint/backlog/exact-title receipts are retained; the first missing-`gc` extraction failure, partial-install Playwright resolution failure, async-iterator typing repair and incorrect local title paraphrase are documented. No full clean local install, full project typecheck or application build is asserted.

With the parent's explicit serialized-slot authorization, A ran one bounded Git-blob size/SHA verification against this exact commit: **all26 evidence payloads and16 source bindings matched**. First execution passed in435ms, peak177,504KiB, pressure1. Files outside the repository:
- `/tmp/spn146-investigation/window-evidence-check-a.ts`
- `/tmp/spn146-investigation/window-evidence-check-a.log`
- `/tmp/spn146-investigation/window-evidence-watchdog-a.json`
- `/tmp/spn146-investigation/window-evidence-proof-a.json`

The manifest records that the first failed broader test output survives in the tool transcript rather than as a complete retained log; its watchdog and five-failure disposition remain durable. This limitation is disclosed rather than erased.

## Personas and remaining acceptance

Operator receives bounded collection, source integrity, first-failure evidence and explicit cancellation accounting; the open finding directly affects that trust. Owner and Collaborator retain exact editing/saving/peer/history requirements and the100ms contract; no diagnostic pass may replace them. Link guest access/revocation remains owned by its separate current-source cases. No document access or physical-phone claim is added.

After repair and two qualifying exact-head reviews, the declared transition may publish this one diagnostic only, with ordinary CI/Storybook/native runs cancelled and terminal cancellations retained. There has been no hosted execution of this new window. Real emitted-source/map compatibility, first-attempt collection, strict framing/conversion, clock/source/native linkage, selected semantic continuation and owned teardown remain unproved. Either failed or inconclusive terminal outcome closes this allowance, with no re-anchoring or rerun.

All previous component-criterion failures, native/application failures and the larger causal repair/disposition obligation remain open. SPN-146 cannot merge until a supported complete outcome, fresh ordinary required gates and selected native/browser owners are accepted on the final integrated source. The prepared ticket deletion/dependency removal/completion ledger must not be used to describe that outcome as already accepted.
