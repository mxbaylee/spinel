# Delivery-repair registration validation

## ✅ Verified documentation outcome

PR #284 source **9733de55de0333e395361fd3e0b1043e815d6a6a** against base
**ebf0842f51b60d54649cf8a03065914bec0944bf** passed all seven required current-head
gates in CI **43551775040, attempt 1**. The exact tested merge is
**46c22ab1ef0a0fb00ced59e9fb91e0e039ac322c**. Source and tested merge have the same
tree **60621b2aa9f114667ce69134111abe849e3440f5**. Raw commit/run/job/check APIs,
logs, artifact ZIPs and decoded JSON are retained here. `validation-summary.json`
records the observation time and exact gate identities.

The complete CI job list is terminal: **16 jobs, 8 success and 8 explicitly
inapplicable matrix/worker placeholders skipped**. The successes are Backlog,
Pull request, Lint, Typecheck, Unit tests, Lib tests, Playwright smoke and the
classification job. Storybook **43551775005, attempt 1**, is also terminal success:
**8 jobs, 3 success and 5 inapplicable jobs skipped**. Its build and interaction
aggregate expressly report documentation-only applicability. No Desktop workflow
was dispatched for this documentation-only range. There was no retry, rerun,
workflow cancellation, source change or evidence-only PR edit during this validation.

The immutable `opened` plan has the actual 24-path range, empty labels and targeted
mode. It selects only **backlog, pull-request and lint**. All twelve other suite
entries are explicitly inapplicable. Unit, Lib and browser aggregates pass by
verifying that applicability and the required selected results; they do not assert
that application suites executed. Typecheck's actual compiler steps and Storybook's
actual build are skipped under the same documented rule. This proves registration
only: SPN-090/098 remain open and the SPN-157/158 runtime repairs remain unperformed.

## 🧾 Plan and artifact identity

- Canonical plan digest used by all three required result aggregates:
  `0091358bd9cd90269300b3e4bd06d821b1d87266fbec07bb87d00abe7c8be94b`.
- Raw retained `ci-plan.json` file SHA-256:
  `36f2a4037d53b4777f813c2c819e3f8ca50256b91fdf4facd52001812547b93a`.
  This includes the file's serialized whitespace/newline; it is not the canonical
  aggregate digest. Both bind the same parsed plan.
- Plan artifact **14095824173**, ZIP SHA-256
  `c25bbf8cc00d48118586d4d2bd098598de7ffeafabac3519f1368fac45a605ee`.
- Unit result artifact **14096762449**, ZIP SHA-256
  `27ef04798d0acb0b6362694652ee9cd6d65e6379dde0cdddc87f2b20f30eb0fb`.
- Lib result artifact **14096147160**, ZIP SHA-256
  `bc75a57e7890bf51ecc7f1cd7c1fafcba7f1afc39888f31dbfce32ce04f4f7e0`.
- Browser result artifact **14096512898**, ZIP SHA-256
  `677095facdbc17e9594157141791a8a8af3d0a9fe0dc64c9b5efc1140d91fda2`.

Every downloaded ZIP matches its GitHub digest. Each decoded result reports
`passed: true`, binds the canonical digest above and embeds the identical plan.
The browser aggregate retains successful Backlog/Pull request/Lint results and
explicit skipped/inapplicable application entries. Hosted artifacts expire; these
immutable stored copies, payload hashes and decoded hashes retain the evidence.

## 👀 Independent reviews and local verification

Both nonimplementing reviewers independently approved the complete exact source at
**100/100**, rubric **35/25/20/10/10**, without actionable deductions or CI-result
penalties. Their actual reports and check/cleanup receipts are in `local/`.
Reviewer A independently ran backlog validation (195 ms; shorter than the 200 ms
memory sampling interval, so the reported zero is unsampled) and the PR check
(354 ms / 179,120 KiB). Reviewer B independently ran backlog validation
(327 ms / 156,944 KiB) and the exact-base grooming PR check (515 ms / 265,936 KiB).
Both found no owned process survivors. No UI change requires visual approval.

The implementation receipts retain the one CLI allocation of SPN-158, generated
index, normal-pressure backlog check, earlier candidate PR check and final exact
source PR check (575 ms / 265,184 KiB). The initial memory-pressure preflight refusal
is explicitly recorded; no process/receipt/verdict was fabricated. The shared
resource budget was not raised and no owner application was stopped. These checks
verify 30 open tickets, next ID 159, unchanged November 12 grooming date and
completion list `[SPN-148, SPN-145]`, plus exact allocation/history/scope links.

## 🔒 Archive and completion boundary

This archive is an evidence-only child of reviewed source 9733de55. It adds files
only under `docs/review-assets/delivery-repair-registration-9733de55/`; it does not
move the PR branch or change the candidate tree. Local reports normalize personal
checkout paths and temporary receipt links, preserving original/stored hashes.
Raw hosted payloads remain unchanged. Credential/private-key/personal-path scans
of stored and decoded contents found no live credential or unnecessary personal
path. No database, browser profile, user document or cookie store is included.

The published PR body is retained as the original conditional checkpoint. This
record fulfills its reserved validation link once the manager verifies and publishes
the archive. **Merge and branch cleanup are not performed or claimed here.** The
separately reserved completion record is populated only after a verified squash
and guarded cleanup. The manager retains the final current-head/base/merge guard.
