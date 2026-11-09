# SPN-146 patch A/B (previous build vs linear-tail build)

Question: does the linear-tail Docs patch change the mobile Doc typing flush tail, everything else equal?

- Same container image (`docs/implementation/SPN-146-linear-tail.md`, "Local container rehearsal" recipe), same flags
  (`--cpus=4 --memory=6g --shm-size=2g`, `PRESET=mobile SPN108_BASELINE=0`), sample `mobile sustained native typing plain-1`.
- Per run, `node_modules/@univerjs/docs/lib/{es,cjs}/index.js` was rewritten from `prepareDocsPatch(source, format)`:
  `qualifiedRangesPatched` = previous build, `patched` = this PR's build (both carry the same flush observation patches).
  Then `npm run build` (offline), then the spec. Installed sha256 values are in `summary.json` and were re-checked after the build.
- Three alternating pairs (previous, patched, ...), one container per run.

Result: no flush tail on either variant (flush max 11.1-25.8 ms, p95 7.6-10.8 ms, all budgets met). The previous build
did not reproduce the 102-129 ms hosted maxima, so this harness cannot attribute them to the patched mechanism.

Caveats: smoke only. Docker runs ~2.3x faster than the hosted runner, one sample (plain-1) per run, n=3 per variant,
single machine. A hosted-runner A/B (same toggle in CI) would be needed to say anything about the 100 ms tail there.

Rerun: build the image, then per variant run the container with a script that calls `prepareDocsPatch` on both lib files,
writes `qualifiedRangesPatched` or `patched`, runs `npm run build`, then `/run.sh` from the rehearsal recipe.

## Hosted runs (`.github/workflows/patch-ab.yml`)

Retained here because workflow artifacts expire after 7 days. Each folder holds the workflow's own
`summary.json` and `summary.md` (per-run metrics, installed hashes, budgets):

- `run-42309178838-4-pairs/`: head `c4be221c`, previous over budget in 1 of 4 pairs, patched 0 of 4.
- `run-42320780806-8-pairs/`: head `53fad9fe`, 8 of 8 pairs within budget on both builds.
- `run-42336853126-8-pairs/`: head `c7c96714`, 8 of 8 pairs within budget on both builds (fast runner).
- `run-42340182231-8-pairs/`: head `c7c96714`, 4x throttle, 8 of 8 pairs within budget on both builds (fast runner).
- `run-42348189799-6x-8-pairs/`: head `cde5a7b7`, 6x throttle (`ci-patch-ab-6x`), 8 of 8 pairs within budget on both builds. Do not pool with the 4x runs.
- `run-42353649355-8x-8-pairs/`: head `cde5a7b7`, 8x throttle (`ci-patch-ab-8x`). Previous: 1 flush-budget breach (pair 3, 118.1 ms). Patched: no flush breach, but pairs 1 and 3 exited 1 (input p95 205 ms plus a 300 s timeout; a timeout after which every recorded budget passed). The summary's "over budget" tally counts flush budgets only. Do not pool with other throttle levels.
- `run-42390275800-8x-8-pairs/`: head `cde5a7b7`, 8x throttle, second 8x cycle. No usable data: all 16 runs (both builds) hit the 300 s test timeout (`keyboard.type: Test ended`) and produced no budget results; the summarizer correctly reported harness problems. Not counted in any tally.

Run labels: runs 42309178838 (the only one with a flush breach) was on a slower runner state (flush p95 about 21 ms); runs 42336853126 and 42340182231 were fast (about 8 ms). Both runs 42336853126 and 42340182231 are at the default 4x. The 4x pool mixes runner states and is reported per run, not as one population. The `ci-patch-ab-8x` label is best effort: its first cycle completed, its second timed out on every run, so use it only to observe, never as a gate.

Early stop: the workflow ends a cycle after four consecutive runs that produce no metrics (every run timing out), so an unusable cycle does not use its remaining runs; the summarizer then reports the missing pairs as harness problems and its Summarize step fails by design. A stop can leave the last pair incomplete.

Rerun: remove, then re-add, the `ci-patch-ab` label on the PR (`gh pr edit <n> --remove-label ci-patch-ab`,
then `--add-label ci-patch-ab`); each cycle adds `PAIRS` pairs. The labels `ci-patch-ab-6x` and
`ci-patch-ab-8x` run the same pairs at a 6x and 8x mobile CPU throttle (default 4x); do not pool across levels.

The two 8x folders also hold `failures.json`: per-run exit codes, first-failure messages and failed budget results, extracted from the run artifact because the raw logs were not retained. The `summary.md` files of the earlier runs were written by the summarizer as it was then (flush budgets only in the over-budget tally); the current summarizer also fails a run over the input p95 or longest-task budget and counts non-zero exits.

The label `ci-patch-ab-stress` (4x throttle plus busy-loop processes beside each run: one per CPU in cycle 1, half the CPUs from cycle 2) forces the slow runner regime; its decision rule is in the implementation doc. Do not pool it with unstressed runs.

- `run-42448149074-stress-8-pairs/`: head `c9bb3fe3`, stress cycle 1 (four loops on four CPUs). No usable data: all 16 runs timed out (`failures.json`). Not counted. It exposed a workflow bug in the early stop (a partial metrics file counted as measured), fixed afterwards.
- `run-42476558232-stress-half-8-pairs/`: head `91400232`, stress cycle 2 (two busy loops on four CPUs, 4x throttle). Previous 2 of 8 flush breaches (130.4, 130.0 ms), patched 1 of 8 (205.6 ms); non-zero exits 3 and 3. Does not separate the builds. Never pool with unstressed runs.

The label `ci-patch-ab-profile` (added after stress cycle 2) uses the same half-CPU busy-loop load but runs the spec's `profile` sample (CPU profile at 1 ms sampling, budgets not enforced, exit 0) and keeps each run's `spn108-profile.cpuprofile.gz` and clock bracket beside its metrics, so a slow flush on either build can be attributed to JavaScript work, GC or starvation. Profiling overhead applies to both builds; never pool with plain-1 runs.

- `run-42500754153-profile-8-pairs/`: head `ac9ebc22`, `ci-patch-ab-profile` (two busy loops, 4x, CPU-profile sample). No breach on either build (worst paired flush: previous 84.8 ms, patched 60.6 ms; 0 non-zero exits). Kept: summary plus metrics and profiles for the two worst previous-build runs (pair 1, pair 8), one slow patched run (pair 3) and one typical patched run (pair 2). Profile analysis in the implementation doc.

The label `ci-patch-ab-gc` (added after the profile run) keeps the unprofiled plain-1 sample under the half-CPU stress and records, per flush, the main-thread GC time inside it (`gcTrace` in `metrics.json`); see the implementation doc. Never pool it with plain-1 runs without the trace.

- `run-42509105617-gc-8-pairs/`: head `74b4c499`, `ci-patch-ab-gc` (two busy loops, 4x, plain-1, light GC trace). No breach on either build (worst paired flush: previous 36.9 ms, patched 88.1 ms), no non-zero exits. Kept: summary, plus metrics (with `gcTrace`) for the two patched runs with flushes over 60 ms, one slow previous run and one typical run per build. Every flush over 35 ms was mostly GC.

`run-42509105617-gc-8-pairs/gc-summary.json` holds the per-run major-GC counts and durations, flush totals and heap sizes for all 16 runs, derived from each run's `gcTrace` (the artifact expires).

The label `ci-patch-ab-heap` (added after the GC run) keeps the half-CPU stress and samples V8 allocations (`heapSample` in `metrics.json`, raw `spn146-heap-sampling.json.gz` per run): odd pairs include collected objects (churn), even pairs only live ones (retention). Never pool it with plain-1 runs.

- `run-42515290552-heap-8-pairs/`: head `87b9df9b`, `ci-patch-ab-heap` (two busy loops, 4x, allocation sampling: odd pairs all allocations, even pairs live only). Not an A/B: sampling overhead pushed 11 of 16 runs to non-zero exits; no flush reached 100 ms. Kept: summary, derived `heap-summary.json`, metrics of two runs per mode and the raw sampling profile of two runs.

The label `ci-patch-ab-semispace` (added after the heap run) records the GC trace under the half-CPU stress; odd pairs run with a 64 MB young generation (`SPN146_AB_V8_FLAGS`) and even pairs with the default. Read it per mode, never pooled across modes or with plain-1 runs.

- `run-42525930367-semispace-8-pairs/`: head `931e2981`, `ci-patch-ab-semispace` (two busy loops, 4x, GC trace; odd pairs a 64 MB young generation). Reproduced the hosted tail: three flushes over 100 ms (previous 151.0 ms default; patched 127.3 and 158.7 ms flagged), each 75-82% GC; previous pair 2 produced no metrics. Kept: summary, derived `semispace-summary.json`, metrics (with `gcTrace`) of six runs including all three breaches. Flagged pairs had 41% fewer major GCs but no shorter tail.

The label `ci-patch-ab-worker` (added after the glyph counts showed layout running on the whole document) keeps the half-CPU stress and the GC trace and compares layout on the main thread (`previous`) with Univer's layout Worker (`patched`, `VITE_DOC_LAYOUT_WORKER=1`). Both variants install this PR's Docs patch, so the summarizer runs in same-build mode (`AB_SAME_BUILD=1`). The names `previous` and `patched` here mean main-thread and Worker layout, not the two Docs builds. Never pool it with any other label.

The label `ci-patch-ab-sync` (added after the buffer probe showed the batch timer lagging typing) keeps the half-CPU stress and the GC trace and compares the sync client's old `enqueue` (`previous`, `scripts/ci/patch-ab/quadratic-enqueue.patch` applied for its build and reverted before the run) with this PR's incremental one (`patched`). Layout stays on the main thread and both variants install this PR's Docs patch, so the summarizer runs in same-build mode. Never pool it with any other label.

- `run-42644030946-sync-8-pairs/`: head `88422ea5`, `ci-patch-ab-sync` (two busy loops, 4x, GC trace). All 16 runs measured. Major GCs 207 (old `enqueue`) against 41 (fix), no flush over 100 ms in either build (worst 72.2 ms previous, 88.1 ms patched), so the tail did not reproduce and the run cannot confirm it. Longest major GC rose (up to 354 ms against 182 ms); one patched run failed the longest-task budget (628 ms) and two previous runs exited 1. Kept: summary, `gc-summary.json`, `failures.json`, metrics of pair 3 patched and pair 6 patched/previous.

The label `ci-patch-ab-channel` (added after the MessageChannel probe) keeps the half-CPU stress and the GC trace and compares upstream's one-`MessageChannel`-per-call macrotask helper in `@univerjs/core` (`previous`, `scripts/ci/patch-ab/core-channel.ts previous`) with this PR's shared channel (`patched`). Layout stays on the main thread and both variants install this PR's Docs patch, so the summarizer runs in same-build mode. Never pool it with any other label.
