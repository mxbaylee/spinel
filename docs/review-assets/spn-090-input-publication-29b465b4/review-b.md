# 🔎 SPN-090 exact-source review B — 30fbfef9

**94/100. Withhold validation publication of this exact candidate until the cleanup finding below is repaired and the complete new head is independently revalidated.** This is a source review, not a physical-device plan or merge approval.

Reviewed clean commit `30fbfef980a5f257b7879cf6dead0541ad207a23` in `/Users/mxbaylee/projects/spinel-spn-090-production`, against `origin/main` `2f442317dd2e1c188ae4a810ac094fd1162a4a2a`. I read the original ticket, process/testing/personas/rubric, full PR file/scope inventory and representative authority/storage integration, and the entire six-file d4eeeb8b→30fbfef9 delta. The other full-PR source is byte-unchanged from the prior candidate I independently reviewed; its retained tests/native/CI/build/visual and failed-phone observations remain historical evidence, not current-head acceptance credit. No implementation edits or workload reruns were performed.

## ❌ P2 — preliminary screenshot failure skips temporary recorder removal

At `scripts/ci/browserstack-acceptance.ts:755`, nativeType calls `driver.diagnose(stop)` after an operational failure. The actual supplied helper, `failureDiagnosis` in `browserstack-offline-preparation.ts:53–61`, awaits the screenshot before invoking `work`. If capture or screenshot persistence rejects, `stop` never runs. The new listeners and up to 16 retained Event references therefore remain installed until the page/session is destroyed, despite nativeType having entered its owned cleanup path. Recording `cleanup: 'failed'` correctly avoids a false success but does not perform best-effort removal.

Concrete trigger: the existing dropped-third-character failure followed by an unsuccessful failure screenshot. No additional hypothetical production mutation is required. Preserve the dropped-character cause and the screenshot failure, but attempt the recorder's single bounded removal even if that preliminary evidence operation fails. Do not resend input, add a new polling loop or extend the lane deadline. Preserve the original failed command when an independent cleanup attempt changes the command journal.

The new fake-driver test omits `diagnose`, so it exercises only direct `stop()` and misses this actual integration boundary. Add a control with the real helper or a faithful rejecting pre-work screenshot path: removal attempted exactly once, no replay, first error retained, cleanup state truthful, and secondary failure visible. A failed removal must not be repeated merely because the first call may already have stopped the recorder.

## ✅ Other source findings and prior constraints

The small dedicated observation module is appropriately scoped. Its passive capture listeners store at most 16 event references per key range; overflow is sticky, snapshots are copied, strings are allowlisted/redacted, and it returns no key/text/input payload or DOM reference. The existing component-name field remains bounded and sanitized; event target/focus evidence is boolean. No new product authority or guest access is introduced.

Final cancellation is read only after `eventPhase === 0`; pending dispatch is explicit. This is simpler and safer than adding deferred finalizers. There are no callback queues to outlive the recorder. Stop is idempotent and identity-fenced so an old instance cannot delete a replacement. The focused existing execute command marks each sequence range; neither additional key delivery nor a new observation polling loop was introduced. Ranges describe observation order, not proof that an event belongs causally to that key. Empty ranges are explicitly not proof of global absence of DOM delivery.

The per-key native keyDown/keyUp payload, two-second insertion deadline, broader bounds and final authored-content requirements remain intact. Successful input with stale/overflowed/pending or malformed observation fails closed. The deadline snapshot remains separate from cleanupObservation; a late insertion during cleanup cannot rewrite a failed count. Operational errors are kept primary when removal or final record fails. The single finding concerns whether the actual caller reaches removal after screenshot failure, not a claim that the normal stop implementation is ineffective.

The existing broader repairs remain coherent with the original outcome: shell installation assets are digest-bound and stay in the offline descriptor; persistence feedback is nonblocking and updates only its own still-current result object; account scope remains fenced; renderer splitting preserves all modules offline and editor-reachable; bootstrap evidence remains opt-in and content-free. The original Safari `731`→`73` failure and earlier storage/provider observations are retained rather than converted into successes.

## 🧪 Verification assessed

Inspected the retained receipts in `/tmp/spn090-input`: 97 combined acceptance/capability/observation controls passed in 36,157 ms at 751,360 KiB, normal pressure. Eleven CI-plan controls passed in 260 ms at 90,368 KiB, including selected missing/failed work remaining red. Scoped typecheck passed in 1,006 ms at 630,560 KiB after the retained initial trace-inference type error was corrected. Scoped lint/format, backlog and committed PR checks passed. These are donor-tooling/scoped checks, not a full installation, full application typecheck/build or physical runtime observation on this source.

The VM controls meaningfully cover pending/final cancellation, copied snapshots, ordered ranges, late-event ambiguity, overflow, replacement, malformed observations and final-read removal. Fake-driver controls retain a missing third insertion, late cleanup insertion, dispatch/removal/record failures and no resend. The missing real diagnose integration control is material to the stated lifecycle contract. No extra browser benchmark or generic framework is needed to fix it.

New executable scripts remain outside the documentation-only allowlist and their `scripts/ci/*.test.ts` owner is selected by ordinary CI routing. No device trigger or paid allowance is introduced by this delta. Exact-current hosted gates, applicable native/Storybook owners and visual revalidation remain pending; previous d4eeeb8b passes are not those gates. A separate finite device plan would still be required after qualifying reviews and ordinary validation.

## ⚖️ Rubric and complete scope

- **Scope and acceptance: 35/35.** Full XL outcome and unfinished physical input/Chrome storage work remain visible; the owner's Firefox provider-blocked/unobserved disposition is preserved without inventing another allocation requirement.
- **Correctness, integrity and access: 22/25.** Deduct three for the concrete screenshot-before-removal lifecycle gap. The failed lane remains failed and content/access guarantees are not weakened.
- **Meaningful regression protection: 18/20.** Deduct two for omitting the real diagnose boundary from the cleanup controls. Existing tests are otherwise at the cheapest meaningful layer and preserve the first failure.
- **CI and operations: 9/10.** Routing and bounded local evidence are present; full current-head hosted integration remains unexecuted. No physical execution is precredited.
- **Maintainability, process and over-complexity: 10/10.** One focused module, no queued callback infrastructure, no dependency or speculative transport abstraction. The 29,617 changed-line soft warning is serious review cost, but most scope predates this 661-addition/135-deletion delta and includes durable evidence. This diagnostic boundary belongs to the existing native acceptance owner; splitting it as a new feature would not complete or reduce the original physical obligation. Keep the concise checkpoint and immutable first-failure links rather than duplicate ledgers.

All four personas remain represented: Operator receives bounded redacted diagnostics and reliable cleanup; Owner and Collaborator retain real native editing, durable offline content and complete reconnect requirements; Link guest sees no broader account or offline authority. None benefits from a synthetic edit, omitted native assertion or failed attempt relabeled as acceptance.

Disposition: repair P2, retain this exact-head finding/grade, commit the complete candidate and obtain fresh independent reviews. No device execution or merge approval follows from this report.
