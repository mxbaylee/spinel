# 🔎 SPN-143 independent review B

**Reviewed commit:** `96b11bf0374540d28e5537d4a9cddb1280403e21`  
**Base:** `eb32117f5d09c28cd411063256db6d645335ae8a`  
**Worktree:** `/Users/mxbaylee/projects/spinel-spn-143`  
**Reviewer:** independent nonimplementing agent B; agent review only.

**Score: 97/100. No unresolved blocking source findings. Ready for the one declared validation push once the other independent review also qualifies on this exact commit. Not merge approval: all current-source hosted/native acceptance remains pending.**

## 📐 Rubric

- **Scope and acceptance design: 35/35.** The complete XL outcome includes protocol authority, a finite capability checkpoint, lossless storage, interruption, partial acquisition, evidence publication, comparison, local verification and forthcoming paired native acceptance. The immutable baseline, full native editing/disposal workload, categories, buffer, callback limits, first attempts and 420-second success budget are preserved. The change does not claim completion of SPN-141/140/120 or silently defer an in-scope repair.
- **Correctness, integrity and access: 25/25.** Raw transport and stored gzip identities are distinct and recomputed; the stream is exclusively owned and backpressured. Cleanup shares pending work, preserves original errors and cannot satisfy acceptance through unconfirmed witnesses. Terminal progress independently rejects stale success. No product authorization, persistence or access boundary changes were found.
- **Regression protection and evidence: 17/20.** The deterministic controls meaningfully exercise the two discovered counterexamples, actual Playwright timeout settlement, partial fixture cleanup with real SQLite, malformed/lost/truncated evidence, source attribution and selected-check failure. The three-point deduction is the remaining verification boundary: current-source desktop/mobile CDP transfer, overall timing, browser lifecycle and complete historical/candidate pairs have not run. Local feasibility and mocks cannot establish that boundary. The prescribed next step is the existing first-attempt selected CI owners, with original budgets; this is pending evidence, not an actionable source defect or authorization to retry a failure unchanged.
- **CI and operational usability: 10/10.** Existing dependency routing selects full coverage for changed harness/CI-script paths. Both paired owners use the same current harness overlay, including the changed shared fixture. Outcome checks and required aggregates remain fail closed. Progress is bounded; early phases survive logarithmic transfer milestones. No extra browser workflow or weakened gate was introduced.
- **Maintainability, documentation, process and over-complexity: 10/10.** One execution promise, one abort authority and shared cleanup promises are a proportionate implementation of the actual ownership boundaries. Node's existing stream/zlib facilities avoid new dependencies or a generic lifecycle framework. Much of the spec/fixture diff is indentation caused by an outer ownership scope; it does not conceal native workload edits. The maintained record separates prospective plans, observations, first failures, repaired findings and pending acceptance. Conditional landing bookkeeping is consistent.

## 🛠️ Earlier findings and exact-head dispositions

1. **Timeout during final manifest write — resolved.** The production settlement helper synchronously records the failed terminal state, aborts, awaits shared interruption and the owned execution, then invokes `rejectManifest`. The spec sets `passed` false and persists again. The deferred writer control reproduces stale serialized success and verifies the failed replacement only after that writer settles. Independently, evidence loading requires successful terminal progress, no original/persistence failure and a cleanup-complete witness. Missing/timed-out/failed progress rejects even a manifest that still says passed. If failure recovery itself stalls, the durable timeout keeps that evidence rejected.

2. **Rejected Tracing.end dropping late-handle ownership — resolved.** General collection failures now invoke the same shared interruption path as abort/pipeline failures. Known handles receive their one close attempt before detachment is awaited, and the completion listener remains until interruption settles. A late completion during that boundary closes its acquired handle rather than starting output. The direct end-rejection control proves one close attempt and preservation of the original error. Pending-read/pending-close output failure also has a dedicated control.

3. **Actual timeout-hook coverage — resolved.** The real browserless Playwright test invokes `settleCallbackObservation`, verifies the original synchronous timedOut phase, uses the separate failure-only hook allowance and observes execution/cleanup settlement. This proves framework hook wiring more meaningfully than a direct helper test alone. It does not prove native CDP timing.

4. **Partial/shared fixture cleanup — resolved for the stated contract.** Per-context promises share actual closure settlement. All acquired contexts are attempted; DB cleanup and close are reached after context failure, and outer setup failure closes the DB handle. Late acquired contexts cannot become usable after closure. Four real-database/fake-context scenarios cover normal cleanup, context rejection, failed page setup and abort during delayed context acquisition. Original setup errors remain primary. Suppressed secondary setup disposal errors do not become confirmed-cleanup evidence; the record states that limitation honestly.

## 🧪 Independent inspection and evidence checked

Read the original ticket from the specified base, complete substantive base-to-head diff, process/testing/run-backlog rubric, all four personas, maintained decision and local evidence. Rechecked a clean worktree and whitespace. Inspected native workload changes with whitespace ignored, trace/progress/fixture implementation, added negative controls, comparator, source-map assertion repair, existing baseline overlay and CI/aggregate routing.

Independently recomputed all nine executable/test source hashes listed in `local.json`; all match the exact reviewed tree. Read the retained completed test/type/lint logs and watchdog records, and the actual focused TypeScript configuration:

- **107/107 controls**, no failures/cancellations/skips; watchdog 2,889 ms, 834,976 KiB sampled combined peak, pressure 1.
- **Nine-root/import-graph typecheck**, 444 ms, 292,688 KiB sampled peak, pressure 1. This is not full-project Typecheck.
- **Full lint/dependency/format**, 17,752 ms, 756,064 KiB sampled peak, pressure 1.
- Backlog, generated index and exact-title PR check receipts pass; direct whitespace inspection also passes. Existing ticket-length/grooming reminders remain nonblocking.

The retained first fixture-test failure is a native libsql panic from querying a closed DB, followed by the public `isOpen` repair. The first expanded 107-control attempt retains four macOS alias-path assertion failures; comparing the same fixture map's realpath matches production canonicalization without weakening the attribution/security implementation. The later complete run is distinguished from those failures.

The one declared retained-trace probe records exact 596,624,241-byte raw parity, stored 47,129,287-byte gzip, 2.786-second roundtrip and closed streams. I previously inspected its admission/result and inspected the retained evidence again; I did not repeat the probe or inflate the full trace. It proves local storage feasibility, not Chromium causality, actual CDP transfer cost, native timing or reclamation beyond the owned boundaries. The historical timeout and missing baseline trace remain failures, with their exact interrupted browser operation unproved.

No tests/browser runs, full-trace analysis or implementation edits were performed by this reviewer in this final pass. Repeating the already complete controls would add no distinct resolved uncertainty; source/negative-control inspection and exact hash/log verification supply the independent check while preserving the coordinated resource policy.

## 👥 Personas and remaining acceptance

The **Operator** gains accountable, bounded collection and trustworthy failure evidence without more operational services or repeated browser runs. The **Owner** retains exact authored/saved content and callback/disposal requirements. The **Collaborator** retains the separate convergence/history/idle/capacity checks selected through the shared fixture and full CI plan. The **Link guest** retains unchanged revocation/access verification; no authorization logic or permission expectation is narrowed. No product UI changes require new visual approval.

Before merging, require both exact-source grades above95, all seven current-head gates and every selected worker, full hosted types, first-attempt complete desktop/mobile historical and candidate pairs with full trace/source hashes and cleanup, and applicable unprofiled responsiveness/content/access evidence. Native total cost must fit the original budget; a failed pair stops acceptance. Retain useful failure diagnostics and immutable final evidence with source/base/tested identities. The ticket removal, SPN-141 dependency removal and completion-ledger increment are prepared landing changes only; no merge is claimed here. Next ID and grooming date remain unchanged.
