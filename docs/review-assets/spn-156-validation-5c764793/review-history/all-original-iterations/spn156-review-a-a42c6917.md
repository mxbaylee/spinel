# 🔎 Independent full SPN-156 repair review A

Exact reviewed candidate **a42c6917ea2d5c75dcc7cfa34467b5a58d44a8d8** against actual base **754e65317744e5ce97ede501935c6586e4875f2a**, clean worktree `/Users/mxbaylee/projects/spinel-spn-156`. Independent, nonimplementing, read-only review; no other or prior numerical review was consulted.

**100/100: scope35/35, correctness25/25, regression protection20/20, workflow/operations10/10, maintainability/complexity10/10.** No actionable candidate defect found, no withheld points and no repair steps to recover points. CI results are not scored. This qualifies as one exact-head pre-push review, not full L acceptance or merge permission.

## 🧩 Complete outcome and repair scope

I revalidated the complete base-to-head outcome against the original main ticket, canonical scope/capability/first-failure/verification record and all four personas, with particular attention to the three changed fixture files. All16 original replay runtime/test Git blobs remain identical to the independently inspected and tested source40dee0d3. The three repair files match committed checked source def39e338f9aab57e11a940aa1622b5015f1f930; def39e33→a42 changes documentation/evidence only. No replay runtime, budgets, content assertions, permission rules, native adapter or lifecycle ownership changed in this repair.

The complete L remains event-driven account-scoped serial replay of saved Doc/Sheet work from a running file list, using the existing native client, OfflineSession, scoped authority, immutable retry envelope and durable checkpoint path. Foreground writer priority, account/epoch/access admission, cross-tab contention, interrupted persistence, conservative lost-ack/conflict recovery and cleanup are retained. No raw-frame uploader, new engine, hidden visual editor, polling service or guest-private-store path is introduced. Existing pending/synced/attention UI remains unchanged, so routine captures/new visual approval are inapplicable.

The narrow fixture repair is justified by the demonstrated covered-control admission gap. It is not claimed to fix the native permission warning's unknown trigger. Owner/Collaborator retain the original exact-content, recoverability and permission contracts; Operator retains bounded execution and first-failure evidence; Link guest receives no new store, replay or authority. There is no accepted-scope reduction, deferred in-scope repair or phone waiver.

## 🖱️ First failure and actual caller/geometry assessment

I inspected the original Chrome acceptance JSON, raw job log and actual failure screenshot under `/tmp/spn156-validation-40dee0d3/`. Verified original ZIP SHA-256 `c7887b140a624c9387eae654ca1a376cf0beee1e031739eeeba379acacf3b479`. Source40dee0d3, tested merge eaaf75f393ab91d9fd1120cbff63c034b481bada, Desktop run43572863994/attempt1, Chrome job132380800458 and artifact14105073087 match the canonical record.

The screenshot visibly shows the top-center native warning covering the Save details control; WebDriver reports intercepted click at(638,30), naming that warning toast. Acceptance JSON retains the published-copy status and preceding successful normal Sheet, conflict Sheet and normal Doc stages, plus browser5058/driver5054 cleanup. It does not complete later conflict-Doc/storage-loss assertions. Safari/Firefox results are separate; none explains the warning trigger, substitutes for Chrome or proves installed-phone acceptance.

At `scripts/ci/desktop-pointer.ts:14`, `namedPointerTarget` performs read-only readiness: selector/name, connected HTMLElement, enabled state, finite first client rectangle, nonempty viewport intersection, and target/descendant membership at the floored center of that clipped rectangle. The geometry matches the intended WebDriver click admission point; partly clipped rectangles and boundary/zero/non-finite cases are controlled explicitly.

At `scripts/ci/desktop-offline.ts:76`, the existing45-second bounded poll now uses this predicate and then invokes the same single `browser.click(selector,index)`. There is no input during polling, force-click, toast dismissal/style mutation, permission change, click retry or deadline increase. Persistent obstruction fails. A new obstruction or DOM change after readiness can still make the ordinary native click fail; the helper does not conceal that failure. Chrome/Firefox still execute the existing WebDriver element click. Safari retains its existing focus/native activation path; this repair does not introduce a synthetic DOM click or alter native pointer identity/delivery checks.

A read-only generated-expression check also confirmed whitespace normalization: the TypeScript template has two backslash characters and emits one in the regex; a name containing newline, tab and repeated spaces correctly normalizes to the target (index0). There is no escaping defect.

The changes cover all existing named-control call sites, not just Save details. Existing content, recovery-copy/original-state, storage-loss and cleanup assertions are unchanged. NativeDesktop workflow path selection includes `scripts/ci/desktop-*.ts`, and the Node script test glob includes this test. No CI routing or selection is narrowed.

## 🧪 Independent local checks and retained source evidence

On exact a42c6917, independently ran:

`node --test --test-concurrency=1 scripts/ci/desktop-pointer.test.ts`

through pinned Node26.13.0 and the shared serial/runtime watchdog, normal-pressure admission and unchanged2GiB/eight-minute guards. **65/65 passed,217ms,230880KiB process-tree peak**, no abort. Receipt/log:

- `/tmp/spinel-dependabot-2026-11-11/spn156-review-a-pointer-a42c6917.json`
- `/tmp/spinel-dependabot-2026-11-11/spn156-review-a-pointer-a42c6917.log`

The test uses Node's built-in runner and VM fixtures, so no dependency install or shared Vitest cache was needed. Owned-process audit found no surviving test/watchdog/serial workers; clean source was reconfirmed. Mac workload slot was explicitly released immediately after the run. No full176-test repeat, compiler repeat, browser attempt or mutation was performed by this review.

Reviewed the new controls for meaningful failure detection: an otherwise connected/visible/enabled target is rejected while covered, remains rejected on repeated reads, then becomes admissible only when uncovered; descendant hit succeeds without posting input; disabled/hidden/missing/disconnected/name-mismatch, clipped-center geometry and invalid/outside rectangles are covered. Existing Safari pointer controls continue to pass.

Inspected the retained hit-test-removal negative: it failed directly at the blocked-control expectation (`0 !== -1`) without timeout/resource abort. Verified restored current helper SHA-256 `be3c3a510c6d18c751750eed633fea73102b45a629a246913b51a77c2e94ca34` against the recorded corrected source. It detects the demonstrated fixture defect rather than an incidental setup failure. Worker full type/lint/format/backlog/PR evidence binds def39e33's identical source; I do not relabel those checks as my own executions.

My previous independently executed176 lifecycle/persistence/replay/binding controls and2 real native Doc/Sheet checkpoint tests retain their actual40dee source identities and remain applicable only after the verified16-file identity check. They are not new a42 executions. The real native cases protect exact restored content, immutable receipt identity, once-only server history, held acknowledgement persistence and durable reopen. Browser cases still own actual IndexedDB/transport integration and second-viewer content. All six original local browser first outcomes and their cleanup dispositions remain retained.

## 🚦Remaining required acceptance and publication conditions

No points are withheld for pending/failed CI, and no local repair is requested. The following remain mandatory, with exact scope intact:

1. **Current repaired native desktop acceptance:** `scripts/ci/desktop-offline.ts:76` and`:621`, plus existing recovery/content/storage-loss assertions. Execute the new reviewed source on its native owners; preserve the first40de failure. Classification: hosted/native execution. The warning trigger remains causally unproved; if it persists or exposes a product issue, diagnose it without suppressing warnings or weakening assertions.
2. **Both original replay/revocation browser cases:** `e2e/offline-editing.spec.ts:53` and`:167`. Prove exact durable Doc/Sheet queues, acknowledgements, server revisions/content and second-viewer content with the source file list still open; prove revoked edits remain unsent and recoverable without hidden copy creation. Classification: hosted/suitable resource environment. Both remain required/unverified for the accepted full L outcome; neither desktop partial stages nor the pointer unit tests substitute.
3. **Bounded installed-phone observation:** original main ticket Verify and canonical SPN-156 retained acceptance. Record authorized actual device/browser/repaired-build/installed context, offline authorship, file-list reconnect/foreground, pending-state outcome and peer content. Classification: unavailable authorized physical-device execution. No provider quota or routine human design approval is required; the old owner observation is not repair acceptance.
4. **Evidence and delivery:** the current first-failure JSON explicitly marks immutable archive publication pending manager verification. Preserve/publish the already-retained raw ZIP/log/screenshot/stages with its verified hash and exact identities, complete the second exact-head review, maintain PR evidence and require current selected gates before merge. Classification: evidence publication/review/hosted delivery. Reserved archive identity is not claimed already published. Any new head requires appropriate revalidation.

Provisional ticket removal/completion accounting remains conditional. The complete L outcome is not accepted or mergeable merely because this local review qualifies. No push, merge or source edit was performed.
