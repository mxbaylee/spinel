# 🔁 Independent full-L SPN-156 repair review B

Exact candidate **32897ce33c7924835a2700955c182364fff50f44** against actual base **87c34e30ed810e6789d876e55b23dcbb349fa506**; `/Users/mxbaylee/projects/spinel-spn-156`. Read-only nonimplementing review of the full174-file outcome, original main ticket, current canonical scope/repair/evidence, shared process/testing/personas, full source and repaired fixture delta. No other/prior grade was used to derive this assessment. No source edit, push, browser/native-app/compiler repeat. Final reviewed head and clean worktree verified.

## 🚧 Assessment and complete steps to100

**94/100: scope35/35; correctness21/25; regression18/20; workflow/operations10/10; maintainability/complexity10/10.** One actionable underlying finding, with a missing detecting regression. No CI-result deduction. This exact candidate needs repair and revalidation before publication.

**[P2] A rejected storage fence strands item admission.** Location: `web/offline/offlineStore.ts:822`, with registration at815–820 and cleanup beginning844. `withOfflineItemWriter` registers an unresolved `completed` promise in `temporaryItemWriters`, then calls `offlineEpoch()` before entering its `try/finally`. `offlineEpoch()` calls `preparationCancellation()` and reads browser storage; denied/unavailable storage or failed cancellation-token creation throws. That exception bypasses `writers.delete(completed)` and `finish()`. Even after storage becomes available, `reserveOfflineReplay` refuses that account/item and `withOfflineEditorAdmission` waits forever on the stranded promise in its initial `Promise.all`. No actual Web Lock is needed to produce the blockage.

All steps to100 are local:

- **4 correctness points:** capture the potentially throwing epoch before registering the temporary writer, or place capture inside the cleanup-protected try. Ensure every failure after registration removes the reservation and resolves its completion waiter. Preserve original error/authority refusal and the real item-writer contract; do not catch it as successful admission.
- **2 regression points:** add a maintained direct wrapper regression in `src/ui/offlineWriterHandoff.test.ts`, not only a `createReplayAdmission` transport test. Deny the initial cancellation/fence storage read, assert original rejection and zero operation, restore storage, then prove an actual replay reservation and subsequent editor admission succeed without waiting on the failed writer. Include the relevant missing/denied fence case with safe test cleanup. The test must fail on32897 and pass with the bounded repair.

The existing transport-denial tests are useful but start below this wrapper boundary and therefore cannot detect this leak. No additional point-bearing or externally blocked repair step was found. Remaining hosted/phone acceptance is a merge condition, not a score deduction.

## 🧪 Direct reproduction and own controls

I created only a scratch TypeScript regression under `/tmp`, importing the exact real `web/offline/offlineStore.ts` module. It uses actual Node Web Locks, a denied localStorage read followed by restored storage, and actual exported reservation/editor-admission functions; no extracted source, lock-manager model, source mutation, IDB/native app or browser.

First attempt output:

`{"initialRefusal":"Offline downloads need browser storage. Allow storage or free up space, then try again.","workRan":false,"subsequentReplayReserved":false,"subsequentEditorEntered":false,"locks":{"held":[],"pending":[]}}`

The regression fails directly at expected `function` versus actual `undefined` for the new replay reservation after storage recovery. The editor acquire callback also remains unentered after an event-loop turn. This is a direct lifecycle failure, not a test timeout, native lock contention or resource abort. Guarded result: exit1,249ms,209552KiB. Artifacts: `/tmp/spinel-dependabot-2026-11-11/spn156-review-b-32897-epoch-leak.{ts,json,log}`. Exact command was `node /tmp/spinel-dependabot-2026-11-11/spn156-review-b-32897-epoch-leak.ts` through pinned Node/shared watchdog/serial.

Own existing relevant regression owners:

`node node_modules/vitest/vitest.mjs run src/ui/offlineWriterHandoff.test.ts src/ui/offlinePersistence.test.ts src/ui/offlineLifecycle.test.ts --cache=false --fsModuleCachePath=/tmp/spinel-dependabot-2026-11-11/spn156-review-b-32897-module-cache`

**86/86 passed across3files on the first attempt**,8575ms,1151872KiB, exit0. These cover the new cross-tab gate, real host/session cleanup and promotion/account lifetime. Their success does not negate the missing wrapper regression. Receipts/log `/tmp/spinel-dependabot-2026-11-11/spn156-review-b-32897-controls.{json,log}`.

Both commands used explicitly granted sole Mac slot, normal pressure, pinned Node26.13.0, shared serial/runtime watchdog, unchanged2GiB/eight-minute limits. No abort, install or shared cache modification. Explicit command/private-cache and node/esbuild worktree-cwd cleanup audit at2026-11-14T09:13:45.404305+00:00 found no owned processes, no kills and no serial lock. Receipt `/tmp/spinel-dependabot-2026-11-11/spn156-review-b-32897-cleanup.json`. Slot explicitly released immediately afterward. Later inspection was read-only.

## 🧩 Complete outcome and substantive repair review

Full effort remains L: app-running Doc/Sheet list reconnect and foreground return, exact native checkpoints/acknowledgment, authority/revocation/account lifetime, writer ownership, interruption/recovery, browser/native cleanup and installed-phone verification. No original requirement is silently assigned away. Closed-app OS background execution, iPhone acceptance and unrelated phone/image/creation changes remain out of scope. Branch-local ticket deletion/counter addition remain provisional.

The original event-driven account replay owner shares work across file-list surfaces and serializes eligible copies. It rechecks account/current scope and foreground item after storage/module boundaries, skips incompatible/uncertain/creation/read-only work, avoids own-checkpoint idle retry loops, and drains before remount ownership. The nonvisual host reuses the existing OfflineSession, NativeReplica and sync authority path. Acknowledgment must reach durable persistence before pending clears; stop quiets transport/producers before joining persistence/disposal. Background recovery cannot silently publish a copy or falsely complete failed work. Existing native content and persistence/authority assertions remain intact.

The new admission gate is a reasonable bounded cross-tab repair apart from the wrapper exception bug. Replay holds a shared account/item-scoped gate through actual job cleanup. Foreground first queues exclusive priority, then delivers scoped stop notification, so it does not deadlock waiting for the gate before asking its holder to yield. Queued exclusive priority prevents fresh shared replay from stealing the handoff. The real item writer remains authoritative and nonblocking; a live editor is not asked to yield and retains its immediate busy refusal. Gate lifetime ends after acquisition/temporary work, not after an entire editor lifetime.

Remote stop only applies to a matching account/item with an actual pending exclusive reservation; wrong-scope, stale-with-no-waiter and late retired listeners do not authorize work. Denied/missing notification, account invalidation and five-second queued admission timeout fail closed. Abort callback exclusion and subsequent exclusive progress are meaningfully checked. Native stop/join/drain precedes gate release, with nested cleanup handling and outer reservation completion covering gate refusal before work starts. No lock stealing, blanket retries or polling service was added. The observed wrapper fence-capture exception must receive the same cleanup guarantee.

All four personas remain considered: Owner can open or explicitly discard a queued copy from another tab without a nonexistent-editor refusal; Collaborator retains exact authored data, writer authority and account/revocation behavior; Operator retains bounded coordination and inspectable owned cleanup; Link guest receives no private store/replay authority. The finding affects Owner/Collaborator recoverability after a storage failure and is therefore a real implementation issue, not an optional polish request.

## 🧷 Browser fixtures, negatives and source binding

Quota and original-account exit cases now assert actual authored durable buffers, hold native resume while HTTP/image access remains available, and require zero submissions/unchanged server. Their original transaction/image/warning/account isolation/offline reopen assertions survive. This intentionally isolates pending-data behavior from the newly correct automatic replay, rather than suppressing the product feature under acceptance of replay itself.

The actual cross-tab discard case establishes pending556, held real resume and a shared replay gate before explicit discard; it still requires zero submits, local removal and unchanged server. Two original replay/revocation cases remain separate and still require native acknowledgment/exact server/peer data without reopening the originating editor. No exact repair-head browser result is claimed by source inspection.

The gate-bypass mutation retains the real item lock and directly fails both independent-tab non-null item-lock assertions. I inspected its retained output and positive/mutant/restored hashes; this detects missing coordination, not a timeout. The separate actual Chromium156 platform probe verifies abort rejection, callback exclusion, later exclusive acquisition and empty final ownership without booting the application. Its source/config/result are separately labelled; it does not prove the native replay/discard integration or phone lifecycle. The earlier Node intermediate query anomaly is retained and correctly distinguished from orphan ownership by the subsequent-acquisition probe. No deterministic LockManager substitute was retained.

I independently verified the9 current repair-source SHA256 mappings, all24 ticket runtime/test Git blobs against8ef89a8211e9b6ad4c50c894de976fc9b438c677, and the evidence-only delta from integrateda2ee428272dd3a1fc12bf20bf11b685df226f451 to32897. All117 recorded dependency inputs match both current checkout and the actual clean donor5e72d33ac9cb3a86b3496345209493d6c86e469c. The historical2204 baseline is not relabelled as current donor. Current full type8899ms/1788528KiB and other worker receipts retain their actual identities; they are not my reruns. Existing native/browser selection and aggregate requirements are preserved, including the new narrow production platform case. No CI routing or deadline is narrowed for this repair.

The desktop actionability repair remains the unchanged single native click after enabled, clipped-center descendant hit readiness using the existing45-second poll. It does not dismiss the native warning, force a click, retry input or claim the warning trigger repaired. No new visual component/state was introduced, so no routine visual approval is granted or substituted for real interaction acceptance.

## 🧾 First outcomes and remaining acceptance

Original40dee0d3 results remain original-source observations. Its two new replay/revocation cases and native Doc/Sheet checkpoint cases passed; three other Playwright scenarios failed all configured attempts and Chrome desktop was obstructed by the native warning. Successful ACK/content evidence explains the quota/exit fixture assumptions but is not a data-loss claim. The cross-tab writer problem has distinct zero-submit/pending evidence. Published archive3b496299a9f91ca797c5d80683aaede15660842a remains a direct child of40de; no older pass is claimed for this changed runtime. Six local native browser failures/resource aborts and the new first local184/186 result remain retained with their dispositions.

After the local wrapper repair, require exact-new-head reviews and meaningful regression results. Current-source hosted acceptance still includes the2 original replay/revocation cases plus3 repaired lifecycle cases, Desktop actionability and all7 required gates. The authorized installed-phone observation remains an unavailable execution prerequisite; old Pixel10 symptom provenance and the small Chromium lock probe do not satisfy it. Actual157/groomed-main integration requires another exact delta revalidation before publication. These conditions remain unchanged and were not used as CI-result deductions.
