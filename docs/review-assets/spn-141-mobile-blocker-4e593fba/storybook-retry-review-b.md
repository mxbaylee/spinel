# 📚 SPN-141 finite Storybook infrastructure retry — reviewer B

Accepted Storybook run `41970163084`, **attempt 2**, on unchanged source `4e593fbaf9ea89585920053b9415f9a8eac0944f`, base `2f442317dd2e1c188ae4a810ac094fd1162a4a2a`, tested merge `f0e74d52629923737985ce03e4f32ff218dcf76d`, equal tree `a2b37aa82336224ac40e92f7364e52ccebfb6d74`. This is recovery from one documented provisioning failure, not first-attempt Storybook success. The original failed attempt remains retained and classified in `storybook-provisioning-b.md/json`.

## ✅ What actually executed

The single failed-jobs-only request led to new desktop-light job `127064750723` (starting 05:15:12Z) and new dependent aggregate `127067720030`. Both are terminal success with every step successful. Microsoft noble InRelease fetched successfully at 05:15:33Z; Chromium dependencies installed without disabling trust checks or modifying source. The original failed light job had skipped both application check steps, so these are the first actual desktop-light icon/story assertions for this source, but the worker itself is attempt 2.

The light log and digest-bound artifacts confirm all 1,041 uniquely requested catalog states checked exactly once for light, no narrowed story list, zero failures, and 13 additional interaction verifications. Its manifest records 436,463 ms, safely within the unchanged 15-minute worker budget. The icon/integration manifest has all 42 checks: 14 each in light, dark and phone. Screenshots were not requested; zero captures is the intended check mode, not visual evidence or a newly granted visual approval. The semantic controls text and bundle-size record are retained too.

Artifact `13390553613` (storybook-check-desktop-light), 16,350 bytes, SHA-256 `1f73ec7fe17e56afdabd38785870f591359b967f04f18f19a85758c0810463f5`; artifact `13390113505` (entity-icon-checks), 509 bytes, SHA-256 `3c62ed35048f307659b9239efb7f8dda7bc0cb3772b3b246ff9232464e0f64a5`. Both ZIP hashes/sizes match API metadata and upload logs. All four members pass CRC, unique/safe names, byte hashes and exclusive extraction/re-read. The light worker downloaded the same prior successful build artifact digest `2560da49fe78d562bd8aefe2416bf84693b8adace9a655d10f2ac52d07f35018`.

The fresh aggregate received successful classification, build, desktop, tablet and mobile results and explicitly reported all required Storybook checks passed. Final run/jobs show eight successful applicable jobs and two skipped, inapplicable Pages jobs. Canonical terminal `storybook-run.json` and `storybook-jobs.json` are saved alongside report-specific raw records.

## 🔗 Carried results are not new executions

I compared all six original successful job start/end times and every step's name, number, start/end, status and conclusion byte-for-value against the attempt-2 metadata. Every execution window matches exactly. The complete mapping and steps are retained in `storybook-retry-carried-mapping-b.json`:

- Classification: `127056281081` → `127064751926`.
- Build: `127056504247` → `127064784811`.
- Desktop dark: `127056809598` → `127064752550`.
- Tablet: `127056809585` → `127064787072`.
- Mobile dark: `127056809609` → `127064752389`.
- Mobile light: `127056809613` → `127064752587`.

GitHub labels the carried metadata attempt 2 and gives new IDs, but the actual job/step windows remain from attempt 1. No successful sibling application execution repeated. Skipped Pages metadata can have inconsistent start/completion ordering; these are retained as skipped inapplicable records, never counted as executed tests. Only the failed light worker and dependent aggregate have new execution windows.

## ⚖️ Failure disposition and limits

Attempt 1's Microsoft package-index HTTP 403, apt exit 100, skipped assertions, consequential missing uploads and correctly failing aggregate remain preserved. The failed runner's setup-banner/helper-image mismatch and differing successful sibling image remain caveats; the successful retry does not prove the underlying HTTP 403 cause. Source, workflow, dependency configuration, catalog, assertions, budgets and trust policy were unchanged. The single exception is exhausted; no further retry is authorized by this report.

The bounded serialized artifact/mapping verifier passed on its first execution in 147 ms, sampled peak 90,448 KiB, normal pressure. Review work only read existing GitHub results and retained files; no browser/converter/application run was launched by this reviewer. A preliminary member lookup used the nonexistent generic `review.json`; inspection of the ZIP listing identified actual `manifest.json` before validation. No test or artifact changed as a result.

This closes the current Storybook provisioning blocker and its aggregate. It does not approve merge or waive remaining current-head CI, mobile responsiveness, final immutable publication or fresh merge guards. Raw evidence and machine proof are bound in `storybook-retry-review-b.json`.
