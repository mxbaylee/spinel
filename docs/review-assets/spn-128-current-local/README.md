# SPN-128 resumed local validation

Integrated main: 18a8759c498574a1d9cc24a969a558cd97a798ed.
Initial integration: 0638e02f8b78e2cd41110665a1490dc037a1f3c9.
First review repairs: fdd9180ed342e3a6a3f9ae26fa83d04b87730351.
Final teardown correction: 2fcbbec7516fcf2f689bb6dbcf9d12d1ca2ad621.

Local macOS, pinned Node 26.12.1, private npm ci, shared serial lock and unchanged
2 GiB / 475-second process-tree watchdog. Logs retain each actual command and result.

Initial integration:
- install-first.log: passed, 5,726 ms, 1,148.4 MiB peak.
- typecheck-first.log: passed, 2,816 ms, 1,700.4 MiB peak.
- cold-custody-first.log: 25/25 passed, 4,034 ms, 642.3 MiB peak.
- pr-shape-first.log: passed, 420 ms, 258.8 MiB peak.
- lint-first.log: passed, 13,682 ms, 785.1 MiB peak.

First review repair source:
- review-fixes-typecheck-first.log: passed, 2,064 ms, 1,682.5 MiB peak.
- cleanup-errors-first.log: selected platform-independent control passed;
  21 Linux-only or unselected cases skipped, not passed. 1,053 ms, 445.6 MiB peak.
- review-fixes-lint-first.log: passed, 10,055 ms, 844.7 MiB peak.

Final teardown correction:
- cleanup-errors-after-teardown-fix.log: selected control passed again because
  teardown changed; 21 Linux-only or unselected cases skipped. 468 ms, 271.5 MiB.

Formatting logs are preparation only. No resource abort or Linux process acceptance
is claimed. Docker was not running; it was not started. Both independent reviewers
found no remaining source defects at 2fcbbec7; final grades remain withheld.

Current CI 41499457478 was pending. Required next work is bounded sanitized failure
capture in the existing supervised-restore catalog journey, followed by current
Linux controls and selected hosted acceptance. Historical first-attempt mobile
latency and post-backup snapshot ECONNRESET failures are retained separately at
41e2a2868be914adec6da5eeccc0faba589c3ef2/docs/review-assets/spn-128-previous-ci.
This archive does not claim ticket closure or repair of the uncaptured reset.


## Bounded snapshot evidence extension (2026-11-02)

Diagnostic source: f28ec2187643573ffbecd9ca20efa7f76372f395.
Current source after optional identity-read repair:
a6dd085d549d1a6e7b3894ccaa8d3c4fa03bcbb3.
Base remains 18a8759c498574a1d9cc24a969a558cd97a798ed.

The original uncaptured ECONNRESET cause remains unknown. Existing catalog
snapshot GETs retain maxRetries: 0. Retry-zero failure evidence has bounded,
content-free request phases, journal selection, process identity, log categories,
cgroup counters and two bounded probes. First-attempt tracing is retained on
failure. No additional browser execution or acceptance retry is introduced.

The first reviewer found that optional process-identity reads could throw before
cleanup registration. Current a6dd085d registers lifecycle cleanup first and
reports identity-read failures as unavailable evidence. Both independent source
reviews found no remaining source issue on a6dd085d; final grades remain withheld
pending current hosted acceptance. These are agent reviews only.

Actual local validation (same serial lock and watchdog):
- snapshot-evidence-tests-first.log: four deterministic evidence/privacy controls
  passed at the initial diagnostic source, 118 ms. It ended before the first RSS
  sample; reported 0.0 MiB is unsampled, not zero memory usage.
- snapshot-evidence-typecheck-first.log: initial typecheck passed, 2,143 ms,
  1,713.8 MiB, before the trace override.
- snapshot-evidence-trace-typecheck.log: typecheck with trace override passed,
  1,944 ms, 1,744.4 MiB.
- snapshot-evidence-collection.log: the same two supervised-restore cases
  collected, 1,197 ms, 422.8 MiB. Collection is not runtime acceptance.
- snapshot-evidence-lint-first.log: lint passed, 10,760 ms, 842.4 MiB.
- snapshot-evidence-pr-shape.log: PR shape passed.
- snapshot-evidence-identity-tests.log: all five controls passed after the
  identity-read repair, including synchronous and asynchronous permission
  failures, 113 ms. RSS was unsampled because it ended before 250 ms.
- snapshot-evidence-identity-typecheck.log: current typecheck passed,
  1,993 ms, 1,613.2 MiB.

Formatting is preparation only. Current source is pushed. CI 41501654342,
Storybook 41501654284 and Spaces 41501654298 are pending; Desktop 41501654127
is queued at this checkpoint. Linux crash controls and first-attempt browser
acceptance remain outstanding. No ticket completion or historical reset repair
is claimed by these local results.
