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
