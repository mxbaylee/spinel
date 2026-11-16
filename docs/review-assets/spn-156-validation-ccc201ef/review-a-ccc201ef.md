# 🔎 SPN-156 independent review A

## Decision and source identity

**Score: 100/100. No unresolved source-review findings or source blockers.** This is a qualifying independent review of the complete committed candidate below. It does not certify hosted results or the required installed-phone observation, and it does not authorize merge while those gates remain incomplete.

| Identity | Value |
| --- | --- |
| Reviewed commit | `ccc201ef243022d572e2764fd26c1e928f2582c0` |
| Reviewed tree | `adf496587fd9ccaafa21444d0a8c1c24c4ef0542` |
| Base/main | `104d7ae89d3ed5ff328cc87b838ed9246f0f42ce` |
| Checkout | `/workspace/scratch/50a216697989/spinel` |
| Review date | 2026-11-16 UTC |
| Reviewer | Independent nonimplementing agent `/root/review_a` |
| Working tree | Clean before and after independent checks |

The implementing agent owns all product edits. I supplied provisional findings and recommendations, then independently reviewed the committed repairs. I did not read the PR body, historical numerical review reports, or the other final review. No product file was edited by this review. Evidence and this report are outside the checkout.

## Rubric

| Category | Score | Assessment |
| --- | ---: | --- |
| Ticket scope and acceptance criteria | **35/35** | Implements the original file-list reconnect/foreground outcome for eligible saved Doc and Sheet edits, preserves the existing authority, writer, durable acknowledgement and recovery owners, and keeps the installed-phone requirement explicit. No requirement was silently split or removed. |
| Correctness, data integrity and access boundaries | **25/25** | One serial account replay owner; exclusive item writer remains authoritative; foreground and maintenance handoffs join cleanup; account/visibility/preparation fences prevent stale work and observation capture; failed or interrupted work remains retained. Native content and acknowledgement persistence boundaries are exercised by actual native clients. |
| Meaningful regression protection and verification evidence | **20/20** | Independently ran 242 related offline/sync/native tests on the exact commit. Tests distinguish memory acknowledgement from durable commit, detect observer failures and stale captures, exercise actual lock admission, and protect foreground contention and release-time wakes. Native browser assertions retain exact content, revisions, no-editor state, revocation and peer delivery. Hosted status is a separate gate. |
| CI and operational usability | **10/10** | Independently ran 85 native-pointer, routing, immutable-range and fail-closed aggregate controls. Main's workflows/routing remain intact; changed CI helpers select full coverage. Replay uses the existing content-free diagnostic collector, bounded sampling and emitter inventory. Historical failures and dirty-tree preparation identities are preserved accurately. |
| Maintainability, documentation, process and over-complexity | **10/10** | The coordinator, headless host and admission gate each own a necessary boundary and reuse the existing sync protocol, storage, SDK and diagnostics. No new engine, persistent queue, dependency or generic framework was added. Maintained docs, persona rationale, scope reassessment and provisional landing bookkeeping are consistent. |
| **Total** | **100/100** | **No numerical deductions.** |

## Independent local verification

All test workloads used Node **26.13.0**, `../validation/watchdog.ts`, and `scripts/serial.ts`. The watchdog enforced the existing eight-minute and 2 GiB process-tree limits. I ran the two batches serially, then notified the root agent immediately that reviewer B could use the workload slot. No retry, failure, resource abort or skipped selected test occurred.

| Workload | Result | Watchdog elapsed | Peak sampled process-tree RSS | Original evidence |
| --- | --- | ---: | ---: | --- |
| Eight offline/sync/native suites | **242 passed; 8 files passed** | 15,143 ms | 818,416 KiB | `focused.log`, `focused.json` |
| Pointer and CI controls | **85 passed** | 2,147 ms | 623,972 KiB | `operational.log`, `operational.json` |

The first batch executed these complete suites:

- `src/ui/offlinePersistence.test.ts`
- `src/ui/offlineLifecycle.test.ts`
- `src/ui/offlineTransactionErrors.test.ts`
- `src/ui/offlineWriterHandoff.test.ts`
- `src/ui/offlineReplay.test.ts`
- `src/ui/spinelSync.test.ts`
- `lib/sync-client/tests/headless-checkpoint.test.ts`
- `lib/sync-client/tests/diagnostics.test.ts`

The second batch executed:

- `scripts/ci/desktop-pointer.test.ts`
- `scripts/ci/plan.test.ts`
- `scripts/ci/changes.test.ts`
- `scripts/ci/coverage-result.test.ts`

Exact executable/arguments, UTC timestamps, source identity, exit status and resource samples are in the receipts. The runtime prefix was:

```sh
env PATH="/workspace/scratch/50a216697989/tooling/node-v26.13.0-linux-x64/bin:$PATH" \
  node ../validation/watchdog.ts <receipt> node scripts/serial.ts <command>
```

I also inspected the preparation typecheck, lint and backlog receipts. Those retain their original pre-commit `source` field and are not relabelled as current-commit executions. Their provenance and source relationship are documented in the integration evidence. The independent test receipts above bind directly to the reviewed commit.

## Source and evidence inspected

Read `AGENTS.md`, `docs/todo/process.md`, `docs/run-backlog.md`, `docs/testing.md`, all four personas, and the original ticket from `main:docs/todo/SPN-156.md`. Reviewed the application/native/fixture change set against main, maintained offline and diagnostic guidance, capability and architecture decisions, current integration decision, failure dispositions and the new `integration-104d7ae8/README.md`. Historical evidence files were inventoried without using prior numerical grades.

Independently verified both compressed evidence checksums and all **44** embedded file hashes/byte counts. Independently rehashed all **1,342** non-documentation source-audit inputs against the committed checkout: **zero mismatches**. The audit is retained as `evidence-audit.json` beside this report.

- `raw-evidence.json.gz`: `20750dc79e8ea65f312367077b544c7f52b5bb5f45f7efbf96544df0c5410da7`
- `source-audit.json.gz`: `5e8ea725393e06ad0467d879f1f42d895d12f53c6ea37a42d4b3a5d14d8a98d1`

Raw historical evidence bytes were not reformatted. The substantial retained evidence does not conceal additional runtime scope; the implementation record reassesses the complete L outcome and retains every acceptance obligation.

## Findings and dispositions

### Diagnostic entry-point integration — resolved

The provisional merge bypassed main's loader-only assignment of `OfflineSession.diagnostics`. The committed candidate initializes that source in shared `attachSpinelSync`, and the file-list hook supplies the existing account collector through the originating replay subscription. Capture checks the subscription, current preparation/account, visibility and connectivity. Factory invocation remains inside the optional diagnostic capture boundary.

The real replay host/native client/persistence tests pass with enabled, absent, throwing-source and throwing-sink modes while preserving the authored checkpoint. They assert actual durable-save observations and no fabricated document-open or server acknowledgement. Existing native diagnostic tests retain acknowledgement semantics and observer isolation. The source guard tests prevent a retired subscription or replaced account from initiating a fresh capture. The inventory documents dashboard/file/Space attribution and reuses existing sampling and collection authorization.

### Release-time replay wake — resolved

The committed owner restarts a retained requested wake after a run that actually acquired the account lock. This closes the interval between the queue's last check and completion of lock release. An unavailable lock does not enter an idle retry loop. The maintained regression injects a durable-change event at the real lock callback's release boundary and passes in the independent exact-commit suite.

### Overlapping foreground admissions — resolved

Editors join the bounded admission queue while maintenance retains immediate refusal behind an exclusive foreground operation. The authoritative item writer remains nonblocking. The actual-session regression proves that the second editor opens read-only, the first retains its writer, maintenance remains refused and final lock ownership is empty. This repair does not wait for a live editor's lifetime or bypass the gate using a stale query snapshot.

### Other reviewed boundaries — no additional actionable finding

- Dashboard and Space subscriptions exclude the currently opened item and share the account owner.
- Replay reloads the actual stored copy, checks compatibility and authority through `OfflineSession`, and never silently publishes a recovery copy or uploads a new offline creation.
- Quiet stop ends producers and joins persistence before normal handoff. Nested cleanup releases reservations even when a disposer throws; invalidated account work remains fenced.
- Native tests distinguish the immutable durable sent envelope, server acknowledgement, and final local checkpoint commit. A server receipt does not prematurely clear a failed local write.
- Browser tests retain exact Doc/Sheet content, one accepted revision per authored batch, original mutation identities, no visible editor and peer content. Revocation retains the original queue without a submit or hidden recovery publication.
- Existing device and sign-out tests explicitly hold resume where automatic file-list replay would otherwise consume their intentionally pending fixture. Their original retained-content/server-state assertions remain present.
- The native pointer helper checks enabled state, clipped click geometry and hit membership without posting during polling, suppressing warnings, force-clicking, retrying input or extending the existing deadline.
- Guest roots do not acquire a private replay/diagnostic owner. Operator has bounded work and useful observations; Owner and Collaborator retain durable edits and ordinary foreground behavior.
- The hook's local-mode comment now accurately distinguishes retained catalog reads from acknowledged replay writes.

## Every actionable step to 100 and blocker status

**There are no remaining actionable source-review steps or deductions: the score is already 100/100.** No speculative cleanup, extra abstraction or redundant test execution is requested.

Separate acceptance gates remain open and are not represented by this score:

1. Fresh selected hosted checks, native Desktop and applicable Storybook evidence must bind the published candidate and actual tested merge. Historical successful runs do not replace them.
2. The original bounded installed-phone observation remains explicitly unavailable/unperformed: installed Home Screen launch, offline authorship, file-list reconnect/foreground, acknowledgement and separate-viewer content with device/browser/build provenance. Local native tests, browser emulation and desktop runs do not substitute for it.

These are merge-readiness gates, not source-score deductions. Keep the PR draft/unmerged until they are satisfied. Provisional ticket removal and the completion-counter update are landing preparation, not proof that those gates passed.

**Agent review only.** No new layout, visual component or visible state was introduced; this report is not a fabricated screenshot approval.
