# SPN-120 terminal blocked checkpoint

Source `bcc1c17c538756e7886a60a413ee31a8ed5ff2ba`, base
`1fca8a98c315d2f715e8051537e50f2efbbe580b`, tested CI identity `495a21a2fc5b16db9754188ed506093daad18dfa`.
CI 41460301620 attempt 1 completed with 30 successful jobs and three failures:
Unit tests (supervisor) failed the unchanged strict mirror check before tests;
required Unit tests and Playwright smoke aggregates correctly rejected that
missing evidence. All browser workers passed. Five of the seven required gates
passed; Unit tests and Playwright smoke did not. No retry was requested.

Storybook 41460301816 attempt 1 failed mobile-dark setup at the same mirror check;
its aggregate failed, while the other four variant jobs passed. Desktop 41460301616
attempt 1 passed Chrome/Firefox but failed the Safari identity probe before app
setup. Spaces 41460301610 passed. The fixed fixture audit 41460328677 passed24/24,
without retries/setup recovery and with every cleanup successful. Both independent
reviewers validated that audit and found no remaining source defect, but withheld
final grades because selected acceptance remains missing. Agent review only.

The CI plan and all three aggregate JSON/ZIP artifacts are retained here and their
ZIP SHA-256 matched GitHub metadata. Run/job metadata includes every job (explicit
per_page=100, count checked against total_count). The complete original CI attempt1
job list has32 jobs and supplements the first30-job page retained in prior archive
`d825f803952506685c64362938192c4206a6e8d5`; attempt2 has30 jobs. This correction
adds the omitted terminal aggregates without changing the recorded cancellations.

Raw current audit/identity/process journals and the Safari failure ZIP are retained
in `51d5b48203f999ff27e3b01592a6668518f7ebf8` at
`docs/review-assets/spn-120-blocked-integration`. Earlier baseline/collection failure/
old candidate and local controls remain in `d825f803...`. Other full CI browser and
native artifacts are supplementary and expire according to the included manifest;
this archive does not claim to retain all raw traces or screenshots.

SPN-130 owns the Safari investigation; SPN-131 owns the recurring mirror setup
investigation. PR236 records a base-authorized reservation so the already allocated
SPN-130 can be registered without ID reuse. PR237 is collecting mirror input before
selecting a repair. Neither registration nor diagnostics clears SPN-120's failures.
Keep PR228 draft, integrate actual prerequisites, then obtain fresh applicable
validation and two independent final grades on the same source before merging.
