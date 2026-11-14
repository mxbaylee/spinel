# 🔎 Independent SPN-123 review A

Reviewed candidate: `cae5a58689b049e4f62c3a815482e21bb5212f49`.
Actual base: `c525aa933505d6e78b8fdd7a89940d87506d5cb3`.
Worktree: `/Users/mxbaylee/projects/spinel-spn-123-production` (clean and still at the candidate after my runs).
Review packet: `/tmp/spn123-review-packet-cae5a586`; coordinator-provided source manifest SHA-256 `4d1606e33d8fe069908991e999bcf0a83828eec74b4778007f6ceff1e93c31c7`.

I did not implement this candidate. I reviewed read-only, did not consult another reviewer's result or the original PR's numerical assessments, and made no repository/dependency/cache changes. I read the original ticket, process/personas/testing policies, full runtime/test delta and relevant unchanged integration context, maintained emitter inventory and implementation record, current local receipts, historical failure dispositions, and postcommit selection evidence. The coordinator's exhaustive packet/archive binding verification is supplied evidence, not work I independently repeated.

## Assessment

**96/100, with one unresolved P2 source correctness finding. Do not approve validation publication until it is repaired and independently revalidated.** The score alone does not satisfy the no-unresolved-blockers requirement. CI results carry no deduction.

- Scope and acceptance breadth: **35/35**. The complete L inventory is implemented in production seams, with named remaining actual platform acceptance. No acceptance is silently moved to SPN-098, SPN-110 or SPN-160.
- Correctness: **22/25**. Deduct 3 for the reproducible false durable-save observation in F1.
- Meaningful regression coverage: **19/20**. Deduct 1 for the absent already-refused stale-ACK negative contract associated with F1. Existing tests cover the normal branch, so the new instrumentation passes them while violating the same truthfulness guarantee in the refusal branch.
- Delivered workflow/usability: **10/10**. Existing download/schema workflow, explicit local versus server save names, source attribution, exact timing inventory and visible loss semantics make this operationally interpretable without new UI.
- Maintainability/overcomplexity: **10/10**. Reuses bounded existing collectors/store and public SDK APIs. Fixed schema families, process-local weak group metadata, one bounded histogram, and a small secondary writer are justified by actual promised boundaries. No new durable tracing service, speculative abstraction or dependency is introduced. The lengthy evidence history is substantial but source-bound and necessary to preserve failed attempts and integration decisions.

## F1 — P2: Do not report an impossible stale receipt as durable after refusal

**Location:** `lib/sync-client/src/client.ts:684-685` (new `finishSave('success', ack.duplicate)`), and the missing branch coverage beside `lib/sync-client/tests/diagnostics.test.ts:277`.

A nonpreserving client retains its immutable sent request after an unrelated refusal until it receives a terminal response. `acknowledge()` validates only the receipt shape before entering `if (this.reason)`. The new success observation in that branch bypasses the revision consistency checks at lines 693–702. A receipt whose revision is equal to the new request's base revision cannot prove that request was durably committed, but it is counted as a successful `document-save-server-ack` after refusal. The identical input before refusal is correctly cancelled as stale.

I reproduced the contrast using the actual native Sheet fixture and SyncClient, not a mock of `acknowledge()`:

1. Commit and acknowledge a first write, reaching confirmed revision 2 and exactly one durable server history row.
2. Enqueue/send a second write based on revision 2; never submit this second request to the server.
3. In one run, call `refuse('divergence')`; leave the otherwise identical control run unrefused.
4. Deliver a shape-valid ACK carrying the second request's matching mutation ID but the first receipt's revision 2/body.
5. Control emits `cancelled` and reports `stale`. Refused run emits **`success`** and retains `divergence`. Both still have exactly one durable history row; there was no durable second write.

This is a diagnostic truthfulness regression introduced by the new success emitter. The pre-existing terminal-receipt handling also accepts the stale response, but this review does **not** claim that SPN-123 introduced that synchronization behavior or demonstrates new content loss. The ticket explicitly promises validated server-ACK timing and must not turn this known inconsistent receipt into affirmative evidence of saving.

**Fix:** Before claiming success in the already-refused branch, apply the nonmutating receipt/revision consistency checks that can establish this sent request's durable receipt. At minimum an ACK must advance beyond its immutable request base/current known revision. An inconsistent receipt must not produce a success result/count or `sync.client.acknowledged`; settle as cancelled/unknown or retain the wait according to the existing authority contract. Do not replay native edits merely to emit diagnostics, and do not let observation code become recovery authority. Preserve genuine post-refusal durable receipts, duplicate receipt counting, refusal handoff and original operation behavior.

**Regression:** Extend the existing diagnostics suite with the above normal/refused contrast, plus a genuine committed late receipt after an unrelated refusal. Assert exact operation results and absence/presence of acknowledged events, immutable request behavior, server history count and unchanged content. Run it locally under the existing bounded serial guard, then obtain both reviews on the new exact commit. This is locally repairable; it needs no external access or owner decision.

**Points recoverable:** correctness +3 and meaningful regression +1. These are all actionable deductions in this review; no additional scope, maintainability or CI-result deductions are hidden.

## 🧪 Independent executions

All commands ran only after the coordinator explicitly granted the sole Mac slot. I released the slot immediately after each command. Pinned Node was `/tmp/spinel-dependabot-2026-11-11/node-v26.13.0-darwin-arm64/bin/node`; the existing `watch.ts` invoked shared `scripts/serial.ts`, required normal pressure, and enforced 2 GiB/eight minutes with 200 ms sampling.

### Focused contracts — first attempt passed

Command arguments after the watchdog:

```text
[pinned node] node_modules/vitest/vitest.mjs run
--config /tmp/spinel-dependabot-2026-11-11/spn123-vitest.config.ts
--configLoader native --cache=false
lib/diagnostics/client.test.ts
lib/diagnostics/server.test.ts
lib/sync-client/tests/diagnostics.test.ts
src/server/diagnostics/browser.test.ts
src/server/diagnostics/runtime.test.ts
src/server/diagnostics/store.test.ts
src/ui/spinelSync.test.ts
src/ui/offlinePersistence.test.ts
```

**175/175 tests, eight files passed.** Vitest 2.77 seconds; watchdog 3,121 ms, peak 699,568 KiB, code 0, no signal or resource-guard reason. Private config imports this candidate's config; cache was disabled.

- Full log: `/tmp/spn123-review-cae5-a.log`.
- Receipt: `/tmp/spinel-dependabot-2026-11-11/spn123-review-cae5-a.json`.

### F1 negative reproduction — defect confirmed, first attempt

Command arguments after the watchdog:

```text
[pinned node] /tmp/spn123-review-cae5-a-stale-ack.ts
```

**394 ms, peak 218,864 KiB, code 0, no signal or guard reason.** Code 0 means the contrast assertions successfully reproduced the defect; it is not a product acceptance pass. Ordinary native identifier-cache notices were present before the structured output.

- Exact script: `/tmp/spn123-review-cae5-a-stale-ack.ts`.
- Script SHA-256: `3b12393343f30f4a32264c8cc86e596db8f2d38f40a01ba4159376f1040738b0`.
- Full input/result log: `/tmp/spn123-review-cae5-a-stale-ack.log`.
- Receipt: `/tmp/spinel-dependabot-2026-11-11/spn123-review-cae5-a-stale-ack.json`.

## 🧭 Full-scope and integration judgment

Production document-open/search boundaries terminate once; real local checkpoint persistence and validated server ACKs are distinct. Save timestamps remain process-local and restored/rebased age is explicitly unknown. Browser routine sampling is fixed-family, bounded, bundle-consistent and separate from actual edit delivery; rate pressure discards old observations and verifies a fresh collection. Account/session/visibility/truncate fencing, fixed allowlists, frontend claims versus server-derived actors, guest exclusion and content-free fields remain explicit. The P2 exception above is the only observed source defect in those contracts.

The native wrapper observes success/failure in `finally` and preserves the original exception. Main's PendingBuffer and current 16-state/200-history policy are preserved; the unchanged 70-input native regression now checks all five real Undo/Redo groups, selections, peer, storage and reopened body. The supported opaque-pointer loader is combined with main's identity/action/readiness protections. Main's whole-browser storage-quiescence and history account-transition fixtures remain authoritative. No product visual design changed, so no visual approval is claimed or required for these instrumentation/harness changes.

History observations recheck authorization while avoiding invented background actors; restore ownership prevents duplicate operation counts across coalesced/replayed requests. Offline publication/recovery distinguish new durable results from receipt duplicates. Maintenance lifecycle observations cannot admit application writes; the bounded secondary writer keeps truncate fencing and active export ownership. CPU/event-loop conversion and actual windows are explicit, with allocation/reset/sink/teardown failures isolated.

The 17,811 counted-line soft warning is justified by 10,401 retained evidence lines, 1,551 other documentation and 5,859 runtime/test/config lines. This remains cohesive L work with earlier scope checkpoints, including bounded acceptance-harness repairs and retained failures. Splitting evidence from the claimed outcome would reduce reviewability rather than remove architectural scope. No limit or exclusion changed. Current main's SPN-157 audit and unknown historical cause are preserved; SPN-160 is not credited as a causal repair. Only SPN-123 is provisionally retired, and CLI-generated bookkeeping preserves actual grooming/next-ID state.

All four personas were weighed: Operator gains truthful bounded investigation data, making F1 relevant despite no new UI; Owner and Collaborator keep privacy, access, persistence, history and edit-delivery contracts; Link guest remains outside browser collection and receives no new access.

## 📚 Supplied evidence and limits

Reviewed supplied current/source-bound receipts include 286 production contracts, 238 passing Docs SDK tests with two existing opt-in timing skips, 18 classifier controls, dependency/lint/format validation, 166 desktop controls, 85 sync/native tests and full TypeScript. Those are other executions with their stated source/hash bindings, not tests I claim to have rerun. I read actual decoded current logs and the retained nullable-pointer result and original Safari/callback failures. The coordinator independently verified all copied-source bindings and decoded archives; I did not repeat exhaustive archive hashing.

The fresh bounded overhead harness shows identical 14 native outcome hashes, off/on medians 0.664583/0.726514 ms per save (delta +0.061931 ms with overlapping ranges), and 500 pressure attempts reconciled as 64 admitted +244 overflow +192 transport/cooldown discard. Its in-process Sheet/collector scope excludes real browser rendering/network/SQLite/IDB and does not establish browser latency or explain old unprofiled spikes.

The postcommit policy receipt preserves the first failed overbroad per-file routing expectation and its correction. Full 152-path selection selects all 15 suites and rejects all 60 missing/skipped/failed/cancelled selected results, with 16 representative input cases. This is local routing evidence, not a hosted result.

No unchanged resource-aborted install/compiler/browser run, full hosted matrix, native Safari action or Linux-only process-supervisor run was repeated locally. Historical mobile 104.2/117.4/110.4 ms failures, callback timeout, nullable loader error, Firefox/history/restore fixture failures and inconclusive controls remain failures with their stated attribution limits.

## 🚦 Remaining gates, separate from scoring

Repair F1 and its regression locally, commit the complete candidate, and revalidate both independent reviews on that SHA before validation publication. All seven current-head CI gates and actual production diagnostic/export, callback/responsiveness, Chrome/Firefox/Safari, ordinary browser/Storybook, sized restore and maintenance/operational acceptance remain pending. No CI-result deduction, waiver, hosted pass, push, merge or cleanup authorization is implied by this review. Final review/check identities, measurements and finding disposition must enter maintained evidence or the final PR description.
