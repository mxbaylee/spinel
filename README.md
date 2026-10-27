# SPN-108 evidence archive

This branch preserves the pre-policy source and synthetic benchmark evidence for
[PR #202](https://github.com/mxbaylee/spinel/pull/202). The immutable baseline is
`a0c3154ae6b548d68ba8be9d143df781e47dc623`. The comparison contract is maintained
in `docs/implementation/SPN-108.md` on the PR/main branch.

## Attempts retained so far

| Attempt | Result | Evidence |
| --- | --- | --- |
| Local baseline build | Passed; peak process-tree RSS 1,668.4 MiB | Reported in the implementation record and execution transcript |
| Local browser, initial launch | Loopback listen permission denied; no workload executed | Execution transcript; no browser metrics produced |
| Local browser, authorized launch | Resource-aborted at 2,099.0 MiB during two-editor startup | Execution transcript; no accepted performance sample |
| CI `40579224187`, source `49a86ad` | Both presets stopped during test registration before typing | `attempt-49a/desktop-report.json`, `attempt-49a/mobile-report.json` |

The CI registration failure was a Playwright trace override inside a describe
group. It was repaired using explicit context tracing only for boundary tests,
after the timed samples. The failed attempt is not a performance result.

The next candidate is `cf611f7d176a8f42c64d9c5d632867a3d1c0b885`, CI run
`40581429512`. Its measurements, profiles and independent-review evidence will be
appended after collection. No passing browser result is asserted by this
checkpoint.

All content is synthetic test evidence. SHA-256 checksums preserve the exact
downloaded reports. The GitHub Actions artifact IDs and original ZIP checksums
are recorded in `attempt-49a/manifest.json`.
