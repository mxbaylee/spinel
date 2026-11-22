# 🧾 Reviewed validation and first fixture type failure

Candidate `52f38e8a179eb958978ea3033840f7e84857cb4a` received two independent
nonimplementing 100/100 exact-head reviews before publication. It changes only
three documentation files from independently reviewed/tested `70a4bbb5` to record
the owner's explicit physical-phone waiver. Both reviews and their prior exact
test receipts remain source-labelled; no unchanged-source pass is relabelled as
a new execution. A pressure-aborted helper rerun is retained separately.

## 🧪 First failure and repair

CI `45048244268`, Typecheck job `137287678907`, correctly rejected the candidate:
`scripts/ci/desktop-offline.ts:671` still used `href` after the diagnostic fixture
changed its earlier result to `publication`. `first-typecheck-52.log.gz` preserves
the complete first job log. The next repair binds the already-validated
`publication.href` once and uses that same value for identity and later native
navigation. No product, timeout, retry or admission behavior changes.

The targeted `no-undef` check initially lacked Node globals and rejected existing
Node built-ins; that command failure is retained. With only the five existing
Node globals declared in the retained temporary configuration, the repaired
fixture passes while the exact file from `52f38e8a` still fails on undefined
`href`. The same local check therefore rejects the retained defect. Prettier
passes. These short executions have no RSS sample; zero is not measured zero
memory. Full hosted type/native acceptance remains required.

## 🔁 Metadata event accounting

Updating the PR body before the reviewed code push triggered old-head event
`45048238250` on `419773ed`. It was deliberately cancelled as superseded, with
force cancellation completing the remaining always-run aggregate; the retained
receipt verifies terminal `cancelled`. Its classification/dependency cancellation
caused fail-closed aggregate results, not a new type/product test finding. It is
never acceptance of `52f38e8a`. The earlier complete `419773ed` code/Storybook/
desktop ledgers remain separately retained as compressed originals.

Current source-specific gates and any superseded-run cancellation are recorded in
the PR/canonical record before landing. No failed or cancelled run is a pass.
