# Independent review B: SPN-156

## Decision and identity

**Source review: 100/100. No unresolved source blocker or actionable source correction found.** The candidate is ready to proceed to its remaining acceptance gates. This is not a claim that installed-phone acceptance or the fresh hosted validation has happened, and it does not authorize merging before those gates complete.

Reviewed on 2026-11-16 UTC:

| Identity | Value |
| --- | --- |
| Candidate | `ccc201ef243022d572e2764fd26c1e928f2582c0` |
| Tree | `adf496587fd9ccaafa21444d0a8c1c24c4ef0542` |
| Base / actual main | `104d7ae89d3ed5ff328cc87b838ed9246f0f42ce` |
| Ordered parents | `5c764793f03f7f885873d08d6eca0660cd401bf0`, `104d7ae89d3ed5ff328cc87b838ed9246f0f42ce` |
| Checkout | `/workspace/scratch/50a216697989/spinel` |
| Working tree after checks | Clean |

I independently checked the local committed identity, ordered parents, tree and clean worktree. I reviewed the complete implementation difference against actual main, the original ticket from `git show main:docs/todo/SPN-156.md`, current repository/process/testing rules, personas, relevant implementation and user documentation, and the current-main integration evidence. I did not read the PR body, historical numerical review reports, or the other reviewer's findings or grade. I made no product edits. My earlier overlap reproduction was an external scratch probe using production admission code and actual locks.

## Rubric

| Category | Score | Assessment |
| --- | ---: | --- |
| Scope and acceptance design | 35/35 | Implements the retained running-app file-list reconnect/foreground outcome for downloaded Docs and Sheets. Keeps the original native capability, authority, durable acknowledgement, contention and recovery work in scope; tests and docs own the complete source contract. Guests, offline creation/images, OS execution after closure, periodic polling and iPhone acceptance remain within their original boundaries. The installed-phone observation is explicitly retained as a separate unfulfilled acceptance gate. |
| Correctness | 25/25 | Serial account ownership, scoped authority, actual nonblocking item writers, native checkpoint restoration and durable acknowledgement are preserved. The observed lock-release wake and overlapping-editor admission defects are repaired without lock stealing, polling, premature pending clearance or bypassing authority. Cleanup waits for the existing persistence barrier before releasing writers. |
| Regression protection | 20/20 | Independent exact-commit execution passed all 242 offline/sync/native tests and all 85 pointer/CI-selection controls. Relevant existing owners remain in place. New cases exercise real lock ordering, real OfflineSession/native restoration and persistence failure boundaries. Browser changes preserve actual authored content, durable pending data and peer/server checks while adapting the main-branch fixtures to automatic replay. |
| Operations and evidence | 10/10 | Work is event driven, account scoped and bounded, with explicit stop/cleanup paths and no new service or polling loop. SPN-123 diagnostics use the existing collector and honor subscription/lifetime fences. Original negative evidence remains intact; hashes and source inputs verified. Current-head hosted and installed-phone gates are described honestly. |
| Maintainability | 10/10 | Reuses the existing sync client, native adapter, OfflineSession, account authority and writer boundary. The replay owner, temporary native host and cross-tab admission each have a distinct responsibility. The small editor/maintenance admission distinction expresses a real behavioral contract and has a regression test. No redundant synchronization engine, persistent queue, diagnostics framework or dependency is introduced. |
| **Total** | **100/100** | **No source deductions.** |

## Original acceptance and integration assessment

### Editor-independent replay and durable state

The file-list/Space call sites mount an account-level `watchOfflineReplay` subscription and separately identify the current foreground item. `web/offline/replay.ts` admits work only for the prepared current account while visible and online. Its account lock and retiring-owner barrier keep work serial across account subscription lifetimes. The downloaded-item scan excludes creation, read-only, problem, uncertain and foreground work; it rechecks scope around asynchronous boundaries. It uses durable change notifications and browser lifecycle events rather than polling.

`web/offline/replayHost.ts` reserves the item before asynchronous admission, obtains the existing OfflineSession writer, restores native state and attaches the same sync transport used by editors. It does not require a mounted editor or create a second protocol implementation. The headless host disables automatic recovery publication and navigation. Failed, unauthorized or incompatible work retains its checkpoint/outbox for the existing recovery flow.

The inspected native adapter and `headless-checkpoint.test.ts` use real Doc/Sheet snapshots and queued native edits. The tests check restored authored content without duplicate native edit creation, immutable sent retries, duplicate receipts, and an acknowledgement checkpoint whose persistence is deliberately held. Pending state remains until the durable acknowledgement finishes. These are material assertions for the original once-only and interruption contract, not merely lifecycle mocks.

### Authority, contention and cleanup

The temporary host still goes through OfflineSession and the existing account/item access and ticket/socket authority path. Guests do not receive this private-store owner. Invalidation, lost access, offline/hidden transitions, subscription disposal, timeout and foreground handoff stop temporary producers. The shared attachment's quiet stop aborts further work, marks the client disconnected and awaits persistence before final disposal. The host's nested cleanup releases the native objects, session, binding and reservation on both normal and early-exit paths.

The item writer remains an actual nonblocking exclusive lock. An existing editor is never displaced by replay. Cross-tab foreground work queues on the replay admission gate with a bounded timeout and account/storage cancellation; the stop notification is sent after enqueueing the exclusive request. The receiving shared owner only honors a handoff when the queued exclusive request exists. The gate coordinates temporary replay with admission, while the actual item writer determines editable versus read-only editor behavior.

I specifically checked the three current-main repairs:

1. **Wake during account-lock release — resolved.** `web/offline/replay.ts` retains a wake that arrives after the queue callback completes but before the account lock Promise settles. Its `finally` restarts only after an actually acquired lock, a retained request and a still-admitted lifetime. A lock miss does not start an idle retry loop. The exact-head suite passes the actual-lock completion-boundary regression.
2. **Overlapping editor admission — resolved.** `web/offline/replayAdmission.ts` distinguishes editor from maintenance admission. Editors use the bounded FIFO gate even when another exclusive admission is briefly held; maintenance retains immediate refusal. `withOfflineEditorAdmission` passes the editor mode. This avoids the unsafe alternative of bypassing the gate based on a momentary query result. The maintained regression opens an actual second OfflineSession read-only while retaining the first actual writer, verifies queued admission and maintenance denial, and finishes with no held or pending locks.
3. **Headless SPN-123 diagnostics — resolved.** `attachSpinelSync` now assigns the OfflineSession diagnostic sink for both editor and headless entry points. `useOfflineDownloads` supplies the existing account collector/source, and the owner guards acquisition against inactive subscription, account, visibility and connectivity. Diagnostic construction and delivery exceptions are isolated. The actual-host cases check enabled, throwing-sink, throwing-source and absent modes; replay durability survives all four and enabled collection includes durable-save observations without claiming document-open activity or an unreceived server acknowledgement.

### Integration with main's SPN-090, SPN-120 and SPN-123 work

The existing creation/image rules and offline authority owners remain intact. Device quota, removal and sign-out browser fixtures now account for automatic replay using real resume/gate control while retaining durable authored-content assertions. They do not replace server behavior with a synthetic successful replay. The new Doc/Sheet browser scenario checks the pending authored content before leaving the editor, file-list reconnect with no editor container, exact server revision/content, cleared pending state and separate-peer native content. The revoked-access scenario retains the work and failure without submits or automatic recovery publication.

The Chromium lock regression observes platform queue-abort/progress behavior without starting the app. The Desktop pointer helper checks connected/enabled geometry and hit testing before the existing pointer action; it does not bypass the menu or synthesize app state. Its negative tests cover hidden, disabled, obscured and invalid-geometry targets. Existing CI-selection policy continues to select full coverage for the changed Desktop helper; workflows, dependency manifests, compiler configuration and routing policy have not been weakened.

The changed product behavior serves the owner and collaborator outcomes directly. The operator gets one serial native replay job per account, existing diagnostics and bounded cleanup, with no new backend responsibility. Guest behavior retains its explicit exclusion. There is no new visual component or layout change that would require a new screenshot matrix to establish this source contract.

## Independently executed exact-commit checks

All three workloads used pinned Node `v26.13.0`, `../validation/watchdog.ts`, and `scripts/serial.ts`, with the assigned exclusive workload slot, an eight-minute deadline and a 2 GiB owned-process-tree RSS limit. All receipts identify the exact candidate SHA above. No workload was aborted, killed by a signal, or exceeded its limit. RSS is the watchdog's sampled process-tree peak.

| Check | Actual result | Elapsed | Peak RSS | Original files in this directory |
| --- | --- | ---: | ---: | --- |
| Offline/sync/native owners | 8 suites, 242 tests passed | 15,604 ms | 796,992 KiB | `owner-native.log`, `owner-native.json` |
| Pointer and CI-selection controls | 85 tests passed; no failures/skips | 2,433 ms | 566,232 KiB | `pointer-routing.log`, `pointer-routing.json` |
| Backlog consistency | Passed; 23 open tickets | 422 ms | 237,876 KiB | `backlog-check.log`, `backlog-check.json` |

The eight owner suites were `offlineReplay`, `offlineWriterHandoff`, `offlinePersistence`, `offlineTransactionErrors`, `offlineLifecycle`, `spinelSync`, native `headless-checkpoint`, and sync-client `diagnostics`. The control suites were `desktop-pointer`, `plan`, `changes`, and `coverage-result`. Exact executable commands and timestamps are in the original receipts. Backlog emitted only existing advisory ticket-length warnings, not consistency failures.

I also independently decoded and verified the current integration evidence, recorded in `evidence-integrity.json`:

- Both compressed bundles match `integration-104d7ae8/SHA256SUMS`.
- All 44 retained raw files match their recorded decoded byte lengths and SHA-256 hashes.
- All 1,342 prepared non-documentation source inputs match this committed checkout byte-for-byte and by SHA-256.
- The source audit explicitly retains the uncommitted integration receipts' original HEAD values. I did not relabel those old runs as exact-commit executions.
- The final HEAD, tree, base, ordered parents and clean worktree were rechecked after my workloads.

I inspected the maintained integration record's corrected typecheck/lint evidence and its first failures. My independent executions above do not claim to be a new full build, browser run, native Desktop run, Storybook run or installed-phone observation. Preserved historical raw logs were not rewritten to satisfy whitespace tooling.

## Remaining actions and blocker status

**Actionable source steps to reach 100: none identified. Source blocker status: none.** The previous release-boundary wake and overlapping-editor findings are closed by the reviewed implementation and independently passing exact-head regressions. I found no remaining concrete diagnostics integration defect.

The following acceptance work remains separate from this source score:

1. Obtain fresh selected hosted checks, native Desktop and Storybook evidence tied to this candidate and the actual tested merge; historical results for the previous candidate are not evidence for the new merge.
2. Complete the retained bounded own-phone observation on the repaired installed build: Home Screen/offline authorship, durable pending content, file-list reconnect or foreground online, acknowledgement/pending clearance, and peer content without reopening the first editor. Record installed/build/account provenance and retain any first failure. Local native and desktop tests cannot substitute for that installed lifecycle observation.
3. Keep the PR draft/unmerged until those acceptance gates are satisfied. Any further executable change requires review and meaningful verification of the changed contract before carrying this score forward.

The phone observation is explicitly unavailable/unperformed in the reviewed implementation record. That is a real remaining merge gate, not a hidden follow-up or a passed acceptance item.
