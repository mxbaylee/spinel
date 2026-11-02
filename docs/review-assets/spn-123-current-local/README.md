# SPN-123 current-main local validation

Source: `54307c19c075c5dd67a8012341cc7cee716a09a3`.
Integrated base: `18a8759c498574a1d9cc24a969a558cd97a798ed`.
Executed 2026-11-02 on the local macOS host using Node 26.12.1,
a private `npm ci` install, the repository shared serial lock and the existing
2 GiB / 475-second process-tree watchdog. No source changes during these checks.

Each log is the first execution on this integrated source; no retry was needed.

- `install-first.log`: npm ci passed, 7,040 ms, 1,164.0 MiB peak.
- `typecheck-first.log`: npm run typecheck passed, 2,865 ms, 1,850.5 MiB peak.
- `focused-integration-first.log`: 174/174 tests in five files passed,
  6,164 ms, 1,078.4 MiB peak. Existing maintenance gate, diagnostics store,
  workspace search, spinelSync and offlineCreation suites cover the repaired
  conflict boundaries and their negative/access cases.
- `diagnostic-contracts-first.log`: 107/107 tests in 13 files passed,
  4,818 ms, 740.2 MiB peak. Existing lib/diagnostics, sync-client diagnostics,
  server account/browser/routes/runtime/supervisor diagnostics, UI operation
  diagnostics, bounded Doc history and offline persistence suites cover bounded
  admission, privacy, observation failure isolation and save/ACK semantics.
- `native-docs-first.log`: node --test scripts/dependencies/patch-univer-docs.test.ts
  passed 206/206, 5,068 ms, 567.8 MiB peak. The installed current main Docs
  implementation and retained SPN-123 native capture regressions execute together.
- `lint-first.log`: npm run lint passed, 11,348 ms, 740.9 MiB peak; dependency,
  oxlint and formatting checks all succeeded.

Elapsed figures above are watchdog wall time. The logs also retain suite timings.
There was no resource abort. Native tests use the real pinned SDK in controlled
fixtures; these are not hosted browser, rendered interaction or latency results.
The historical Sheet off/on overhead sample remains historical with its previously
reviewed source-equivalence limits. No new overhead execution is claimed.

Both independent reviewers found no actionable current-source defect, but their
final rubric grades remain withheld pending current-head required CI and selected
native/browser acceptance. CI 41495432876 was pending at this checkpoint.
This archive is local validation evidence, not merge acceptance or ticket closure.
