# ✅ SPN-142 first-attempt mobile responsiveness — independent review B

## Disposition and identity

**Accepted as the mobile responsiveness result for source `2b173b29b3c0894a45b8d48d92073c3645110673`.** Preserve this valid first candidate pass. It does not close the expanded idle/collaboration obligation discovered in older receipt-triggered runs, establish their causes, discharge the historical callback collection owner, or approve merging SPN-142. The PR remains draft under those obligations.

Base `7679351822caaa9535d73d656191f2a6597a3380`; tested merge `3b11e1e7469b2d3fc59ac95195bf4da6333c16c4`; source/tested tree `eac584b6bb8e9a377e69ae58551df67df5b7bcde` (independently checked during this same source's callback audit). CI `41916623281` attempt 1, mobile job `126878184157`, artifact `13369565365`. Original ZIP `/tmp/spn142-hosted/mobile.zip` independently hashes to `43af252c1e95690d4c1ba83fd815ba30b30705d9c075175cfbd9b8f05f8b862e`.

All 18 extracted artifact members match the ZIP: 16 JSON records and two CPU profiles; both profile hashes match the metric and clock records. The nine recorded harness hashes in every sustained-typing manifest match the exact source files; the post-burst harness also matches. Baseline source is immutable `2c84a18449c7dae09e2817989fac6236be96ef98`, candidate is the tested merge. Both use the current copied harness, Chromium `156.0.8078.4`, the same Linux/X64 runner `GitHub Actions 1000041312`, run attempt 1 and fourfold mobile CPU throttling. This is emulated mobile, not physical-device acceptance.

## All 11 cases and raw budgets

The retained Playwright reports and job log agree: four baseline sustained cases and seven candidate cases passed, each retry 0, with no skipped, unexpected or flaky results. Candidate cases are three plain sustained samples, one profiled sustained sample, quiet-pause continuation, composition/group-boundary behavior, and access revocation with a late composition event. The paired comparator reports passed/timing-valid/candidate-integrity true with no failures or unavailable requirements.

For candidate plain samples 1/2/3, respectively:

- Input-to-frame p95: **106.2 / 104.3 / 105.5 ms**, below 200 ms.
- Maximum long task: **209 / 181 / 177 ms**, below 500 ms.
- Capacity flush p95: **33.8 / 33.8 / 30.2 ms**, below 50 ms; maximum **47.2 / 44.0 / 43.6 ms**, below 100 ms.
- Idle pair p95/maximum: **3.1 ms each**, below the mobile 50/100 ms limits.
- First verified browser-local drain: **321.7 / 308.9 / 509.7 ms**, below 1,000 ms.

Each sustained candidate has 65 actual 32-state capacity pairs and one six-state idle pair. I cross-checked raw flush durations and counts against summary maxima, raw long tasks against their maxima, group sizes against 32, and each idle quiet period against the unchanged 300 ms policy. The browser-local witnesses are not invalidated. Late-read drain upper bounds of 1,272.5 / 1,129.7 / 1,119.4 ms are retained descriptive observations; protocol revision 5 explicitly uses the previously registered browser-local drain metric. No new subtraction or budget interpretation was introduced to pass this run.

## Content, history and boundaries

All four candidate sustained manifests contain 2,086 native inputs and frame observations, exact 2,088-character text with SHA-256 `6c714aa1049090072c1b3c4acb27bf6e12c9e56426c8df01cf069a23c6529b44`, pre-Undo integrity across sender/peer/saved state, sender selection 2,086 and peer selection 0, drained history/collaboration queues, high-water 32/32, and 66 undo records before Undo. No candidate errors or reloads remain.

Plain-1 exercises **all 66 actual history groups**: Undo reaches zero undos and 66 redos, then Redo restores 66 undos/zero redos and exact sender/peer/saved content. Other sustained samples exercise the last six-state group: Undo leaves 65/1 history and 2,082 characters, then Redo restores exact 2,088-character content. This distinguishes complete-history acceptance from merely observing 66 available records. Final hashes across sender, peer and saved state independently agree with the pre-Undo expected hash.

Quiet-pause continuation completed with a 433.8 ms browser quiet gap, 148.9 ms key-to-frame, 149.0 ms key-to-native-read, 164.7 ms request return, and 582.7/582.8 ms from final original key to continuation frame/native read. These meet the unchanged 350 ms requested pause, 500 ms continuation frame/read, 1,000 ms request and 1,850 ms combined bounds. Saved/peer behavior completed with no errors or reloads.

The composition case preserves provisional text/history on composing Enter, removes cancelled provisional text and atomically undoes/redoes finalized composition with exact saved/peer text. The revocation case holds one pending write, forwards no late write after revocation, preserves persisted snapshot/revision and denies the old capability. Both have no browser errors. Both explicitly report `physicalIme: false`; synthetic composition-event coverage must not be described as real platform IME qualification.

The baseline's four passes retain their registered observation outcome: exact initial integrity and Undo, followed by explicit baseline capacity refusal on Redo and recovered empty saved state. Their one-group history and capacity reloads are disclosed, not converted to candidate correctness or responsiveness passes. Candidate retention is 100 groups, baseline 50; candidate grouping remains 32.

## Profiling limits and remaining scope

The profiled candidate also completed exact content/history and has a 71.8 ms capacity maximum and 35.6 ms idle pair, but its latency budgets are deliberately not enforced. It is diagnostic and does not substitute for the three unprofiled samples. The retained candidate profile has 1,761 ms clock uncertainty, three negative deltas and six reordered samples; history and collaboration are sampled, but certain containing-task attribution is unavailable. No inference that GC, a specific guard or a specific native subphase caused an old unprofiled failure follows from these samples. Baseline attributed long tasks and observed profile/plain differences are not causal measurements of profiler overhead.

No browser execution, assertion retry, source mutation, or heavy trace parsing occurred in this audit. The reports establish completion of the declared test/fixture assertions; they are not a separate native process-lifecycle audit. No routine screenshot was required or supplied for these passing non-UI cases. Operator receives exact provenance and measurement limits, Owner/Collaborator receive saved/peer/history integrity, and Link guest receives the explicit revocation boundary check.

Current mobile acceptance remains valid while the historical failures remain failed. Required expanded SPN-142 work, its bounded guard-allocation checkpoint, the distinct callback follow-up registration, and any later integrated-source acceptance remain outstanding; this review does not approve an unchanged rerun or a merge.
