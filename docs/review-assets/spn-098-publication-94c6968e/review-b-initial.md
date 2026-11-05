# 🔎 SPN-098 takeover — initial independent review B

Read-only initial review of the uncommitted integration of published **ed7ef3da5e8d57fcef4b098064a6e8eba052b1b5** with main **2f442317dd2e1c188ae4a810ac094fd1162a4a2a**, in `/Users/mxbaylee/projects/spinel-spn-098-production`. Original ticket, process/testing/persona requirements, full changed-file scope, core production/store/export/route/UI paths and meaningful boundary controls were inspected. No implementation edits, dependency changes, tests, exports or heavy workloads were performed. The parent owns installation and verification. This is **not an exact-commit grade or merge approval**.

**No concrete blocking authority, durable-feedback or snapshot-selection defect found in this inspection.** Current integrated execution and visual evidence remain unverified. The points below identify the specific boundaries that must survive the fresh checks; they do not propose a broader framework or speculative product scope.

## 🔐 Authority and privacy

The dedicated feedback route derives the actor from the live authenticated everyday session, requires the matching account header, excludes Operator accounts, validates exact request/context keys and rejects automatic raw URLs or extra fields. A file context invokes current document access resolution, including Space child authority. The generation-bound HMAC uses the persisted session hash, so a lost acknowledgement can be retried after server restart without assigning the old report to a replacement session. Operator routes independently enforce the Operator role; prepared artifacts are bound to both actor and session hash.

Preparation rechecks the Operator/session and diagnostics generation after the asynchronous worker finishes and before responding. Download checks authority, generation, expiry and cancellation for each admitted stream chunk. This is a forward boundary: already-sent bytes cannot be recalled. The implementation does not claim that revocation erases a previously downloaded artifact. Fixed filenames and validated scope avoid request-controlled filesystem paths. Public errors are sanitized; intentionally submitted feedback is retained, but unrelated document contents/titles and credentials are not automatically captured.

UI entry points exclude guests and Operators, preserve drafts after unconfirmed sends, keep attempted payload identity frozen for retry, and key the composer by account. Failure to load feedback flags is represented as unknown, not absence. These are appropriate Owner/Collaborator/Link guest boundaries.

## 💾 Durability, idempotency and truncation

Feedback bypasses the lossy observation queue. The store uses synchronous FULL durability and an explicit transaction; acknowledgement follows COMMIT. Generation is checked before matching an existing report. A duplicate is accepted only for the same actor and exact message/context, without consuming a fresh rate allowance. A changed payload conflicts. Physical/logical/reserve checks produce a visible failure rather than incrementing best-effort loss counters or silently dropping a report.

Successful truncate changes generation in the same transaction as deleting rows, then clears old buffers and invalidates feedback exports. A pre-clear retry therefore cannot resurrect its report after restart. A failed transaction does not clear those buffers or pretend to succeed. New intentional submissions can create new flags. The real-store tests cover lost acknowledgement/restart, generation fencing, rollback, capacity, duplicate payload/actor behavior and durable flags.

SPN-110 remains a separate unmerged TTL owner in the maintained record. Existing simulated expiry and retention metadata support the interface, but are not execution of the combined future implementation. The recorded requirement that the second landing ticket run the retained actual expiry/export integration must remain intact.

## 📦 Paired export and cleanup

The worker takes one committed SQLite snapshot before choosing the selected actor's inclusive server-receipt window. Both artifacts come from that same frozen database. The user artifact includes only matching actor rows; the system artifact includes all actor and unattributed rows in that exact span. Empty actor selection returns empty without widening the system scope. Old feedback-only spans are explicitly described. Metadata retains snapshot ID/generation/watermark, counts, time basis, retention/drop limits and unknown historical completeness.

Crucially, each artifact is a fresh filtered database, rather than copying and deleting excluded rows and leaving their bytes in free pages. The frozen source is removed after preparation; idle retained pairs do not keep a live SQLite read lock. One bounded retained lease prevents unbounded staging allocation. Preparation has worker heap/time/disk bounds, transfer uses pipeline cancellation through destination finalization, and expiry/cancel/truncate invalidate the lease. Directory removal failure leaves a cancelled occupied lease that cannot be downloaded or replaced until cleanup succeeds. Startup removes interrupted owned staging directories.

The existing tests meaningfully exercise real SQLite and worker boundaries: exact tied receipt-time membership, ingestion/expiry between downloads, empty and feedback-only spans, lost ready acknowledgement, late session/role/truncate change, disconnect while JSON response is unfinished, real staging failure and denied directory removal followed by recovery. Transfer tests cover per-chunk denial, abort before another source chunk, and a destination stalled after source EOF. These are outcome controls, not just copies of implementation branches.

## 🧪 Concrete verification still needed

1. Commit the complete integrated candidate after current installation/checks; record its exact SHA/tree and new base. Old ed7/f9/e6/066 evidence cannot be promoted to current-head passes. The current merge is uncommitted and cannot receive a qualifying numerical review yet.
2. Run the existing diagnostics store, route, capacity, transfer and context suites on the installed current tree. Retain any first failures and cleanup disposition. Full types/lint/backlog and dependency checks must be current or explicitly resource-blocked; don't infer them from old archived logs.
3. Current browser acceptance must exercise actual submission with a retained failed draft, real paired downloads and row/metadata comparison, truncation/flag refresh and unauthorized operations. Historical feedback-only browser exports do not replace the mixed/unattributed row tests; preserve that ownership distinction.
4. Current production-component light/dark/phone evidence and independent visual review are required. Old screenshots and the retained Storybook source manifest remain historical until exact component/dependency/source applicability is established. Keyboard/focus, pending/failed/expired/cancelled states and draft retention belong in that review.
5. Reconcile current file-based CI selection and all selected missing/failed aggregates on the committed source. The one workflow addition preserves the browser paired-result JSON; it does not by itself prove that the broader integrated test plan ran.
6. Before publication/landing, update the maintained takeover checkpoint and PR receipt with exact review/check identities, current acceptance state, failed/superseded runs and residual SPN-110 integration obligation. The current end of the implementation record still describes the previous main refresh. Conditional ticket deletion/ledger/index preparation must not be reported as completed work before acceptance.

## 👥 Scope and complexity judgment

Owner and Collaborator get durable deliberate feedback and safe retry without automatic content capture. Link guest exclusion is preserved. Operator receives complete inspectable paired datasets with explicit limits, cancellation and controlled resource use, without an inbox/query-management product. The worker/lease/stream split is justified by snapshot consistency, privacy and bounded cleanup. I found no concrete avoidable abstraction that warrants a redesign at this checkpoint.

Proceed with the existing finite local/hosted verification and a complete committed candidate for two independent exact-head grades. No additional native experiment or unrelated changes to SPN-090/SPN-146 are recommended by this review.
