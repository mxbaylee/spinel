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

Rerun: remove, then re-add, the `ci-patch-ab` label on the PR (`gh pr edit <n> --remove-label ci-patch-ab`,
then `--add-label ci-patch-ab`); each cycle adds `PAIRS` pairs. The labels `ci-patch-ab-6x` and
`ci-patch-ab-8x` run the same pairs at a 6x and 8x mobile CPU throttle (default 4x); do not pool across levels.
