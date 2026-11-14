# 🔁 SPN-156 independent review B

**Head:** `8ca1ef651aae7447ad640575f0ed76ca431f79c3`  
**Base:** `ecef3c6d6ea5093bdd9fcf7c0a69c5e5218b4a6f`  
**Worktree:** `/Users/mxbaylee/projects/spinel-spn-156`  
**Reviewer:** Independent nonimplementing reviewer B; read-only candidate review. No source edits, installations, mutations, push or merge. Report dated 2026-11-14 UTC.

## Assessment

**100/100: scope 35/35; correctness/data/access 25/25; regression 20/20; CI workflow/operations 10/10; maintainability/complexity 10/10. No actionable findings or point deductions.** No prior or other review grade was used. There are no locally repairable steps to full marks identified on this exact candidate. CI results were not used for deductions.

This is a review-before-validation assessment, **not a statement that the complete L outcome has passed acceptance or is ready to merge**. The actual browser replay/revocation cases and bounded installed-phone observation remain required and unverified. Provisional ticket removal and the completion counter are landing preparation only. These missing executions are explicitly recorded constraints, not hidden implementation follow-ups or evidence of success. Any subsequent main integration or code repair needs exact-new-head revalidation.

## Original scope and implementation

Read the original ticket directly from the base, the complete candidate diff (84 files), canonical current packet/history, applicable process, backlog runbook and sustainable-testing guidance, and all four personas. The retained pre-launch outcome covers both Doc and Sheet list-view reconnect, once-only acknowledged content, peer observation, account/item authority, revocation, writer contention, interrupted persistence/retry, native capability and installed lifecycle. SPN-090 closure does not satisfy it. Closed-app execution, periodic idle polling, changed offline creation/image policies and iPhone acceptance remain out of scope.

The source implements that outcome through existing owners. `web/offline/replay.ts` shares one event-driven account owner across file-list surfaces, uses an account Web Lock across tabs, excludes foreground items and ineligible downloads, and admits one replay item at a time. Account epochs and mounted lifetime are rechecked after asynchronous boundaries. The retiring-owner join prevents a same-account remount from racing the old account lock. Contention is conservative and retried on a later external event; own active-item checkpoint notices do not produce an idle retry loop.

`web/offline/replayHost.ts` lazily constructs the existing NativeReplica over the retained checkpoint and attaches the existing sync binding. It does not send stored frames directly or introduce a second acknowledgement/rebasing protocol. It disables hidden recovery publication/navigation. The bounded network lifetime ends on acknowledgement, failure, stop or timeout. Stop completion joins persistence and disposal rather than treating an empty memory queue as durable success. Nested cleanup finally blocks release reservation/completion waiters even when native disposal throws.

`OfflineSession.ts` preserves compatibility, prepared account, item/Space, native generation, image preparation and scoped HTTP checks. The narrow background admission path avoids waiting on its own replay reservation while retaining the actual item Web Lock. Another-tab ownership yields read-only admission and no binding. `offlineStore.ts` reserves foreground/maintenance admission before waiting for replay stop; new replay cannot enter that handoff. `web/spinelSync.ts` exposes attachment to the already-created native unit and a quiet stop/join boundary, while retaining existing access-before-ticket admission, expected-account/epoch fencing, immutable retry envelopes, revocation, conservative lost-ack attention and persistence failure behavior. No source change broadens guest authority or private offline storage.

Dashboard, offline Space and Space actions supply current foreground item identity to the shared hook. They introduce no new visible component or state. Existing rendering/interaction acceptance remains applicable, but routine new visual captures/approval are not required for this lifecycle wiring.

## Meaningful verification and evidence

The test ownership is appropriate rather than duplicating a full phone matrix. The new real native Doc/Sheet checkpoint test checks authored content, restored identity, server receipt/duplicate behavior and held durable acknowledgement. Existing real-host/session/Web Lock tests cover held shutdown, cleanup exceptions, late account invalidation, disappearing copy and competing writer. Existing binding tests cover quiet stop, persistence failure and suppressed reconnect producers. Store controls require actual adapter completion before clean notification and preserve errors/account invalidation. Coordinator tests cover shared views, foreground priority, serial work, offline/reconnect, account replacement, cross-tab exclusion and retiring-owner remount.

The two added `e2e/offline-editing.spec.ts` cases assert real offline authorship and durable pending work, absence of an originating editor on reconnect, acknowledged IndexedDB state, exact server revisions/content, separate-viewer native content and denied-access retention without submission or hidden recovery copy. The corrected fixture waits for distinctive authored content in the stored checkpoint before navigation; it does not rely on an already-visible saved message. These assertions are meaningful, but neither integrated case has a completed current result.

Inspected retained checkpoint-restoration and old-cleanup negative evidence. The latter directly fails completion signalling when native disposal throws, rather than merely timing out. Those controls detect their stated boundaries; they do not substitute for the browser integration or phone result.

Independently verified all **16 ticket runtime/test files** against current SHA-256 and Git blob identities and the retained tested source `ff0f12018ea92caaa9b09f48064962326f8061ae`. The full current record contains **64 evidence payloads and 34 guarded receipts**; inspected their result/disposition inventory, source/build identities, first browser failure, resource aborts and cleanup. Retained full typechecks/lint/format/backlog/PR checks retain their own sources rather than being claimed as my execution. The first browser failure was the pre-reconnect pending-Doc assertion; later resource aborts cannot establish its repaired end-to-end result. Sixth attempt ended at 10,938ms / 2,103,424KiB under the unchanged 2GiB guard before an assertion result. Its detached server cleanup is explicitly recorded. Unsampled short checks are not described as zero memory use.

Independently compared **117 dependency source/manifest/lock/workspace inputs** against their hashes and the SPN-098 donor. `node_modules` resolves to the stated donor. No dependency, patch, workflow or CI script was changed by this ticket. Current routing retains application and shared-runtime/browser coverage for web/UI changes and the separate library gate for the native test. It does not narrow selected worker/aggregate requirements.

Landing changes delete only SPN-156, append156 to the preserved148/145/149 completion list, retain next161 and the November12 full-groom date, and regenerate the ticket index. No downstream SPN-156 prerequisite exists to remove. The canonical record retains original rules, effort, provenance and missing acceptance prominently.

## Own local execution and cleanup

With the manager's exclusive Mac workload grant, pinned Node26.13.0 on PATH, shared serial runner and unchanged runtime watchdog (normal pressure, 2GiB descendant RSS, eight-minute ceiling), ran:

```text
node /tmp/spinel-dependabot-2026-11-11/watch.ts spn156-review-b-8ca-lifecycle node node_modules/vitest/vitest.mjs run src/ui/offlinePersistence.test.ts src/ui/offlineLifecycle.test.ts src/ui/offlineTransactionErrors.test.ts src/ui/offlineWriterHandoff.test.ts src/ui/offlineReplay.test.ts src/ui/spinelSync.test.ts --cache=false --fsModuleCachePath=/tmp/spinel-dependabot-2026-11-11/spn156-review-b-8ca-module-cache
```

**176/176 tests passed across six files**, exit0, **4,380ms**, peak **1,139,104KiB**. This was the first and only reviewer-B runtime attempt on this head. No assertion failure, guard abort, browser retry, compiler repeat or altered budget. The broad lifecycle selection is justified by the changed shared admission and binding stop/dispose behavior. Existing unchanged native capability evidence was inspected instead of repeating its separate integration run.

Receipts: `/tmp/spinel-dependabot-2026-11-11/spn156-review-b-8ca-lifecycle.json` and `.log`. Explicit owned-process command/cwd audit at `2026-11-14T06:12:35.974247+00:00` found no remaining owned workload and killed no process: `/tmp/spinel-dependabot-2026-11-11/spn156-review-b-8ca-cleanup.json`. Worktree remained clean at the reviewed SHA. The local slot was released immediately afterward.

Read-only diff hygiene inspection reported trailing spaces only in preserved raw first-browser console/error-context evidence. This is retained diagnostic output, not an authored source defect; no mutation to original evidence is requested or grade deduction applied. I do not report the unrestricted `git diff --check` as passing.

## All four personas and remaining acceptance

Owner and Collaborator gain list-view upload while retaining durable edits, exact acknowledgement, foreground priority and revocation. Operator gets one bounded lazy host using established authority and persistence components instead of another uploader or service. Link guest receives no private replay owner, store or access expansion. The implementation adds modest coordination complexity required by its lifetime boundaries and does not introduce speculative abstraction or new dependencies.

There are **no point-bearing repair findings**. Remaining delivery actions are explicit acceptance conditions:

- **Resource-blocked browser / hosted execution:** run the unchanged two file-list cases at the final integrated source; prove durable browser acknowledgement, exact server and peer content, and revoked-edit retention. Preserve the first result and diagnostics; repair any actual finding before merge. Do not retry unchanged locally, raise budgets or count the existing aborts as passes. Owners: `e2e/offline-editing.spec.ts` and canonical current packet.
- **Unavailable authorized device prerequisite:** obtain an already-authorized installed-phone session, then observe app-running reconnect/return-to-foreground on the repaired build with device/browser/build identity and peer-content result. The earlier Pixel10 symptom is not current acceptance. This is an execution prerequisite, not human design sign-off, a paid-provider requirement or a waived contract. Owner: original SPN-156 Verify and canonical retained-acceptance section.
- **Final delivery:** integrate the manager's actual-main boundary, revalidate the exact new candidate, obtain required current-head gates and all actual acceptance before merge/launch. Keep provisional landing bookkeeping from being presented as completion before those conditions hold.

These conditions remain part of the full L outcome; this review creates no smaller follow-up, push exception, phone waiver or acceptance claim.
