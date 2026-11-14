# SPN-159 — Completed native drawing resizes

## 🔄 Integration after admission and diagnostic prerequisites

2026-11-14: integrate actual main
`754e65317744e5ce97ede501935c6586e4875f2a`, which contains accepted SPN-158 and
SPN-160. Preserve their completion entries, next ID 161 and the November 12
grooming date, then append this candidate's SPN-159. SPN-120 now has both separately
owned prerequisites supplied by this candidate/base combination; it still needs
its own fresh acceptance and retains the historical failures and finite scope.
Merge conflicts affect only those bookkeeping records and the generated index.

The new runtime delta since the previously integrated main is nine files under
`src/server/maintenance/`: the admission fixture, ownership diagnostics and their
tests. These are not dependencies of the isolated native drawing fixture, which
uses a synthetic document and local unacknowledged queue with no server connection.
The complete native dependency closure (`web`, `src/ui`, `src/shared`, `lib`,
`server`, `scripts`, `e2e`, `.storybook`, manifests, root configs and preserved
probe) has no diff from tested source `5108adb5`. Recorded file hashes also match;
retain its single corrected browser sample under its original identity rather
than repeating an unchanged success. Run the 15 focused controls and full combined
source typecheck with the same guarded Go settings, plus quality/backlog checks.
This is the pre-execution checkpoint; new results are recorded separately below.

CI ownership remains unchanged: the story/helper's `web/` paths select ordinary
application and native/performance owners under `scripts/ci/plan.ts`; the existing
Storybook workflow owns all five theme/viewport variants and its fail-closed
aggregate. Shared layout, native/sync source, manifests, postinstall patches and
runner/config paths keep their existing selection. No new matrix, narrower route,
skip or waiver is introduced. All current-head hosted gates remain
requirements for merge, independent of retained local evidence. Publication still
requires the coordinated exact-head reviews and does not require a prior CI pass.

On integrated source `9ae1964d7b0e15116a1ea57a5f2f1d84d7bbf223`, index regeneration
passed. The fresh 15-test invocation was resource-aborted after 235 ms, peak
166,624 KiB, when system pressure rose to 2, before any test result. The following
compiler invocation was denied by watchdog preflight; no compiler started. Neither
is a passed check. No owned Vitest/compiler/serial process survived. Both original
outcomes are retained under `evidence/SPN-159/main754/`.

The delivery manager permits one resumed validation batch only after a bounded
observation finds normal pressure in three readings at least ten seconds apart.
This documents changed available resources; it is not an assertion retry. Retain
the unchanged deadlines and continuous watchdog, stop on the first failure, and
do not repeat the successful native browser sample. The bounded observation did
not establish stability: pressure was 1 at 07:54:48 UTC and 2 at 07:55:11 UTC on
2026-11-14. No resumed unit or compiler workload ran. Current combined-source
controls, types, quality, backlog and exact-title PR validation remain pending;
the earlier successful source identities remain intact. Index regeneration alone
passed in 158 ms before this stop.

## 🔎 Integrated verification results

The subsequent main integration `ecef3c6d6ea5093bdd9fcf7c0a69c5e5218b4a6f`
adds only seven documentation/backlog files since the tested base. A full diff of
runtime source, fixtures, scripts, manifests and configuration against tested
`5108adb5` is empty; current story/helper/test/runner/probe/config/native-package
hashes match the retained source-identity manifest byte for byte. Preserve the
original native, unit and typecheck receipts with their source identities instead
of repeating those unchanged workloads. The generated-index conflict was resolved
only by the index CLI (145 ms, normal-pressure preflight); exact-commit backlog
and PR-shape checks follow this documentation integration. Preserve SPN-160, next ID 161,
SPN-157's dependency on SPN-160, and completions SPN-148/145/149 plus this
candidate's SPN-159; SPN-120 still depended on SPN-158 at that checkpoint. Publication then awaited
the independent SPN-158 prerequisite and final base revalidation; no current
hosted acceptance is claimed by these local results.

The complete local batch passed on committed source
`5108adb55c2de303af7146a0f24402be72430b3a`, integrated base
`7c38f7d32e6a55d8000239923113155de6a07c8c`. Machine-readable
[source/runtime/build identities](evidence/SPN-159/integrated/source-identity.json),
[native observations](evidence/SPN-159/integrated/corrected-native.json) and every
watchdog receipt are retained in `evidence/SPN-159/integrated/`.

- **First corrected native sample passed:** existing desktop-light story at
  1280×900, 2,484 ms, peak 780,208 KiB. Narrow resize event 5 reached host/canvas/
  engine width 1272, followed by controls event 6. Restore event 8 reached 1280,
  followed by controls event 9. Insertion, image/text selection, drawing controls,
  unchanged pending count 1 and exact `doc.mutation.rich-text-editing` pending ID,
  exclusion of UI-only selection mutations, no native failures and no alert all
  passed. No browser error or swallowed Storybook play exception was present.
  The later height-only event 10 followed final text selection/tool closure; it
  is not evidence of either earlier width transition completing.
- **Focused static build passed:** 4,024 ms, peak 1,182,176 KiB. Existing story,
  theme/decorators and private caches; compiled story asset SHA-256
  `9f2ba5d55e37ca1dc55d721b8a10ffccb961aa3185beb8e909ebabcf26bbe087`.
- **All 15 focused tests passed:** 354 ms, peak 201,536 KiB, including rejection
  of both retained native false positives and missing/lagged/reordered transitions.
  Vitest caching was disabled with a task-private module-cache path.
- **Full typecheck passed:** 9,051 ms, peak 1,719,376 KiB, with the native Go
  compiler settings declared below and the unchanged watchdog/include set.
- **Quality and bookkeeping passed:** full Oxlint with denied warnings, changed
  source Prettier, dependency boundary, generated index, backlog structure/links
  and exact-title PR validation against registered main. Existing ticket-length
  advisories remain informational. A zero peak in a very short watchdog receipt
  means the command ended before the first sample, not zero memory use.

Owned-process and port audits found no task server, browser, compiler, Storybook
or rolldown survivor; port 6019 was closed and pressure remained normal. No
additional corrected browser sample was requested. Earlier setup failures and
resource aborts below retain their original disposition. The two deliberately
faulty native controls and this later success do not identify the historical
SPN-120 failure's unknown assertion or cause.

**Still required:** integration of any later main, two independent exact-head
reviews and all current-head hosted gates, including the five existing Storybook
theme/viewport owners. Local desktop light does not substitute for that matrix.
This change affects fixture readiness and diagnostics only; it introduces no
production visual state requiring a separate visual-review capture.

## 🔄 Registered-main integration and remaining sample

2026-11-14: integrated actual main
`7c38f7d32e6a55d8000239923113155de6a07c8c` after registration PR #286 merged.
Resolve the documentation-only add/add conflicts by retaining the experiment and
the registered immutable failure archive together; preserve SPN-149's completion
and the next-ID counter 160. Landing bookkeeping is prepared for this candidate,
not a claim of merge or completed acceptance. Regenerate the index through its CLI.
Main changes no dependency manifest, lockfile, postinstall patch or library source
relative to the verified installed tree. Probe, focused config and native package
source hashes remain the recorded identities.

The available memory condition changed: SPN-156 source
`d6f1b8c27590df5e49c5004a397bfe38a9eff942` completed 176 focused tests (986,496 KiB)
and a full native Go typecheck (1,683,952 KiB) under normal pressure, with owned
processes cleaned up. The delivery manager grants one guarded corrected static
build followed by the **first actual corrected native sample**, same probe,
1280×900 light viewport, deadlines, private caches and 2 GiB/eight-minute limits.
This changes the observed resource condition; it does not erase the earlier build
abort or authorize an unchanged assertion retry. Stop a failed lane and preserve
its first cause. Run the 15 focused controls and relevant quality checks separately.
For the native TypeScript compiler, use `GOMEMLIMIT=640MiB GOGC=50 GOMAXPROCS=2`
under the same external watchdog, without reducing its include set. Source and
result identities will be recorded after execution; all these checks are pending
at this pre-execution checkpoint.

## ✅ Demonstrated boundary and correction

2026-11-14, accepted implementation decision by the ticket agent under standing
persona authority. Both predeclared native controls ran once on source
`f0cb3d401b82762428f668557f9b44f7bdf341d3`, Node 26.13.0, Playwright 1.64.1,
Chromium 156.0.8078.4, desktop light 1280×900. The focused static build passed in
5,186 ms (peak process tree 1,228,608 KiB); the two controls completed in 4,632 ms
(790,000 KiB). These were deliberately faulty transitions, **not** passing native
acceptance or proof of the historical failure's cause.

- **Narrow withheld:** the old wait accepted native resize 1→2 and controls 2→3
  while host/canvas/engine widths all remained 1280. It advanced to Restore,
  which then failed `expected 2 to be greater than 2` because the width had never
  narrowed. The matching error shape does not identify the original failure.
- **Restore withheld:** a real narrow transition reached 1272. An unrelated
  height resize then advanced the counters, and the entire old story passed with
  host/canvas/engine widths still 1272. Pending count stayed 1 with the original
  `doc.mutation.rich-text-editing` ID; native failures and browser errors were empty.
- The native trace also observed controls created while the host was already
  1272 but native canvas/engine were still 1280, followed by the actual width
  resize and then another control creation. Therefore a global control increment
  cannot establish refresh after the intended native width transition.

Choose the smallest correction at the fixture boundary: capture a synchronous
request baseline and target width, then require current host/canvas/engine geometry
at that target, a native resize event at that width, and a later control creation
at that width. Native integer dimensions allow 1 CSS px rounding, well below the
existing 8 px change. Keep every original greater-than comparison and deadline;
add exact pending-ID equality at narrow, restore and final text selection. The
same helper rejects retained native counterfactual observations and deterministic
missing/lagged/reordered events. Bounded diagnostics record phase, geometry and
at most 32 event samples; screenshot failure JSON preserves these fields without
document content. No production UI, native engine, sync or authority change.

Operator gains a gate that rejects demonstrated false positives and identifies
the transition. Owner and Collaborator retain the real native insertion and
pending-work safeguards. Link guest's access and mutation authority remain
unchanged. Requiring a control refresh after restoration also verifies the native
behavior the same controller already promises, without increasing execution
budgets or adding a compatibility environment. Alternatives of longer waits,
retries or globally incremented controls leave the demonstrated gap open.

Raw [narrow](evidence/SPN-159/controls-narrow.json) and
[restore](evidence/SPN-159/controls-restore.json) observations, original
[probe](evidence/SPN-159/experiment.ts), setup failures and watchdog receipts are
retained in `evidence/SPN-159/`. Probe SHA-256 is
`b73d21a21d158fa32a994f86c8507e8a0388f746989a9fff0a8440b8838b2e45`.
The observed static story asset `SyncNative.stories-ZmMBRs7z.js` SHA-256 is
`a375e9eda40c4adec875c33cdd3ab3f9b624d8a39a21311f82a8fe81d2d2129e`;
index SHA-256 is `0538f8d2a28c44845d7c9fdb4ea807b09f642312f1c1ddb281ccc7aa0b98bec5`.
The focused build inherits `.storybook/main.ts`/`preview.tsx`, selects only
`web/SyncNative.stories.tsx`, and uses a task-private Vite/Storybook cache.

**Earlier verification, before registered-main integration:** all 15 focused unit tests passed on `77e0a289` (watchdog
497 ms, peak 277,248 KiB), including both retained native counterfactuals. Full
typecheck was resource-aborted after 1,724 ms at pressure level 2 (peak 1,407,376
KiB), without TypeScript diagnostics; it is **not a pass**. The owned process/port
audit found no remaining tsc, task browser or server on 6019. Focused formatting
and oxlint subsequently passed. Backlog validation was refused at pressure
preflight before execution. On corrected source
`92259c6e126affb9c7d6f5de7d7c19177ed5d179`, the first actual corrected static build
was resource-aborted during Vite transformation after 3,075 ms, peak 604,160 KiB,
with system pressure 2. The task stopped without a repeat. No Storybook, rolldown,
task server or browser processes survived, and port 6019 was closed. The single
corrected native browser sample had **never run** at this checkpoint; the prior
two controlled failures do not substitute for it. Workspace additions during that
build were documentation/evidence only; runtime source was clean.
All five existing hosted Storybook
variants and seven current-head gates remained pending. No coverage routing changed:
the existing `src/ui` Vitest owner tests the `web` helper; Storybook's existing
application/shared-source selection includes the story, helper, native SDK,
styles, runner and config. Both selected-missing and selected-failed work retain
the existing fail-closed runner and workflow aggregation.

## 🔬 Initial capability checkpoint and bounded experiment

2026-11-14, implementing agent: **M remains appropriate**. Inspection found a
fixture readiness boundary, with no evidence requiring a production engine,
authority or persistence change. The open-source native engine observes its
container with `ResizeObserver`, schedules `resize()` through
`requestIdleCallback`, and emits a resize only when width or height changes.
The native drawing controller refreshes selected controls after a 16 ms debounce.
The story samples global counters every 100 ms; those counters do not identify
which dimension changed. This supports an experiment, not a historical diagnosis.

Before execution, declare three fresh desktop-light 1280×900 browser contexts
against the existing `editor-sync-native--doc-drawing-capture` story. First run
two controlled samples on registration source `19337e04` plus passive bounded
phase/geometry instrumentation (exact committed source recorded with results):
intercept **only** the Narrow button or **only** Restore and withhold that width
change, instead reducing host height by 8 px. Native insertion, selection,
ResizeObserver, engine resize and drawing control creation remain real. Inspect
whether the old counter wait accepts the wrong width. Do not repeat a failing
sample. Then, only if that boundary is demonstrated, run one corrected native
sample with neither interception. Preserve first failures and distinguish these
deliberate controls from acceptance. The original failed assertion stays unknown.

Retain story deadlines: readiness 35 s, insertion/geometry 10 s, resize waits
at their existing `waitFor` default. The runner stops each context after 60 s
and the owned server/browser after the three declared samples or first unexpected
failure. No blanket retry or timeout increase. Use pinned Node 26.13.0, installed
Playwright Chromium and the equivalent existing dependency tree after comparing
lockfile, all workspace manifests and postinstall patches. The single Mac workload
slot, normal pressure, 2 GiB process-tree cap and eight-minute watchdog apply.
The exact Chromium/runtime versions and diagnostic source commit belong in the
receipt. Release contexts, browser and owned server in `finally`; audit descendants
after any resource abort. No capture includes real document content or credentials.

Lowest-layer negatives will exercise the same geometric readiness predicate as
the story: missing narrow, missing restore, unrelated height resize/control
increments, native width lag and absent required control refresh cannot complete.
The existing native story owns actual insertion/selection and unchanged pending
count **and IDs**. Existing five Storybook variants retain hosted compatibility
ownership; local work runs desktop light only. No source/shared dependency routing
is narrowed. Initial state: source inspection complete; experiments/tests pending
the shared Mac slot. All four persona tradeoffs remain those recorded below.

### 🧾 Setup attempts and corrected dependency identity

Passive diagnostic source `1e07287c` includes the registration clarification.
The first build setup exited before compilation/native execution: the assumed
`storybook/bin/index.cjs` entry does not exist (watchdog receipt
`spn159-diagnostic-build`, 104 ms, 0 KiB sampled). Inspection then found that the
root installed Storybook was stale at 10.6.2 despite tracked manifest equality.
No behavioral evidence is attributed to that installation.

The task now links the installed tree in `spinel-spn-098-production`, already used
by the current integration work. Its lockfile, root/workspace manifests, postinstall
scripts and complete `lib/` source match base `89e4426d`; a direct installed-version
audit found zero mismatches for all non-workspace root dependencies/devDependencies.
Actual Storybook is 10.6.5 and Playwright 1.64.1. Reinspection of the actual
open-source Univer 1.3.1 install confirms the native scheduling facts above:
`engine-render/lib/es/index.js` SHA-256
`4aafe05d46511c0a6be2bc53a7ab9cf794398c45eef7ed9e10269cf392db4771`
(lines 35320–35385), and `docs-drawing-ui/lib/es/index.js` SHA-256
`ed4e5911810077a2b76e3db9ff986b5539d7467ebaf4f531a176503b8b56d1d4`
(lines 2121–2130). These are current runtime inspection, not historical attribution.

Use the installed `node_modules/.bin/storybook` entry. Build a focused static
Storybook first, then run the lightweight static preview/browser separately;
this avoids concurrent Vite compilation and native browser memory. The focused
config imports the existing config/theme and changes only the story list and
private cache. A second launch was deferred by the watchdog at pressure level 2
before any child spawned. Preserve both setup logs; neither is a native attempt.
The task-owned process/port audit found no remaining server or browser on 6019.
At that setup checkpoint, native samples, readiness repair and acceptance were
still pending; the later completed controls and current limits are recorded above.

A later corrected-build setup command accidentally repeated the Node executable
before `watch.ts`, causing Node to parse its binary and exit with a syntax error.
No watchdog, Storybook build or native sample ran in that setup attempt. The
983-byte log has SHA-256
`7fb4d577a1be7972c22ea7358237e52c9bc499a837f8a04febf0355301baba14`;
its bounded error text is retained as `setup-duplicate-node.txt`. The delivery
manager independently compared the corrected executable/argv against the earlier
successful build receipt before the first actual corrected build described above.
Keep the setup error distinct from that later resource-aborted compilation.

## 🧭 Complete outcome and persona decision

**Date/status/source:** 2026-11-13, accepted registration and complete scope;
implementation and acceptance pending. Agent delivery-manager judgment under the
owner's continuous backlog instruction and [standing persona authority](../todo/process.md#decisions),
following independent SPN-120 source/fixture assessment. This is an independent
newly observed native interaction failure, not completion or narrowing of SPN-120.

**Question:** how should the failed native Doc drawing story receive a useful
first-attempt diagnosis and repair without retrying it to green or silently
expanding the finite browser-fixture audit or obsolete CSS cleanup?

Options were an unchanged rerun, weakened counter comparison, absorption into
SPN-120/SPN-087, or one complete **M, pre-launch** investigation and repair. Choose
the separate outcome, explicitly blocking SPN-120. Retain actual native image
insertion, image/text selection and drawing-control refresh, with unchanged
authored pending work and no UI-only selection operation entering the mutation
queue. Registration or another variant's pass does not resolve the failed gate.

The estimate includes source/native investigation, bounded stage/geometry
diagnostics, demonstrated readiness correction, negative controls, original
privacy/resource/cleanup boundaries and current five-variant Storybook acceptance.
**Before execution**, declare a bounded experiment with exact source, relevant
native events, phase identities, geometry observations, viewport and stopping
condition. Start with the existing fixture and capture helpers. Reassess before
expanding into native engine, product rendering, persistence or authority changes;
a short diff does not make that wider work automatically M.

The global counters may observe an unrelated pending resize before the requested
width has completed. That is a **hypothesis**, not an established historical cause.
Before choosing a correction, demonstrate the causal transition/readiness boundary
in the predeclared new controlled experiment. The original failed comparison and
phase remain unknown; do not require reconstruction of unavailable historical
evidence or treat a plausible hypothesis as a demonstrated cause. The corrected
readiness control must reject missing narrow and missing restore completion;
where relevant, deliberately unrelated resize activity must not satisfy it. Keep
all original timing budgets and behavioral assertions. No sleep-based readiness,
unconditional retry, skipped variant, weaker greater-than comparison or timeout
increase is acceptance.

**All four personas:** Operator gains a trustworthy bounded native gate and useful
phase-specific failure evidence. Owner and Collaborator retain native drawing
edits while selection and resize cannot masquerade as authored changes. Link guest
retains the applicable native interaction and read-only/edit authority boundaries;
this fixture grants no new access. A separate repair makes the newly discovered
work visible and reviewable, at the cost of delaying SPN-120 until its required
acceptance is genuinely complete.

## 🔎 Retained failure and source limits

[Storybook run 43554616505](https://github.com/mxbaylee/spinel/actions/runs/43554616505),
attempt 1, [desktop-light job 132324964897](https://github.com/mxbaylee/spinel/actions/runs/43554616505/job/132324964897),
failed on published SPN-120 source
`47bf4aad2a7b7e880dbb3cf43eb09d90da70c6ee`, integrated base
`89e4426dfff1c3469b260305e21180ffd79fdb7f`. The artifact is **14097504548**;
ZIP SHA-256 **c203f06d01059c23bdeb0eb6f8737fd689186e852d3edd9557cf19f1b067d167**.
Its manifest records **1,041 requested, 1,040 checked, one failed** in **394,633 ms**,
desktop light, 1280×900, reviewed at **2026-11-14 04:11:19.167 UTC**.

The failed story is `editor-sync-native--doc-drawing-capture`; its retained inner
message is **`expected 2 to be greater than 2`**. The outer fail-closed capture check
found a `playFunctionThrewException` although Storybook's `storyFinished` event
reported success. No unhandled-error event was recorded. Other selected variants'
results do not supersede this failure. No unchanged rerun was requested.

The [exact play source](https://github.com/mxbaylee/spinel/blob/47bf4aad2a7b7e880dbb3cf43eb09d90da70c6ee/web/SyncNative.stories.tsx#L376)
has three possible counter comparisons: resized and controls-created after Narrow
editor (lines 380–381), and resized after Restore editor width (line 386). The
retained error is truncated and does **not** identify which assertion or phase
failed. The later host, layout and canvas widths are all 1280; the synthetic image
is selected in the failure screenshot. This later full-width state cannot prove
which transition failed or whether an event was missing.

`web/SyncNative.stories.tsx` last changed in SPN-058 commit
`12aa9b0d4f7c43f458729a38a390a5988d33bc58`. Its source SHA-256 is
**cb49b99f39451671822b4816902dca54eb2182390706fc293d83e7edb1741bb9**
on both current main 89e4426d and the failed candidate 47bf4aad. The SPN-120 diff
has no `web/`, `.storybook/`, screenshot-runner or lockfile changes; package.json
changes only formatting command paths. These are provenance facts, not proof
that broader source/runner behavior cannot contribute or that a product is faulty.

The fixture samples observations into hidden output every 100 ms. Its global
resize/control counters do not explicitly bind completion to the requested native
width. Investigate this as one supported hypothesis while retaining the possibility
of a missing native resize/control event. The original ZIP remains locally at
`/tmp/spn120-storybook-light-14097504548.zip` and in the expiring hosted artifact.
The durable archive retains the relevant extracted manifest, diagnostic JSON,
synthetic screenshot and log, plus the original ZIP digest; it does not contain
the full ZIP.
The [published immutable failed-validation archive](https://github.com/mxbaylee/spinel/blob/4bd84e3be7645a3b18c794c966e0007e6770cc9c/docs/review-assets/spn-120-validation-47bf4aad/README.md)
retains those extracted files and digest at commit
`4bd84e3be7645a3b18c794c966e0007e6770cc9c`,
sole parent 47bf4aad, under tag
`archive/spn-120-validation-47bf4aad-20261114`. The delivery manager verified
the archive payload hashes and exact remote tag before this link was recorded.
This is retained failure evidence, not repaired acceptance.

## 🧪 Verification plan and registration status

The existing native story and screenshot interaction runner own the real image,
selection, layout and pending-queue contract. Extend bounded diagnostics with
fixed phase/counter/geometry fields, without recording document contents or
credentials. Reuse the lowest meaningful shared readiness control for deterministic
negatives, and execute the affected real native interaction. The existing five
Storybook theme/viewport variants own compatibility; no new matrix or repeated
full local catalog is introduced. Keep relevant shared native drawing/selection,
sync, CSS/layout, story and runner/config paths in CI selection, with selected
failed/missing work unable to pass.

The fixture uses a synthetic image and local pending queue; it does not simulate
a server connection or save acknowledgement. Preserve exact native insertion,
image/text focus, drawing controls, pending count/IDs, exclusion of
`doc.operation.clear-drawing-transformer` from mutations and the empty native
failure list and no-alert assertion. Dispose editor subscriptions/timers and owned browser/server work
on success or failure, retaining the first cause and bounded cleanup evidence.

The original registration performed no native experiment, fix, new capture or acceptance
run. Its documentation checks covered the ID allocation, complete scope, evidence
limits, dependencies and generated index. [Focused registration sequencing](grooming-native-drawing-2026-11-13.md)
preserves the grooming counter and the independent existing repair requirements.
