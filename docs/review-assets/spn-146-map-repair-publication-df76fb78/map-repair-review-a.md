# 🔎 SPN-146 map-collection repair — exact-source review A

**Reviewed commit: `df76fb78fa0258f8c28c068767970e8e869a5838`, original main base `2f442317dd2e1c188ae4a810ac094fd1162a4a2a`. Independent score:98/100. No unresolved source blocker found for the explicitly declared one-time changed-source diagnostic publication. No production qualification, native acceptance or merge approval.**

Independent nonimplementing review, 2026-11-05. Source was clean and unpushed when checked. This score follows inspection of this exact candidate and its `ab896604→df76fb78` delta; it does not inherit the previous98/100 grade or reclassify the failed hosted collection. Project source remained read-only. No test, browser, native workload, converter or trace parsing was executed by A.

## ✅ Repair correctness and finding dispositions

The prior hosted attempt failed because the collector required a `.map` beside every emitted JavaScript file, including an unmapped generated preload helper. The repaired collector still compares every in-scope executed JavaScript byte sequence against its emitted file and retains those bytes with script ID, path, size and digest. It now distinguishes mapping availability from exact generated-code identity.

Only ENOENT from the initial map `stat` produces `absent-at-collection`. Other stat errors propagate. Once a map is observed present, its read remains mandatory; disappearance or read error is not downgraded. Its actual length must equal the observed length, and malformed maps/incorrect embedded sources still fail. An empty map is a Buffer and reaches parsing rather than being mistaken for absent data. Unmapped rows retain null map size/hash and an empty mapped-module set, not fabricated original-source information.

Final retained-source verification remains strict. A present-map receipt requires the exact retained map file, bytes, SHA and embedded identity. An absent-map receipt must retain no contradictory map metadata/file. Expected prior Docs and Core bindings are still required exactly once across the mapped closure, so a missing target map cannot use the unmapped branch to complete. The native preparation/Git/source/tree/event-before checks remain in place; the original9a7 terminal source-retention P2 remains resolved.

The tests now use the actual collector and real temporary emitted/retained files with a fake CDP session. One mapless helper accompanies mapped Docs/Core; changed loaded helper bytes, missing target map, malformed map, disappearance between stat and read, map-as-directory read failure and retained tampering/deletion are rejected. This is meaningful lower-layer proof of the specific repair. It is not a claim that the complete hosted module inventory is already accepted.

The diagnostic now labels `loaded-source-retention` before collection and records the first operation failure in its catch before finally cleanup changes phase. The added lifecycle control checks that the original error identity and first failure phase survive cleanup through the actual progress/ownership helpers. The earlier misleading `fixture-cleanup-complete` first-failure phase is therefore addressed; the original failed journal remains preserved rather than rewritten.

**No additional actionable source finding was established.** Unknown/unmapped original frames remain an explicit attribution limit. The repair does not alter the prior-native algorithm, emitted application bytes, workload,384→448 boundaries,80ms comparable-event definition,100ms acceptance limit, GC criterion, source limits or collection/resource deadlines.

## 📊 Full rubric and limitations

- **Scope and acceptance:35/35.** The original complete XL outcome remains open with its causal/native/performance/data/access/history obligations. The revised plan distinguishes a startup collection defect from unfavorable measured outcomes and admits only the specific changed-source validation. One-group diagnostic history and separate ordinary full66/access/composition acceptance remain explicit.
- **Correctness/data integrity/access:25/25.** Mapless generated code stays byte-bound; present and required native maps remain fail-closed through final retention. First-failure phase is repaired without replacing the original exception or adding a retry. No product collection/access policy changes in this delta.
- **Meaningful verification:18/20.** Two points withheld for the unperformed integrated hosted boundary: actual current module capture, strict trace/GC clocks, native window and complete semantic continuation remain untested on this head. The targeted controls are appropriate and no duplicate local browser run is requested. Hosted pending is neither a pass nor a known source defect.
- **CI/operational usability:10/10.** Exact predecessor `ab896604…` is bound consistently in workflow and converter, with same-repository branch/main routing and attempt1 admission. Normal workflow cancellation is explicit and must be recorded. The old component trigger and its failed criterion remain untouched.
- **Maintainability/process/over-complexity:10/10.** Approximately170 changed source/test lines repair a concrete format boundary and failure journal using existing helpers. The change introduces no new recorder, build service, general fallback or configurable retry system. The expanded complete PR remains one deliberately reviewed XL investigation with honest scope checkpoints.

**Total98/100.** This qualifies reviewer A's source assessment for the declared diagnostic-only publication once the second exact-head review and fresh publication guards qualify. It does not qualify the production candidate or mean the original ticket outcome is complete.

## 🔬 Exact evidence inspected

Considered the original main ticket, current process/testing/persona requirements, full candidate scope and maintained history, then read the entire new source/workflow/test delta and prospective superseding decision. Unchanged production composition and earlier controller/source/ownership analysis retain their previously reviewed identities; no old runtime pass is used as current credit.

Read retained logs:9 window/collector controls passed in197ms,90,256KiB sampled peak;7 lifecycle controls passed in1001ms,553,408KiB, including the real Playwright deadline fixture and first-failure phase. Scoped types, targeted lint/format and actionlint are retained as passed with their limited scope. The timeout fixture runs a synthetic controlled test, not the full native diagnostic. Local partial dependency installation/full project typing/application/native limitations remain explicit.

With the parent's serialized-slot authorization, A verified **all14 maintained payloads and6 source bindings from exact `df76fb78…` Git blobs**. All20 size/SHA assertions passed on first execution in304ms, peak92,704KiB, pressure1. External proof files:
- `/tmp/spn146-window-hosted/map-repair-evidence-check-a.ts`
- `/tmp/spn146-window-hosted/map-repair-evidence-check-a.log`
- `/tmp/spn146-window-hosted/map-repair-evidence-watchdog-a.json`
- `/tmp/spn146-window-hosted/map-repair-evidence-proof-a.json`

The original failed run42039152201/sourceab896 remains failed and consumed. Its full original16-member ZIP and independent audit are linked at immutable `d1c75e4dd09a3fa265ea17a5f9d87c372aa16e62`. A's prior read of raw metrics/progress/native-caches established that it failed before input/observer/window; A did not duplicate B's complete ZIP audit here. CDP-detached/fixture-closed witnesses and the original aggregate cleanup.complete=false are preserved truthfully.

## 📐 Soft-limit and split assessment

The committed PR checker reports13,983 changed lines, above the10,000 soft-limit checkpoint. This warning is not waived by XL sizing and must remain visible. The present correction is within the separately declared sub200-line scope. The complete PR includes the native proposal, regression contracts, retained failed investigations, source-bound diagnostic capture and their operational guards, all serving the same unresolved mobile-flush outcome. There is still no safely accepted production slice to land separately; closing a smaller parent would hide remaining causal/acceptance requirements. Keeping this checkpoint in SPN-146 is coherent. A future expansion requires renewed scope review rather than treating this decision as unlimited diagnostic infrastructure work.

## 🚦 Explicit prospective allowance and pending outcome

The new maintained decision correctly records the `02ef→ab896` allowance as consumed and closed. It does not say zero inputs made that attempt free. It explicitly supersedes the old no-reanchor restriction only for one changed-source attempt after the concrete map-collection repair, conditional on both final grades. That is defensible because a lower-layer startup defect prevented any event from entering the measurement window; no adverse timing sample is being repeated or screened out.

Before publication, verify the remote predecessor is still exactab896 and the candidate is exactdf76 (or re-review any later commit). The only admitted route is the declared same-repository synchronize transition on the owning branch, attempt1. No manual fallback, workflow rerun or implicit new allowance follows. Cancel and record terminal ordinary CI/Storybook/native checkpoint runs; their cancellation is not acceptance. Do not alter routing or required checks to hide them.

The one diagnostic must preserve exact preparation/source/runtime identities, full raw/derived trace integrity, mandatory mapped prior-native/Core closure, native384/448 witnesses, original2,086-input continuation, selected content/saved-peer/selection/history checks and owned cleanup under unchanged limits. A valid new comparable event can inform only that instrumented execution. No comparable event is inconclusive; missing/invalid evidence or resource/semantic failure is failed. Neither result automatically creates another attempt or explains historical131.2/110.4/129.1ms failures.

Operator gains finite, integrity-checked evidence; Owner and Collaborator retain original content/durability/history and performance requirements; Link guest collection/access protections remain separate mandatory owners. The production candidate's rejected component criterion and application/native failures remain open. Full causal repair or supported disposition, main integration and all required current-source ordinary acceptance still precede any merge.

The user's current scope is **complete SPN-146 and SPN-090, then stop**. SPN-123 and141/140/120 continuation remain parked. This review does not reopen them or authorize any unrelated workload.
