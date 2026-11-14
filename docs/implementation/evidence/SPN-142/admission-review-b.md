# 🔬 SPN-142 offline capability and admission review B

Independent nonimplementing review, 2026-11-04, against base `7679351822caaa9535d73d656191f2a6597a3380`. Inspected the dirty documentation checkpoint, temporary probe/experimental helper sources, retained results and watchdog, and existing patch/manager test infrastructure. No source edits or additional workload were performed.

**Disposition: the evidence justifies implementing and testing this narrowly guarded leading-delete-prefix extension. It does not yet justify shipping the patch, claiming native latency acceptance, or attributing the failed 102.4 ms interval to this work.** No grade or validation-push approval is issued for an unimplemented candidate.

## 📌 What the bounded probe establishes

Independently verified the capture hash `714376723b3ef6a048796f7a1903a58181098960960cecb111e22e0594a2e7c8`, current patch-source hash and both experimental helper hashes against `results.json`. There are exactly 320 unique comparisons: eight retained caches plus 32 Enter-position windows, two cache scopes, two directions and ES/CJS helper forms. All 320 record raw deep equality, and the script asserts input nonmutation after both control and experiment. Allocation counts fall in 124 comparisons and increase in none; redo counts are unchanged throughout. Watchdog records command-passed at normal pressure, 1528 ms and sampled peak 431056 KiB. Instrumentation restoration is protected by `finally`.

The position-5 history Undo case reduces counted allocations 1240 → 352 and iterator-next calls 167 → 42. Cases with only zero/one qualified inverse member retain original work. These counters measure calls/allocations through the existing native primitives, not heap bytes, GC pause duration or latency. The source arithmetic maps input states 385–416 to an Enter at offset 5 and a 26-delete inverse prefix. That mapping is not a capture of the failed interval and cannot establish its cause.

The probe prepares the current patch in memory from hash-recognized installed OSS bytes, extracts helper text and evaluates it with the shared required Core runtime. ES and CJS helper generation are both covered; this is not full ES/CJS module installation, state-manager publication, native browser or independent dual-Core-runtime acceptance. The old historical cache capture remains distinct from current-source execution evidence.

## 🧭 Why the narrow algorithm is defensible

The experiment preserves the existing plain-data and exact native-shape guard, changing its result from whole-group Boolean to the length of the initial qualified descending single-character delete run. For a prefix of at least two, it deep-clones the lowest-offset member and changes only its delete length. That is the existing complete-group identity applied to a smaller prefix. It then folds every remaining action through the original JSONX.compose calls in order, never reorders a structural action or searches for later eligible islands. The insert path is unchanged.

The intended proof boundary is therefore precise: the prefix result must equal the original sequential prefix accumulator in complete raw value/metadata shape; composing the identical tail in the same order must preserve the complete result. Deep-cloning the retained prefix action prevents newly mutating the source prefix. Tail ownership still relies on the original composition operation and must be checked in the integrated manager path; the probe's immediate input-nonmutation assertion alone does not prove there are no harmful result/input aliases after publication or later mutation.

This reuses the existing SPN-135 delete identity and SPN-133 leading-prefix convention. It needs no new composition engine, cache policy, group size, timer, publication delay or dependency. The surrounding effort remains XL because proving the semantic boundary and actual integrated latency/access/history outcome is substantial even if the code edit is small.

## 🧪 Required production proof before validation

Use the existing real manager fixture and native semantic/work suites, retaining pristine sequential native and exact pre-SPN-142 patch controls. Do not replace the current algorithm with an implementation-mirroring test oracle.

- Cover prefix lengths 0, 1, 2, odd/even and full group, empty/singleton states, zero/nonzero offsets, and independent history/collaboration caches with different valid prefix lengths and order. Verify complete publications, metadata and application/Undo/Redo snapshots, not only action output.
- Put each unsupported member at the beginning, middle and end: nonadjacent/constant/ascending offsets, multi-character edits, insertion/mixed actions, Enter/C0/DEL, paragraph/section/custom metadata, unsupported markers, own undefined versus absent fields, styles/valueRangeId and unknown keys. Retain exotic-shape guard negatives (prototype/accessor/nonenumerable/symbol/depth). After the first rejection, the whole tail must remain the original sequential fold; later eligible islands must not be optimized.
- Prove lowest-offset prefix body and metadata remain exact with deliberately different characters/styles/own fields, including when subsequent structural composition changes that accumulator. Require input nonmutation and appropriate ownership/isolation under later output mutation and shared input references.
- Exercise actual full-manager publication order, cache draining and no-new-observer/timer behavior. Keep divergent cache and complete history/selection/segment/IME/access controls intact. Raw equality to the previously shipped patch and original native results must not normalize away meaningful metadata.
- Preserve a meaningful work-reduction control that fails with the exact pre-SPN-142 patch. Unsupported-at-start and short-prefix cases should retain original work; eligible prefixes before unsupported tails may now legitimately reduce work. Existing whole-group fallback tests that demand unchanged counts for every unsupported position need a precise new boundary assertion, not wholesale weakening or deletion.
- Preserve exact installer recognition/upgrades for pristine and every previously accepted patch, including the current full-group-delete patch; unknown/partial bytes must fail closed in both formats. Do not mutate installed packages during the admission probe.

The 320 captured/window cases are useful regression inputs, not a substitute for these guards, manager semantics or fresh required native first attempts. Before those native runs, record the selected implementation contract and finite acceptance plan; keep diagnostic profiling separate from primary timing and preserve every new first failure.

## 👥 Scope and remaining uncertainty

Owner and Collaborator retain complete history, publication and persisted/peer edits; Link guest must retain identical native semantics and access fences; Operator gains a bounded primitive-work reduction without chance-based retries. Existing storage and Safari authority repairs remain separate.

The retained peak contains a long history phase, but no captured failed cache or plain-sample profile identifies allocation/composition/GC/subscriber/scheduling cause. The proposed extension addresses demonstrable avoidable work on a relevant class of native inverse caches. Phrase that as an independently supported improvement and hypothesis to validate, not a proven repair of the historical spike. Keep the 100 ms maximum, all other limits and original 2086-input workload unchanged. Production admission remains conditional on complete implementation proof, both exact-source reviews and fresh selected acceptance.
