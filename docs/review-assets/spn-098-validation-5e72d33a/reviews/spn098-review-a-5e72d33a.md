# 🔎 Independent SPN-098 review A

Reviewed commit: **5e72d33ac9cb3a86b3496345209493d6c86e469c**.
Actual base: **754e65317744e5ce97ede501935c6586e4875f2a**.
Worktree: `/Users/mxbaylee/projects/spinel-spn-098-production`.
Reviewer is independent and nonimplementing. Source and worktree remained unchanged and clean. This assessment used the full candidate, original main ticket and SPN-157 prerequisite, grade-free historical evidence, current implementation record, process/runbook, testing policy, design playbook/theme and all four personas. It did not use other reviewers' numerical assessments.

**Score: 100/100** — scope 35/35; correctness 25/25; regression protection 20/20; workflow/operations 10/10; maintainability/complexity 10/10.

No actionable candidate defects or deductions found. Steps to recover withheld points: none. This is a qualifying pre-push assessment for the supporting validation only, not merge approval or a claim that SPN-157 is repaired. CI results are not scored.

## 🧩 Complete outcome and implementation

The complete L feedback outcome remains intact: explicit durable submission, exact retry identity and generation fencing, verified account/document context, both complete SQLite selections from one immutable snapshot and shared inclusive server-receipt window, bounded preparation/transfer, cancellation/expiry/revocation and cleanup, truthful sender/operator states, and deliberate truncation. No anonymous submission, inbox, raw URL/title/content attachment or broader document authority was introduced.

Reviewed the actual store/route/worker/export/transfer flow and its UI callers. Feedback commits synchronously before acknowledgment and remains outside the lossy observation queue; retry matching precedes new-report rate admission, while generation/session/account boundaries prevent rebinding or resurrection. Server-derived identity and live access checks constrain context. The export worker builds new selected databases rather than deleting excluded rows from copied files, preserving full matching rows without leaking excluded free-page data. Pair count/window/snapshot metadata share the frozen source. Preparation, transfer, active lease, free-space and size bounds remain explicit; cleanup failure retains the fence rather than permitting unsafe overlap. Transfer authorization is rechecked per chunk, with a deadline covering destination completion.

Sender failure/cancellation retains the exact attempted report and explains uncertainty; a new report requires explicit intent. Operator flags expose availability rather than messages, unknown flag loading stays unknown, and paired actions display shared scope/window and known collection limitations. Session loss, expiry, clear and download failure retain truthful state. Existing controls and production component stories keep the UI reasonably contained. The split between shared contract, storage/routes, worker/lease/transfer and sender/operator components corresponds to actual lifecycle boundaries rather than speculative abstraction.

All four personas are accounted for: Owner and Collaborator receive durable receipt and safe retry semantics without automatic private content capture; Operator receives bounded complete correlation files and clear failure/cleanup behavior without document access or an inbox; Link guest receives no feedback or management authority. Main's SPN-110 remains the separate observation-expiry owner; feedback retention and clear behavior are documented for either integration order.

## 🧪 Independent checks and evidence identity

I independently ran all 81 related diagnostics/context and landed ownership/control tests in 13 files on the reviewed checkout. Command:

`node node_modules/vitest/vitest.mjs run src/server/diagnostics src/ui/feedbackContext.test.ts src/server/maintenance/ownership.test.ts src/server/maintenance/supervisor-test-control.test.ts --cache=false --fsModuleCachePath /tmp/spn098-review-a-cache-5e72d33a`

Pinned Node26.13.0, shared serial/runtime watchdog, normal-pressure admission and unchanged2GiB/eight-minute guards were used. Result: **passed,4522ms,548096KiB process-tree peak**, no watchdog termination. Independent receipt/log:

- `/tmp/spinel-dependabot-2026-11-11/spn098-review-a-focused-5e72d33a.json`
- `/tmp/spinel-dependabot-2026-11-11/spn098-review-a-focused-5e72d33a.log`

Owned-process audit found no surviving test/watchdog/serial workload. The local slot was explicitly released to the manager immediately after testing; no browser rerun, full compiler repeat or Linux-on-Mac attempt was made.

Test-source review includes exact SQLite row/window membership and endpoint ties, other actors/unattributed system rows, ingestion/expiry after preparation, empty and feedback-only selections, real transactional/source/capacity/cleanup failure, idempotent lost acknowledgments and restart binding, generation/session/access refusal, stalled transfer completion and chunk revocation. Real browser cases preserve exact submitted text, stored identity/context and both downloaded databases; fresh hosted execution remains pending, so these source assertions and historical executions are not called a new browser pass.

Independently verified51 executable/configuration hashes against both current files and render/test commit23e7553ff4f35f5f03dfe51a644840994e52929e. Locked package inputs match the retained dependency installation. All16 current evidence payload hashes/byte lengths and compressed-log decoded hashes checked successfully. Both retained image mappings checked successfully:16 historical and16 fresh PNG hashes/lengths/dimensions, actual compressed manifest paths, stored SHA-256 and decoded SHA-256. The earlier stale-path/hash defect is not present in the current mapping. The44-story/220-state capture receipt is retained; it is distinct from my own81-test execution. Current TypeScript, lint/dependencies/format, backlog and exact-base policy receipts were inspected, not represented as my own runs.

Original supervisor failure/comparator, native timing failure and later evidence remain separate. The bounded actual-connection SQLite probe only excludes a particular effective-setting difference on the pinned Mac; its198ms run had no sampled RSS peak. It does not establish Linux timing or historical causality. Main allocations/completions and next_id161 are preserved, with SPN-098's own deletion/completion explicitly conditional. No rule reset or dependency waiver is inferred from that bookkeeping.

## 🖼️ Independent visual approval — agent review only

**Approved for exact5e72d33ac9cb3a86b3496345209493d6c86e469c, agent review only.** I actually opened and inspected all16 historical proposed/reference PNGs and all16 fresh actual PNGs, rather than approving from source or manifests alone. No blocking visual findings.

Historical reference source isea6aa741c89b3e52350849b73dbbc41ef3893fbc under `docs/review-assets/spn-098/`. Fresh captures are under `docs/review-assets/spn-098-post160/`, rendered at23e7553ff4f35f5f03dfe51a644840994e52929e with51 matching executable/configuration hashes on the final reviewed head. These are synthetic production Storybook fixtures, fixed clock2026-10-20T16:00Z, with emulated phone/touch states; they do not claim installed-phone or real database acceptance.

The inspected image set in each directory covers account draft light/dark/phone, failed draft phone-dark, long message phone, changed access phone, admin flag light, paired downloads light/dark/phone-dark, download failure phone, expanded limits phone, changed operator access phone-dark, old-feedback-only phone, guest editor phone, and diagnostics-clear navigation-block phone. Desktop viewports are1280×900 and phone viewports are390×900. The full-page clear PNG is390×4289 historically and390×4083 currently; those taller dimensions describe image size, not the viewport. Committed README capture conditions and manifests preserve that distinction. The manager subsequently clarified the external gallery captions to state it explicitly; no committed source, image or manifest changed.

Current screenshots follow existing theme tokens and dialog/menu patterns, remain readable in both themes, keep message/error/privacy guidance legible on phones, and distinguish failed/unconfirmed sends from saved reports. Operator screens present window/counts/limits and action state without report content or an invented inbox. Expanded disclosures use the existing scrollable dialog treatment. Destructive clear text names feedback and observations and states irreversibility while protecting unrelated data; blocked navigation is visible. The guest reference correctly lacks feedback authority. Focus/touch interactions are owned by the production story checks; screenshots alone are not claimed to prove their behavior.

## 🚦Remaining acceptance, without score deductions

- **SPN-157 remains an explicit merge blocker**, at `docs/todo/SPN-157.md` and the current-prerequisite/supporting-validation sections of `docs/implementation/SPN-098.md`. Its complete L investigation must diagnose the original named Linux process-handoff failures, repair a demonstrated cause where required, and establish actual Linux recovery/authority/persistence/cleanup/deadline acceptance. Classification: Linux/external execution plus substantive SPN-157 investigation; no repair inferred from SPN-160 instrumentation or a new supporting pass.
- Fresh selected combined-source browser, supervisor/recovery and required current-head gates remain acceptance owners. Classification: hosted/platform execution. Preserve first outcomes and exact source identities; the existing full feedback assertions and budgets must remain unchanged. Neither historical browser success nor the current Storybook captures substitute for them.
- A second independent exact-head review and accurately maintained PR evidence are still needed before the manager's supporting validation push. Classification: review/workflow. My visual approval and score apply only to the exact commit above.

There is no local code repair requested by this review. These explicit merge/validation conditions do not become a deduction for pending, absent or failed CI results, and none is concealed by the100 score.
