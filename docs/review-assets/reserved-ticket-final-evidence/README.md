# PR 236 final validation evidence

Source and both review target: `7ed82b84ab66ce668b40a35d3db97f0f205f83dd`.
Base: `43299f311d62fb73a5688a49471b71c626ea6e1d`.
Tested synthetic merge: `14c2a5712eca6574103773a6ad544995d128c818`.
Source/tested tree: `79a41a151f5272241d7812abff25b01c1401f283`.

This focused grooming permits independently proven historical ticket allocations to
be reserved on main and consumed by a later grooming PR. It does not register or
complete SPN-130. Its allocation is fefb3660cdfa363f4b80812df33a3a63a404b8ef;
58dfc5390750ff84948fc4c0ad99b31824e4f69a is a later integration, not allocation.
Historical provenance remains review-enforced. Tests reject self-authorization,
changed identities, invalid reservations, unconsumed registration exceptions,
nongrooming changes and counter decreases. SPN-098 now explicitly depends on its
existing SPN-135 acceptance blocker. Next ID 137, all 11 completion entries and
grooming date 2026-10-29 are preserved; retired ID 136 is never reused.

## Executed checks

CI run 41482018820 attempt 1 succeeded: all 33 jobs, including Pull request,
Typecheck, Lint, Backlog, Unit tests, Lib tests and Playwright smoke. The full
coverage plan and digest-bound aggregate results are included. Plan raw-byte
SHA256 is b0cb82913519c30ee59e213a0a0fef68ac1665bacc0a5f9f5c7d93c161338130;
canonical/trimmed digest is d771abf911760d39affd47b0531ca5fe8bc72fe58c7fe26263b891050100b9c2.
Storybook run 41482018673 attempt 1 succeeded with all five variants and aggregate;
publication skips on the PR are expected. No UI was changed.

All 41 focused backlog controls passed locally on the integrated source. Subsequent
local index/PR checks were deferred before launch when macOS memory pressure was
2; those deferrals are not passes. The generated index was produced by the CLI in
hosted helper run 41481604973 attempt 1, verified and imported byte-for-byte.
Its full workflow, patch, log, original artifact and generation identities are in
index-generation/. Helper 5bfb00381a3d1e3f43eda5cb5d5eeafa44c73726 is retained by
archive/spn-236-index-helper-5bfb003. The index SHA256 is
d06196b9b365d5e1f33c6ce894ee8eb6ff5d30c0c4c742cce64a80822efdf045.

Original failed CI and infrastructure evidence remain at immutable commit
f955396a2e6faf5ece0d6ce00225393b58600b45 under
docs/review-assets/reservation-first-ci-blocked. SPN-131 repaired the mirror
prerequisite and was merged before this integrated validation. Passing this
focused grooming does not complete the SPN-120 native Safari prerequisite.

## Responsiveness limitations

Original desktop/mobile artifact ZIPs and the candidate summary are retained.
All eight candidate cases completed on attempt 0, with empty error lists and
content/Undo/Redo checks passing. All four desktop cases observed no policy-idle
flush (idle metrics null). Capacity checks passed and local caches drained in
about 301-304 ms. This is not evidence that desktop idle latency meets its budget.
Mobile plain idle measurements were 2.1, 2.2 and 5.2 ms; the profile was 2 ms, with
all budget checks passing. These results do not establish the cause or disposition
of SPN-135's historical 34.3 ms idle event, which remains open and blocks SPN-098.
No runtime policy, measurement threshold or coverage routing changed here.

## Retention and review

hashes.json binds each included payload. Original artifact ZIPs are retained,
not described as full traces of runs whose raw artifacts are absent. CI metadata,
plan, unit/lib/browser aggregates, index-generation proof and both responsiveness
ZIPs are durable here. Other CI artifacts remain supplementary and expire on the
dates in ci-artifacts.json (7-30 days after the run).
Final independent grades and finding dispositions are recorded in reviews.md and
in the final PR acceptance description. Agent review only.
