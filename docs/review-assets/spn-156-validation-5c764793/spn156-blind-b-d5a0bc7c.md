# 🔎 SPN-156 independent full-outcome review B

**Candidate:** `d5a0bc7cad087ce30f48861b276996fd31d3af94`  
**Actual base:** `87c34e30ed810e6789d876e55b23dcbb349fa506`  
**Reviewer:** `/root/spn156_blind_b`, independent, nonimplementing, read-only; agent review only.  
**Result:** **100/100**, no actionable code/test/documentation findings. This is a pre-push review, **not acceptance of the complete ticket or permission to merge**. Current hosted and installed-phone acceptance remain required below.

## 📏 Full rubric

- **Ticket scope and acceptance criteria: 35/35.** I assessed the original complete L outcome, including native capability, integration, authority, persistence, interruption/recovery, bounded ownership, and phone acceptance. The implementation and maintained verification owners cover the original outcome; the canonical record expressly retains unperformed acceptance. No requirement has been moved into an unaccounted follow-up. Provisional ticket deletion/completion-counter changes are appropriate landing preparation under the runbook, not proof of completion.
- **Correctness, data integrity and access: 25/25.** Existing NativeReplica, OfflineSession, scoped HTTP and sync-client checkpoint owners are reused. Item writer ownership remains authoritative. Foreground admission reserves priority and joins replay teardown; live editors retain immediate nonblocking refusal. Denied storage now throws before temporary-writer registration, and the actual exported wrapper regression verifies recovery of replay, editor and maintenance admission. The reviewed paths preserve account/item fences, pending work, immutable retry identity, durable acknowledgement, and visible recovery ownership.
- **Meaningful regression protection and evidence: 20/20.** Independently executed the complete actual writer owner, actual native Doc/Sheet checkpoint owner and desktop pointer owner on this exact candidate, all passing. Inspected surrounding coordinator, actual-session/persistence, binding stop/join and real-store notification controls and retained source-bound runs. The gate-bypass and original-epoch mutations fail at direct contract assertions, not timeouts. The browser fixtures assert authored pending content, durable clean state, exact server revision/content and peer content. Phone and current hosted results are not inferred from these lower layers.
- **Delivered workflow and operational usability: 10/10.** Existing file/dependency selection and seven required aggregates remain intact; production owns quota/discard/account-exit, sync-production owns native file-list replay/revocation, and the library partition owns native checkpoints. Desktop readiness preserves one ordinary native click, warnings and the existing deadline. Failure diagnostics, resource aborts, first attempts and exact source identities are retained. No points are deducted for any CI result.
- **Maintainability, documentation and complexity: 10/10.** The coordinator, nonvisual host and narrowly scoped cross-tab admission have separate purposes without a second sync engine, uploader, persistent queue, polling service or new dependency. Necessary authority/cleanup safeguards justify their complexity. All four personas and early complete-scope checkpoints are recorded. Runtime changes remain TypeScript; dependency/package boundaries are unchanged. The canonical record preserves the original chronology and makes current acceptance status explicit.

## 🧭 Scope and source inspection

Read the review packet, actual-base full change set, repository AGENTS.md, process/runbook, all four personas, sustainable-testing policy, implementation-record convention, complete 1,081-line canonical SPN-156 record, and original allocated/retained ticket specifications from Git. Inspected all 24 ticket-owned runtime/test files in the base diff and relevant surrounding authority, native binding, store/session, CI selection and Playwright configuration. No historical numerical review report, numerical PR review section or other reviewer grade was opened or used.

The packet full.diff SHA-256 is `1caba73e258e41b4074b0333f0c6960794c41bbf9035fa99c5fe4ea26092dd34`. Read-only verification found all 24 owned runtime/test blobs identical to epoch-repair source `16f4bb3b`; all 117 recorded dependency-input SHA-256 values match both this checkout and its recorded donor path. These comparisons support reuse of source-bound prior evidence and do not relabel historical runs as new executions.

Important reviewed boundaries:

- `web/offline/replay.ts` scopes one event-driven account owner to mounted, visible, prepared-account file-list surfaces, excludes foreground items, serializes native jobs, and ignores its own checkpoint notifications as retry triggers. Account-lock contention waits for a later meaningful event rather than polling.
- `web/offline/replayHost.ts` rechecks lifetime after admission, restores the actual native/session path, disables hidden recovery publication, and joins quiet persistence before nested cleanup releases session/native/reservation ownership. The shared admission gate stays held through cleanup.
- `web/offline/replayAdmission.ts` queues exclusive foreground priority before notification, checks matching account/item and a presently queued reservation, and preserves fail-closed cleanup on denied/missing transport, invalidation and timeout. Actual item locks remain the final writer authority.
- `web/offline/offlineStore.ts:814` captures the storage-backed epoch before allocating/registering a temporary writer. `src/ui/offlineWriterHandoff.test.ts:53` exercises that actual wrapper and detects the previous leak before any blocked editor wait.
- The new native checkpoint owner uses actual Doc and Sheet commands, destroys the original host, restores the retained checkpoint into a new host, checks exact content and duplicate prevention, and keeps pending true until acknowledgement persistence commits.
- Quota/original-account fixtures now deliberately hold native resume while their HTTP/image scenarios remain available. They assert actual authored buffers and zero submissions rather than assuming reconnect leaves a queue pending. Cross-tab discard establishes the held replay gate and authored buffer before exercising product handoff. Original transaction/image, server preservation, warning, isolation and reopen assertions remain.
- Desktop hit readiness only reads enabled state, clipped geometry and descendant hit membership. It neither posts during polling nor hides the permission warning. Its product cause remains unclaimed and current native interaction acceptance remains pending.

Owner and Collaborator benefit from durable, authority-safe replay and foreground priority. Operator retains bounded native work, no new service and inspectable cleanup. Link guest receives no private replay/store capability. There is no changed visual component, layout/theme or new presentation state; existing interaction acceptance applies without an invented screenshot matrix.

## 🧪 Independently executed checks

Execution was deferred while another reviewer owned the shared slot and while pressure was elevated. After explicit handoff, pressure was 1. Both commands used pinned Node `26.13.0`, `/tmp/spinel-dependabot-2026-11-11/watch.ts`, the repository serial runner, unchanged normal-pressure/2 GiB/eight-minute bounds and no shared installation writes.

1. Complete `src/ui/offlineWriterHandoff.test.ts` plus `lib/sync-client/tests/headless-checkpoint.test.ts`: **22/22 passed**, first attempt, guarded **7,590 ms**, peak **831,744 KiB**. Vitest `5.1.0`, `--cache=false`, private cache `/tmp/spn156-blind-b-d5a0bc7c-cache`.
   - Receipt: `/tmp/spinel-dependabot-2026-11-11/spn156-blind-b-d5a0bc7c-writer-native.json`
   - Log: `/tmp/spinel-dependabot-2026-11-11/spn156-blind-b-d5a0bc7c-writer-native.log`
2. Complete `scripts/ci/desktop-pointer.test.ts`, Node `--test --test-concurrency=1`: **65/65 passed**, first attempt, guarded **216 ms**, peak **142,992 KiB**.
   - Receipt: `/tmp/spinel-dependabot-2026-11-11/spn156-blind-b-d5a0bc7c-pointer.json`
   - Log: `/tmp/spinel-dependabot-2026-11-11/spn156-blind-b-d5a0bc7c-pointer.log`

No browser/native-app repetition, build, compiler, mutation or broad unaffected-suite rerun was performed by this reviewer. Retained broader checks keep their original identities. I inspected the original-epoch and gate-bypass negative logs and restoration hashes; they respectively fail the replay-reservation and non-null item-lock invariants. The retained Chromium platform result proves cancellation/progress/empty final ownership only.

A read-only `git diff --check` reports trailing whitespace solely inside verbatim retained first-failure console/error-context payloads. I do not propose changing original diagnostic bytes or deduct for their preservation. The repository remained clean. Post-run process inspection found no owned workload candidates, and `/tmp/spinel-test.lock` was absent. The manager was notified that the slot was released.

## 🚧 Required acceptance and delivery work

These are explicit merge prerequisites, not asserted passes or score deductions:

1. On the eventual reviewed/published source, complete both original native file-list replay/revocation cases and all three repaired production lifecycle cases. Preserve exact build/tested identities, first failures, retries and durable/server/peer assertions.
2. Complete current-source native Desktop interaction acceptance, including the formerly obstructed control and subsequent recovery/storage-loss assertions. A VM readiness pass does not prove the real native interaction or resolve the warning's product cause.
3. Pass all seven current-head required gates with complete selected worker evidence. No old-head result, skipped selected worker or pre-push grade substitutes for this.
4. Obtain an authorized installed-phone session and execute the bounded repaired-build Home Screen offline-edit/list-reconnect or foreground observation, recording device/browser/build identity and exact content outcome. Earlier Pixel symptom notes and Chromium emulation do not qualify it.
5. After any real-main integration or candidate edit, revalidate the exact new SHA with both reviewers before validation publication. Preserve final review/check identities and failure dispositions in durable final PR/maintained evidence. After accepted squash merge, verify the merge and enumerate/preserve/delete obsolete ticket-created branches with head/active-PR ownership checks; record any access-blocked cleanup.

The original failed `40dee0d3` validation remains failed. I inspected its immutable archive binding at `3b496299a9f91ca797c5d80683aaede15660842a`, retained three-case/nine-attempt failure records, replay/revocation diagnostic summary, and Desktop Chrome acceptance payload. These confirm distinct original successful replay observations and unresolved lifecycle/Desktop failures at that original source. None is relabelled as a repaired-source pass. The archive tag name was not a local ref; the recorded immutable commit was available and used directly.

## ✅ Every actionable step to 100

None: no points withheld and no actionable source/test/documentation defect established. The numbered acceptance/delivery prerequisites above still block completion and merge. The full outcome remains L and incomplete until they are actually satisfied.
