# Independent review A — SPN-158

Reviewed exact `bfeb0b23953a67aae8afcba8af6eadd8b24f1040` against actual base `89e4426dfff1c3469b260305e21180ffd79fdb7f`, clean `/Users/mxbaylee/projects/spinel-spn-158`. Read-only review; no source edits, mutation experiment, push or merge.

**100/100 — scope35, correctness25, regression20, workflow/operations10, maintainability10.** No actionable finding or unresolved review blocker. No remaining repair step to100. No deduction for CI results or pending actual Linux acceptance. This is a qualifying numerical pre-push review, not a claim that pending acceptance passed.

## Complete outcome assessed

Read the original158 ticket at89e4426d, complete43-file diff, canonical record, maintained source/evidence/receipts, provisional landing bookkeeping, prepared PR body, testing/process rules and all four personas. The only executable changes are three test/helper files. Production MaintenanceGate, authentication mutations, supervisor ownership and application behavior are unchanged.

The shared `restoreHttpClient.restoredAdmission` retains the original client's cookie/session context and requires session401, maintenance200, supervised availability and running phase. It reads the same application maintenance status used by admission. The actual postcommit crash fixture uses that exact shared predicate, rather than a separate test-only approximation. A single20s controller signal bounds both HTTP reads, combines with any existing client cancellation, and is aborted/cleared in finally. Ordinary60s authentication/archive request behavior is retained. The following authentication attempt, acknowledged marker write, cut request, SIGKILL, reconciliation, exact durable rows, authority and retained-evidence assertions are unchanged.

Failure output is bounded to fixed stage/category, allowlisted phase, statuses and booleans. Authentication errors exclude body text/credentials; poll failure records the last sanitized observation and original assertion cause, avoiding Vitest's subset-diff omission. No new generic retry or readiness framework, extra deadline window, authentication retry, gate exception, skip or speculative product change found.

The real HTTP fixture deterministically holds paused admission while session401/maintenance200 coexist with denied auth503 and unchanged session/challenge rows. It then admits authentication options and expected writes after running. The separate held-response case proves caller cancellation closes the pending second read and makes exactly the two intended reads. These are meaningful low-layer controls for the identified oracle weakness, not substitute Linux crash evidence.

## Evidence and independent checks

- Independently ran exact-head `http.test.ts` filtered to `postcommit readiness|shared readiness deadline`: **2passed**,9 unrelated cases filtered,1file passed. Node26.13.0/Vitest5.1.0; normal pressure before launch, shared serial/runtime watchdog; elapsed3251ms, peak1015744KiB, exit0/reasonnull. Used `--cache=false --fsModuleCachePath /tmp/spn158-review-a-cache-bfeb0b23`. Receipt/log: `/tmp/spinel-dependabot-2026-11-11/spn158-review-a-http-bfeb0b23.{json,log}`.
- Inspected the retained actual mutation: replacing only the shared conjunction with session401 readiness failed exactly on paused `ready:true` versus expectedfalse. Original/current/restored helper hashes match; I did not modify source to repeat it. Historical503 attribution is still correctly unproved.
- All three current source hashes and every retained payload hash/size in checks.json match. The focused test/helper bytes are unchanged by later crash-wrapper diagnostic work. Integrated full Typecheck pass, targeted lint/format and backlog receipts remain correctly distinguished from prior resource aborts/refusals. `git diff --check` passes.
- Rechecked dependencies against clean0982204b8c4: matching lock, manifest dependency/workspace/engine fields, all tracked patch/lib files and seven linked workspaces. No dependency-source/install mutation. Earlier shared-cache writes are disclosed; this run used private module cache and disabled result caching.
- Explicit post-run process/start-time audit found no owned test, fixture or watchdog descendants; only audit shell/rg matched. Final head/tree are unchanged and clean; source hashes rechecked. Sole local workload slot released. No broad suite, Linux-on-Mac run, compiler repeat or browser workload.

Existing recovery CI ownership includes both affected suites/helper; broad maintenance source dependencies retain required selection and missing/failed-worker rejection. Bookkeeping removes only158, appends only158 to existing completions, preserves next159/groomingNov12, and removes090's dependency while retaining its original failure and obligation to integrate/revalidate.157 remains a separate completeL investigation with098's dependency intact.

Operator gains a useful bounded readiness verdict. Owner and Collaborator retain authenticated selection and acknowledged-content durability. Link guest receives no new admission or authority. There is no visible product change requiring visual review.

## Pending acceptance, without point deductions

Actual current-source Linux postcommit authentication, acknowledged write, cut/SIGKILL, reconciliation, exact rows, retained evidence and cleanup remain required, along with all seven current-head gates and applicable selected workers. The original503 occurred before acknowledgement/cut/SIGKILL; its missing body/phase means this source-proven repair does not establish the cause of that historical response. Preserve any new first failure and disposition. SPN090 must integrate the accepted repair and obtain its own current-head validation. The other independent exact-head review remains a separate gate.
