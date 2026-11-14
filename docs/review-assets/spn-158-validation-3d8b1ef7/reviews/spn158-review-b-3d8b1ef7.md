# SPN-158 independent review B

Reviewed head: `3d8b1ef775b0a71ec4e1512a0cca3b033f2c41bb`.
Actual base: `ecef3c6d6ea5093bdd9fcf7c0a69c5e5218b4a6f`.
Worktree: `/Users/mxbaylee/projects/spinel-spn-158`.
Independent nonimplementing, read-only review of the original base ticket and complete candidate. No source edits or publication.

## Assessment

**100/100.** Scope 35/35; correctness, data integrity and access boundaries 25/25; meaningful regression protection and verification 20/20; CI/workflow and operational usability 10/10; maintainability, documentation and complexity 10/10.

No actionable findings, deductions or remaining steps to 100. No deductions for CI results.

The complete candidate preserves the shared admission contract: original-client session HTTP 401 plus maintenance HTTP 200, availability and running phase. One cancellation signal bounds readiness reads within the existing 20-second wait. Authentication is not retried; subsequent acknowledged-write, cut, SIGKILL, durable-row and retained-evidence assertions remain unchanged. Diagnostics retain fixed categories/statuses without response contents or credentials.

The three maintenance source hashes match the retained identity and are byte-identical to bfeb0b23. The three inherited SPN-149 observer/consumer/test files match actual main exactly. No executable file changed after the tested integration commit 0e32180a77a22466e6bfaa9f4c2a1b6a5769a139. Dependency manifest fields, lock/patch/workspace source and linked installation attribution were checked. All 50 retained evidence payload hashes/sizes verified; resumed compressed payloads also matched their recorded decompressed hashes/sizes.

SPN-159/160 registrations, SPN-157's complete L scope, next ID 161 and November 12 grooming state remain preserved. Completion accounting retains SPN-148/SPN-145/SPN-149 and provisionally appends SPN-158. SPN-120 retains dependency SPN-159; SPN-090's SPN-158 dependency is removed as landing preparation. No product UI change requires visual approval.

## Independent local checks

On the exact reviewed head, ran:

`node node_modules/vitest/vitest.mjs run src/server/maintenance/http.test.ts -t 'postcommit readiness|shared readiness deadline' --cache=false --fsModuleCachePath=/tmp/spinel-dependabot-2026-11-11/spn158-review-b-3d8b-module-cache`

Pinned Node 26.13.0, shared serial runner and runtime watchdog; normal-pressure preflight and continuous 2 GiB/eight-minute limits. **2/2 controls passed**, nine unrelated cases filtered, no failed assertion or resource abort. Elapsed 2,898 ms; peak process-tree RSS 1,194,432 KiB. Results caching was disabled and the module cache was reviewer-private.

Receipt: `/tmp/spinel-dependabot-2026-11-11/spn158-review-b-3d8b-http.json`.
Log: `/tmp/spinel-dependabot-2026-11-11/spn158-review-b-3d8b-http.log`.

Inspected the retained actual session-only predicate mutation failure and exact helper restoration instead of repeating the unchanged mutation. The paused control detects incorrect readiness while maintenance 200 and session 401 coexist. The second control establishes pending-read cancellation and request closure.

## Historical evidence and limits

Read the failure-only historical extract and original recovery/browser log evidence. Prior bfeb0b23 had 609/609 recovery tests passing, including the real postcommit case, alongside a failed first revocation-observation attempt and fail-closed browser aggregate. The configured retry's success does not erase that failure. SPN-149 is now integrated from main; this does not retroactively make the earlier gate pass.

The particular historical authentication-options HTTP 503 cause remains unproved. The implemented target is the source-proven readiness-oracle weakness. SPN-157 remains a separate unfinished investigation. Current combined-source Linux acceptance, all seven required gates and applicable selected workers remain merge conditions. This pre-push review is not a current hosted pass or merge approval.

## Cleanup

Explicit `ps` command-identity and `lsof` node/npm/esbuild working-directory audits at 2026-11-14T05:53:30.125847+00:00 found no owned surviving processes. No process was killed. Worktree remained clean at the exact reviewed head; whitespace validation passed. Shared local workload slot released.

Cleanup receipt: `/tmp/spinel-dependabot-2026-11-11/spn158-review-b-3d8b-cleanup.json`.
