# 🔎 SPN-130 source-bound acceptance evidence

Implementation/reviewed source: `d36d44c252061452c2c8487bcc84ad9a55b641e8`.
Base: `ccaa49c130cf559e8da7b5cdb60fc1053aec6156`.
Tested merge: `590ef871970c90fb82eb5c4d6a1c3c6251ec3953`.
This archive preserves reports without changing the reviewed implementation head.
`SHA256SUMS` binds every report and this README. Original failures remain in the
implementation's `spn-130-original` evidence directory.

## 🧪 Declared native sample

[Desktop run 41668117254](https://github.com/mxbaylee/spinel/actions/runs/41668117254),
attempt 1: one first-attempt job per existing browser/runner, no reruns. Native
reports and versions are unmodified downloaded artifacts; the run/job API snapshots
retain relevant identities and terminal step results. Distinct fixture accounts and
profiles, three application launches/stops per browser, no teardown errors.

- Safari 27.2, macOS 15.7.9 Intel, job `126028844160`: profile probe and complete
  application acceptance passed. Initial identity 3,988 ms, restart identity 162 ms,
  both within 8,000 ms, with complete phase traces. **Historical identity timeout:
  bounded-not-reproduced** in this sample.
- Firefox 159.0.1, macOS 26 arm64, job `126028844635`: every deletion phase passed,
  unregister 8 ms and IndexedDB deletion 19 ms. No worker/cache/target database,
  empty localStorage, zero available downloads and missing offline content denied.
  Complete retained-content/edit/reconnect/recovery assertions passed.
  **Historical storage timeout: bounded-not-reproduced** in this sample.
- Chrome 156.0.8078.80, macOS 26 arm64, job `126028844737`: complete compatibility
  flow and storage postconditions passed.

The diagnostic/failure-control gaps are repaired and covered by negative controls.
This single sample establishes neither historical root cause nor elimination of
future intermittency. It does not waive SPN-120's fresh integrated acceptance,
SPN-137's separate pointer investigation or SPN-090's physical-device matrix.

## 👥 Review and local checks

Both independent nonimplementing reviewers retain 100/100 on the implementation
head, including reinspection of all three native reports. `review.json` records
identities, rubric and resolved findings. **Agent review only**; no UI changes.

30 focused tests and 14 routing/failure-gate controls pass. Full typecheck passed
with `GOMEMLIMIT=1024MiB GOGC=30`, peak 1,867,632 KiB; focused lint/format and
backlog/PR/whitespace checks passed. The earlier unrestricted compiler was aborted
at the 2 GiB watchdog limit (2,108,032 KiB); it is not counted as a pass. No owner
Safari settings/profile were changed. The local read-only JXA negative took 290 ms
and does not substitute for the hosted Safari result.

## ✅ Current-head CI

The immutable CI plan binds this source, base, tested merge and complete paths.
The `ci-run.json`, `ci-jobs.json`, `storybook-run.json` and `storybook-jobs.json`
snapshots retain terminal results for the existing selected checks; they are
GitHub API evidence, not results inferred from earlier commits. The PR description
records the eventual merge and cleanup identities.

All seven required gates passed in [CI run 41668117309, attempt 1](https://github.com/mxbaylee/spinel/actions/runs/41668117309).
All selected browser, library, unit, restore, transition, container, callback and
responsiveness work passed. [Storybook 41668117733, attempt 1](https://github.com/mxbaylee/spinel/actions/runs/41668117733)
passed its build and interaction checks; PR preview/main deployment are explicitly
inapplicable skips. Both responsiveness comparison reports are retained. No check
or scenario reruns occurred in this validation cycle.
